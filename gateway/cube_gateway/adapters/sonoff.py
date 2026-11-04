"""SONOFF / eWeLink devices on the LAN.

Two modes, both announced over mDNS as _ewelink._tcp with the device id and state in TXT `data1..4`:

- DIY mode (ITEAD's SONOFF DIY MODE API Protocol v2.0): unencrypted. POST http://ip:8081/zeroconf/info,
  /zeroconf/switch {"deviceid": "", "data": {"switch": "on"}}. Documented by ITEAD for BASICR3, RFR3 and MINI.
- eWeLink LAN mode (stock firmware set up with the eWeLink app): TXT `encrypt=true`. State and commands are
  AES-128-CBC encrypted with MD5(devicekey), as implemented by AlexxIT/SonoffLAN (core/ewelink/local.py).
  The devicekey is the `apikey` the device returns from http://10.10.7.1/device in pairing mode. Without it
  the device is detected but not controllable, and the app says so. Not documented by ITEAD: experimental.

Per ITEAD, requests to one device should be at least 200 ms apart; commands are serialized per device.
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import secrets
import time
from typing import Any

import httpx
from cryptography.hazmat.primitives import padding
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

from ..models import AdapterInfo, AuthKind, Candidate, Category, CommandResult, ConnectionStatus, FieldSpec, PairingRequirements, SupportLevel
from . import caps
from .base import (
    AdapterError,
    ApprovalCallback,
    CommandOutcome,
    DeviceAdapter,
    DeviceState,
    DeviceUnreachable,
    LocalKeyRequired,
    MdnsRecord,
    PairResult,
    ScanContext,
    StoredDevice,
    UnsupportedCommand,
    make_candidate,
)

SERVICE = "_ewelink._tcp.local."
DEFAULT_PORT = 8081
DIY_MODELS = ("BASICR3", "RFR3", "MINI")


# ---- the eWeLink LAN cipher (SonoffLAN-compatible) ------------------------------------------------


def _key(device_key: str) -> bytes:
    return hashlib.md5(device_key.encode()).digest()  # noqa: S324 - the device's protocol, not our choice


def encrypt(data: Any, device_key: str) -> tuple[str, str]:
    iv = secrets.token_bytes(16)
    padder = padding.PKCS7(128).padder()
    plaintext = padder.update(json.dumps(data, separators=(",", ":")).encode()) + padder.finalize()
    encryptor = Cipher(algorithms.AES(_key(device_key)), modes.CBC(iv)).encryptor()
    return base64.b64encode(encryptor.update(plaintext) + encryptor.finalize()).decode(), base64.b64encode(iv).decode()


def decrypt(data: str, iv: str, device_key: str) -> dict[str, Any]:
    decryptor = Cipher(algorithms.AES(_key(device_key)), modes.CBC(base64.b64decode(iv))).decryptor()
    padded = decryptor.update(base64.b64decode(data)) + decryptor.finalize()
    unpadder = padding.PKCS7(128).unpadder()
    try:
        plaintext = unpadder.update(padded) + unpadder.finalize()
    except ValueError:
        # Some firmware pads with stray control bytes after the JSON (SonoffLAN #1160).
        plaintext = padded.rstrip(bytes(range(0, 32)))
    parsed = json.loads(plaintext.decode("utf-8").rstrip("".join(chr(c) for c in range(32))))
    if not isinstance(parsed, dict):
        raise ValueError("not an object")
    return parsed


def decode_txt(properties: dict[str, str], device_key: str | None) -> tuple[dict[str, Any] | None, bool | None]:
    """Returns (params, key_verified). key_verified is None when no key was needed or none was given."""
    raw = "".join(properties.get(f"data{i}", "") for i in range(1, 5))
    if not raw:
        return None, None
    if properties.get("encrypt") != "true":
        try:
            parsed = json.loads(raw)
        except ValueError:
            return None, None
        return (parsed if isinstance(parsed, dict) else None), None
    if not device_key or not properties.get("iv"):
        return None, None
    try:
        return decrypt(raw, properties["iv"], device_key), True
    except (ValueError, UnicodeDecodeError):
        return None, False


def _state_from_params(params: dict[str, Any], *, confirmed: bool = True) -> DeviceState:
    capabilities = []
    if isinstance(params.get("switches"), list):
        for entry in params["switches"]:
            if isinstance(entry, dict) and "outlet" in entry:
                index = int(entry["outlet"])
                capabilities.append(caps.power(entry.get("switch") == "on", key=f"power:{index}", label=f"Outlet {index + 1}", confirmed=confirmed))
    elif params.get("switch") in {"on", "off"}:
        capabilities.append(caps.power(params["switch"] == "on", key="power:0", label="Power", confirmed=confirmed))
    readings = []
    if isinstance(params.get("signalStrength"), int | float):
        readings.append(caps.reading("rssi", "Wi-Fi signal", params["signalStrength"], "dBm", "signal_strength"))
    for key, label, unit in (("power", "Power", "W"), ("voltage", "Voltage", "V"), ("current", "Current", "A")):
        if params.get(key) not in (None, ""):
            try:
                readings.append(caps.reading(key, label, float(params[key]), unit, key))
            except (TypeError, ValueError):
                pass
    return DeviceState(capabilities=capabilities, readings=readings, commands=caps.commands_for(capabilities))


class SonoffLanAdapter(DeviceAdapter):
    info = AdapterInfo(
        id="sonoff_lan",
        name="SONOFF LAN (DIY mode and eWeLink LAN)",
        brands=["sonoff"],
        protocols=["sonoff-diy-v2", "ewelink-lan-aes"],
        discovery=["mdns"],
        categories=[Category.SWITCH, Category.PLUG],
        status=SupportLevel.LIMITED,
        account_free=True,
        auth=AuthKind.NONE,
        verified_models=[],
        notes=[
            "DIY mode: documented by ITEAD for BASICR3, RFR3 and MINI; account-free.",
            "eWeLink LAN mode needs the device key (from pairing mode at http://10.10.7.1/device); experimental.",
            "S26R2TPF: its setup network and GET /device were confirmed earlier in this project; control in DIY or LAN mode is not yet verified on hardware.",
        ],
    )
    mdns_types = (SERVICE,)
    probe_ports = (DEFAULT_PORT,)
    poll_interval = 20

    def __init__(self, ctx):
        super().__init__(ctx)
        self._locks: dict[str, asyncio.Lock] = {}
        self._last_request: dict[str, float] = {}

    # ---- discovery ----

    async def discover(self, scan: ScanContext) -> None:
        await scan.wait_passive()
        for record in scan.mdns_of(SERVICE):
            if scan.in_scope(record.ip):
                candidate = self._from_record(record, "mdns")
                if candidate:
                    scan.report(candidate)

    def _from_record(self, record: MdnsRecord, source: str) -> Candidate | None:
        props = record.properties
        device_id = (props.get("id") or record.name.replace("eWeLink_", "")).lower()
        if not device_id:
            return None
        encrypted = props.get("encrypt") == "true"
        params, _ = decode_txt(props, None)
        device_type = props.get("type") or "unknown"
        candidate = make_candidate(
            self,
            device_id,
            name=f"SONOFF {device_id}",
            model=device_type,
            ip=record.ip,
            port=record.port or DEFAULT_PORT,
            protocol="ewelink-lan-aes" if encrypted else "sonoff-diy-v2",
            sources=[source],
            control="experimental" if encrypted else "supported",
            details={"encrypted": encrypted, "type": device_type, "apivers": props.get("apivers"), "instance": record.name, "params": params or {}},
        )
        candidate.status = ConnectionStatus.LOCAL_KEY_REQUIRED if encrypted else ConnectionStatus.IDENTIFIED
        candidate.pairing = self.get_pairing_requirements(candidate)
        return candidate

    async def probe(self, host: str) -> Candidate | None:
        """A DIY-mode device answers /zeroconf/info without a key; encrypted ones are found by mDNS only."""
        try:
            info = await self._post(host, DEFAULT_PORT, "/zeroconf/info", {"deviceid": "", "data": {}})
        except AdapterError:
            return None
        data = info.get("data") if isinstance(info.get("data"), dict) else {}
        device_id = str(data.get("deviceid") or "").lower()
        if not device_id:
            return None
        candidate = make_candidate(
            self, device_id, name=f"SONOFF {device_id}", model="DIY", ip=host, port=DEFAULT_PORT, protocol="sonoff-diy-v2",
            sources=["manual"], details={"encrypted": False, "params": data},
        )
        candidate.status = ConnectionStatus.IDENTIFIED
        return candidate

    def get_pairing_requirements(self, candidate: Candidate) -> PairingRequirements:
        if not candidate.details.get("encrypted"):
            return PairingRequirements(auth=AuthKind.NONE, instructions="DIY mode: no key needed.")
        return PairingRequirements(
            auth=AuthKind.LOCAL_KEY,
            fields=[
                FieldSpec(
                    name="device_key",
                    label="Device key",
                    kind="password",
                    secret=True,
                    help="The eWeLink device key: the apikey shown at http://10.10.7.1/device while the device is in "
                    "pairing mode. The gateway never contacts eWeLink.",
                    pattern=r"^[0-9a-fA-F-]{20,64}$",
                )
            ],
            instructions="This device was set up with the eWeLink app and encrypts its local traffic. Enter its device "
            "key, or set it up again in DIY mode from Connect new device.",
        )

    # ---- transport ----

    async def _post(self, host: str, port: int, path: str, body: dict[str, Any]) -> dict[str, Any]:
        lock = self._locks.setdefault(host, asyncio.Lock())
        async with lock:
            wait = 0.2 - (time.monotonic() - self._last_request.get(host, 0))
            if wait > 0:
                await asyncio.sleep(wait)
            last_error: Exception | None = None
            for attempt in range(3):
                try:
                    response = await self.ctx.http.post(f"http://{host}:{port}{path}", json=body, timeout=4.0, headers={"Connection": "close"})
                    break
                except httpx.HTTPError as error:
                    last_error = error
                    await asyncio.sleep(0.15 * (attempt + 1))
            else:
                raise DeviceUnreachable(f"The SONOFF at {host} did not answer.") from last_error
            self._last_request[host] = time.monotonic()
        try:
            payload = response.json()
        except ValueError as error:
            raise AdapterError("The SONOFF sent an unreadable reply.") from error
        error_code = payload.get("error", 0)
        if error_code == 401:
            raise LocalKeyRequired("The device wants encrypted requests; it needs its device key.")
        if error_code not in (0, None):
            raise AdapterError(f"The SONOFF refused the request (error {error_code}).", code="device_rejected")
        return payload

    async def _command(self, device: StoredDevice, path: str, data: dict[str, Any]) -> dict[str, Any]:
        key = device.credentials.get("device_key")
        body: dict[str, Any] = {"sequence": str(int(time.time() * 1000)), "deviceid": device.unique_id, "selfApikey": "123"}
        if device.params.get("encrypted"):
            if not key:
                raise LocalKeyRequired("Enter this device's key to control it.")
            body["encrypt"] = True
            body["data"], body["iv"] = encrypt(data, key)
        else:
            body["data"] = data
        return await self._post(device.host or "", device.port or DEFAULT_PORT, path, body)

    # ---- pairing ----

    async def pair(self, candidate: Candidate, credentials: dict[str, str], approval: ApprovalCallback) -> PairResult:
        if not candidate.ip:
            raise DeviceUnreachable("No address for this device; scan again.")
        encrypted = bool(candidate.details.get("encrypted"))
        creds: dict[str, str] = {}
        if encrypted:
            key = (credentials.get("device_key") or "").strip()
            if not key:
                raise LocalKeyRequired("This device needs its device key.")
            record = await self._fresh_record(candidate.details.get("instance"))
            props = record.properties if record else {}
            params, verified = decode_txt(props, key)
            if verified is False:
                raise LocalKeyRequired("That device key does not decrypt the device's data. Check it and try again.", code="local_key_invalid")
            if verified is None:
                raise DeviceUnreachable("The device's announcement could not be read to check the key. Make sure it is on and try again.")
            creds = {"device_key": key}
            state = _state_from_params(params or {})
        else:
            info = await self._post(candidate.ip, candidate.port or DEFAULT_PORT, "/zeroconf/info", {"deviceid": "", "data": {}})
            state = _state_from_params(info.get("data") or {})
        device_type = str(candidate.details.get("type") or "")
        return PairResult(
            unique_id=candidate.unique_id,
            name=candidate.name or "SONOFF",
            category=Category.PLUG if "plug" in device_type else Category.SWITCH,
            model=candidate.model,
            host=candidate.ip,
            port=candidate.port or DEFAULT_PORT,
            protocol=candidate.protocol,
            params={"encrypted": encrypted, "type": device_type, "instance": candidate.details.get("instance"), "multi": any(c.key != "power:0" for c in state.capabilities)},
            credentials=creds,
        )

    async def _fresh_record(self, instance: str | None) -> MdnsRecord | None:
        if not instance or self.ctx.mdns is None:
            return None
        return await self.ctx.mdns.resolve(SERVICE, instance)

    # ---- state and control ----

    async def get_state(self, device: StoredDevice) -> DeviceState:
        if not device.params.get("encrypted"):
            info = await self._post(device.host or "", device.port or DEFAULT_PORT, "/zeroconf/info", {"deviceid": "", "data": {}})
            return _state_from_params(info.get("data") or {})
        record = await self._fresh_record(device.params.get("instance"))
        if record is None:
            raise DeviceUnreachable("The device has not announced itself recently.")
        params, verified = decode_txt(record.properties, device.credentials.get("device_key"))
        if verified is False:
            raise LocalKeyRequired("The stored device key no longer decrypts this device's data.", code="local_key_invalid")
        state = _state_from_params(params or {})
        if record.ip != device.host:
            state.host = record.ip
        return state

    async def execute_command(self, device: StoredDevice, command: str, params: dict[str, Any]) -> CommandOutcome:
        if command not in {"turn_on", "turn_off", "toggle"}:
            raise UnsupportedCommand(f"SONOFF switches do not support {command}.")
        current = await self.get_state(device)
        key = str(params.get("key") or "power:0")
        target = next((c for c in current.capabilities if c.key == key), current.capabilities[0] if current.capabilities else None)
        if target is None:
            raise UnsupportedCommand("This device reported no switch.")
        on = {"turn_on": True, "turn_off": False}.get(command, target.value != "on")
        if device.params.get("multi"):
            outlet = int(target.key.split(":")[1])
            await self._command(device, "/zeroconf/switches", {"switches": [{"switch": "on" if on else "off", "outlet": outlet}]})
        else:
            await self._command(device, "/zeroconf/switch", {"switch": "on" if on else "off"})
        try:
            confirmed = await self.get_state(device)
        except AdapterError:
            confirmed = None
        if confirmed and any(c.key == target.key and c.value == ("on" if on else "off") for c in confirmed.capabilities):
            return CommandOutcome(result=CommandResult(status="confirmed"), state=confirmed)
        # The device accepted (error 0) but its announcement has not caught up yet.
        assumed = [c.model_copy(update={"value": "on" if on else "off", "confirmed": False}) if c.key == target.key else c for c in current.capabilities]
        return CommandOutcome(
            result=CommandResult(status="pending", message="The device accepted the command; waiting for it to report."),
            state=DeviceState(capabilities=assumed, readings=current.readings, commands=current.commands),
        )
