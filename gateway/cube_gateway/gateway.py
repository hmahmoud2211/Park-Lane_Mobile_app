"""The gateway process: builds every service, starts them in order and stops them cleanly."""

from __future__ import annotations

import logging
import time

from . import __version__
from .adapters.base import AdapterContext
from .adapters.registry import AdapterRegistry
from .config import Settings
from .crypto import Sealer
from .db import Database
from .devices import DeviceManager, PairingManager
from .discovery.engine import DiscoveryEngine
from .discovery.mdns import MdnsService
from .events import EventBus
from .netutil import primary_address
from .provisioning.engine import ProvisioningEngine
from .security import Security, announce_setup_code

log = logging.getLogger("cube.gateway")


class Gateway:
    def __init__(self, settings: Settings, *, registry: AdapterRegistry | None = None, mdns: MdnsService | None = None):
        self.settings = settings
        self.started_at = time.time()
        settings.data_dir.mkdir(parents=True, exist_ok=True)
        self.db = Database(settings.db_path)
        self.sealer = Sealer.from_file(settings.key_path)
        self.bus = EventBus()
        self.security = Security(self.db, self.sealer, code_file=settings.data_dir / "setup-code.txt")
        #: The FastAPI app serving this gateway; the relay tunnel forwards requests into it.
        self.app = None
        self.mdns = mdns or MdnsService()
        self.adapter_ctx = AdapterContext(settings)
        self.adapter_ctx.mdns = self.mdns
        self.registry = registry or AdapterRegistry(self.adapter_ctx)
        self.devices = DeviceManager(self.db, self.sealer, self.registry, self.bus, settings)
        self.discovery = DiscoveryEngine(self.registry, self.db, self.bus, settings, self.mdns, self.devices.lookup)
        self.pairings = PairingManager(self.devices, self.registry, self.bus, self.discovery.candidates)
        runner = None
        if settings.softap_interface:
            from .provisioning.gateway_wifi import make_runner

            runner = make_runner(settings.softap_interface)
        self.provisioning = ProvisioningEngine(self.db, self.bus, settings, self.registry, self.discovery, self.pairings, runner)
        self.relay = None

    async def start(self) -> None:
        version = await self.db.open()
        await self.security.load(self.settings.name)
        log.info(
            "gateway starting",
            extra={"version": __version__, "gateway_id": self.security.gateway_id, "schema": version, "data_dir": str(self.settings.data_dir)},
        )
        await self.mdns.start()
        await self.registry.start()
        await self.devices.load()
        await self.discovery.load()
        await self.provisioning.load()
        self.devices.start_monitors()
        await self.advertise()
        await self.start_relay_from_settings()
        if not await self.security.is_claimed():
            announce_setup_code(self.security, self.address(), self.settings.port)
        loaded = sorted(self.registry.adapters)
        log.info("gateway ready", extra={"port": self.settings.port, "adapters": loaded, "failed_adapters": sorted(self.registry.failed)})

    def address(self) -> str | None:
        """The address phones should use: CUBE_HOST when it names one, else the first private LAN address."""
        host = self.settings.host
        return host if host and host not in {"0.0.0.0", "::"} else primary_address()

    async def advertise(self) -> None:
        if self.settings.mdns_advertise:
            await self.mdns.advertise(self.security.gateway_id, self.security.name, self.settings.port, self.address(), await self.security.is_claimed())

    async def start_relay_from_settings(self) -> None:
        from .relay.client import RelayClient

        url = await self.db.get_meta("relay_url") or self.settings.relay_url
        sealed = await self.db.get_meta("relay_secret")
        if not url or not sealed:
            return
        secret = self.sealer.unseal(sealed, "relay")
        self.relay = RelayClient(self, url, secret)
        self.relay.start()

    async def stop(self) -> None:
        log.info("gateway stopping")
        if self.relay:
            await self.relay.stop()
        await self.provisioning.stop()
        await self.devices.stop()
        await self.registry.stop()
        await self.mdns.stop()
        await self.adapter_ctx.close()
        await self.db.close()
