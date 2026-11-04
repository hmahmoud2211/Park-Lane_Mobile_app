"""mDNS / DNS-SD: browsing for devices, and advertising the gateway as _cube-gw._tcp for the app.

One AsyncZeroconf instance serves both, so the gateway holds a single multicast socket set. It coexists
with avahi on the host (zeroconf binds port 5353 with SO_REUSEPORT).
"""

from __future__ import annotations

import asyncio
import logging
import socket

from zeroconf import IPVersion, ServiceStateChange, Zeroconf
from zeroconf.asyncio import AsyncServiceBrowser, AsyncServiceInfo, AsyncZeroconf

from .. import API_VERSION, __version__
from ..adapters.base import MdnsRecord
from ..models import clean_text

log = logging.getLogger("cube.mdns")
GATEWAY_SERVICE = "_cube-gw._tcp.local."


class MdnsService:
    def __init__(self) -> None:
        self._zc: AsyncZeroconf | None = None
        self._info: AsyncServiceInfo | None = None
        self.error: str | None = None

    async def start(self) -> None:
        try:
            self._zc = AsyncZeroconf(ip_version=IPVersion.V4Only)
        except OSError as error:
            self.error = f"mDNS unavailable: {error}"
            log.warning("mDNS unavailable; discovery falls back to SSDP, vendor UDP and the subnet probe", extra={"reason": str(error)})

    async def stop(self) -> None:
        if self._zc is None:
            return
        if self._info is not None:
            try:
                await self._zc.async_unregister_service(self._info)
            except Exception:  # noqa: BLE001
                log.debug("mDNS unregister failed", exc_info=True)
        await self._zc.async_close()
        self._zc = None

    @property
    def available(self) -> bool:
        return self._zc is not None

    async def advertise(self, gateway_id: str, name: str, port: int, address: str | None, claimed: bool) -> None:
        """Lets the app find the gateway. The advert proves nothing: the app still verifies its identity."""
        if self._zc is None or not address:
            return
        info = AsyncServiceInfo(
            GATEWAY_SERVICE,
            f"CUBE Gateway {gateway_id[:8]}.{GATEWAY_SERVICE}",
            addresses=[socket.inet_aton(address)],
            port=port,
            properties={"id": gateway_id, "name": name[:60], "v": __version__, "api": f"/api/v{API_VERSION}", "claimed": "1" if claimed else "0"},
            server=f"cube-gw-{gateway_id[:8]}.local.",
        )
        try:
            if self._info is not None:
                await self._zc.async_update_service(info)
            else:
                await self._zc.async_register_service(info, allow_name_change=True)
            self._info = info
        except Exception as error:  # noqa: BLE001 - advertising is a convenience; the app can be pointed at the IP
            log.warning("could not advertise the gateway over mDNS", extra={"reason": repr(error)})

    async def browse(self, types: list[str], duration: float, cancelled: asyncio.Event) -> list[MdnsRecord]:
        if self._zc is None or not types:
            return []
        zc = self._zc.zeroconf
        names: set[tuple[str, str]] = set()

        def on_change(zeroconf: Zeroconf, service_type: str, name: str, state_change: ServiceStateChange) -> None:
            if state_change in (ServiceStateChange.Added, ServiceStateChange.Updated):
                names.add((service_type, name))

        browser = AsyncServiceBrowser(zc, types, handlers=[on_change])
        records: dict[tuple[str, str], MdnsRecord] = {}
        loop = asyncio.get_running_loop()
        deadline = loop.time() + duration
        try:
            while loop.time() < deadline and not cancelled.is_set():
                pending = [key for key in names if key not in records]
                if pending:
                    resolved = await asyncio.gather(*(self._resolve(zc, t, n) for t, n in pending[:32]))
                    for key, record in zip(pending[:32], resolved, strict=False):
                        if record:
                            records[key] = record
                await asyncio.sleep(0.25)
        finally:
            await browser.async_cancel()
        return list(records.values())

    async def resolve(self, service_type: str, instance: str) -> MdnsRecord | None:
        """Fresh TXT/SRV/A for one known instance, e.g. a SONOFF's latest state announcement."""
        if self._zc is None:
            return None
        return await self._resolve(self._zc.zeroconf, service_type, f"{instance}.{service_type}")

    @staticmethod
    async def _resolve(zc: Zeroconf, service_type: str, name: str) -> MdnsRecord | None:
        info = AsyncServiceInfo(service_type, name)
        try:
            if not await info.async_request(zc, 1500):
                return None
        except Exception:  # noqa: BLE001 - malformed announcements are ignored
            return None
        addresses = info.parsed_addresses(IPVersion.V4Only)
        if not addresses or not info.port:
            return None
        properties: dict[str, str] = {}
        for key, value in (info.properties or {}).items():
            try:
                k = key.decode("utf-8", "replace") if isinstance(key, bytes) else str(key)
                v = value.decode("utf-8", "replace") if isinstance(value, bytes) else ("" if value is None else str(value))
            except Exception:  # noqa: BLE001
                continue
            properties[clean_text(k, 32) or "_"] = (clean_text(v, 512) or "")
        instance = name[: -len(service_type)].rstrip(".") if name.endswith(service_type) else name
        return MdnsRecord(
            type=service_type,
            name=clean_text(instance, 96) or instance[:96],
            ip=addresses[0],
            port=int(info.port),
            properties=properties,
            server=clean_text(info.server, 128),
        )
