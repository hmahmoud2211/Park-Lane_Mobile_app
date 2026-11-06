"""Paired devices: the persistent registry, live state, monitoring and commands; and pairing jobs.

- Devices are stored in SQLite with credentials sealed (crypto.Sealer, keyed to the device id). After a
  restart every device is loaded and monitored again without asking the user anything.
- Each device has one monitor task: push updates where the adapter offers them, else polling. A device that
  stops answering is marked offline and retried with exponential back-off (5 s doubling to 5 min).
- Commands run one at a time per device. The device shows `pending` while a command runs, then the state the
  adapter read back. Capabilities carry `confirmed`; an adapter without feedback marks them unconfirmed.
- State read at boot from the cache is marked unconfirmed until the device answers.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import secrets
import time
from typing import Any

from .adapters.base import AdapterError, AuthRequired, DeviceAdapter, DeviceState, LocalKeyRequired, PairResult, StoredDevice, UnsupportedCommand
from .adapters.registry import AdapterRegistry, guard
from .config import Settings
from .crypto import Sealer
from .db import Database
from .events import EventBus
from .models import (
    Candidate,
    Capability,
    Category,
    CommandRequest,
    CommandResult,
    ConnectionStatus,
    Device,
    DeviceConnection,
    Pairing,
    PairingRequest,
    PendingCommand,
    Reading,
    Room,
    Setting,
    clean_text,
)

log = logging.getLogger("cube.devices")
BACKOFF_MIN = 5.0
BACKOFF_MAX = 300.0
LOCK_WAIT = 10.0


class DeviceError(Exception):
    def __init__(self, code: str, message: str, status: int, recovery: str | None = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status
        self.recovery = recovery


class _Live:
    """Everything about a paired device that is not its identity."""

    def __init__(self, row: dict[str, Any]):
        self.room_id: str | None = row.get("room_id")
        self.dashboard = bool(row.get("dashboard", 1))
        self.experimental = bool(row.get("experimental", 0))
        self.created_at: float = row.get("created_at") or time.time()
        self.updated_at: float = row.get("updated_at") or time.time()
        self.capabilities: list[Capability] = []
        self.readings: list[Reading] = []
        self.settings: list[Setting] = []
        self.commands: list[str] = []
        self.connection = DeviceConnection(status=ConnectionStatus.CONNECTED, last_seen=row.get("last_seen"))
        self.pending: PendingCommand | None = None
        self.lock = asyncio.Lock()
        self.task: asyncio.Task | None = None
        self.unsubscribe: Any = None
        self.failures = 0
        self.wake = asyncio.Event()
        self.last_persist = 0.0


class DeviceManager:
    def __init__(self, db: Database, sealer: Sealer, registry: AdapterRegistry, bus: EventBus, settings: Settings):
        self.db = db
        self.sealer = sealer
        self.registry = registry
        self.bus = bus
        self.settings = settings
        self.devices: dict[str, StoredDevice] = {}
        self.live: dict[str, _Live] = {}
        self.rooms: dict[str, str] = {}
        self._stopping = False

    # ---- loading and persistence ----

    async def load(self) -> None:
        for room in await self.db.fetchall("SELECT id, name FROM rooms"):
            self.rooms[room["id"]] = room["name"]
        for row in await self.db.fetchall("SELECT * FROM devices ORDER BY created_at"):
            credentials: dict[str, Any] = {}
            if row["credentials_sealed"]:
                try:
                    credentials = self.sealer.unseal(row["credentials_sealed"], row["id"])
                except Exception:  # noqa: BLE001
                    log.error("stored credentials could not be unsealed; the device must be paired again", extra={"device": row["id"]})
            device = StoredDevice(
                id=row["id"],
                adapter_id=row["adapter_id"],
                brand=row["brand"],
                unique_id=row["unique_id"],
                name=row["name"],
                category=Category(row["category"]),
                model=row["model"],
                host=row["host"],
                port=row["port"],
                mac=row["mac"],
                protocol=row["protocol"],
                params=json.loads(row["params"] or "{}"),
                credentials=credentials,
            )
            live = _Live(row)
            cached = json.loads(row["state"] or "{}")
            live.capabilities = [Capability.model_validate({**c, "confirmed": False}) for c in cached.get("capabilities", [])]
            live.readings = [Reading.model_validate(r) for r in cached.get("readings", [])]
            live.settings = [Setting.model_validate({**x, "confirmed": False}) for x in cached.get("settings", [])]
            live.commands = cached.get("commands", [])
            live.connection = DeviceConnection(status=ConnectionStatus.OFFLINE, last_seen=row["last_seen"], last_error="Not checked since the gateway started.")
            self.devices[device.id] = device
            self.live[device.id] = live
        log.info("devices loaded", extra={"count": len(self.devices)})

    def start_monitors(self) -> None:
        for device_id in self.devices:
            self._start_monitor(device_id)

    async def stop(self) -> None:
        self._stopping = True
        for device_id, live in self.live.items():
            if live.task:
                live.task.cancel()
            if live.unsubscribe:
                with contextlib.suppress(Exception):
                    await live.unsubscribe()
            adapter = self.registry.adapters.get(self.devices[device_id].adapter_id)
            if adapter:
                with contextlib.suppress(Exception):
                    await asyncio.wait_for(adapter.disconnect(self.devices[device_id]), 5)
        for live in self.live.values():
            if live.task:
                with contextlib.suppress(asyncio.CancelledError, Exception):
                    await live.task

    async def _persist_state(self, device_id: str, force: bool = False) -> None:
        live = self.live.get(device_id)
        if not live or (not force and time.time() - live.last_persist < 30):
            return
        live.last_persist = time.time()
        state = {
            "capabilities": [c.model_dump(mode="json") for c in live.capabilities],
            "readings": [r.model_dump(mode="json") for r in live.readings],
            "settings": [x.model_dump(mode="json") for x in live.settings],
            "commands": live.commands,
        }
        await self.db.execute("UPDATE devices SET state = ?, last_seen = ? WHERE id = ?", (json.dumps(state), live.connection.last_seen, device_id))

    # ---- lookups and models ----

    async def lookup(self, adapter_id: str, unique_id: str) -> str | None:
        for device in self.devices.values():
            if device.adapter_id == adapter_id and device.unique_id == unique_id:
                return device.id
        return None

    def model(self, device_id: str) -> Device:
        device = self.devices[device_id]
        live = self.live[device_id]
        return Device(
            id=device.id,
            name=device.name,
            brand=device.brand,
            model=device.model,
            adapter_id=device.adapter_id,
            category=device.category,
            room_id=live.room_id,
            room=self.rooms.get(live.room_id) if live.room_id else None,
            ip=device.host,
            mac=device.mac,
            unique_id=device.unique_id,
            protocol=device.protocol,
            experimental=live.experimental,
            dashboard=live.dashboard,
            connection=live.connection,
            capabilities=live.capabilities,
            readings=live.readings,
            settings=live.settings,
            commands=live.commands,
            pending=live.pending,
            created_at=live.created_at,
            updated_at=live.updated_at,
        )

    def list(self) -> list[Device]:
        return sorted((self.model(i) for i in self.devices), key=lambda d: ((d.room or "￿").lower(), d.name.lower()))

    def get(self, device_id: str) -> Device:
        if device_id not in self.devices:
            raise DeviceError("not_found", "No such device on this gateway.", 404)
        return self.model(device_id)

    def _publish(self, device_id: str) -> None:
        self.bus.publish("device.updated", device=self.model(device_id).model_dump(mode="json"))

    # ---- adding, editing, removing ----

    async def add(self, result: PairResult, adapter: DeviceAdapter, *, name: str | None, room_id: str | None, experimental: bool) -> Device:
        if room_id and room_id not in self.rooms:
            room_id = None
        existing = await self.lookup(adapter.info.id, result.unique_id)
        device_id = existing or "dev_" + secrets.token_hex(8)
        now = time.time()
        sealed = self.sealer.seal(result.credentials, device_id) if result.credentials else None
        display = clean_text(name, 64) or clean_text(result.name, 64) or adapter.info.name
        brand = adapter.info.brands[0] if adapter.info.brands else "other"
        await self.db.execute(
            """INSERT INTO devices (id, adapter_id, brand, unique_id, name, model, category, room_id, host, port, mac, protocol,
                                    params, credentials_sealed, experimental, created_at, updated_at, last_seen)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(adapter_id, unique_id) DO UPDATE SET
                 name = excluded.name, model = excluded.model, category = excluded.category, host = excluded.host,
                 port = excluded.port, mac = excluded.mac, protocol = excluded.protocol, params = excluded.params,
                 credentials_sealed = excluded.credentials_sealed, room_id = COALESCE(excluded.room_id, devices.room_id),
                 experimental = excluded.experimental, updated_at = excluded.updated_at, last_seen = excluded.last_seen""",
            (
                device_id, adapter.info.id, brand, result.unique_id, display, clean_text(result.model), result.category.value, room_id,
                result.host, result.port, result.mac, result.protocol, json.dumps(result.params), sealed, int(experimental), now, now, now,
            ),
        )
        stored = StoredDevice(
            id=device_id, adapter_id=adapter.info.id, brand=brand, unique_id=result.unique_id, name=display, category=result.category,
            model=clean_text(result.model), host=result.host, port=result.port, mac=result.mac, protocol=result.protocol,
            params=result.params, credentials=result.credentials,
        )
        if existing and self.live[existing].task:
            self.live[existing].task.cancel()
        live = self.live.get(device_id) or _Live({"created_at": now, "updated_at": now, "room_id": room_id, "experimental": int(experimental)})
        live.experimental = experimental
        if room_id:
            live.room_id = room_id
        self.devices[device_id] = stored
        self.live[device_id] = live
        await self.db.audit("device.paired", target=device_id, adapter=adapter.info.id)
        # The pairing proved control by reading state; read it once more now so the dashboard starts accurate.
        await self.refresh(device_id, quiet=True)
        self._start_monitor(device_id)
        return self.model(device_id)

    async def update(self, device_id: str, *, name: str | None = None, room_id: str | None = None, dashboard: bool | None = None, clear_room: bool = False) -> Device:
        if device_id not in self.devices:
            raise DeviceError("not_found", "No such device on this gateway.", 404)
        live = self.live[device_id]
        if name is not None:
            cleaned = clean_text(name, 64)
            if not cleaned:
                raise DeviceError("bad_request", "The name cannot be empty.", 400)
            self.devices[device_id].name = cleaned
            await self.db.execute("UPDATE devices SET name = ? WHERE id = ?", (cleaned, device_id))
        if clear_room:
            live.room_id = None
            await self.db.execute("UPDATE devices SET room_id = NULL WHERE id = ?", (device_id,))
        elif room_id is not None:
            if room_id not in self.rooms:
                raise DeviceError("not_found", "No such room.", 404)
            live.room_id = room_id
            await self.db.execute("UPDATE devices SET room_id = ? WHERE id = ?", (room_id, device_id))
        if dashboard is not None:
            live.dashboard = dashboard
            await self.db.execute("UPDATE devices SET dashboard = ? WHERE id = ?", (int(dashboard), device_id))
        live.updated_at = time.time()
        await self.db.execute("UPDATE devices SET updated_at = ? WHERE id = ?", (live.updated_at, device_id))
        self._publish(device_id)
        self._publish_rooms()
        return self.model(device_id)

    async def remove(self, device_id: str) -> None:
        if device_id not in self.devices:
            raise DeviceError("not_found", "No such device on this gateway.", 404)
        device = self.devices.pop(device_id)
        live = self.live.pop(device_id)
        if live.task:
            live.task.cancel()
        if live.unsubscribe:
            with contextlib.suppress(Exception):
                await live.unsubscribe()
        adapter = self.registry.adapters.get(device.adapter_id)
        if adapter:
            with contextlib.suppress(Exception):
                await asyncio.wait_for(adapter.disconnect(device), 5)
            with contextlib.suppress(Exception):
                await asyncio.wait_for(adapter.forget(device), 10)
        await self.db.execute("DELETE FROM devices WHERE id = ?", (device_id,))
        await self.db.audit("device.removed", target=device_id)
        self.bus.publish("device.removed", id=device_id)
        self._publish_rooms()

    # ---- rooms ----

    def room_list(self) -> list[Room]:
        counts: dict[str, int] = {}
        for live in self.live.values():
            if live.room_id:
                counts[live.room_id] = counts.get(live.room_id, 0) + 1
        return sorted((Room(id=i, name=n, device_count=counts.get(i, 0)) for i, n in self.rooms.items()), key=lambda r: r.name.lower())

    def _publish_rooms(self) -> None:
        self.bus.publish("rooms.updated", rooms=[r.model_dump() for r in self.room_list()])

    async def create_room(self, name: str) -> Room:
        cleaned = clean_text(name, 40)
        if not cleaned:
            raise DeviceError("bad_request", "Give the room a name.", 400)
        if any(existing.lower() == cleaned.lower() for existing in self.rooms.values()):
            raise DeviceError("conflict", "A room with that name already exists.", 409)
        room_id = "room_" + secrets.token_hex(6)
        await self.db.execute("INSERT INTO rooms (id, name, created_at) VALUES (?, ?, ?)", (room_id, cleaned, time.time()))
        self.rooms[room_id] = cleaned
        self._publish_rooms()
        return Room(id=room_id, name=cleaned)

    async def rename_room(self, room_id: str, name: str) -> Room:
        cleaned = clean_text(name, 40)
        if room_id not in self.rooms:
            raise DeviceError("not_found", "No such room.", 404)
        if not cleaned:
            raise DeviceError("bad_request", "Give the room a name.", 400)
        await self.db.execute("UPDATE rooms SET name = ? WHERE id = ?", (cleaned, room_id))
        self.rooms[room_id] = cleaned
        self._publish_rooms()
        for device_id, live in self.live.items():
            if live.room_id == room_id:
                self._publish(device_id)
        return next(r for r in self.room_list() if r.id == room_id)

    async def delete_room(self, room_id: str) -> None:
        if room_id not in self.rooms:
            raise DeviceError("not_found", "No such room.", 404)
        await self.db.execute("DELETE FROM rooms WHERE id = ?", (room_id,))
        del self.rooms[room_id]
        for device_id, live in self.live.items():
            if live.room_id == room_id:
                live.room_id = None
                self._publish(device_id)
        self._publish_rooms()

    # ---- state ----

    async def _apply(self, device_id: str, state: DeviceState) -> None:
        if device_id not in self.devices:
            return
        live = self.live[device_id]
        device = self.devices[device_id]
        if state.capabilities or not live.capabilities:
            live.capabilities = state.capabilities
        live.readings = state.readings
        if state.settings or not state.online:
            live.settings = state.settings or [x.model_copy(update={"confirmed": False, "available": False}) for x in live.settings]
        if state.commands:
            live.commands = state.commands
        now = time.time()
        live.connection = DeviceConnection(
            status=ConnectionStatus.CONNECTED if state.online else ConnectionStatus.OFFLINE,
            last_seen=now if state.online else live.connection.last_seen,
            last_error=None if state.online else "The device reports it is unavailable.",
        )
        changed = False
        if state.host and state.host != device.host:
            log.info("device moved to a new address", extra={"device": device_id, "host": state.host})
            device.host = state.host
            changed = True
        if state.params:
            device.params = {**device.params, **state.params}
            changed = True
        model = clean_text(state.model)
        if model and model != device.model:
            device.model = model
            changed = True
        if changed:
            await self.db.execute("UPDATE devices SET host = ?, params = ?, model = ? WHERE id = ?", (device.host, json.dumps(device.params), device.model, device_id))
        live.failures = 0 if state.online else live.failures
        await self._persist_state(device_id)
        self._publish(device_id)

    def _mark_failure(self, device_id: str, error: AdapterError) -> float:
        live = self.live[device_id]
        live.failures += 1
        delay = min(BACKOFF_MAX, BACKOFF_MIN * 2 ** (live.failures - 1))
        status = ConnectionStatus.LOCAL_KEY_REQUIRED if isinstance(error, LocalKeyRequired) else (
            ConnectionStatus.LOCAL_AUTHORIZATION_REQUIRED if isinstance(error, AuthRequired) else ConnectionStatus.OFFLINE
        )
        live.connection = DeviceConnection(status=status, last_seen=live.connection.last_seen, last_error=error.message, retry_at=time.time() + delay)
        live.capabilities = [c.model_copy(update={"confirmed": False}) for c in live.capabilities]
        live.settings = [x.model_copy(update={"confirmed": False, "available": False}) for x in live.settings]
        self._publish(device_id)
        return delay

    async def refresh(self, device_id: str, quiet: bool = False) -> Device:
        if device_id not in self.devices:
            raise DeviceError("not_found", "No such device on this gateway.", 404)
        device = self.devices[device_id]
        adapter = self.registry.get(device.adapter_id)
        try:
            state = await guard(adapter, "reading state", adapter.get_state(device), timeout=adapter.call_timeout)
        except AdapterError as error:
            self._mark_failure(device_id, error)
            if quiet:
                return self.model(device_id)
            raise
        await self._apply(device_id, state)
        return self.model(device_id)

    def _start_monitor(self, device_id: str) -> None:
        live = self.live[device_id]
        if live.task and not live.task.done():
            live.task.cancel()
        live.task = asyncio.create_task(self._monitor(device_id), name=f"monitor-{device_id}")

    async def _monitor(self, device_id: str) -> None:
        await asyncio.sleep(secrets.randbelow(1000) / 1000)  # spread start-up load
        while not self._stopping and device_id in self.devices:
            device = self.devices[device_id]
            live = self.live[device_id]
            adapter = self.registry.adapters.get(device.adapter_id)
            if adapter is None:
                live.connection = DeviceConnection(status=ConnectionStatus.UNSUPPORTED, last_error=f"The {device.adapter_id} adapter is not loaded on this gateway.")
                self._publish(device_id)
                return
            try:
                state = await guard(adapter, "reading state", adapter.get_state(device), timeout=adapter.call_timeout)
                await self._apply(device_id, state)
                if live.unsubscribe is None:
                    live.unsubscribe = await guard(adapter, "subscribing", adapter.subscribe_to_events(device, self._pusher(device_id)), timeout=adapter.call_timeout)
                interval = float(adapter.poll_interval or self.settings.poll_interval)
            except AdapterError as error:
                interval = self._mark_failure(device_id, error)
                if live.unsubscribe:
                    with contextlib.suppress(Exception):
                        await live.unsubscribe()
                    live.unsubscribe = None
            live.wake.clear()
            with contextlib.suppress(TimeoutError):
                await asyncio.wait_for(live.wake.wait(), timeout=interval)

    def _pusher(self, device_id: str):
        async def push(state: DeviceState) -> None:
            if self.live.get(device_id) and self.live[device_id].pending is None:
                await self._apply(device_id, state)

        return push

    def wake_all(self) -> None:
        for live in self.live.values():
            live.wake.set()

    # ---- commands ----

    async def command(self, device_id: str, request: CommandRequest, client_id: str | None) -> tuple[Device, CommandResult]:
        if device_id not in self.devices:
            raise DeviceError("not_found", "No such device on this gateway.", 404)
        device = self.devices[device_id]
        live = self.live[device_id]
        if live.commands and request.command not in live.commands:
            raise DeviceError("unsupported_command", f"{device.name} does not support {request.command}.", 422, "Only the controls this device reports are available.")
        params = {k: v for k, v in request.params.items() if isinstance(k, str) and len(k) <= 32}
        if len(json.dumps(params, default=str)) > 2048:
            raise DeviceError("bad_params", "Command parameters are too large.", 400)
        adapter = self.registry.get(device.adapter_id)
        try:
            await asyncio.wait_for(live.lock.acquire(), timeout=LOCK_WAIT)
        except TimeoutError as error:
            raise DeviceError("device_busy", f"{device.name} is still busy with another command.", 409, "Wait a moment and try again.") from error
        try:
            live.pending = PendingCommand(command=request.command, params=params, since=time.time())
            self._publish(device_id)
            try:
                outcome = await guard(adapter, request.command, adapter.execute_command(device, request.command, params), timeout=adapter.call_timeout + 5)
            except UnsupportedCommand:
                raise
            except AdapterError as error:
                live.pending = None
                if not isinstance(error, (AuthRequired, LocalKeyRequired)) and error.code in {"device_unreachable", "adapter_timeout"}:
                    self._mark_failure(device_id, error)
                else:
                    self._publish(device_id)
                raise
            live.pending = None
            if outcome.state:
                await self._apply(device_id, outcome.state)
            else:
                self._publish(device_id)
            await self._persist_state(device_id, force=True)
            await self.db.audit("device.command", client_id, target=device_id, command=request.command, result=outcome.result.status)
            return self.model(device_id), outcome.result
        finally:
            live.pending = None
            live.lock.release()


class PairingManager:
    """Runs pair() in the background so the app can show "accept on your TV" while it waits."""

    def __init__(self, devices: DeviceManager, registry: AdapterRegistry, bus: EventBus, candidates: dict[str, Candidate]):
        self.devices = devices
        self.registry = registry
        self.bus = bus
        self.candidates = candidates
        self.pairings: dict[str, Pairing] = {}
        self.listeners: list[Any] = []

    def get(self, pairing_id: str) -> Pairing | None:
        return self.pairings.get(pairing_id)

    def _publish(self, pairing: Pairing) -> None:
        self.bus.publish("pairing.updated", pairing=pairing.model_dump(mode="json"))
        for listener in list(self.listeners):
            with contextlib.suppress(Exception):
                listener(pairing)

    async def start(self, request: PairingRequest, *, experimental: bool | None = None) -> Pairing:
        candidate = self.candidates.get(request.candidate_id)
        if candidate is None:
            raise DeviceError("not_found", "That device is no longer in the scan results. Scan again.", 404)
        credentials = {k: str(v)[:256] for k, v in list(request.credentials.items())[:8] if isinstance(v, str | int)}
        pairing = Pairing(id="pair_" + secrets.token_hex(6), candidate_id=candidate.id, status="running", started_at=time.time())
        self.pairings[pairing.id] = pairing
        if candidate.control == "detection_only":
            pairing.status = "failed"
            pairing.error_code = "unsupported_device"
            pairing.message = "CUBE cannot control this device: no adapter supports it."
            pairing.finished_at = time.time()
            self._publish(pairing)
            return pairing
        self._publish(pairing)
        asyncio.create_task(self._run(pairing, candidate, credentials, request, experimental))
        return pairing

    async def _run(self, pairing: Pairing, candidate: Candidate, credentials: dict[str, str], request: PairingRequest, experimental: bool | None) -> None:
        try:
            adapter = self.registry.get(candidate.adapter_id)
        except AdapterError as error:
            self._finish(pairing, "failed", error.message, error.code)
            return

        async def approval(message: str) -> None:
            pairing.status = "awaiting_approval"
            pairing.message = message
            self._publish(pairing)

        try:
            result = await guard(adapter, "pairing", adapter.pair(candidate, credentials, approval), timeout=90)
            is_experimental = experimental if experimental is not None else (candidate.control == "experimental" or adapter.info.status == "experimental")
            device = await self.devices.add(result, adapter, name=request.name, room_id=request.room_id, experimental=is_experimental)
            candidate.paired_device_id = device.id
            pairing.device_id = device.id
            self._finish(pairing, "paired", f"{device.name} is connected.", None)
        except (AuthRequired, LocalKeyRequired) as error:
            pairing.fields = adapter.get_pairing_requirements(candidate).fields
            self._finish(pairing, "needs_input", error.message, error.code, terminal=False)
        except AdapterError as error:
            self._finish(pairing, "failed", f"{error.message} {error.recovery}".strip(), error.code)
        except Exception:  # noqa: BLE001
            log.exception("pairing failed unexpectedly")
            self._finish(pairing, "failed", "Pairing failed unexpectedly. The gateway log has details.", "internal")

    def _finish(self, pairing: Pairing, status: str, message: str | None, code: str | None, terminal: bool = True) -> None:
        pairing.status = status  # type: ignore[assignment]
        pairing.message = message
        pairing.error_code = code
        pairing.finished_at = time.time() if terminal else None
        self._publish(pairing)
