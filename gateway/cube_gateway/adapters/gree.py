"""Gree air conditioners and their rebrands over Gree's local UDP protocol (experimental).

Gree does not publish this protocol. It is community-documented (gree-remote, the openHAB GREE binding,
greeclimate), and this module is written from those protocol facts: it uses no code from them. It has not
been tested on real hardware.

Every message is one JSON datagram on UDP port 7000:

- {"t":"scan"}, answered by an encrypted description of the unit (mac, name, mid, ver)
- bind, under a generic key every unit shares; the reply carries that unit's own key
- status ("cols" -> "cols" and "dat") and cmd ("opt" and "p" -> "r": 200), under the unit's own key

Packs come in two encryptions. AES-128-ECB with PKCS-7 is the original. AES-128-GCM, on newer firmware, has
its own generic key and a nonce and AAD fixed by the firmware, with the tag in a separate "tag" field.
Nothing tells which one a unit wants: firmware versions do not predict it, and some units answer the scan in
ECB and want GCM from then on. So a reply is opened according to whether it carries a tag, and bind tries both.

A unit answers a bind only straight after a scan, and it does not push changes, so it is polled.
"""

from __future__ import annotations

import base64
import contextlib
import json
from dataclasses import dataclass
from typing import Any

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives import padding
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from ..models import AdapterInfo, AuthKind, Candidate, Category, CommandResult, ConnectionStatus, PairingRequirements, Setting, SupportLevel, clean_text
from . import _lan, caps
from .base import (
    AdapterError,
    ApprovalCallback,
    AuthRequired,
    CommandOutcome,
    DeviceAdapter,
    DeviceState,
    DeviceUnreachable,
    PairingRejected,
    PairResult,
    ScanContext,
    StoredDevice,
    UnsupportedCommand,
    make_candidate,
    normalize_mac,
)

PORT = 7000
SCAN_REQUEST = b'{"t":"scan"}'

ECB, GCM = "ecb", "gcm"
GENERIC_KEYS = {ECB: b"a3K8Bx%2r8Y7#xDh", GCM: b"{yxAHAY_Lm6pbC/<"}
#: Fixed by the firmware, so every GCM message reuses them. The weakness is the protocol's; it leaves no choice.
GCM_NONCE = bytes.fromhex("5440784449675a516c5e6313")
GCM_AAD = b"qualcomm-test"
GCM_TAG_SIZE = 16
PROTOCOLS = {ECB: "gree-udp-ecb", GCM: "gree-udp-gcm"}

#: AES key sizes; anything else in a bind reply is not a key.
KEY_SIZES = (16, 24, 32)

#: Family codes from the scan's `mid` that speak this protocol but are not air conditioners: gateways, zone
#: controllers, heaters, air-to-water units and dehumidifiers. An unknown code is treated as an air conditioner
#: and has to prove it when pairing.
OTHER_APPLIANCES = frozenset({"60", "5000", "5001", "9000", "9300", "9301", "9302", "13800", "13801", "13802", "13803", "13804", "13805", "13806"})

MODES = {0: "auto", 1: "cool", 2: "dry", 3: "fan_only", 4: "heat"}
MODE_CODES = {name: code for code, name in MODES.items()}
FAN_NAMES = {0: "auto", 1: "low", 2: "medium_low", 3: "medium", 4: "medium_high", 5: "high"}
FAN_CODES = {name: code for code, name in FAN_NAMES.items()}
#: Every unit has these speeds. 2 and 4 exist only on some, so they are offered once a unit is seen using one.
COMMON_FAN_SPEEDS = (0, 1, 3, 5)

TEMP_MIN, TEMP_MAX = 16, 30
#: TemSen is Celsius plus 40 on most units and plain Celsius on some. A plain reading of 40 or more, or an
#: offset one under 40, would be a room over 40 or under 0 degrees, so the value itself tells them apart.
SENSOR_OFFSET = 40
SENSOR_MAX = 90

VERTICAL_SWING = {
    0: "Default",
    1: "Full swing",
    2: "Top",
    3: "Upper",
    4: "Middle",
    5: "Lower",
    6: "Bottom",
    7: "Swing bottom",
    8: "Swing lower",
    9: "Swing middle",
    10: "Swing upper",
    11: "Swing top",
}
HORIZONTAL_SWING = {0: "Default", 1: "Full swing", 2: "Left", 3: "Left of centre", 4: "Centre", 5: "Right of centre", 6: "Right"}


@dataclass(frozen=True)
class _Control:
    column: str
    name: str
    #: The values of a select; None makes it an on/off switch.
    options: dict[int, str] | None = None
    needs_power: bool = False


CONTROLS = {
    "swing_vertical": _Control("SwUpDn", "Vertical swing", VERTICAL_SWING),
    "swing_horizontal": _Control("SwingLfRig", "Horizontal swing", HORIZONTAL_SWING),
    "turbo": _Control("Tur", "Turbo", needs_power=True),
    "quiet": _Control("Quiet", "Quiet", needs_power=True),
    "display_light": _Control("Lig", "Display light"),
}
#: Turbo and Quiet pull the fan opposite ways, so turning one on turns the other off.
RIVALS = {"Tur": "Quiet", "Quiet": "Tur"}
#: Sent alongside SetTem to describe it, not changes the user asked for.
ENCODING_COLUMNS = frozenset({"TemUn", "TemRec"})

STATUS_COLUMNS = ("Pow", "Mod", "SetTem", "TemUn", "TemRec", "TemSen", "WdSpd", *(control.column for control in CONTROLS.values()))

REPAIR = "Add the air conditioner again from Add device."


class _Unreadable(Exception):
    """A pack that does not open with the key it was tried with."""


# ---- packs -----------------------------------------------------------------------------------------


def _text(data: bytes) -> str:
    return base64.b64encode(data).decode()


def _seal(cipher: str, key: bytes, inner: dict[str, Any]) -> dict[str, str]:
    """The "pack" field, plus "tag" under GCM, for one inner message."""
    plain = json.dumps(inner, separators=(",", ":")).encode()
    if cipher == GCM:
        sealed = AESGCM(key).encrypt(GCM_NONCE, plain, GCM_AAD)
        return {"pack": _text(sealed[:-GCM_TAG_SIZE]), "tag": _text(sealed[-GCM_TAG_SIZE:])}
    padder = padding.PKCS7(128).padder()
    encryptor = Cipher(algorithms.AES(key), modes.ECB()).encryptor()  # noqa: S305 - the protocol's own mode
    return {"pack": _text(encryptor.update(padder.update(plain) + padder.finalize()) + encryptor.finalize())}


def _unseal(packet: dict[str, Any], key: bytes) -> dict[str, Any]:
    """Opens a packet's pack: GCM when it carries a tag, otherwise ECB. Raises _Unreadable."""
    try:
        data = base64.b64decode(packet["pack"])
        tag = packet.get("tag")
        if tag:
            plain = AESGCM(key).decrypt(GCM_NONCE, data + base64.b64decode(tag), GCM_AAD)
        else:
            decryptor = Cipher(algorithms.AES(key), modes.ECB()).decryptor()  # noqa: S305 - the protocol's own mode
            plain = decryptor.update(data) + decryptor.finalize()
        # Firmware pads replies in several ways, also under GCM, so the JSON simply ends at its last brace.
        pack = json.loads(plain[: plain.rindex(b"}") + 1].decode())
    except (KeyError, TypeError, ValueError, RecursionError, InvalidTag) as error:
        raise _Unreadable from error
    if not isinstance(pack, dict):
        raise _Unreadable
    return pack


def _generic_key(packet: dict[str, Any]) -> bytes:
    return GENERIC_KEYS[GCM if packet.get("tag") else ECB]


def _envelope(cipher: str, key: bytes, mac: str, inner: dict[str, Any], *, binding: bool = False) -> bytes:
    outer = {"cid": "app", "i": 1 if binding else 0, "t": "pack", "uid": 0, "tcid": mac, **_seal(cipher, key, inner)}
    return json.dumps(outer, separators=(",", ":")).encode()


def _packet(data: bytes) -> dict[str, Any] | None:
    """A datagram as an outer Gree packet, or None for anything else."""
    try:
        packet = json.loads(data)
    except (ValueError, RecursionError):
        return None
    return packet if isinstance(packet, dict) and isinstance(packet.get("pack"), str) else None


def _kind(pack: dict[str, Any]) -> str:
    """The message type. Firmware varies its case (bindok, bindOk)."""
    return str(pack.get("t", "")).casefold()


def _int(value: Any) -> int | None:
    """A status value. Units answer numbers, numeric strings, or "" for a column they do not have."""
    if isinstance(value, int):
        return int(value)
    if isinstance(value, str):
        with contextlib.suppress(ValueError):
            return int(value)
    return None


# ---- discovery -------------------------------------------------------------------------------------


@dataclass(frozen=True)
class _Scanned:
    mac: str
    gcm: bool
    readable: bool
    name: str | None = None
    model: str | None = None
    version: str | None = None
    mid: str | None = None
    locked: bool = False

    @property
    def wire_mac(self) -> str:
        return self.mac.replace(":", "")


def _label(value: Any, mac: str) -> str | None:
    """A name a person chose. Units otherwise say "gree", or the end of their MAC."""
    text = clean_text(value)
    if not text or text.casefold() == "gree" or text.casefold() in mac:
        return None
    return text


def _read_scan(packet: dict[str, Any]) -> _Scanned | None:
    """What a scan reply says. A pack that does not open still identifies a unit by its outer `cid`: pairing
    tries both encryptions, and says so plainly if neither works, rather than the unit being invisible."""
    if str(packet.get("t", "")).casefold() != "pack":
        return None
    try:
        pack, readable = _unseal(packet, _generic_key(packet)), True
    except _Unreadable:
        pack, readable = {}, False
    mac = next(filter(None, map(normalize_mac, (pack.get("mac"), pack.get("cid"), packet.get("cid")))), None)
    if not mac:
        return None
    wire_mac = mac.replace(":", "")
    return _Scanned(
        mac=mac,
        gcm=bool(packet.get("tag")),
        readable=readable,
        name=_label(pack.get("name"), wire_mac),
        model=_label(pack.get("model"), wire_mac),
        version=clean_text(pack.get("ver"), 32),
        mid=clean_text(pack.get("mid"), 16),
        locked=_int(pack.get("lock")) == 1,
    )


# ---- state -----------------------------------------------------------------------------------------


def _room_temperature(raw: int | None) -> float | None:
    """0 or nothing means the unit has no sensor."""
    if raw is None or raw <= 0 or raw > SENSOR_MAX:
        return None
    return float(raw - SENSOR_OFFSET if raw >= SENSOR_OFFSET else raw)


def _settings(props: dict[str, int]) -> list[Setting]:
    settings = []
    for key, control in CONTROLS.items():
        raw = props.get(control.column)
        if raw is None:
            continue
        ready = bool(props["Pow"]) or not control.needs_power
        settings.append(
            Setting(
                key=key,
                kind="select" if control.options else "switch",
                name=control.name,
                value=control.options.get(raw) if control.options else bool(raw),
                options=list(control.options.values()) if control.options else [],
                available=ready,
                requires=None if ready else "AC on",
            )
        )
    return settings


def _state(props: dict[str, int]) -> DeviceState:
    speed = props.get("WdSpd")
    capability = caps.climate(
        current=_room_temperature(props.get("TemSen")),
        target=props.get("SetTem"),
        mode=MODES.get(props.get("Mod", -1)) if props["Pow"] else "off",
        modes=["off", *MODE_CODES],
        fan_mode=FAN_NAMES.get(speed) if speed is not None else None,
        fan_modes=[name for code, name in FAN_NAMES.items() if code in COMMON_FAN_SPEEDS or code == speed],
        low=TEMP_MIN,
        high=TEMP_MAX,
    )
    settings = _settings(props)
    return DeviceState(capabilities=[capability], settings=settings, commands=caps.commands_for([capability]) + (["set_setting"] if settings else []))


def _setting_change(props: dict[str, int], params: dict[str, Any]) -> dict[str, int]:
    key = str(caps.param(params, "key"))
    control = CONTROLS.get(key)
    if control is None or control.column not in props:
        raise UnsupportedCommand(f"This air conditioner has no setting {key!r}.")
    if control.needs_power and not props["Pow"]:
        raise AdapterError(f"{control.name} needs the air conditioner to be on.", code="setting_unavailable", recovery="Turn it on first, then try again.")
    value = caps.param(params, "value")
    if control.options:
        codes = {name: code for code, name in control.options.items()}
        if str(value) not in codes:
            raise AdapterError(f"{control.name} has no option {value!r}.", code="bad_params")
        return {control.column: codes[str(value)]}
    if not isinstance(value, bool):
        raise AdapterError(f"{control.name} needs true or false.", code="bad_params")
    change = {control.column: int(value)}
    rival = RIVALS.get(control.column)
    if value and rival and props.get(rival):
        change[rival] = 0
    return change


async def join_wifi(host: str, ssid: str, password: str) -> None:
    """Gives a unit on its own hotspot the home Wi-Fi, for a sender on that hotspot (the gateway's spare radio).

    Gree publishes nothing about this: the packet is the plain one community projects use (gree-remote issue 29,
    gree-hvac-client). Some units answer {"t":"ret","r":200} and others restart without a word, so silence is not
    failure; only finding the unit on the home network afterwards proves it worked.
    """
    payload = json.dumps({"psw": password, "ssid": ssid, "t": "wlan"}).encode()
    with contextlib.suppress(DeviceUnreachable):
        await _lan.udp_request(host, PORT, payload, timeout=2.0, attempts=2, what="The Gree unit")


class GreeAdapter(DeviceAdapter):
    info = AdapterInfo(
        id="gree",
        name="Gree air conditioner (local UDP)",
        brands=["gree"],
        protocols=list(PROTOCOLS.values()),
        discovery=["udp-broadcast"],
        categories=[Category.CLIMATE],
        status=SupportLevel.EXPERIMENTAL,
        account_free=True,
        auth=AuthKind.NONE,
        library=None,
        verified_models=[],
        notes=[
            "Reverse-engineered protocol that Gree does not publish. Not yet tested on real hardware.",
            "Units must already be on Wi-Fi through the Gree+ app; the gateway does not set up their Wi-Fi.",
            "The Wi-Fi module's firmware decides whether local control works: some builds have none, and owners report others stopping without internet access.",
            "Polled: changes made with the remote appear at the next poll.",
        ],
    )
    poll_interval = 30

    def __init__(self, ctx):
        super().__init__(ctx)
        self.port = PORT
        #: Tests point discovery at a fake unit; normally the scan's broadcast addresses.
        self.discovery_targets: list[tuple[str, int]] | None = None
        self.timeout = 1.5
        #: Units are slower to answer a bind than a status request.
        self.bind_timeout = 3.0

    # ---- transport ----

    async def _exchange(self, host: str, payload: bytes, *, timeout: float, attempts: int) -> dict[str, Any]:
        raw = await _lan.udp_request(host, self.port, payload, timeout=timeout, attempts=attempts, accept=lambda data: _packet(data) is not None, what="The Gree air conditioner")
        return _packet(raw) or {}

    async def _scan(self, host: str, attempts: int = 2) -> _Scanned:
        scanned = _read_scan(await self._exchange(host, SCAN_REQUEST, timeout=self.timeout, attempts=attempts))
        if scanned is None:
            raise AdapterError(f"The device at {host} is not a Gree air conditioner.", code="not_gree")
        return scanned

    async def _request(self, device: StoredDevice, inner: dict[str, Any], expected: str) -> dict[str, Any]:
        """One message under the unit's own key. Commands set absolute values, so a retry is harmless."""
        key = device.credentials.get("key")
        if not key:
            raise AuthRequired("This air conditioner needs to be paired again.", code="credentials_missing", recovery=REPAIR)
        secret = key.encode()
        payload = _envelope(device.params.get("cipher", ECB), secret, device.unique_id, inner)
        reply = await self._exchange(device.host or "", payload, timeout=self.timeout, attempts=3)
        try:
            pack = _unseal(reply, secret)
        except _Unreadable as error:
            raise AuthRequired("The air conditioner no longer accepts its saved key.", code="device_auth_failed", recovery=REPAIR) from error
        if _kind(pack) != expected:
            raise AdapterError("The air conditioner sent a reply the gateway does not understand.", code="bad_reply")
        if pack.get("r", 200) != 200:
            raise AdapterError("The air conditioner refused the request.", code="device_rejected")
        return pack

    async def _read(self, device: StoredDevice) -> dict[str, int]:
        pack = await self._request(device, {"t": "status", "mac": device.unique_id, "cols": list(STATUS_COLUMNS)}, "dat")
        columns, values = pack.get("cols"), pack.get("dat")
        if not isinstance(columns, list) or not isinstance(values, list) or len(columns) != len(values):
            raise AdapterError("The air conditioner sent a reply the gateway does not understand.", code="bad_reply")
        props = {str(column): number for column, value in zip(columns, values, strict=True) if (number := _int(value)) is not None}
        if "Pow" not in props:
            raise AdapterError("The air conditioner did not report its state.", code="bad_reply")
        return props

    # ---- discovery ----

    async def discover(self, scan: ScanContext) -> None:
        targets = self.discovery_targets or _lan.broadcast_targets(scan, self.port)
        replies = await _lan.udp_broadcast(targets, SCAN_REQUEST, duration=_lan.window(scan, 4.0), cancelled=scan.cancelled)
        seen: set[str] = set()
        for data, ip, _port in replies:
            packet = _packet(data)
            scanned = _read_scan(packet) if packet and scan.in_scope(ip) else None
            if scanned and scanned.mac not in seen:
                seen.add(scanned.mac)
                _lan.report(scan, self._candidate(ip, scanned, "udp-broadcast"))

    def _candidate(self, ip: str, scanned: _Scanned, source: str) -> Candidate:
        candidate = make_candidate(
            self,
            scanned.wire_mac,
            name=scanned.name or f"Gree air conditioner {scanned.wire_mac[-4:]}",
            model=scanned.model,
            ip=ip,
            port=self.port,
            mac=scanned.mac,
            protocol=PROTOCOLS[GCM if scanned.gcm else ECB],
            sources=[source],
            details={"mid": scanned.mid, "ver": scanned.version, "locked": scanned.locked},
        )
        if scanned.mid in OTHER_APPLIANCES:
            candidate.control = "detection_only"
            candidate.status = ConnectionStatus.UNSUPPORTED
        else:
            candidate.status = ConnectionStatus.IDENTIFIED if scanned.readable else ConnectionStatus.DISCOVERED
        candidate.pairing = self.get_pairing_requirements(candidate)
        return candidate

    async def probe(self, host: str) -> Candidate | None:
        try:
            return self._candidate(host, await self._scan(host), "manual")
        except AdapterError:
            return None

    def get_pairing_requirements(self, candidate: Candidate) -> PairingRequirements:
        if candidate.control == "detection_only":
            return PairingRequirements(auth=AuthKind.NONE, instructions="Only Gree air conditioners can be controlled.")
        return PairingRequirements(
            auth=AuthKind.NONE,
            instructions="Experimental: the unit must already be on your Wi-Fi through the Gree+ app, and some Wi-Fi module firmware does not allow local control.",
        )

    # ---- pairing ----

    async def _bind(self, host: str, mac: str) -> tuple[str, str]:
        """(encryption, the unit's own key). A tagged scan reply says GCM; an untagged one says nothing, so both are tried."""
        try:
            first = await self._scan(host)
        except AdapterError:
            first = None
        answered = first is not None
        likely, other = (GCM, ECB) if first and first.gcm else (ECB, GCM)
        for cipher in (likely, likely, other, other):
            # A unit answers a bind only straight after a scan, so every try gets its own: a plain resend would be ignored.
            with contextlib.suppress(AdapterError):
                await self._scan(host, attempts=1)
                answered = True
            payload = _envelope(cipher, GENERIC_KEYS[cipher], mac, {"mac": mac, "t": "bind", "uid": 0}, binding=True)
            try:
                reply = await self._exchange(host, payload, timeout=self.bind_timeout, attempts=1)
            except DeviceUnreachable:
                continue
            answered = True
            key = _bound_key(reply)
            if key:
                self.log.info("bound to a gree unit", extra={"cipher": cipher})
                return cipher, key
        if not answered:
            raise DeviceUnreachable(f"The Gree air conditioner at {host} did not answer.")
        raise PairingRejected(
            "This air conditioner answered but would not pair. Its Wi-Fi firmware may not allow local control.",
            code="bind_failed",
            recovery='Check the unit can reach the internet and that "Lock device" is off in the Gree+ app. Then switch it off at the breaker for a minute and try again.',
        )

    async def pair(self, candidate: Candidate, credentials: dict[str, str], approval: ApprovalCallback) -> PairResult:
        if candidate.control == "detection_only":
            raise UnsupportedCommand("Only Gree air conditioners can be controlled.", code="unsupported_device")
        if not candidate.ip:
            raise DeviceUnreachable("No address for this air conditioner; scan again.")
        cipher, key = await self._bind(candidate.ip, candidate.unique_id)
        name = candidate.name or "Gree air conditioner"
        device = StoredDevice(
            id="pairing",
            adapter_id=self.info.id,
            brand="gree",
            unique_id=candidate.unique_id,
            name=name,
            category=Category.CLIMATE,
            host=candidate.ip,
            port=self.port,
            params={"cipher": cipher},
            credentials={"key": key},
        )
        props = await self._read(device)
        if not {"Mod", "SetTem"} <= props.keys():
            raise UnsupportedCommand("This Gree device is not an air conditioner.", code="unsupported_device")
        return PairResult(
            unique_id=candidate.unique_id,
            name=name,
            category=Category.CLIMATE,
            model=candidate.model,
            host=candidate.ip,
            port=self.port,
            mac=candidate.mac,
            protocol=PROTOCOLS[cipher],
            params={"cipher": cipher, "mid": candidate.details.get("mid"), "ver": candidate.details.get("ver")},
            credentials={"key": key},
        )

    # ---- state ----

    async def get_state(self, device: StoredDevice) -> DeviceState:
        return _state(await self._read(device))

    async def execute_command(self, device: StoredDevice, command: str, params: dict[str, Any]) -> CommandOutcome:
        if command == "turn_on":
            change = {"Pow": 1}
        elif command == "turn_off":
            change = {"Pow": 0}
        elif command == "set_temperature":
            target = round(caps.clamp(caps.param(params, "temperature"), TEMP_MIN, TEMP_MAX, "temperature"))
            # SetTem is Celsius whatever the display shows; TemUn goes along so the display stays as it is.
            change = {"TemUn": (await self._read(device)).get("TemUn", 0), "SetTem": target, "TemRec": 0}
        elif command == "set_hvac_mode":
            mode = str(caps.param(params, "mode"))
            if mode == "off":
                change = {"Pow": 0}
            elif mode in MODE_CODES:
                change = {"Pow": 1, "Mod": MODE_CODES[mode]}
            else:
                raise AdapterError(f"Unknown mode {mode!r}.", code="bad_params")
        elif command == "set_fan_mode":
            fan = str(caps.param(params, "fan_mode"))
            if fan not in FAN_CODES:
                raise AdapterError(f"Unknown fan mode {fan!r}.", code="bad_params")
            props = await self._read(device)
            change = {"WdSpd": FAN_CODES[fan]}
            # While Turbo or Quiet is on the unit holds the fan, so a chosen speed would not take effect.
            change.update({column: 0 for column in RIVALS if props.get(column)})
        elif command == "set_setting":
            change = _setting_change(await self._read(device), params)
        else:
            raise UnsupportedCommand(f"Gree air conditioners do not support {command}.")
        await self._request(device, {"t": "cmd", "mac": device.unique_id, "opt": list(change), "p": list(change.values())}, "res")
        return await self._outcome(device, change)

    async def _outcome(self, device: StoredDevice, change: dict[str, int]) -> CommandOutcome:
        """A unit answers r=200 to changes it then ignores, such as Turbo in a mode without it, so only the read-back confirms."""
        try:
            props = await self._read(device)
        except DeviceUnreachable:
            return CommandOutcome(result=CommandResult(status="assumed", message="The air conditioner took the change but did not report back."))
        ignored = any(props.get(column, value) != value for column, value in change.items() if column not in ENCODING_COLUMNS)
        if ignored:
            result = CommandResult(status="assumed", message="The air conditioner took the change but still reports the old value. It may not offer this in the current mode.")
        else:
            result = CommandResult(status="confirmed")
        return CommandOutcome(result=result, state=_state(props))


def _bound_key(reply: dict[str, Any]) -> str | None:
    """The unit's own key from a bind reply, or None if this is not a good one."""
    try:
        pack = _unseal(reply, _generic_key(reply))
    except _Unreadable:
        return None
    key = pack.get("key")
    if _kind(pack) != "bindok" or pack.get("r", 200) != 200 or not isinstance(key, str) or len(key.encode()) not in KEY_SIZES:
        return None
    return key
