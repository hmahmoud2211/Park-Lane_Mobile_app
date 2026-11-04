"""Tuya / Smart Life devices over Tuya's local protocol, with tinytuya.

Tuya devices announce themselves by UDP broadcast: protocol 3.1 in plain text on port 6666, 3.2-3.4
encrypted with a well-known key on 6667, and 3.5 devices answer a discovery request on 7000. The
announcement carries the device id, IP and protocol version, but never the device's local key: every
command and status read is encrypted with that per-device key, which the user must supply (it is obtained
once with tinytuya's wizard and a Tuya IoT developer account; the gateway itself never contacts Tuya).

Data points (DPS) are model-specific. This adapter maps the common layouts: switches and plugs
(DP 1..n on/off, plus 18/19/20 current/power/voltage on metering plugs) and v2 bulbs (20 power, 21 mode,
22 brightness 10-1000, 23 white temperature 0-1000, 24 colour HSV). Anything else falls back to the
first on/off data point, or no controls, rather than guessing.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import socket
from typing import Any

import tinytuya

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

LISTEN_PORTS = (6666, 6667, 7000)
VERSIONS = ["3.1", "3.2", "3.3", "3.4", "3.5"]
#: Tuya white temperature is a 0-1000 scale; these are the nominal ends most bulbs document.
KELVIN_MIN, KELVIN_MAX = 2700, 6500


def parse_broadcast(data: bytes) -> dict[str, Any] | None:
    """A device announcement, decrypted with tinytuya's helper, or None for anything else."""
    try:
        text = tinytuya.decrypt_udp(data)
    except Exception:  # noqa: BLE001 - tinytuya raises many types for foreign packets
        return None
    if isinstance(text, bytes):
        text = text.decode("utf-8", "replace")
    try:
        info = json.loads(text)
    except (TypeError, ValueError):
        return None
    if not isinstance(info, dict) or not info.get("gwId") or not info.get("ip"):
        return None
    return info


def discovery_request(local_ip: str) -> bytes:
    """The broadcast 3.5 devices answer (tinytuya.scanner.send_discovery_request builds the same)."""
    body = json.dumps({"from": "app", "ip": local_ip}).encode()
    message = tinytuya.TuyaMessage(0, tinytuya.REQ_DEVINFO, None, body, 0, True, tinytuya.PREFIX_6699_VALUE, True)
    return tinytuya.pack_message(message, hmac_key=tinytuya.udpkey)


def _local_ip_towards(target: str) -> str | None:
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        sock.connect((target, 7000))
        return sock.getsockname()[0]
    except OSError:
        return None
    finally:
        sock.close()


def _profile(dps: dict[str, Any]) -> dict[str, Any]:
    """Which layout the data points follow."""
    if isinstance(dps.get("20"), bool) and ("22" in dps or "21" in dps):
        return {"kind": "bulb"}
    gangs = sorted((k for k, v in dps.items() if k.isdigit() and 1 <= int(k) <= 9 and isinstance(v, bool)), key=int)
    if gangs:
        return {"kind": "switch", "gangs": gangs, "metering": isinstance(dps.get("19"), int | float)}
    first_bool = next((k for k, v in sorted(dps.items(), key=lambda kv: int(kv[0]) if kv[0].isdigit() else 999) if isinstance(v, bool)), None)
    return {"kind": "unknown", "power": first_bool}


def _hsv_decode(value: Any) -> tuple[float, float, float] | None:
    text = str(value or "")
    if len(text) != 12:
        return None
    try:
        return int(text[0:4], 16), int(text[4:8], 16) / 10, int(text[8:12], 16) / 10
    except ValueError:
        return None


def _hsv_encode(h: float, s: float, v: float) -> str:
    return f"{round(h) % 360:04x}{round(s * 10):04x}{round(v * 10):04x}"


def _state(dps: dict[str, Any]) -> tuple[DeviceState, Category]:
    profile = _profile(dps)
    capabilities = []
    readings = []
    category = Category.OTHER
    if profile["kind"] == "bulb":
        category = Category.LIGHT
        capabilities.append(caps.power(dps.get("20"), key="power:20"))
        mode = dps.get("21")
        colour = _hsv_decode(dps.get("24"))
        if mode == "colour" and colour:
            capabilities.append(caps.brightness(colour[2]))
        elif isinstance(dps.get("22"), int | float):
            capabilities.append(caps.brightness((float(dps["22"]) - 10) / 9.9))
        if isinstance(dps.get("23"), int | float):
            kelvin = KELVIN_MIN + float(dps["23"]) / 1000 * (KELVIN_MAX - KELVIN_MIN)
            capabilities.append(caps.color_temp(kelvin if mode != "colour" else None, KELVIN_MIN, KELVIN_MAX))
        if "24" in dps:
            capabilities.append(caps.color(colour[0], colour[1]) if mode == "colour" and colour else caps.color(None, None))
    elif profile["kind"] == "switch":
        category = Category.PLUG if profile["metering"] or len(profile["gangs"]) == 1 else Category.SWITCH
        for index, dp in enumerate(profile["gangs"]):
            label = "Power" if len(profile["gangs"]) == 1 else f"Outlet {index + 1}"
            capabilities.append(caps.power(dps.get(dp), key=f"power:{dp}", label=label))
        if profile["metering"]:
            readings.append(caps.reading("power_w", "Power", round(float(dps["19"]) / 10, 1), "W", "power"))
            if isinstance(dps.get("18"), int | float):
                readings.append(caps.reading("current_ma", "Current", dps["18"], "mA", "current"))
            if isinstance(dps.get("20"), int | float):
                readings.append(caps.reading("voltage_v", "Voltage", round(float(dps["20"]) / 10, 1), "V", "voltage"))
    elif profile.get("power"):
        capabilities.append(caps.power(dps.get(profile["power"]), key=f"power:{profile['power']}"))
    return DeviceState(capabilities=capabilities, readings=readings, commands=caps.commands_for(capabilities)), category


def _check(result: Any) -> dict[str, Any]:
    if not isinstance(result, dict):
        raise AdapterError("The Tuya device sent an unexpected reply.", code="device_rejected")
    if "Err" in result or "Error" in result:
        try:
            code = int(result.get("Err") or 0)
        except (TypeError, ValueError):
            code = 0
        if code == tinytuya.ERR_KEY_OR_VER:
            raise LocalKeyRequired(
                "The device rejected the local key or protocol version.",
                code="local_key_invalid",
                recovery="Check the local key (it changes whenever the device is re-paired in the Smart Life app) and the protocol version.",
            )
        if code in {tinytuya.ERR_CONNECT, tinytuya.ERR_OFFLINE, tinytuya.ERR_TIMEOUT}:
            raise DeviceUnreachable("The Tuya device did not answer on the local network.")
        raise AdapterError(f"The Tuya device reported an error: {tinytuya.error_codes.get(code, 'unknown error')}.", code="device_rejected")
    return result


class TuyaLocalAdapter(DeviceAdapter):
    info = AdapterInfo(
        id="tuya_local",
        name="Tuya local protocol (tinytuya)",
        brands=["tuya"],
        protocols=["tuya-local-3.1", "tuya-local-3.3", "tuya-local-3.4", "tuya-local-3.5"],
        discovery=["udp-broadcast-listen"],
        categories=[Category.PLUG, Category.SWITCH, Category.LIGHT],
        status=SupportLevel.LIMITED,
        account_free=True,
        auth=AuthKind.LOCAL_KEY,
        library="tinytuya",
        notes=[
            "Discovery never reveals a device's local key. Get it once with `python -m tinytuya wizard` "
            "(needs a free Tuya IoT developer account); the gateway never contacts Tuya.",
            "The key changes whenever the device is removed and re-added in the Smart Life app.",
            "Common plug, switch and bulb data points are mapped; other device types may show no controls.",
        ],
    )
    poll_interval = 30
    call_timeout = 15.0

    def __init__(self, ctx):
        super().__init__(ctx)
        self.listen_ports: tuple[int, ...] = LISTEN_PORTS
        self.request_targets: list[tuple[str, int]] | None = None
        #: Swapped in tests for a fake.
        self.client_factory = tinytuya.Device

    # ---- discovery ----

    async def discover(self, scan: ScanContext) -> None:
        duration = _lan.window(scan)
        found: dict[str, tuple[dict[str, Any], int]] = {}

        def on_reply(reply: _lan.Reply) -> None:
            info = parse_broadcast(reply[0])
            if info and info["gwId"] not in found:
                found[info["gwId"]] = (info, reply[2])

        async def listen(port: int) -> None:
            try:
                await _lan.udp_listen(port, duration=duration, cancelled=scan.cancelled, on_reply=on_reply)
            except OSError as error:
                self.log.warning("cannot listen for Tuya broadcasts", extra={"port": port, "reason": str(error)})

        async def ask_v35() -> None:
            targets = self.request_targets or _lan.broadcast_targets(scan, 7000)
            for target in targets:
                local_ip = _local_ip_towards(target[0]) or "0.0.0.0"
                with contextlib.suppress(OSError):
                    await _lan.udp_broadcast([target], discovery_request(local_ip), duration=0.2, repeat=2, interval=0.1)

        await asyncio.gather(*(listen(port) for port in self.listen_ports), ask_v35())
        for gw_id, (info, _port) in found.items():
            ip = str(info.get("ip"))
            if not scan.in_scope(ip):
                continue
            _lan.report(scan, self._candidate(gw_id, ip, info, "udp-broadcast"))

    def _candidate(self, gw_id: str, ip: str, info: dict[str, Any], source: str) -> Candidate:
        version = str(info.get("version") or "3.3")
        candidate = make_candidate(
            self,
            gw_id,
            name=f"Tuya device {gw_id[-4:]}",
            model=info.get("productKey"),
            ip=ip,
            port=6668,
            protocol=f"tuya-local-{version}",
            sources=[source],
            details={"version": version, "product_key": info.get("productKey"), "encrypted": bool(info.get("encrypt", True))},
        )
        candidate.status = ConnectionStatus.LOCAL_KEY_REQUIRED
        candidate.pairing = self.get_pairing_requirements(candidate)
        return candidate

    def get_pairing_requirements(self, candidate: Candidate) -> PairingRequirements:
        version = str(candidate.details.get("version") or "3.3")
        return PairingRequirements(
            auth=AuthKind.LOCAL_KEY,
            fields=[
                FieldSpec(
                    name="local_key",
                    label="Local key",
                    kind="password",
                    secret=True,
                    pattern=r"^.{16}$",
                    help="16 characters. Get it once with tinytuya's wizard; scanning does not reveal it.",
                ),
                FieldSpec(name="version", label="Protocol version", kind="select", required=False, options=VERSIONS, help=f"Detected: {version}"),
            ],
            instructions="Tuya devices encrypt their local protocol with a per-device key. Enter it to control this device locally.",
        )

    # ---- transport ----

    def _client(self, device_id: str, host: str, key: str, version: str) -> Any:
        client = self.client_factory(
            device_id, address=host, local_key=key, version=float(version), connection_timeout=4, connection_retry_limit=1, connection_retry_delay=1
        )
        return client

    async def _run(self, client: Any, method: str, *args: Any, allow_empty: bool = False) -> dict[str, Any]:
        def work() -> Any:
            try:
                return getattr(client, method)(*args)
            finally:
                with contextlib.suppress(Exception):
                    client.close()

        try:
            result = await asyncio.wait_for(asyncio.to_thread(work), timeout=12)
        except TimeoutError as error:
            raise DeviceUnreachable("The Tuya device did not answer in time.") from error
        if result is None and allow_empty:
            # Some firmware acknowledges a write without a payload; the status read that follows confirms it.
            return {}
        return _check(result)

    def _device_client(self, device: StoredDevice) -> Any:
        key = device.credentials.get("local_key")
        if not key:
            raise LocalKeyRequired("This Tuya device has no local key stored.")
        return self._client(device.unique_id, device.host or "", key, str(device.params.get("version") or "3.3"))

    async def _dps(self, device: StoredDevice) -> dict[str, Any]:
        result = await self._run(self._device_client(device), "status")
        dps = result.get("dps")
        if not isinstance(dps, dict):
            raise AdapterError("The Tuya device did not report its data points.", code="device_rejected")
        return {str(k): v for k, v in dps.items()}

    # ---- pairing ----

    async def pair(self, candidate: Candidate, credentials: dict[str, str], approval: ApprovalCallback) -> PairResult:
        if not candidate.ip:
            raise DeviceUnreachable("No address for this Tuya device; scan again.")
        key = credentials.get("local_key", "").strip()
        if not key:
            raise LocalKeyRequired("Enter this device's local key.", code="credentials_missing")
        version = (credentials.get("version") or str(candidate.details.get("version") or "3.3")).strip()
        if version not in VERSIONS:
            raise AdapterError(f"Unknown Tuya protocol version {version!r}.", code="bad_params")
        device = StoredDevice(
            id="pairing",
            adapter_id=self.info.id,
            brand="tuya",
            unique_id=candidate.unique_id,
            name=candidate.name or "Tuya device",
            category=Category.OTHER,
            host=candidate.ip,
            port=6668,
            params={"version": version},
            credentials={"local_key": key},
        )
        dps = await self._dps(device)
        _state_now, category = _state(dps)
        return PairResult(
            unique_id=candidate.unique_id,
            name=candidate.name or "Tuya device",
            category=category,
            model=candidate.model,
            host=candidate.ip,
            port=6668,
            protocol=f"tuya-local-{version}",
            params={"version": version, "dps": sorted(dps)},
            credentials={"local_key": key},
        )

    # ---- state ----

    async def get_state(self, device: StoredDevice) -> DeviceState:
        state, _category = _state(await self._dps(device))
        return state

    async def execute_command(self, device: StoredDevice, command: str, params: dict[str, Any]) -> CommandOutcome:
        dps = await self._dps(device)
        profile = _profile(dps)
        state, _category = _state(dps)
        power_keys = [cap.key.split(":", 1)[1] for cap in state.capabilities if cap.type == "power"]
        changes: dict[str, Any] = {}

        if command in {"turn_on", "turn_off", "toggle"}:
            if not power_keys:
                raise UnsupportedCommand("This Tuya device has no on/off data point the gateway recognises.")
            wanted = str(params.get("key") or "").split(":")[-1] or str(params.get("channel") or "")
            dp = wanted if wanted in power_keys else power_keys[0]
            changes[dp] = (not bool(dps.get(dp))) if command == "toggle" else command == "turn_on"
        elif profile["kind"] == "bulb" and command == "set_brightness":
            level = caps.clamp(caps.param(params, "brightness"), 0, 100, "brightness")
            if level == 0:
                changes["20"] = False
            elif dps.get("21") == "colour" and _hsv_decode(dps.get("24")):
                h, s, _v = _hsv_decode(dps.get("24")) or (0, 0, 0)
                changes.update({"20": True, "24": _hsv_encode(h, s, max(level, 1))})
            else:
                changes.update({"20": True, "22": round(10 + level * 9.9)})
        elif profile["kind"] == "bulb" and command == "set_color_temp" and "23" in dps:
            kelvin = caps.clamp(caps.param(params, "kelvin"), KELVIN_MIN, KELVIN_MAX, "kelvin")
            changes.update({"20": True, "21": "white", "23": round((kelvin - KELVIN_MIN) / (KELVIN_MAX - KELVIN_MIN) * 1000)})
        elif profile["kind"] == "bulb" and command == "set_color" and "24" in dps:
            h = caps.clamp(caps.param(params, "h"), 0, 360, "h")
            s = caps.clamp(caps.param(params, "s"), 0, 100, "s")
            current = _hsv_decode(dps.get("24"))
            changes.update({"20": True, "21": "colour", "24": _hsv_encode(h, s, current[2] if current and current[2] > 0 else 100)})
        else:
            raise UnsupportedCommand(f"This Tuya device does not support {command}.")

        await self._run(self._device_client(device), "set_multiple_values", changes, allow_empty=True)
        return CommandOutcome(result=CommandResult(status="confirmed"), state=await self.get_state(device))
