"""Discovery jobs: one scan at a time, streamed to the app as it goes.

A job runs three passive collectors (mDNS, SSDP, the subnet probe) while the selected adapters run their
own vendor discovery (UDP broadcasts etc.). Adapters then interpret the passive records. Every candidate
goes through `_accept()`, which deduplicates by adapter and device id, keeps the freshest address, notes
whether the device is already paired, persists it and publishes `discovery.candidate`.

Detection is not control: a candidate's `control` says whether the gateway can actually operate it.
"""

from __future__ import annotations

import asyncio
import json
import logging
import secrets
import time
from collections.abc import Awaitable, Callable

from ..adapters.base import DeviceAdapter, ScanContext
from ..adapters.registry import AdapterRegistry, guard
from ..config import Settings
from ..db import Database
from ..events import EventBus
from ..models import Candidate, ConnectionStatus, DiscoveryJob
from ..netutil import is_private_host, scan_subnets
from ..tasks import spawn
from . import ssdp, subnet
from .mdns import MdnsService

log = logging.getLogger("cube.discovery")
GENERIC_ID = "generic"


class _Job:
    def __init__(self, job: DiscoveryJob, scan: ScanContext):
        self.job = job
        self.scan = scan
        self.task: asyncio.Task | None = None


class DiscoveryEngine:
    def __init__(
        self,
        registry: AdapterRegistry,
        db: Database,
        bus: EventBus,
        settings: Settings,
        mdns: MdnsService,
        paired_lookup: Callable[[str, str], Awaitable[str | None]],
    ):
        self.registry = registry
        self.db = db
        self.bus = bus
        self.settings = settings
        self.mdns = mdns
        self.paired_lookup = paired_lookup
        self.candidates: dict[str, Candidate] = {}
        self.jobs: dict[str, _Job] = {}
        self._persist: set[str] = set()

    async def load(self) -> None:
        rows = await self.db.fetchall("SELECT data FROM candidates WHERE last_seen > ?", (time.time() - 7 * 86400,))
        for row in rows:
            try:
                candidate = Candidate.model_validate_json(row["data"])
            except ValueError:
                continue
            self.candidates[candidate.id] = candidate
        await self.db.execute("DELETE FROM candidates WHERE last_seen <= ?", (time.time() - 7 * 86400,))

    def running(self) -> _Job | None:
        return next((j for j in self.jobs.values() if j.job.status == "running"), None)

    def _select(self, brand_id: str | None, adapter_ids: list[str] | None) -> list[DeviceAdapter]:
        if adapter_ids:
            chosen = [self.registry.get(a) for a in adapter_ids]
        elif brand_id:
            chosen = self.registry.for_brand(brand_id)
        else:
            chosen = list(self.registry.adapters.values())
        return [a for a in chosen if a.available()[0]]

    async def start(
        self, *, brand_id: str | None = None, adapter_ids: list[str] | None = None, timeout: float = 12, subnet_scan: bool = True
    ) -> DiscoveryJob:
        current = self.running()
        if current:
            return current.job
        adapters = self._select(brand_id, adapter_ids)
        if brand_id == "other" or (not brand_id and not adapter_ids):
            # "Other": run everything, so a known device is recognised for what it is, not as "unknown".
            adapters = [a for a in self.registry.adapters.values() if a.available()[0]]
        timeout = max(3.0, min(60.0, float(timeout)))
        job = DiscoveryJob(
            id="job_" + secrets.token_hex(6),
            status="running",
            brand_id=brand_id,
            adapter_ids=[a.info.id for a in adapters],
            methods=["mdns", "ssdp", "vendor"] + (["subnet"] if subnet_scan and self.settings.subnet_scan else []),
            started_at=time.time(),
            timeout=timeout,
        )
        subnets = scan_subnets(self.settings.scan_subnets)
        runtime = _Job(job, ScanContext(timeout=timeout, subnets=subnets, report=lambda c: self._accept(runtime, c)))
        self.jobs[job.id] = runtime
        runtime.task = asyncio.create_task(self._run(runtime, adapters, subnet_scan and self.settings.subnet_scan))
        self._prune_jobs()
        self._publish(runtime)
        return job

    def _prune_jobs(self) -> None:
        finished = [j for j in self.jobs.values() if j.job.status != "running"]
        for old in sorted(finished, key=lambda j: j.job.started_at)[:-10]:
            self.jobs.pop(old.job.id, None)

    def get(self, job_id: str) -> DiscoveryJob | None:
        runtime = self.jobs.get(job_id)
        return runtime.job if runtime else None

    async def cancel(self, job_id: str) -> DiscoveryJob | None:
        runtime = self.jobs.get(job_id)
        if not runtime:
            return None
        if runtime.job.status == "running":
            runtime.scan.cancelled.set()
            runtime.job.status = "cancelled"
            runtime.job.finished_at = time.time()
            runtime.job.phase = "cancelled"
            if runtime.task:
                runtime.task.cancel()
            self._publish(runtime)
        return runtime.job

    async def _run(self, runtime: _Job, adapters: list[DeviceAdapter], do_subnet: bool) -> None:
        job, scan = runtime.job, runtime.scan
        progress_task = asyncio.create_task(self._progress_loop(runtime))
        try:
            mdns_types = sorted({t for a in adapters for t in a.mdns_types})
            ssdp_targets = sorted({t for a in adapters for t in a.ssdp_targets}) or ["ssdp:all"]
            if any(a.info.id == GENERIC_ID for a in adapters) and "ssdp:all" not in ssdp_targets:
                ssdp_targets.append("ssdp:all")
            ports = sorted({p for a in adapters for p in a.probe_ports})
            passive_window = min(job.timeout * 0.6, 8.0)
            job.phase = "listening"

            async def passive() -> None:
                results = await asyncio.gather(
                    self.mdns.browse(mdns_types, passive_window, scan.cancelled),
                    ssdp.search(ssdp_targets, min(passive_window, 4.0), scan.cancelled),
                    subnet.probe(scan.subnets, ports, scan.cancelled) if do_subnet and ports and scan.subnets else _empty_ports(),
                    return_exceptions=True,
                )
                for result, name in zip(results, ("mdns", "ssdp", "subnet"), strict=True):
                    if isinstance(result, BaseException):
                        log.warning("passive discovery failed", extra={"method": name, "reason": repr(result)})
                        job.errors.append(f"{name} discovery failed")
                mdns_records, ssdp_records, open_ports = results
                scan.mdns = [r for r in (mdns_records if isinstance(mdns_records, list) else []) if scan.in_scope(r.ip)]
                scan.ssdp = [r for r in (ssdp_records if isinstance(ssdp_records, list) else []) if scan.in_scope(r.ip)]
                scan.open_ports = open_ports if isinstance(open_ports, dict) else {}
                job.phase = "identifying"
                scan.passive_done.set()

            specific = [a for a in adapters if a.info.id != GENERIC_ID]
            generic = next((a for a in adapters if a.info.id == GENERIC_ID), None)

            async def run_adapter(adapter: DeviceAdapter) -> None:
                try:
                    await guard(adapter, "discovery", adapter.discover(scan), timeout=job.timeout + 4)
                except Exception as error:  # noqa: BLE001 - one adapter's failure is reported, others continue
                    message = getattr(error, "message", None) or repr(error)
                    job.errors.append(f"{adapter.info.name}: {message}")

            await asyncio.gather(passive(), *(run_adapter(a) for a in specific))
            if not scan.cancelled.is_set():
                await self._identify(runtime)
            if generic and not scan.cancelled.is_set():
                scan.claimed_ips = {c.ip for c in self.candidates.values() if c.ip and c.id in job.candidate_ids}
                await run_adapter(generic)
            job.status = "completed" if not scan.cancelled.is_set() else "cancelled"
        except asyncio.CancelledError:
            job.status = "cancelled"
        except Exception:  # noqa: BLE001
            log.exception("discovery job failed")
            job.status = "failed"
            job.errors.append("The scan failed unexpectedly; see the gateway log.")
        finally:
            progress_task.cancel()
            job.progress = 1.0
            job.phase = job.status
            job.finished_at = job.finished_at or time.time()
            await self._flush()
            self._publish(runtime)
            log.info(
                "discovery finished",
                extra={"job": job.id, "status": job.status, "candidates": len(job.candidate_ids), "errors": len(job.errors)},
            )

    async def _identify(self, runtime: _Job) -> None:
        """Asks each newly seen device for its model/firmware (adapter.identify), a few at a time."""
        semaphore = asyncio.Semaphore(8)
        pending = [self.candidates[i] for i in runtime.job.candidate_ids if self.candidates.get(i) and self.candidates[i].status == "discovered"]

        async def one(candidate: Candidate) -> None:
            adapter = self.registry.adapters.get(candidate.adapter_id)
            if adapter is None:
                return
            async with semaphore:
                try:
                    identified = await guard(adapter, "identification", adapter.identify(candidate), timeout=6)
                except Exception:  # noqa: BLE001 - identification is best effort; the candidate stays "discovered"
                    return
            if identified.status == "discovered":
                identified.status = ConnectionStatus.IDENTIFIED if identified.model else identified.status
            identified.pairing = adapter.get_pairing_requirements(identified)
            self.candidates[identified.id] = identified
            self._persist.add(identified.id)
            self.bus.publish("discovery.candidate", candidate=identified.model_dump(mode="json"))

        runtime.job.phase = "identifying"
        await asyncio.gather(*(one(c) for c in pending))

    async def _progress_loop(self, runtime: _Job) -> None:
        job = runtime.job
        while job.status == "running":
            elapsed = time.time() - job.started_at
            job.progress = round(min(0.95, elapsed / job.timeout), 3)
            self._publish(runtime)
            await self._flush()
            await asyncio.sleep(0.75)

    def _accept(self, runtime: _Job, candidate: Candidate) -> None:
        if candidate.ip and not is_private_host(candidate.ip) and candidate.adapter_id != "lg_thinq_rethink":
            return
        existing = self.candidates.get(candidate.id)
        if existing:
            merged = existing.model_copy(
                update={
                    "ip": candidate.ip or existing.ip,
                    "port": candidate.port or existing.port,
                    "name": candidate.name or existing.name,
                    "model": candidate.model or existing.model,
                    "mac": candidate.mac or existing.mac,
                    "sources": sorted(set(existing.sources) | set(candidate.sources)),
                    "last_seen": time.time(),
                    "status": candidate.status,
                    "pairing": candidate.pairing,
                    "control": candidate.control,
                    "details": {**existing.details, **candidate.details},
                }
            )
        else:
            merged = candidate
        adapter = self.registry.adapters.get(merged.adapter_id)
        if adapter is not None:
            # Requirements always come from the adapter, so a candidate never looks easier to pair than it is.
            try:
                merged.pairing = adapter.get_pairing_requirements(merged)
            except Exception:  # noqa: BLE001
                log.debug("pairing requirements failed", exc_info=True)
        self.candidates[merged.id] = merged
        if merged.id not in runtime.job.candidate_ids:
            runtime.job.candidate_ids.append(merged.id)
        self._persist.add(merged.id)
        spawn(self._mark_paired(merged.id), name="mark-paired")

    async def _mark_paired(self, candidate_id: str) -> None:
        candidate = self.candidates.get(candidate_id)
        if not candidate:
            return
        device_id = await self.paired_lookup(candidate.adapter_id, candidate.unique_id)
        if device_id != candidate.paired_device_id:
            candidate.paired_device_id = device_id
            self._persist.add(candidate_id)
        self.bus.publish("discovery.candidate", candidate=candidate.model_dump(mode="json"))

    def accept_external(self, candidate: Candidate) -> Candidate:
        """A candidate found outside a job (manual probe, provisioning). Stored and published the same way."""
        dummy = _Job(DiscoveryJob(id="external", status="running", started_at=time.time(), timeout=0), self._dummy_scan())
        self._accept(dummy, candidate)
        return self.candidates[candidate.id]

    def _dummy_scan(self) -> ScanContext:
        return ScanContext(timeout=0, subnets=[], report=lambda c: None)

    async def _flush(self) -> None:
        ids, self._persist = self._persist, set()
        if not ids:
            return
        rows = [(c.id, c.adapter_id, c.model_dump_json(), c.first_seen, c.last_seen) for i in ids if (c := self.candidates.get(i))]

        def write(conn) -> None:
            conn.executemany(
                "INSERT INTO candidates (id, adapter_id, data, first_seen, last_seen) VALUES (?, ?, ?, ?, ?) "
                "ON CONFLICT(id) DO UPDATE SET data = excluded.data, last_seen = excluded.last_seen",
                rows,
            )

        await self.db.transaction(write)

    def list(self, *, job_id: str | None = None, brand_id: str | None = None, adapter_id: str | None = None) -> list[Candidate]:
        items = list(self.candidates.values())
        if job_id:
            runtime = self.jobs.get(job_id)
            wanted = set(runtime.job.candidate_ids) if runtime else set()
            items = [c for c in items if c.id in wanted]
        if brand_id and brand_id != "other":
            items = [c for c in items if c.brand == brand_id]
        if adapter_id:
            items = [c for c in items if c.adapter_id == adapter_id]
        return sorted(items, key=lambda c: c.last_seen, reverse=True)

    async def probe(self, host: str, adapter_id: str | None) -> Candidate | None:
        adapters = [self.registry.get(adapter_id)] if adapter_id else [a for a in self.registry.adapters.values() if a.info.id != GENERIC_ID]

        async def one(adapter: DeviceAdapter) -> Candidate | None:
            try:
                return await guard(adapter, "probe", adapter.probe(host), timeout=8)
            except Exception:  # noqa: BLE001
                return None

        for result in await asyncio.gather(*(one(a) for a in adapters)):
            if result:
                if "manual" not in result.sources:
                    result.sources = sorted(set(result.sources) | {"manual"})
                candidate = self.accept_external(result)
                await self._mark_paired(candidate.id)
                await self._flush()
                return candidate
        return None

    async def find(self, adapter_id: str, match: Callable[[Candidate], bool], *, window: float, after: float) -> Candidate | None:
        """Scans for one adapter repeatedly until a new device matching `match` shows up (provisioning)."""
        loop = asyncio.get_running_loop()
        deadline = loop.time() + window
        while loop.time() < deadline:
            for candidate in self.list(adapter_id=adapter_id):
                if candidate.last_seen >= after and match(candidate):
                    return candidate
            running = self.running()
            if running is None:
                await self.start(adapter_ids=[adapter_id], timeout=min(10.0, max(3.0, deadline - loop.time())))
            await asyncio.sleep(2.0)
        return None

    def _publish(self, runtime: _Job) -> None:
        self.bus.publish("discovery.progress", job=json.loads(runtime.job.model_dump_json()))


async def _empty_ports() -> dict[int, set[str]]:
    return {}
