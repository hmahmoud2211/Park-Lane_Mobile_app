"""Midea air conditioners (and rebrands such as Comfee, Inventor, Pioneer) over Midea's local LAN protocol,
with msmart-ng.

Discovery is msmart-ng's UDP broadcast (port 6445), run with `auto_connect=False` so it never contacts
Midea's cloud. V2 units are controlled with no credentials. V3 units (most since 2020) encrypt the session
with a token and key that Midea's cloud issues per device: the user obtains them once (for example with
`msmart-ng discover` on a computer, which logs in to Midea's cloud), and the gateway then uses them only
locally. Without them a V3 unit is shown but cannot be controlled.
"""

from __future__ import annotations

import asyncio
import contextlib
import re
from typing import Any

from msmart.const import DeviceType
from msmart.device import AirConditioner
from msmart.discover import Discover as MideaDiscover
from msmart.lan import AuthenticationError as MideaAuthError

from ..models import AdapterInfo, AuthKind, Candidate, Category, CommandResult, ConnectionStatus, FieldSpec, PairingRequirements, SupportLevel
from . import _lan, caps
from .base import (
    AdapterError,
    ApprovalCallback,
    CommandOutcome,
    DeviceAdapter,
    DeviceState,
    DeviceUnreachable,
    LocalKeyRequired,
    PairResult,
    ScanContext,
    StoredDevice,
    UnsupportedCommand,
    make_candidate,
)

Mode = AirConditioner.OperationalMode
Fan = AirConditioner.FanSpeed
MODE_NAMES = {Mode.AUTO: "auto", Mode.COOL: "cool", Mode.DRY: "dry", Mode.HEAT: "heat", Mode.FAN_ONLY: "fan_only", Mode.SMART_DRY: "dry"}
MODE_VALUES = {"auto": Mode.AUTO, "cool": Mode.COOL, "dry": Mode.DRY, "heat": Mode.HEAT, "fan_only": Mode.FAN_ONLY}
FAN_NAMES = {Fan.AUTO: "auto", Fan.SILENT: "silent", Fan.LOW: "low", Fan.MEDIUM: "medium", Fan.HIGH: "high", Fan.MAX: "max"}
FAN_VALUES = {name: speed for speed, name in FAN_NAMES.items()}
KEY_HELP = "Obtained once from Midea's cloud, e.g. with `msmart-ng discover` on a computer. The gateway never contacts Midea."


def _fan_name(speed: Any) -> str | None:
    if speed in FAN_NAMES:
        return FAN_NAMES[speed]
    return f"{int(speed)}%" if isinstance(speed, int) else None


def _state(ac: AirConditioner) -> DeviceState:
    modes = ["off"] + list(dict.fromkeys(MODE_NAMES[m] for m in (ac.supported_operation_modes or list(MODE_VALUES.values())) if m in MODE_NAMES))
    fans = [FAN_NAMES[f] for f in (ac.supported_fan_speeds or []) if f in FAN_NAMES]
    capability = caps.climate(
        current=ac.indoor_temperature,
        target=ac.target_temperature,
        mode=MODE_NAMES.get(ac.operational_mode, "auto") if ac.power_state else "off",
        modes=modes,
        fan_mode=_fan_name(ac.fan_speed),
        fan_modes=fans,
        low=float(ac.min_target_temperature or 16),
        high=float(ac.max_target_temperature or 30),
        step=0.5,
    )
    readings = []
    if ac.outdoor_temperature is not None:
        readings.append(caps.reading("outdoor_temperature", "Outdoor temperature", ac.outdoor_temperature, "°C", "temperature"))
    return DeviceState(capabilities=[capability], readings=readings, commands=caps.commands_for([capability]))


class MideaAdapter(DeviceAdapter):
    info = AdapterInfo(
        id="midea",
        name="Midea air conditioner (msmart-ng)",
        brands=["midea"],
        protocols=["midea-lan-v2", "midea-lan-v3"],
        discovery=["udp-broadcast"],
        categories=[Category.CLIMATE],
        status=SupportLevel.LIMITED,
        account_free=True,
        auth=AuthKind.LOCAL_KEY,
        library="msmart-ng",
        notes=[
            "V3 units need a token and key obtained once from Midea's cloud; the gateway only uses them locally.",
            "Only air conditioners are controlled; other Midea appliances are shown, not controlled.",
        ],
    )
    poll_interval = 30
    call_timeout = 20.0

    def __init__(self, ctx):
        super().__init__(ctx)
        self.discovery_targets: list[str] | None = None
        self._units: dict[str, AirConditioner] = {}
        self._locks: dict[str, asyncio.Lock] = {}

    # ---- discovery ----

    async def discover(self, scan: ScanContext) -> None:
        targets = self.discovery_targets or [ip for ip, _port in _lan.broadcast_targets(scan, 6445)]
        duration = _lan.window(scan, 5.0)
        work = asyncio.gather(*(MideaDiscover.discover(target=target, timeout=duration, auto_connect=False) for target in targets), return_exceptions=True)
        stop = asyncio.ensure_future(scan.cancelled.wait())
        done, _pending = await asyncio.wait({work, stop}, return_when=asyncio.FIRST_COMPLETED)
        stop.cancel()
        if work not in done:
            work.cancel()
            return
        seen: set[str] = set()
        for result in work.result():
            if isinstance(result, BaseException):
                self.log.debug("midea discovery failed", extra={"reason": repr(result)})
                continue
            for unit in result:
                uid = str(unit.id)
                if uid in seen or not scan.in_scope(unit.ip):
                    continue
                seen.add(uid)
                _lan.report(scan, self._candidate(unit, "udp-broadcast"))

    def _candidate(self, unit: Any, source: str) -> Candidate:
        is_ac = unit.type == DeviceType.AIR_CONDITIONER
        version = int(unit.version or 2)
        candidate = make_candidate(
            self,
            str(unit.id),
            name=unit.name or f"Midea {'air conditioner' if is_ac else 'appliance'}",
            model=unit.sn[:20] if getattr(unit, "sn", None) else None,
            ip=unit.ip,
            port=unit.port,
            protocol=f"midea-lan-v{version}",
            sources=[source],
            control="supported" if is_ac else "detection_only",
            details={"version": version, "device_type": int(unit.type), "device_id": int(unit.id)},
        )
        if not is_ac:
            candidate.status = ConnectionStatus.UNSUPPORTED
        elif version >= 3:
            candidate.status = ConnectionStatus.LOCAL_KEY_REQUIRED
        else:
            candidate.status = ConnectionStatus.IDENTIFIED
        candidate.pairing = self.get_pairing_requirements(candidate)
        return candidate

    async def probe(self, host: str) -> Candidate | None:
        try:
            unit = await asyncio.wait_for(MideaDiscover.discover_single(host, timeout=3, auto_connect=False), timeout=6)
        except Exception:  # noqa: BLE001 - nothing there, or not a Midea unit
            return None
        return self._candidate(unit, "manual") if unit else None

    def get_pairing_requirements(self, candidate: Candidate) -> PairingRequirements:
        if candidate.control == "detection_only":
            return PairingRequirements(auth=AuthKind.NONE, instructions="Only Midea air conditioners can be controlled.")
        if int(candidate.details.get("version") or 2) < 3:
            return PairingRequirements(auth=AuthKind.NONE, instructions="This unit uses Midea's V2 protocol and needs no key.")
        return PairingRequirements(
            auth=AuthKind.LOCAL_KEY,
            fields=[
                FieldSpec(name="token", label="Device token", kind="password", secret=True, pattern=r"^[0-9a-fA-F]{128}$", help=KEY_HELP),
                FieldSpec(name="key", label="Device key", kind="password", secret=True, pattern=r"^[0-9a-fA-F]{64}$", help=KEY_HELP),
            ],
            instructions="This unit (V3) encrypts its local protocol. Enter its token and key to control it locally.",
        )

    # ---- connection ----

    async def _unit(self, host: str, params: dict[str, Any], credentials: dict[str, Any]) -> AirConditioner:
        unit = AirConditioner(host, int(params["device_id"]), int(params.get("port") or 6444), version=int(params.get("version") or 2))
        if int(params.get("version") or 2) >= 3:
            token, key = credentials.get("token"), credentials.get("key")
            if not token or not key:
                raise LocalKeyRequired("This Midea unit needs its token and key.", code="credentials_missing")
            try:
                await asyncio.wait_for(unit.authenticate(token, key), timeout=10)
            except MideaAuthError as error:
                raise LocalKeyRequired("The unit rejected the token and key.", code="local_key_invalid") from error
            except (TimeoutError, OSError) as error:
                raise DeviceUnreachable(f"The Midea unit at {host} did not answer.") from error
        return unit

    async def _refresh(self, unit: AirConditioner, host: str) -> None:
        try:
            await asyncio.wait_for(unit.refresh(), timeout=10)
        except (TimeoutError, OSError) as error:
            raise DeviceUnreachable(f"The Midea unit at {host} did not answer.") from error
        if not unit.online:
            raise DeviceUnreachable(f"The Midea unit at {host} did not answer.")

    async def _live(self, device: StoredDevice) -> AirConditioner:
        unit = self._units.get(device.id)
        if unit is None:
            unit = await self._unit(device.host or "", device.params, device.credentials)
            self._units[device.id] = unit
        try:
            await self._refresh(unit, device.host or "")
        except DeviceUnreachable:
            self._units.pop(device.id, None)
            raise
        return unit

    # ---- pairing ----

    async def pair(self, candidate: Candidate, credentials: dict[str, str], approval: ApprovalCallback) -> PairResult:
        if candidate.control == "detection_only":
            raise UnsupportedCommand("Only Midea air conditioners can be controlled locally.", code="unsupported_device")
        if not candidate.ip:
            raise DeviceUnreachable("No address for this Midea unit; scan again.")
        params = {"device_id": candidate.details["device_id"], "port": candidate.port or 6444, "version": int(candidate.details.get("version") or 2)}
        creds = {k: re.sub(r"\s", "", credentials.get(k, "")) for k in ("token", "key") if credentials.get(k)}
        unit = await self._unit(candidate.ip, params, creds)
        with contextlib.suppress(Exception):
            await asyncio.wait_for(unit.get_capabilities(), timeout=10)
        await self._refresh(unit, candidate.ip)
        return PairResult(
            unique_id=candidate.unique_id,
            name=candidate.name or "Midea air conditioner",
            category=Category.CLIMATE,
            model=candidate.model,
            host=candidate.ip,
            port=params["port"],
            protocol=candidate.protocol,
            params=params,
            credentials=creds,
        )

    # ---- state ----

    async def get_state(self, device: StoredDevice) -> DeviceState:
        return _state(await self._live(device))

    async def execute_command(self, device: StoredDevice, command: str, params: dict[str, Any]) -> CommandOutcome:
        async with self._locks.setdefault(device.id, asyncio.Lock()):
            unit = await self._live(device)
            if command in {"turn_on", "turn_off"}:
                unit.power_state = command == "turn_on"
            elif command == "set_temperature":
                low, high = float(unit.min_target_temperature or 16), float(unit.max_target_temperature or 30)
                unit.target_temperature = round(caps.clamp(caps.param(params, "temperature"), low, high, "temperature") * 2) / 2
            elif command == "set_hvac_mode":
                mode = str(caps.param(params, "mode"))
                if mode == "off":
                    unit.power_state = False
                elif mode in MODE_VALUES and (not unit.supported_operation_modes or MODE_VALUES[mode] in unit.supported_operation_modes):
                    unit.power_state = True
                    unit.operational_mode = MODE_VALUES[mode]
                else:
                    raise AdapterError(f"This unit has no {mode!r} mode.", code="bad_params")
            elif command == "set_fan_mode":
                fan = str(caps.param(params, "fan_mode"))
                if fan not in FAN_VALUES or (unit.supported_fan_speeds and FAN_VALUES[fan] not in unit.supported_fan_speeds):
                    raise AdapterError(f"This unit has no {fan!r} fan speed.", code="bad_params")
                unit.fan_speed = FAN_VALUES[fan]
            else:
                raise UnsupportedCommand(f"Midea units do not support {command}.")
            try:
                await asyncio.wait_for(unit.apply(), timeout=10)
            except (TimeoutError, OSError) as error:
                raise DeviceUnreachable("The Midea unit did not take the change.") from error
            await self._refresh(unit, device.host or "")
            return CommandOutcome(result=CommandResult(status="confirmed"), state=_state(unit))

    async def disconnect(self, device: StoredDevice) -> None:
        self._units.pop(device.id, None)
