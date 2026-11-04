"""Philips WiZ lights and plugs over their local UDP JSON protocol (port 38899).

The protocol is not published by WiZ; it is community-documented and used by pywizlight and Home
Assistant core. Requests are single JSON datagrams: getPilot (state), getSystemConfig (module name, MAC,
firmware) and setPilot (state, dimming 10-100, temp in kelvin, r/g/b). No account, no cloud, no pairing.
"""

from __future__ import annotations

import asyncio
import json
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

PORT = 38899
#: Kelvin range WiZ tunable-white and RGB lights accept; firmware clamps outside it.
KELVIN_MIN, KELVIN_MAX = 2200, 6500


def _module_kind(module: str | None) -> tuple[Category, bool, bool, bool]:
    """(category, dimmable, tunable white, colour) from the moduleName, e.g. ESP01_SHRGB1C_31, ESP10_SOCKET_06."""
    name = (module or "").upper()
    if "SOCKET" in name:
        return Category.PLUG, False, False, False
    colour = "RGB" in name
    tunable = colour or "TW" in name
    return Category.LIGHT, True, tunable, colour


class WizAdapter(DeviceAdapter):
    info = AdapterInfo(
        id="wiz",
        name="Philips WiZ (local UDP)",
        brands=["wiz"],
        protocols=["wiz-udp-json"],
        discovery=["udp-broadcast"],
        categories=[Category.LIGHT, Category.PLUG],
        status=SupportLevel.SUPPORTED,
        account_free=True,
        auth=AuthKind.NONE,
        library=None,
        notes=[
            "Community-documented protocol (pywizlight / Home Assistant core); WiZ does not publish it.",
            "Lights must be set up on Wi-Fi with the WiZ app first. Local control must not be disabled in the WiZ app.",
        ],
    )
    poll_interval = 20

    def __init__(self, ctx):
        super().__init__(ctx)
        self.port = PORT
        #: Tests point discovery at a fake light; normally the scan's broadcast addresses.
        self.discovery_targets: list[tuple[str, int]] | None = None

    # ---- transport ----

    async def _request(self, host: str, method: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        payload = json.dumps({"method": method, "params": params or {}}).encode()

        def accept(data: bytes) -> bool:
            try:
                return json.loads(data).get("method") == method
            except (ValueError, AttributeError):
                return False

        raw = await _lan.udp_request(host, self.port, payload, timeout=1.5, attempts=3, accept=accept, what="The WiZ light")
        reply = json.loads(raw)
        if "error" in reply:
            raise AdapterError(f"The WiZ device refused {method}: {reply['error'].get('message', 'error')}.", code="device_rejected")
        return reply.get("result") or {}

    # ---- discovery ----

    async def discover(self, scan: ScanContext) -> None:
        targets = self.discovery_targets or _lan.broadcast_targets(scan, self.port)
        payload = json.dumps({"method": "getPilot", "params": {}}).encode()
        replies = await _lan.udp_broadcast(targets, payload, duration=_lan.window(scan), cancelled=scan.cancelled)
        seen: set[str] = set()
        tasks = []
        for data, ip, _port in replies:
            try:
                result = json.loads(data).get("result") or {}
            except (ValueError, AttributeError):
                continue
            mac = normalize_mac(result.get("mac"))
            if not mac or mac in seen or not scan.in_scope(ip):
                continue
            seen.add(mac)
            tasks.append(self._candidate(ip, mac, "udp-broadcast"))
        for candidate in await asyncio.gather(*tasks, return_exceptions=True):
            if isinstance(candidate, Candidate):
                _lan.report(scan, candidate)

    async def _candidate(self, ip: str, mac: str, source: str) -> Candidate:
        config: dict[str, Any] = {}
        try:
            config = await self._request(ip, "getSystemConfig")
        except AdapterError:
            pass
        module = config.get("moduleName")
        category, *_ = _module_kind(module)
        candidate = make_candidate(
            self,
            mac.replace(":", ""),
            name=f"WiZ {'plug' if category == Category.PLUG else 'light'} {mac[-5:].replace(':', '')}",
            model=module,
            ip=ip,
            port=self.port,
            mac=mac,
            protocol="wiz-udp-json",
            sources=[source],
            details={"module": module, "fw": config.get("fwVersion")},
        )
        candidate.status = ConnectionStatus.IDENTIFIED if module else ConnectionStatus.DISCOVERED
        candidate.pairing = self.get_pairing_requirements(candidate)
        return candidate

    async def probe(self, host: str) -> Candidate | None:
        try:
            pilot = await self._request(host, "getPilot")
        except AdapterError:
            return None
        mac = normalize_mac(pilot.get("mac"))
        return await self._candidate(host, mac, "manual") if mac else None

    def get_pairing_requirements(self, candidate: Candidate) -> PairingRequirements:
        return PairingRequirements(auth=AuthKind.NONE, instructions="WiZ devices need no pairing on the local network.")

    # ---- pairing ----

    async def pair(self, candidate: Candidate, credentials: dict[str, str], approval: ApprovalCallback) -> PairResult:
        if not candidate.ip:
            raise DeviceUnreachable("No address for this WiZ device; scan again.")
        module = candidate.details.get("module")
        if not module:
            try:
                module = (await self._request(candidate.ip, "getSystemConfig")).get("moduleName")
            except AdapterError:
                module = None
        device = StoredDevice(
            id="pairing",
            adapter_id=self.info.id,
            brand="wiz",
            unique_id=candidate.unique_id,
            name=candidate.name or "WiZ light",
            category=Category.LIGHT,
            host=candidate.ip,
            port=self.port,
            params={"module": module},
        )
        await self.get_state(device)
        category, *_ = _module_kind(module)
        return PairResult(
            unique_id=candidate.unique_id,
            name=candidate.name or "WiZ light",
            category=category,
            model=module,
            host=candidate.ip,
            port=self.port,
            mac=candidate.mac,
            protocol="wiz-udp-json",
            params={"module": module, "fw": candidate.details.get("fw")},
        )

    # ---- state ----

    async def get_state(self, device: StoredDevice) -> DeviceState:
        pilot = await self._request(device.host or "", "getPilot")
        return _state(pilot, device.params.get("module"))

    async def execute_command(self, device: StoredDevice, command: str, params: dict[str, Any]) -> CommandOutcome:
        host = device.host or ""
        category, dimmable, tunable, colour = _module_kind(device.params.get("module"))
        if command == "turn_on":
            pilot: dict[str, Any] = {"state": True}
        elif command == "turn_off":
            pilot = {"state": False}
        elif command == "toggle":
            current = await self._request(host, "getPilot")
            pilot = {"state": not bool(current.get("state"))}
        elif command == "set_brightness" and dimmable:
            level = round(caps.clamp(caps.param(params, "brightness"), 0, 100, "brightness"))
            pilot = {"state": False} if level == 0 else {"state": True, "dimming": max(10, level)}
        elif command == "set_color_temp" and tunable:
            kelvin = round(caps.clamp(caps.param(params, "kelvin"), KELVIN_MIN, KELVIN_MAX, "kelvin"))
            pilot = {"state": True, "temp": kelvin}
        elif command == "set_color" and colour:
            hue = caps.clamp(caps.param(params, "h"), 0, 360, "h")
            sat = caps.clamp(caps.param(params, "s"), 0, 100, "s")
            r, g, b = caps.hs_to_rgb(hue, sat)
            pilot = {"state": True, "r": r, "g": g, "b": b}
        else:
            raise UnsupportedCommand(f"This WiZ device does not support {command}.")
        result = await self._request(host, "setPilot", pilot)
        if result.get("success") is False:
            raise AdapterError("The WiZ device did not accept the change.", code="device_rejected")
        state = await self.get_state(device)
        return CommandOutcome(result=CommandResult(status="confirmed"), state=state)


def _state(pilot: dict[str, Any], module: str | None) -> DeviceState:
    category, dimmable, tunable, colour = _module_kind(module)
    capabilities = [caps.power(pilot.get("state"))]
    if dimmable:
        capabilities.append(caps.brightness(pilot.get("dimming")))
    if tunable:
        capabilities.append(caps.color_temp(pilot.get("temp"), KELVIN_MIN, KELVIN_MAX))
    if colour:
        if all(k in pilot for k in ("r", "g", "b")) and not pilot.get("temp"):
            hue, sat = caps.rgb_to_hs(int(pilot["r"]), int(pilot["g"]), int(pilot["b"]))
            capabilities.append(caps.color(hue, sat))
        else:
            capabilities.append(caps.color(None, None))
    readings = []
    if pilot.get("rssi") is not None:
        readings.append(caps.reading("rssi", "Wi-Fi signal", pilot["rssi"], "dBm", "signal_strength"))
    return DeviceState(capabilities=capabilities, readings=readings, commands=caps.commands_for(capabilities))
