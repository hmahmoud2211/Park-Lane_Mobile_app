"""Loads adapters and isolates them from each other and from the gateway.

Each adapter module is imported separately: one whose library is missing or broken is listed with its
load error and the rest still load. Every call goes through `guard()`, which enforces a timeout and turns
unexpected exceptions into AdapterError, so a faulty experimental adapter cannot take the gateway down.
"""

from __future__ import annotations

import asyncio
import importlib
import logging
from collections.abc import Awaitable
from typing import TypeVar

from ..models import AdapterInfo
from .base import AdapterContext, AdapterError, DeviceAdapter

T = TypeVar("T")
log = logging.getLogger("cube.adapters")

#: module path, class name. Order is the order brands list their methods in.
ADAPTERS: list[tuple[str, str]] = [
    ("cube_gateway.adapters.shelly", "ShellyAdapter"),
    ("cube_gateway.adapters.wled", "WledAdapter"),
    ("cube_gateway.adapters.sonoff", "SonoffLanAdapter"),
    ("cube_gateway.adapters.tplink", "TplinkAdapter"),
    ("cube_gateway.adapters.tuya", "TuyaLocalAdapter"),
    ("cube_gateway.adapters.webos", "WebOsAdapter"),
    ("cube_gateway.adapters.lg_rethink", "LgRethinkAdapter"),
    ("cube_gateway.adapters.samsung_tv", "SamsungTvAdapter"),
    ("cube_gateway.adapters.yeelight", "YeelightAdapter"),
    ("cube_gateway.adapters.wiz", "WizAdapter"),
    ("cube_gateway.adapters.lifx", "LifxAdapter"),
    ("cube_gateway.adapters.daikin", "DaikinAdapter"),
    ("cube_gateway.adapters.faikout", "FaikoutAdapter"),
    ("cube_gateway.adapters.midea", "MideaAdapter"),
    ("cube_gateway.adapters.gree", "GreeAdapter"),
    ("cube_gateway.adapters.nolongerevil", "NoLongerEvilAdapter"),
    ("cube_gateway.adapters.tasmota", "TasmotaAdapter"),
    ("cube_gateway.adapters.esphome", "EsphomeAdapter"),
    ("cube_gateway.adapters.generic", "GenericAdapter"),
]


#: Server-hosted mode (no home network): only devices that connect out to the company's server.
SERVER_HOSTED_ADAPTERS: list[tuple[str, str]] = [
    ("cube_gateway.adapters.shelly_cloud", "ShellyCloudAdapter"),
    ("cube_gateway.adapters.lg_rethink", "LgRethinkAdapter"),
    ("cube_gateway.adapters.meross_cloud", "MerossCloudAdapter"),
]


class AdapterRegistry:
    def __init__(self, ctx: AdapterContext, modules: list[tuple[str, str]] | None = None):
        self.ctx = ctx
        self.adapters: dict[str, DeviceAdapter] = {}
        self.failed: dict[str, AdapterInfo] = {}
        for module_path, class_name in modules if modules is not None else ADAPTERS:
            self._load(module_path, class_name)

    def _load(self, module_path: str, class_name: str) -> None:
        try:
            module = importlib.import_module(module_path)
            cls: type[DeviceAdapter] = getattr(module, class_name)
            adapter = cls(self.ctx)
        except Exception as error:  # noqa: BLE001 - any import/constructor failure disables just this adapter
            adapter_id = module_path.rsplit(".", 1)[-1]
            log.warning("adapter failed to load", extra={"adapter": adapter_id, "reason": repr(error)})
            self.failed[adapter_id] = AdapterInfo(
                id=adapter_id,
                name=adapter_id,
                brands=[],
                protocols=[],
                discovery=[],
                categories=[],
                status="unsupported",
                account_free=False,
                auth="none",
                loaded=False,
                load_error=f"{type(error).__name__}: {error}",
            )
            return
        self.adapters[adapter.info.id] = adapter

    def add(self, adapter: DeviceAdapter) -> None:
        """Tests and plugins: register an adapter instance directly."""
        self.adapters[adapter.info.id] = adapter

    def get(self, adapter_id: str) -> DeviceAdapter:
        adapter = self.adapters.get(adapter_id)
        if adapter is None:
            raise AdapterError(f"No adapter {adapter_id!r} is loaded on this gateway.", code="adapter_unavailable")
        return adapter

    def for_brand(self, brand_id: str) -> list[DeviceAdapter]:
        return [adapter for adapter in self.adapters.values() if brand_id in adapter.info.brands]

    def infos(self) -> list[AdapterInfo]:
        infos = []
        for adapter in self.adapters.values():
            ok, reason = adapter.available()
            info = adapter.info.model_copy()
            if not ok:
                info.loaded = True
                info.load_error = reason
            infos.append(info)
        return infos + list(self.failed.values())

    async def start(self) -> None:
        for adapter in self.adapters.values():
            try:
                await asyncio.wait_for(adapter.start(), timeout=15)
            except Exception as error:  # noqa: BLE001
                log.warning("adapter failed to start", extra={"adapter": adapter.info.id, "reason": repr(error)})

    async def stop(self) -> None:
        for adapter in self.adapters.values():
            try:
                await asyncio.wait_for(adapter.stop(), timeout=10)
            except Exception as error:  # noqa: BLE001
                log.warning("adapter failed to stop", extra={"adapter": adapter.info.id, "reason": repr(error)})


async def guard(adapter: DeviceAdapter, operation: str, awaitable: Awaitable[T], timeout: float) -> T:
    """Runs one adapter call with a timeout; anything but AdapterError becomes a generic, logged AdapterError."""
    try:
        return await asyncio.wait_for(awaitable, timeout=timeout)
    except AdapterError:
        raise
    except TimeoutError as error:
        raise AdapterError(
            f"{adapter.info.name} did not finish {operation} in {timeout:.0f} s.",
            code="adapter_timeout",
            recovery="Check the device is powered and reachable, then try again.",
        ) from error
    except asyncio.CancelledError:
        raise
    except Exception as error:  # noqa: BLE001 - adapters must never crash the caller
        log.exception("adapter crashed", extra={"adapter": adapter.info.id, "operation": operation})
        raise AdapterError(
            f"{adapter.info.name} failed during {operation}.",
            code="adapter_crashed",
            recovery="This is a gateway bug. The gateway logs have the details.",
        ) from error
