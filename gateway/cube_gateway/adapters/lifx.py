"""LIFX lights over the LIFX LAN protocol, which LIFX publishes (lan.developer.lifx.com).

Binary messages on UDP 56700: a 36-byte header (frame, frame address, protocol header) and a payload.
Used here: GetService (2) / StateService (3) for discovery, GetVersion (32) / StateVersion (33),
Get (101) / State (107) for colour, power and label, SetColor (102) and light SetPower (117) / StatePower (118).
No account, no pairing.
"""

from __future__ import annotations

import asyncio
import itertools
import secrets
import struct
from typing import Any

from ..models import AdapterInfo, AuthKind, Candidate, Category, CommandResult, ConnectionStatus, PairingRequirements, SupportLevel
from . import _lan, caps
from .base import (
    AdapterError,
    ApprovalCallback,
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

PORT = 56700
GET_SERVICE, STATE_SERVICE = 2, 3
GET_VERSION, STATE_VERSION = 32, 33
LIGHT_GET, LIGHT_SET_COLOR, LIGHT_STATE = 101, 102, 107
LIGHT_SET_POWER, LIGHT_STATE_POWER = 117, 118
HEADER = 36
_STATE = struct.Struct("<HHHHhH32sQ")
KELVIN_MIN, KELVIN_MAX = 2500, 9000


def encode(
    msg_type: int,
    payload: bytes = b"",
    *,
    source: int,
    sequence: int = 0,
    target: bytes = b"\x00" * 8,
    tagged: bool = False,
    res_required: bool = False,
    ack_required: bool = False,
) -> bytes:
    """Packs one LIFX LAN message. protocol=1024, addressable=1, origin=0."""
    flags = 1024 | (1 << 12) | (int(tagged) << 13)
    frame = struct.pack("<HHI", HEADER + len(payload), flags, source)
    address = struct.pack("<8s6sBB", target.ljust(8, b"\x00")[:8], b"\x00" * 6, int(res_required) | (int(ack_required) << 1), sequence & 0xFF)
    protocol = struct.pack("<QHH", 0, msg_type, 0)
    return frame + address + protocol + payload


def decode(data: bytes) -> tuple[int, int, bytes, int, bytes] | None:
    """(type, source, target, sequence, payload) or None for anything that is not a LIFX message."""
    if len(data) < HEADER:
        return None
    size, flags, source = struct.unpack_from("<HHI", data, 0)
    if flags & 0x0FFF != 1024 or size < HEADER or size > len(data):
        return None
    target, _reserved, _flags, sequence = struct.unpack_from("<8s6sBB", data, 8)
    _reserved64, msg_type, _reserved16 = struct.unpack_from("<QHH", data, 24)
    return msg_type, source, target, sequence, data[HEADER:size]


def mac_bytes(mac: str) -> bytes:
    return bytes.fromhex((normalize_mac(mac) or "").replace(":", "")) + b"\x00\x00"


def parse_state(payload: bytes) -> dict[str, Any]:
    hue, sat, bri, kelvin, _r, power, label, _r2 = _STATE.unpack_from(payload)
    return {
        "h": round(hue * 360 / 65535, 1),
        "s": round(sat * 100 / 65535, 1),
        "b": round(bri * 100 / 65535, 1),
        "kelvin": kelvin,
        "on": power > 0,
        "label": label.split(b"\x00", 1)[0].decode("utf-8", "replace"),
    }


class LifxAdapter(DeviceAdapter):
    info = AdapterInfo(
        id="lifx",
        name="LIFX (LAN protocol)",
        brands=["lifx"],
        protocols=["lifx-lan"],
        discovery=["udp-broadcast"],
        categories=[Category.LIGHT],
        status=SupportLevel.SUPPORTED,
        account_free=True,
        auth=AuthKind.NONE,
        library=None,
        notes=[
            "LIFX publishes its LAN protocol; lights are set up on Wi-Fi with the LIFX app first.",
            "White-only models ignore colour settings.",
        ],
    )
    poll_interval = 20

    def __init__(self, ctx):
        super().__init__(ctx)
        self.port = PORT
        self.discovery_targets: list[tuple[str, int]] | None = None
        # 0 and 1 have special meanings for `source`.
        self._source = secrets.randbelow(0xFFFFFFF0) + 2
        self._sequence = itertools.count(1)

    async def _request(self, host: str, mac: str | None, msg_type: int, payload: bytes, expect: int) -> bytes:
        sequence = next(self._sequence) & 0xFF
        message = encode(msg_type, payload, source=self._source, sequence=sequence, target=mac_bytes(mac) if mac else b"\x00" * 8, res_required=True)

        def accept(data: bytes) -> bool:
            decoded = decode(data)
            return bool(decoded and decoded[0] == expect and decoded[1] == self._source)

        reply = await _lan.udp_request(host, self.port, message, timeout=1.0, attempts=3, accept=accept, what="The LIFX light")
        decoded = decode(reply)
        assert decoded is not None
        return decoded[4]

    async def _light_state(self, host: str, mac: str | None) -> dict[str, Any]:
        return parse_state(await self._request(host, mac, LIGHT_GET, b"", LIGHT_STATE))

    # ---- discovery ----

    async def discover(self, scan: ScanContext) -> None:
        targets = self.discovery_targets or _lan.broadcast_targets(scan, self.port)
        message = encode(GET_SERVICE, source=self._source, tagged=True, res_required=True)
        replies = await _lan.udp_broadcast(targets, message, duration=_lan.window(scan), cancelled=scan.cancelled)
        found: dict[str, str] = {}
        for data, ip, _port in replies:
            decoded = decode(data)
            if not decoded or decoded[0] != STATE_SERVICE or decoded[1] != self._source:
                continue
            mac = normalize_mac(decoded[2][:6].hex())
            if mac and scan.in_scope(ip):
                found.setdefault(mac, ip)
        results = await asyncio.gather(*(self._candidate(ip, mac, "udp-broadcast") for mac, ip in found.items()), return_exceptions=True)
        for candidate in results:
            if isinstance(candidate, Candidate):
                _lan.report(scan, candidate)

    async def _candidate(self, ip: str, mac: str, source: str) -> Candidate:
        state = await self._light_state(ip, mac)
        product = None
        try:
            _vendor, product, _reserved = struct.unpack_from("<III", await self._request(ip, mac, GET_VERSION, b"", STATE_VERSION))
        except (AdapterError, struct.error):
            pass
        candidate = make_candidate(
            self,
            mac.replace(":", ""),
            name=state["label"] or f"LIFX {mac[-5:].replace(':', '')}",
            model=f"LIFX product {product}" if product else None,
            ip=ip,
            port=self.port,
            mac=mac,
            protocol="lifx-lan",
            sources=[source],
            details={"product": product},
        )
        candidate.status = ConnectionStatus.IDENTIFIED
        candidate.pairing = self.get_pairing_requirements(candidate)
        return candidate

    async def probe(self, host: str) -> Candidate | None:
        message = encode(GET_SERVICE, source=self._source, tagged=True, res_required=True)

        def accept(data: bytes) -> bool:
            decoded = decode(data)
            return bool(decoded and decoded[0] == STATE_SERVICE)

        try:
            reply = await _lan.udp_request(host, self.port, message, timeout=1.0, attempts=2, accept=accept, what="The LIFX light")
        except AdapterError:
            return None
        decoded = decode(reply)
        mac = normalize_mac(decoded[2][:6].hex()) if decoded else None
        return await self._candidate(host, mac, "manual") if mac else None

    def get_pairing_requirements(self, candidate: Candidate) -> PairingRequirements:
        return PairingRequirements(auth=AuthKind.NONE, instructions="LIFX lights need no pairing on the local network.")

    # ---- pairing ----

    async def pair(self, candidate: Candidate, credentials: dict[str, str], approval: ApprovalCallback) -> PairResult:
        if not candidate.ip or not candidate.mac:
            raise DeviceUnreachable("No address for this LIFX light; scan again.")
        state = await self._light_state(candidate.ip, candidate.mac)
        return PairResult(
            unique_id=candidate.unique_id,
            name=state["label"] or candidate.name or "LIFX light",
            category=Category.LIGHT,
            model=candidate.model,
            host=candidate.ip,
            port=self.port,
            mac=candidate.mac,
            protocol="lifx-lan",
            params={"product": candidate.details.get("product")},
        )

    # ---- state ----

    async def get_state(self, device: StoredDevice) -> DeviceState:
        return _state(await self._light_state(device.host or "", device.mac))

    async def execute_command(self, device: StoredDevice, command: str, params: dict[str, Any]) -> CommandOutcome:
        host, mac = device.host or "", device.mac
        if command in {"turn_on", "turn_off", "toggle"}:
            on = command == "turn_on"
            if command == "toggle":
                on = not (await self._light_state(host, mac))["on"]
            await self._request(host, mac, LIGHT_SET_POWER, struct.pack("<HI", 65535 if on else 0, 0), LIGHT_STATE_POWER)
        elif command in {"set_brightness", "set_color", "set_color_temp"}:
            current = await self._light_state(host, mac)
            h, s, b, k = current["h"], current["s"], current["b"], current["kelvin"] or 3500
            if command == "set_brightness":
                b = caps.clamp(caps.param(params, "brightness"), 0, 100, "brightness")
                if b == 0:
                    await self._request(host, mac, LIGHT_SET_POWER, struct.pack("<HI", 0, 0), LIGHT_STATE_POWER)
                    return CommandOutcome(result=CommandResult(status="confirmed"), state=await self.get_state(device))
            elif command == "set_color":
                h = caps.clamp(caps.param(params, "h"), 0, 360, "h")
                s = caps.clamp(caps.param(params, "s"), 0, 100, "s")
            else:
                k = caps.clamp(caps.param(params, "kelvin"), KELVIN_MIN, KELVIN_MAX, "kelvin")
                s = 0
            payload = struct.pack("<BHHHHI", 0, round(h % 360 * 65535 / 360), round(s * 65535 / 100), round(max(b, 1) * 65535 / 100), round(k), 0)
            await self._request(host, mac, LIGHT_SET_COLOR, payload, LIGHT_STATE)
            if not current["on"]:
                await self._request(host, mac, LIGHT_SET_POWER, struct.pack("<HI", 65535, 0), LIGHT_STATE_POWER)
        else:
            raise UnsupportedCommand(f"LIFX lights do not support {command}.")
        return CommandOutcome(result=CommandResult(status="confirmed"), state=await self.get_state(device))


def _state(light: dict[str, Any]) -> DeviceState:
    capabilities = [
        caps.power(light["on"]),
        caps.brightness(light["b"]),
        caps.color_temp(light["kelvin"] or None, KELVIN_MIN, KELVIN_MAX),
        caps.color(light["h"], light["s"]),
    ]
    return DeviceState(capabilities=capabilities, commands=caps.commands_for(capabilities))
