"""Faikout (formerly Faikin), an ESP32 module that replaces Daikin's Wi-Fi adapter (experimental).

Faikout serves the Daikin BRP URLs (`/common/basic_info`, `/aircon/get_control_info`, ...; see the "Example HTTP API"
page of https://codeberg.org/RevK/ESP32-Faikout/wiki), so this builds on DaikinAdapter and keeps only what differs.
The project is GPL-3.0: this file is written from the API's behaviour and shares no code with it.

What differs from a real Daikin adapter:

- Identification: `ver` and `rev` both hold the one firmware version; a real adapter has `ver=1_2_51` and a hash in `rev`.
- Discovery: mDNS `_http._tcp` and the subnet probe. UDP answers are off by default and go to port 30000 whatever
  port asked, which the shared broadcast helper does not listen on.
- `set_control_info` takes any subset of fields, so commands send only what changes. Sending everything back, as a
  real Daikin needs, would store `stemp=nan` before the unit has reported, and `dtN` is 20 for a mode not yet seen.
- `err` in basic_info is 1 while the module has lost the indoor unit, and every other field is then stale.
- A web password makes each URL answer 200 with a page that redirects to /login.
- A change is echoed by the next read at once, before the unit has acknowledged it, so results are "pending".
"""

from __future__ import annotations

import asyncio
import math
from typing import Any

import httpx

from ..models import AdapterInfo, AuthKind, Candidate, Category, CommandResult, ConnectionStatus, PairingRequirements, SupportLevel, clean_text
from . import _lan, caps
from .base import (
    AdapterError,
    ApprovalCallback,
    AuthRequired,
    CommandOutcome,
    DeviceState,
    DeviceUnreachable,
    PairResult,
    ScanContext,
    StoredDevice,
    UnsupportedCommand,
    make_candidate,
    normalize_mac,
)
from .daikin import FAN_CODES, FAN_RATES, MODE_CODES, MODES, DaikinAdapter, parse_kv

PROTOCOL = "faikout-http"
#: The firmware's default `tmin` and `tmax`, the limits of its own slider. This API does not report the real ones.
TEMP_MIN, TEMP_MAX = 16, 32


def is_faikout(info: dict[str, str]) -> bool:
    """Whether a /common/basic_info answer is Faikout's. A miss is harmless: DaikinAdapter still controls the module."""
    version = info.get("ver")
    return info.get("ret") == "OK" and info.get("type", "aircon") == "aircon" and bool(version) and info.get("rev") == version


def _temperature(value: str | None) -> float | None:
    """A reported temperature, or None for `-` and for the `nan` shown before the unit has reported."""
    try:
        number = float(value or "")
    except ValueError:
        return None
    return number if math.isfinite(number) else None


def _state(control: dict[str, str], sensors: dict[str, str], linked: bool) -> DeviceState:
    on = control.get("pow") == "1"
    capability = caps.climate(
        current=_temperature(sensors.get("htemp")),
        target=_temperature(control.get("stemp")),
        mode=MODES.get(control.get("mode", ""), "auto") if on else "off",
        modes=["off", "auto", "cool", "heat", "dry", "fan_only"],
        fan_mode=FAN_RATES.get(control.get("f_rate", "")),
        fan_modes=list(FAN_CODES),
        low=TEMP_MIN,
        high=TEMP_MAX,
        step=0.5,
        confirmed=linked,
    )
    outdoor = _temperature(sensors.get("otemp"))
    readings = [] if outdoor is None else [caps.reading("outdoor_temperature", "Outdoor temperature", outdoor, "°C", "temperature")]
    return DeviceState(capabilities=[capability], readings=readings, commands=caps.commands_for([capability]), online=linked)


class FaikoutAdapter(DaikinAdapter):
    info = AdapterInfo(
        id="faikout",
        name="Faikout module for Daikin (local HTTP)",
        brands=["daikin"],
        protocols=[PROTOCOL],
        discovery=["mdns", "subnet"],
        categories=[Category.CLIMATE],
        status=SupportLevel.EXPERIMENTAL,
        account_free=True,
        auth=AuthKind.NONE,
        library=None,
        verified_models=[],
        notes=[
            "ESP32 replacement for Daikin's Wi-Fi adapter, controlled over its Daikin-style local HTTP API. No cloud or account.",
            "Not tested on real hardware. The Faikout project gives this API a lower priority than MQTT, and it covers power, mode, temperature and fan only.",
            "A web password on the module blocks this API. Clear it in the module's settings to use the gateway.",
            "Faikout's own auto mode moves the set temperature by itself, so a target set from the app may not hold while it is on.",
        ],
    )
    mdns_types = ("_http._tcp.local.",)

    # ---- transport ----

    async def _get(self, host: str, path: str, params: dict[str, str] | None = None, *, https: bool = False, key_uuid: str | None = None) -> dict[str, str]:
        try:
            response = await self.ctx.http.get(f"http://{host}{path}", params=params, timeout=5.0)
        except httpx.HTTPError as error:
            raise DeviceUnreachable(f"The Faikout module at {host} did not answer.") from error
        values = parse_kv(response.text)
        if "ret" not in values and "/login" in response.text:
            raise AuthRequired(
                "This Faikout module has a web password, which blocks local control.",
                code="device_auth_failed",
                recovery="Clear the web password in the module's settings, then try again.",
            )
        if response.status_code >= 400 or "ret" not in values:
            raise AdapterError(
                f"The device at {host} did not answer like a Faikout module.",
                code="not_faikout",
                recovery="Check Web control is on in the module's settings.",
            )
        if values["ret"] != "OK":
            reason = clean_text(values.get("adv"), 80)
            raise AdapterError(f"The Faikout module refused the change: {reason}." if reason else "The Faikout module refused the change.", code="device_rejected")
        return values

    async def _linked(self, host: str) -> bool:
        """Whether the module is talking to the indoor unit. `err` here means the link, not a fault code."""
        return (await self._get(host, "/common/basic_info")).get("err", "0") == "0"

    # ---- discovery ----

    async def discover(self, scan: ScanContext) -> None:
        await scan.wait_passive()
        found = {ip: "subnet" for ip in scan.hosts_with_port(80)}
        found.update({record.ip: "mdns" for record in scan.mdns_of(*self.mdns_types)})

        async def check(ip: str, source: str) -> None:
            if scan.in_scope(ip):
                candidate = await self._identify_host(ip, source)
                if candidate:
                    _lan.report(scan, candidate)

        await asyncio.gather(*(check(ip, source) for ip, source in found.items()))

    async def _identify_host(self, ip: str, source: str, info: dict[str, str] | None = None, *, allow_locked: bool = False) -> Candidate | None:
        """A module with a web password cannot be told from any other web page, so it is not listed."""
        try:
            info = info if info is not None else await self._get(ip, "/common/basic_info")
        except AdapterError:
            return None
        if not is_faikout(info):
            return None
        mac = normalize_mac(info.get("mac"))
        name = info.get("name", "")
        version = clean_text(info.get("ver"))
        candidate = make_candidate(
            self,
            (mac or ip).replace(":", ""),
            # The hostname is the MAC address until the resident names the module.
            name="Daikin air conditioner" if not name or normalize_mac(name) == mac else name,
            model=f"Faikout {version}",
            ip=ip,
            port=80,
            mac=mac,
            protocol=PROTOCOL,
            sources=[source],
            details={"ver": version},
        )
        candidate.status = ConnectionStatus.IDENTIFIED if mac else ConnectionStatus.DISCOVERED
        candidate.pairing = self.get_pairing_requirements(candidate)
        return candidate

    def get_pairing_requirements(self, candidate: Candidate) -> PairingRequirements:
        return PairingRequirements(auth=AuthKind.NONE, instructions="Experimental: not yet tested on real hardware.")

    # ---- pairing ----

    async def pair(self, candidate: Candidate, credentials: dict[str, str], approval: ApprovalCallback) -> PairResult:
        if candidate.ip and not await self._linked(candidate.ip):
            raise AdapterError(
                "The Faikout module is on your network but cannot reach the air conditioner.",
                code="ac_not_connected",
                recovery="Check the cable from the module to the indoor unit. The module's LED shows magenta while the link is down.",
            )
        return await super().pair(candidate, credentials, approval)

    # ---- state ----

    async def get_state(self, device: StoredDevice) -> DeviceState:
        linked = await self._linked(device.host or "")
        control, sensors = await self._read(device)
        return _state(control, sensors, linked)

    async def _change_for(self, device: StoredDevice, command: str, params: dict[str, Any]) -> dict[str, str]:
        if command == "turn_on":
            return {"pow": "1"}
        if command == "turn_off":
            return {"pow": "0"}
        if command == "set_temperature":
            control, _sensors = await self._read(device)
            if MODES.get(control.get("mode", "")) in {"dry", "fan_only"}:
                raise AdapterError("The temperature cannot be set in dry or fan mode.", code="bad_params")
            return {"stemp": f"{caps.clamp(caps.param(params, 'temperature'), TEMP_MIN, TEMP_MAX, 'temperature'):.1f}"}
        if command == "set_hvac_mode":
            wanted = str(caps.param(params, "mode"))
            if wanted == "off":
                return {"pow": "0"}
            if wanted in MODE_CODES:
                return {"pow": "1", "mode": MODE_CODES[wanted]}
            raise AdapterError(f"Unknown mode {wanted!r}.", code="bad_params")
        if command == "set_fan_mode":
            wanted = str(caps.param(params, "fan_mode"))
            if wanted in FAN_CODES:
                return {"f_rate": FAN_CODES[wanted]}
            raise AdapterError(f"Unknown fan mode {wanted!r}.", code="bad_params")
        raise UnsupportedCommand(f"Faikout does not support {command}.")

    async def execute_command(self, device: StoredDevice, command: str, params: dict[str, Any]) -> CommandOutcome:
        await self._get(device.host or "", "/aircon/set_control_info", await self._change_for(device, command, params))
        state = await self.get_state(device)
        for capability in state.capabilities:
            capability.confirmed = False
        return CommandOutcome(result=CommandResult(status="pending", message="Faikout accepted the change; the air conditioner has not reported it yet."), state=state)
