"""Nest Learning Thermostats (gen 1 and 2) flashed with NoLongerEvil, through its self-hosted server (experimental).

NoLongerEvil replaces Google's cloud. The thermostat talks to the server on port 8000; this adapter talks to the
server's control API, port 8082 by default (https://docs.nolongerevil.com/api-reference/control/control-overview.md):

- GET  /api/devices         every thermostat the server knows
- GET  /status?serial=...   one thermostat's state; temperatures are always Celsius
- POST /command             {"serial", "command", "value"}: set_temperature, set_mode, set_fan, set_away

Port 8082 has no authentication, so it belongs on a trusted local network and nowhere else.

`/status` reports auto as `range` while `set_mode` takes `heat-cool`. In that mode only the low and high setpoints
count, so a single target is shown as their midpoint and moves both. The server stores a command and passes it on;
/status then shows the stored value, not what the thermostat did, so results are "pending".
"""

from __future__ import annotations

import math
from typing import Any

import httpx

from ..models import AdapterInfo, AuthKind, Candidate, Category, CommandResult, ConnectionStatus, Setting, SupportLevel, clean_text
from . import caps
from .base import (
    AdapterError,
    ApprovalCallback,
    AuthRequired,
    CommandOutcome,
    DeviceAdapter,
    DeviceState,
    DeviceUnreachable,
    PairResult,
    ScanContext,
    StoredDevice,
    UnsupportedCommand,
    make_candidate,
)

PROTOCOL = "nle-control-http"
MODEL = "Nest Learning Thermostat"
#: What the server accepts, in Celsius.
TEMP_MIN, TEMP_MAX = 4.5, 32.0
#: /status `mode` -> normalized mode.
MODES = {"off": "off", "heat": "heat", "cool": "cool", "range": "heat_cool", "emergency": "emergency_heat"}
#: Normalized mode -> `set_mode` value.
MODE_VALUES = {"off": "off", "heat": "heat", "cool": "cool", "heat_cool": "heat-cool", "emergency_heat": "emergency"}
#: /status `schedule_mode` -> normalized mode.
SCHEDULE_MODES = {"HEAT": "heat", "COOL": "cool", "RANGE": "heat_cool"}
#: Modes turn_on may restore. Emergency heat is for equipment failure, so only an explicit choice starts it.
RESTORABLE_MODES = {"heat", "cool", "heat_cool"}
FAN_MODES = ["auto", "on"]
ECO_ACTIVE = {"manual-eco", "auto-eco"}
HEATING = ("heater", "heat_x2", "heat_x3", "aux_heat", "emer_heat", "alt_heat")
COOLING = ("ac", "cool_x2", "cool_x3")
NOT_LISTED = "The NoLongerEvil server does not list this thermostat."


def _number(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, int | float) or not math.isfinite(value):
        return None
    return float(value)


def _object(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _mode(status: dict[str, Any]) -> str | None:
    return MODES.get(str(status.get("mode")).lower())


def _modes(status: dict[str, Any]) -> list[str]:
    capabilities = _object(status.get("capabilities"))
    heat, cool = capabilities.get("can_heat", True), capabilities.get("can_cool", True)
    modes = ["off"]
    if heat:
        modes.append("heat")
    if cool:
        modes.append("cool")
    if heat and cool:
        modes.append("heat_cool")
    if capabilities.get("has_emer_heat"):
        modes.append("emergency_heat")
    return modes


def _fan_modes(status: dict[str, Any]) -> list[str]:
    return FAN_MODES if _object(status.get("capabilities")).get("has_fan") else []


def _range(status: dict[str, Any]) -> tuple[float | None, float | None]:
    return _number(status.get("target_temperature_low")), _number(status.get("target_temperature_high"))


def _action(status: dict[str, Any], mode: str | None) -> str:
    hvac = _object(status.get("hvac"))
    if mode == "off":
        return "off"
    if any(hvac.get(key) for key in HEATING):
        return "heating"
    if any(hvac.get(key) for key in COOLING):
        return "cooling"
    return "fan" if hvac.get("fan") else "idle"


def _state(status: dict[str, Any], last_mode: str | None = None) -> DeviceState:
    mode = _mode(status)
    online = bool(status.get("is_available"))
    low, high = _range(status)
    in_range = mode == "heat_cool"
    if in_range:
        target = None if low is None or high is None else (low + high) / 2
    else:
        target = _number(status.get("target_temperature"))
    fan_modes = _fan_modes(status)
    capability = caps.climate(
        current=_number(status.get("current_temperature")),
        target=target,
        mode=mode,
        modes=_modes(status),
        fan_mode=("on" if status.get("fan_timer_active") else "auto") if fan_modes else None,
        fan_modes=fan_modes,
        low=TEMP_MIN,
        high=TEMP_MAX,
        step=0.5,
        confirmed=online,
    )
    capability.state = _action(status, mode)
    readings = []
    humidity = _number(status.get("humidity"))
    if humidity is not None:
        readings.append(caps.reading("current_humidity", "Humidity", humidity, "%", "humidity"))
    if in_range and low is not None and high is not None:
        readings.append(caps.reading("target_low", "Heat to", low, "°C", "temperature"))
        readings.append(caps.reading("target_high", "Cool to", high, "°C", "temperature"))
    eco_mode = status.get("eco_mode")
    eco = Setting(key="eco", kind="switch", name="Eco", value=eco_mode in ECO_ACTIVE if isinstance(eco_mode, str) else None, confirmed=online)
    return DeviceState(
        capabilities=[capability],
        readings=readings,
        settings=[eco],
        commands=[*caps.commands_for([capability]), "set_setting"],
        online=online,
        # Written only on a change: the device manager saves whatever it is given here.
        params={"last_mode": mode} if mode in RESTORABLE_MODES and mode != last_mode else None,
    )


def _translate(status: dict[str, Any], last_mode: str | None, command: str, params: dict[str, Any]) -> tuple[str, Any]:
    """The control API command and value for one normalized command, refused here when it cannot work."""
    modes = _modes(status)
    if command == "turn_off":
        return "set_mode", "off"
    if command == "turn_on":
        choices = [last_mode, SCHEDULE_MODES.get(str(status.get("schedule_mode"))), *modes]
        wanted = next((mode for mode in choices if mode in RESTORABLE_MODES and mode in modes), None)
        if wanted is None:
            raise AdapterError("This thermostat is not wired for heating or cooling.", code="bad_params")
        return "set_mode", MODE_VALUES[wanted]
    if command == "set_hvac_mode":
        wanted = str(caps.param(params, "mode"))
        if wanted not in modes:
            raise AdapterError(f"Mode {wanted!r} is not offered by this thermostat.", code="bad_params")
        return "set_mode", MODE_VALUES[wanted]
    if command == "set_temperature":
        temperature = caps.clamp(caps.param(params, "temperature"), TEMP_MIN, TEMP_MAX, "temperature")
        mode = _mode(status)
        if mode == "off":
            raise AdapterError("The thermostat is off. Choose a mode first, then set the temperature.", code="bad_params")
        if mode != "heat_cool":
            return "set_temperature", temperature
        low, high = _range(status)
        if low is None or high is None:
            raise AdapterError("The thermostat has not reported its temperature range yet.", code="not_ready", recovery="Try again in a minute.")
        half = (high - low) / 2
        middle = max(TEMP_MIN + half, min(TEMP_MAX - half, temperature))
        return "set_temperature", {"high": middle + half, "low": middle - half}
    if command == "set_fan_mode":
        wanted = str(caps.param(params, "fan_mode"))
        if wanted not in _fan_modes(status):
            raise AdapterError(f"Fan mode {wanted!r} is not offered by this thermostat.", code="bad_params")
        return "set_fan", wanted
    if command == "set_setting":
        key = caps.param(params, "key")
        if key != "eco":
            raise UnsupportedCommand(f"This thermostat has no setting {key!r}.")
        value = caps.param(params, "value")
        if not isinstance(value, bool):
            raise AdapterError("Eco needs true or false.", code="bad_params")
        return "set_away", value
    raise UnsupportedCommand(f"Nest thermostats on NoLongerEvil do not support {command}.")


class NoLongerEvilAdapter(DeviceAdapter):
    info = AdapterInfo(
        id="nolongerevil",
        name="Nest Learning Thermostat via NoLongerEvil (self-hosted)",
        brands=["nest"],
        protocols=[PROTOCOL],
        discovery=["server"],
        categories=[Category.CLIMATE],
        status=SupportLevel.EXPERIMENTAL,
        account_free=True,
        auth=AuthKind.NONE,
        library=None,
        verified_models=[],
        notes=[
            "Needs a self-hosted NoLongerEvil server and CUBE_NLE_URL set to its control API (port 8082). NoLongerEvil replaces Google's cloud, so no Google account is used.",
            "Security: the control API on port 8082 has no authentication. Keep it on your local network and never expose it to the internet.",
            "Only Nest Learning Thermostat gen 1 and 2 flashed with NoLongerEvil firmware. NoLongerEvil does not support gen 3 yet.",
            "Not tested on real hardware. A change takes effect when the thermostat next connects, and its schedule can replace a target later.",
        ],
    )
    poll_interval = 30

    def __init__(self, ctx):
        super().__init__(ctx)
        self.url = ctx.settings.nle_url.rstrip("/")

    def available(self) -> tuple[bool, str | None]:
        if not self.url:
            return False, "Set CUBE_NLE_URL to your NoLongerEvil server's control API (port 8082) to use Nest thermostats."
        return True, None

    # ---- transport ----

    async def _request(self, method: str, path: str, *, params: dict[str, str] | None = None, body: dict[str, Any] | None = None, missing: str = NOT_LISTED) -> dict[str, Any]:
        if not self.url:
            raise DeviceUnreachable("CUBE_NLE_URL is not set, so the gateway cannot reach NoLongerEvil.", recovery="Set CUBE_NLE_URL to your NoLongerEvil server's control API (port 8082).")
        try:
            response = await self.ctx.http.request(method, f"{self.url}{path}", params=params, json=body, timeout=5.0)
        except httpx.HTTPError as error:
            raise DeviceUnreachable("The NoLongerEvil server did not answer.", recovery="Check the server is running and CUBE_NLE_URL points at it.") from error
        try:
            reply = response.json()
        except ValueError:
            reply = None
        if response.status_code in {401, 403}:
            raise AuthRequired(
                "The NoLongerEvil server refused the gateway.",
                code="device_auth_failed",
                recovery="The gateway sends no login. Point CUBE_NLE_URL at the server's control API on your local network.",
            )
        if response.status_code == 404:
            raise DeviceUnreachable(missing, recovery="Check the thermostat is connected to your NoLongerEvil server.")
        if not isinstance(reply, dict):
            raise AdapterError("The NoLongerEvil server sent an unreadable reply.", code="nle_bad_reply", recovery="Check CUBE_NLE_URL points at the control API (port 8082).")
        if response.status_code >= 400 or reply.get("success") is False:
            reason = clean_text(reply.get("message") or reply.get("error"), 160)
            raise AdapterError(reason or f"The NoLongerEvil server answered {response.status_code}.", code="device_rejected")
        return reply

    async def _status(self, serial: str) -> dict[str, Any]:
        return await self._request("GET", "/status", params={"serial": serial})

    # ---- discovery ----

    async def discover(self, scan: ScanContext) -> None:
        if not self.url:
            return
        reply = await self._request("GET", "/api/devices", missing="No NoLongerEvil control API answered there. CUBE_NLE_URL should point at port 8082.")
        devices = reply.get("devices")
        for status in devices if isinstance(devices, list) else []:
            serial = _object(status).get("serial")
            if not isinstance(serial, str) or not serial.strip():
                continue
            candidate = make_candidate(
                self,
                serial,
                name=status.get("name") or "Nest thermostat",
                model=MODEL,
                protocol=PROTOCOL,
                sources=["server"],
                details={"online": bool(status.get("is_available")), "software_version": clean_text(status.get("software_version"))},
            )
            candidate.status = ConnectionStatus.EXPERIMENTAL
            scan.report(candidate)

    # ---- pairing ----

    async def pair(self, candidate: Candidate, credentials: dict[str, str], approval: ApprovalCallback) -> PairResult:
        status = await self._status(candidate.unique_id)
        if not status.get("is_available"):
            raise DeviceUnreachable("NoLongerEvil has not heard from this thermostat recently.", recovery="Check the thermostat has power and is connected to your NoLongerEvil server.")
        if _mode(status) is None:
            raise AdapterError("The thermostat has not reported its state to NoLongerEvil yet.", code="not_ready", recovery="Wait a minute, then try again.")
        return PairResult(
            unique_id=candidate.unique_id,
            name=clean_text(status.get("name")) or candidate.name or "Nest thermostat",
            category=Category.CLIMATE,
            model=MODEL,
            protocol=PROTOCOL,
            params={"software_version": clean_text(status.get("software_version"))},
        )

    # ---- state ----

    async def get_state(self, device: StoredDevice) -> DeviceState:
        return _state(await self._status(device.unique_id), device.params.get("last_mode"))

    async def execute_command(self, device: StoredDevice, command: str, params: dict[str, Any]) -> CommandOutcome:
        last_mode = device.params.get("last_mode")
        nle_command, value = _translate(await self._status(device.unique_id), last_mode, command, params)
        await self._request("POST", "/command", body={"serial": device.unique_id, "command": nle_command, "value": value})
        state = _state(await self._status(device.unique_id), last_mode)
        for capability in state.capabilities:
            capability.confirmed = False
        for setting in state.settings:
            setting.confirmed = False
        return CommandOutcome(result=CommandResult(status="pending", message="NoLongerEvil accepted the change. The thermostat applies it when it next connects."), state=state)
