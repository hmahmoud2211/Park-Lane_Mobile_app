"""Tasmota and OpenBeken devices over their local HTTP command API (experimental, untested on hardware).

Both firmwares run console commands from GET /cm?cmnd=<command> and answer JSON
(https://tasmota.github.io/docs/Commands/, OpenBK7231T_App docs/commands.md). This module speaks only that
published protocol; no firmware code is used.

- `Status 0`: everything at once. Status (names), StatusFWR (version, hardware), StatusNET (Mac), StatusSNS
  (ENERGY when metered), StatusSTS (POWER or POWER1..n, and for lights Dimmer, HSBColor, CT).
- `Power<n> ON|OFF|TOGGLE`, `Dimmer 0..100`, `HSBColor h,s,b`, `CT 153..500` (mireds).

OpenBeken emulates this API rather than sharing it, and differs in ways the code below allows for:
- it identifies itself with StatusFWR.SDK "obk";
- it takes the web password only as HTTP Basic. Tasmota takes Basic too (seen from 9.5), and always the
  `user=` and `password=` URL arguments it documents, which are all it reads up to at least 9.1;
- its HSBColor needs all three numbers (a missing brightness reads as 0);
- Dimmer, CT and HSBColor leave a light that is off still off, unless its "autoenable" flag is set.

Tasmota's default builds leave mDNS off, so devices are found by asking each host with port 80 open for
`Status 0`, or by typing the address.

A refused password looks different on each. Tasmota answers a one-key {"WARNING": ...} JSON, status 401 (seen
from 8.5) or 200 (seen on 7.2), with the text translated per firmware language. OpenBeken answers 401 with
`WWW-Authenticate: Basic realm="OpenBeken HTTP Server"`.
"""

from __future__ import annotations

import asyncio
import re
from typing import Any
from urllib.parse import quote

import httpx

from ..models import AdapterInfo, AuthKind, Candidate, Category, CommandResult, ConnectionStatus, FieldSpec, PairingRequirements, SupportLevel, clean_text
from . import _lan, caps
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
    normalize_mac,
)

PROTOCOL = "tasmota-http"
PORT = 80
TIMEOUT = 4.0
#: Fixed in both firmwares: Tasmota's WEB_USERNAME default, and the only name OpenBeken accepts.
USERNAME = "admin"

TASMOTA = "tasmota"
OPENBEKEN = "openbeken"
LABELS = {TASMOTA: "Tasmota", OPENBEKEN: "OpenBeken"}

POWER_WORDS = {"turn_on": "ON", "turn_off": "OFF", "toggle": "TOGGLE"}
#: The firmware's 153..500 mired range, in whole hundreds of kelvin.
KELVIN_MIN, KELVIN_MAX = 2000, 6500

_POWER_KEY = re.compile(r"POWER(\d*)")

#: StatusSNS.ENERGY field, reading key, label, unit, device class.
ENERGY_READINGS = (
    ("Power", "power_w", "Power", "W", "power"),
    ("Voltage", "voltage_v", "Voltage", "V", "voltage"),
    ("Current", "current_a", "Current", "A", "current"),
    ("Today", "energy_today_kwh", "Energy today", "kWh", "energy"),
    ("Total", "energy_total_kwh", "Energy total", "kWh", "energy"),
)


class TasmotaAdapter(DeviceAdapter):
    info = AdapterInfo(
        id="tasmota",
        name="Tasmota / OpenBeken (local HTTP)",
        brands=["tasmota"],
        protocols=[PROTOCOL],
        discovery=["subnet"],
        categories=[Category.SWITCH, Category.PLUG, Category.LIGHT],
        status=SupportLevel.EXPERIMENTAL,
        account_free=True,
        auth=AuthKind.NONE,
        library=None,
        verified_models=[],
        notes=[
            "Uses the firmware's published /cm command API; not yet tested on real hardware.",
            "OpenBeken answers through its Tasmota-compatible JSON.",
            "If the device has a web password, enter it when pairing.",
        ],
    )
    probe_ports = (PORT,)
    poll_interval = 20
    #: A command is a read, the command, a read back, and at worst one more command and read.
    call_timeout = 15.0

    # ---- discovery ----

    async def discover(self, scan: ScanContext) -> None:
        await scan.wait_passive()

        async def check(ip: str) -> None:
            candidate = await self._identify_host(ip, "subnet")
            if candidate:
                _lan.report(scan, candidate)

        await asyncio.gather(*(check(ip) for ip in scan.hosts_with_port(PORT) if scan.in_scope(ip)))

    async def _identify_host(self, ip: str, source: str) -> Candidate | None:
        try:
            response = await self._request(ip, PORT, "Status 0", None)
        except DeviceUnreachable:
            return None
        locked = _locked_by(response)
        if locked:
            return self._locked_candidate(ip, locked, source)
        identity = _identity(_json(response))
        if identity is None:
            return None
        candidate = make_candidate(
            self,
            identity["mac"].replace(":", ""),
            name=identity["name"],
            model=identity["model"],
            ip=ip,
            port=PORT,
            mac=identity["mac"],
            protocol=PROTOCOL,
            sources=[source],
            details={"firmware": identity["firmware"], "version": identity["version"], "auth": False},
        )
        candidate.status = ConnectionStatus.IDENTIFIED
        candidate.pairing = self.get_pairing_requirements(candidate)
        return candidate

    def _locked_candidate(self, ip: str, firmware: str, source: str) -> Candidate:
        """A device with a web password. It shows nothing without it, so only its address can name it for now."""
        label = LABELS[firmware]
        candidate = make_candidate(
            self,
            f"ip-{ip}",
            name=f"{label} device",
            model=label,
            ip=ip,
            port=PORT,
            protocol=PROTOCOL,
            sources=[source],
            details={"firmware": firmware, "auth": True},
        )
        candidate.status = ConnectionStatus.LOCAL_AUTHORIZATION_REQUIRED
        candidate.pairing = self.get_pairing_requirements(candidate)
        return candidate

    async def probe(self, host: str) -> Candidate | None:
        return await self._identify_host(host, "manual")

    def get_pairing_requirements(self, candidate: Candidate) -> PairingRequirements:
        if not candidate.details.get("auth"):
            return PairingRequirements(auth=AuthKind.NONE, instructions="No web password is set on this device.")
        return PairingRequirements(
            auth=AuthKind.DEVICE_CREDENTIALS,
            fields=[FieldSpec(name="password", label="Web password", kind="password", secret=True, help="The password set on the device's own web page.")],
            instructions="This device has a web password. Enter it to let the gateway control it.",
        )

    # ---- transport ----

    async def _request(self, host: str, port: int, command: str, password: str | None) -> httpx.Response:
        """One /cm call. The password goes in a header, so it stays out of every URL unless the firmware needs it there."""
        base = f"http://{host}:{port}/cm"
        query = "cmnd=" + quote(command, safe=",")
        auth = httpx.BasicAuth(USERNAME, password) if password else None
        try:
            response = await self.ctx.http.get(f"{base}?{query}", auth=auth, timeout=TIMEOUT)
            if password and _locked_by(response) == TASMOTA:
                # Tasmota before Basic support reads only these URL arguments.
                legacy = f"{base}?user={USERNAME}&password={quote(password, safe='')}&{query}"
                response = await self.ctx.http.get(legacy, timeout=TIMEOUT)
        except httpx.HTTPError as error:
            raise DeviceUnreachable(f"The device at {host} did not answer.") from error
        return response

    async def _command(self, host: str, port: int, command: str, password: str | None) -> dict[str, Any]:
        """Runs one command and returns its JSON reply, {} when the firmware prints none."""
        response = await self._request(host, port, command, password)
        if _locked_by(response):
            if password:
                raise AuthRequired("The device rejected that password.", code="device_auth_failed")
            raise AuthRequired("This device has a web password. Enter it to continue.")
        if response.status_code >= 400:
            raise AdapterError(f"The device at {host} answered {response.status_code}.", code="device_rejected")
        return _json(response) or {}

    async def _status(self, host: str, port: int, password: str | None) -> dict[str, Any]:
        status = await self._command(host, port, "Status 0", password)
        if not isinstance(status.get("StatusSTS"), dict):
            raise DeviceUnreachable(f"The device at {host} did not answer like Tasmota or OpenBeken.")
        return status

    async def _device_status(self, device: StoredDevice) -> dict[str, Any]:
        return await self._status(device.host or "", device.port or PORT, device.credentials.get("password"))

    async def _send(self, device: StoredDevice, command: str) -> None:
        reply = await self._command(device.host or "", device.port or PORT, command, device.credentials.get("password"))
        if reply.get("Command") in {"Unknown", "Error"}:
            raise AdapterError("The device refused that command.", code="device_rejected")

    # ---- pairing ----

    async def pair(self, candidate: Candidate, credentials: dict[str, str], approval: ApprovalCallback) -> PairResult:
        if not candidate.ip:
            raise DeviceUnreachable("No address for this device; scan again.")
        port = candidate.port or PORT
        password = credentials.get("password") or None
        status = await self._status(candidate.ip, port, password)
        identity = _identity(status)
        if identity is None:
            raise DeviceUnreachable(f"The device at {candidate.ip} did not answer like Tasmota or OpenBeken.")
        state = _to_state(status)
        if not state.capabilities:
            raise AdapterError(
                "This device has no relay or light set up yet.",
                code="no_outputs",
                recovery="Choose its module or template on the device's own web page, then add it again.",
            )
        return PairResult(
            # The MAC, also for a device first seen by address: only now can it be read.
            unique_id=identity["mac"].replace(":", ""),
            name=identity["name"],
            category=_category(state),
            model=identity["model"],
            host=candidate.ip,
            port=port,
            mac=identity["mac"],
            protocol=PROTOCOL,
            params={"firmware": identity["firmware"], "version": identity["version"]},
            credentials={"password": password} if password else {},
        )

    # ---- state and control ----

    async def get_state(self, device: StoredDevice) -> DeviceState:
        return _to_state(await self._device_status(device))

    async def execute_command(self, device: StoredDevice, command: str, params: dict[str, Any]) -> CommandOutcome:
        status = await self._device_status(device)
        if command not in _to_state(status).commands:
            raise UnsupportedCommand(f"This device does not offer {command}.")
        sts = status["StatusSTS"]
        outputs = _outputs(sts)
        light = f"Power{max(outputs)}" if len(outputs) > 1 else "Power"  # Tasmota numbers a light after the relays
        wants_light = True

        if command in POWER_WORDS:
            line = f"{_power_name(outputs, params)} {POWER_WORDS[command]}"
            wants_light = False
        elif command == "set_brightness":
            level = round(caps.clamp(caps.param(params, "brightness"), 0, 100, "brightness"))
            wants_light = level > 0
            line = f"Dimmer {level}" if wants_light else f"{light} OFF"  # OFF keeps the level for the next turn on
        elif command == "set_color":
            h = round(caps.clamp(caps.param(params, "h"), 0, 360, "h"))
            s = round(caps.clamp(caps.param(params, "s"), 0, 100, "s"))
            line = f"HSBColor {h},{s},{round(_number(sts.get('Dimmer')) or 100)}"
        else:  # set_color_temp, the only command left that a state can offer
            kelvin = caps.clamp(caps.param(params, "kelvin"), KELVIN_MIN, KELVIN_MAX, "kelvin")
            line = f"CT {round(1_000_000 / kelvin)}"

        await self._send(device, line)
        status = await self._device_status(device)
        if wants_light and _outputs(status["StatusSTS"]).get(max(outputs, default=0)) is False:
            await self._send(device, f"{light} ON")
            status = await self._device_status(device)
        return CommandOutcome(result=CommandResult(status="confirmed"), state=_to_state(status))


# ---- reading replies -------------------------------------------------------------------------------


def _json(response: httpx.Response) -> dict[str, Any] | None:
    try:
        body = response.json()
    except ValueError:
        return None
    return body if isinstance(body, dict) else None


def _locked_by(response: httpx.Response) -> str | None:
    """The firmware that refused a request for want of a password, if it is one of these two. See the module notes."""
    if response.status_code == 401 and "openbeken" in response.headers.get("www-authenticate", "").lower():
        return OPENBEKEN
    body = _json(response)
    return TASMOTA if body is not None and list(body) == ["WARNING"] else None


def _identity(status: dict[str, Any] | None) -> dict[str, Any] | None:
    """Who answered, or None unless the reply really is a Status 0: a host with a stray /cm path is not a device."""
    if status is None or not all(isinstance(status.get(section), dict) for section in ("Status", "StatusFWR", "StatusNET", "StatusSTS")):
        return None
    mac = normalize_mac(status["StatusNET"].get("Mac"))
    if not mac:
        return None
    firmware_info = status["StatusFWR"]
    firmware = OPENBEKEN if firmware_info.get("SDK") == "obk" else TASMOTA
    label = LABELS[firmware]
    names = status["Status"]
    friendly = names.get("FriendlyName")  # a list; a single string on older firmware
    first = (friendly[0] if friendly else None) if isinstance(friendly, list) else friendly
    hardware = clean_text(firmware_info.get("Hardware"))
    return {
        "mac": mac,
        "name": clean_text(first) or clean_text(names.get("DeviceName")) or f"{label} device",
        "model": f"{label} on {hardware}" if hardware else label,
        "firmware": firmware,
        "version": clean_text(firmware_info.get("Version")),
    }


def _number(value: Any) -> float | None:
    return float(value) if isinstance(value, int | float) and not isinstance(value, bool) else None


def _outputs(sts: dict[str, Any]) -> dict[int, bool | None]:
    """Each output by the firmware's number, in order. A bare POWER is output 1. None: a state text it can't read."""
    outputs = {}
    for key, value in sts.items():
        match = _POWER_KEY.fullmatch(key)
        if match:
            outputs[int(match[1] or 1)] = {"ON": True, "OFF": False}.get(str(value).upper())
    return dict(sorted(outputs.items()))


def _power_name(outputs: dict[int, bool | None], params: dict[str, Any]) -> str:
    """The Power command for params.key ("power:1") or params.channel, counted from 0, else the first output."""
    if len(outputs) <= 1:
        return "Power"
    key = str(params.get("key") or "")
    channel = key.partition(":")[2] if key.startswith("power:") else params.get("channel")
    number = next(iter(outputs)) if channel is None else round(caps.clamp(channel, 0, 256, "channel")) + 1
    if number not in outputs:
        raise AdapterError(f"This device has no output {number}.", code="bad_params")
    return f"Power{number}"


def _hue_saturation(value: Any) -> tuple[float, float] | None:
    parts = str(value).split(",")
    try:
        return (float(parts[0]), float(parts[1])) if len(parts) == 3 else None
    except ValueError:
        return None


def _readings(status: dict[str, Any]) -> list[Any]:
    readings = []
    sensors = status.get("StatusSNS")
    energy = sensors.get("ENERGY") if isinstance(sensors, dict) else None
    if isinstance(energy, dict):
        for field, key, label, unit, device_class in ENERGY_READINGS:
            value = energy.get(field)
            values = value if isinstance(value, list) else [value]  # a list on multi-channel meters
            for index, item in enumerate(values):
                number = _number(item)
                if number is not None:
                    suffix = f":{index}" if len(values) > 1 else ""
                    readings.append(caps.reading(f"{key}{suffix}", label, number, unit, device_class))
    wifi = status["StatusSTS"].get("Wifi")
    signal = _number(wifi.get("Signal")) if isinstance(wifi, dict) else None
    if signal is not None:
        readings.append(caps.reading("rssi", "Wi-Fi signal", signal, "dBm", "signal_strength"))
    return readings


def _to_state(status: dict[str, Any]) -> DeviceState:
    sts = status["StatusSTS"]
    outputs = _outputs(sts)
    if len(outputs) == 1:
        capabilities = [caps.power(on) for on in outputs.values()]
    else:
        capabilities = [caps.power(on, key=f"power:{number - 1}", label=f"Output {number}") for number, on in outputs.items()]
    dimmer = _number(sts.get("Dimmer"))
    if dimmer is not None:
        capabilities.append(caps.brightness(dimmer))
    colour = _hue_saturation(sts.get("HSBColor"))
    if colour:
        capabilities.append(caps.color(*colour))
    mired = _number(sts.get("CT"))
    if mired:
        capabilities.append(caps.color_temp(max(KELVIN_MIN, min(KELVIN_MAX, 1_000_000 / mired)), KELVIN_MIN, KELVIN_MAX))
    return DeviceState(capabilities=capabilities, readings=_readings(status), commands=caps.commands_for(capabilities))


def _category(state: DeviceState) -> Category:
    if any(cap.type == "brightness" for cap in state.capabilities):
        return Category.LIGHT
    if any(reading.key.startswith("power_w") for reading in state.readings):
        return Category.PLUG
    return Category.SWITCH
