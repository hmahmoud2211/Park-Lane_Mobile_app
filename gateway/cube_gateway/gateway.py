"""The gateway process: builds every service, starts them in order and stops them cleanly."""

from __future__ import annotations

import asyncio
import json
import logging
import time

from . import __version__
from .adapters.base import AdapterContext
from .adapters.registry import SERVER_HOSTED_ADAPTERS, AdapterRegistry
from .cloud.link import CloudLink
from .config import Settings
from .crypto import Sealer
from .db import Database
from .devices import DeviceManager, PairingManager
from .discovery.engine import DiscoveryEngine
from .discovery.mdns import MdnsService
from .events import EventBus
from .netutil import phone_address
from .provisioning.engine import ProvisioningEngine
from .security import Security, announce_setup_code, pairing_target

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
        #: The device broker connection, in server-hosted mode only.
        self.cloud: CloudLink | None = CloudLink(self) if settings.server_hosted else None
        self.adapter_ctx.cloud = self.cloud
        self.registry = registry or AdapterRegistry(self.adapter_ctx, SERVER_HOSTED_ADAPTERS if settings.server_hosted else None)
        self.devices = DeviceManager(self.db, self.sealer, self.registry, self.bus, settings)
        self.discovery = DiscoveryEngine(self.registry, self.db, self.bus, settings, self.mdns, self.devices.lookup)
        self.pairings = PairingManager(self.devices, self.registry, self.bus, self.discovery.candidates)
        runner = None
        if settings.softap_interface:
            from .provisioning.gateway_wifi import make_runner

            runner = make_runner(settings.softap_interface)
        self.provisioning = ProvisioningEngine(self.db, self.bus, settings, self.registry, self.discovery, self.pairings, runner, cloud=self.cloud)
        self.relay = None

    async def start(self) -> None:
        version = await self.db.open()
        await self.security.load(self.settings.name)
        self.security.pair_target = pairing_target(self.settings, self.security.gateway_id)
        log.info(
            "gateway starting",
            extra={"version": __version__, "gateway_id": self.security.gateway_id, "schema": version, "data_dir": str(self.settings.data_dir)},
        )
        await self.mdns.start()
        await self.registry.start()
        await self.devices.load()
        await self._load_rethink_owned()
        await self.discovery.load()
        await self.provisioning.load()
        self.devices.start_monitors()
        await self.advertise()
        await self.start_relay_from_settings()
        if self.settings.relay_url and self.settings.relay_enroll_token and self.relay is None:
            self._enroll_task = asyncio.create_task(self._auto_enroll())
        if self.cloud is not None:
            self.cloud.start()
        if not await self.security.is_claimed():
            announce_setup_code(self.security)
        loaded = sorted(self.registry.adapters)
        log.info("gateway ready", extra={"port": self.settings.port, "adapters": loaded, "failed_adapters": sorted(self.registry.failed)})

    def address(self) -> str | None:
        return phone_address(self.settings.host)

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

    async def _auto_enroll(self) -> None:
        """Enrols with CUBE_RELAY_URL using CUBE_RELAY_ENROLL_TOKEN, retrying until the relay answers."""
        from .relay.client import enroll

        delay = 5.0
        while self.relay is None:
            try:
                await enroll(self, self.settings.relay_url, self.settings.relay_enroll_token)
                log.info("enrolled with the relay", extra={"relay": self.settings.relay_url, "public_url": self.relay.public_url if self.relay else None})
                return
            except Exception as error:  # noqa: BLE001 - keep trying; the gateway works locally meanwhile
                log.warning("could not enrol with the relay; retrying", extra={"relay": self.settings.relay_url, "reason": getattr(error, "message", str(error)), "retry_in": delay})
            await asyncio.sleep(delay)
            delay = min(300.0, delay * 2)

    async def _load_rethink_owned(self) -> None:
        """Which ReThink appliances belong to this gateway: the ones it set up, plus the ones paired here."""
        adapter = self.registry.adapters.get("lg_thinq_rethink")
        if adapter is None or not hasattr(adapter, "owned"):
            return
        stored = json.loads(await self.db.get_meta("rethink_owned") or "[]")
        paired = {d.unique_id for d in self.devices.devices.values() if d.adapter_id == "lg_thinq_rethink"}
        adapter.owned = set(stored) | paired

    async def stop(self) -> None:
        log.info("gateway stopping")
        if getattr(self, "_enroll_task", None):
            self._enroll_task.cancel()
        if self.cloud is not None:
            await self.cloud.stop()
        if self.relay:
            await self.relay.stop()
        await self.provisioning.stop()
        await self.devices.stop()
        await self.registry.stop()
        await self.mdns.stop()
        await self.adapter_ctx.close()
        await self.db.close()
