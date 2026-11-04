"""WLED LED controllers over the documented JSON API (https://kno.wled.ge/interfaces/json-api/).

Discovery: mDNS _wled._tcp. Identification: GET /json/info (name, mac, ver, arch, leds). State and
control: GET/POST /json/state with `"v": true`, so every change answers with the state that resulted.
"""

from __future__ import annotations

import asyncio
from typing import Any

import httpx

from ..models import AdapterInfo, AuthKind, Candidate, Category, CommandResult, ConnectionStatus, SupportLevel
from . import caps
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


class WledAdapter(DeviceAdapter):
    info = AdapterInfo(
        id="wled",
        name="WLED (JSON API)",
        brands=["wled"],
        protocols=["wled-json"],
        discovery=["mdns"],
        categories=[Category.LIGHT],
        status=SupportLevel.SUPPORTED,
        account_free=True,
        auth=AuthKind.NONE,
        notes=["Documented local JSON API; no account or cloud."],
    )
    mdns_types = ("_wled._tcp.local.",)
    poll_interval = 20

    async def discover(self, scan: ScanContext) -> None:
        await scan.wait_passive()
        candidates = await asyncio.gather(*(self._identify_host(r.ip, r.port or 80, "mdns") for r in scan.mdns_of(*self.mdns_types) if scan.in_scope(r.ip)))
        for candidate in candidates:
            if candidate:
                scan.report(candidate)

    async def _info(self, host: str, port: int = 80) -> dict[str, Any]:
        try:
            response = await self.ctx.http.get(f"http://{host}:{port}/json/info", timeout=3.0)
            info = response.json()
        except (httpx.HTTPError, ValueError) as error:
            raise DeviceUnreachable(f"No WLED answered at {host}.") from error
        if not isinstance(info, dict) or "ver" not in info or "leds" not in info:
            raise DeviceUnreachable(f"The device at {host} is not a WLED controller.")
        return info

    async def _identify_host(self, host: str, port: int, source: str) -> Candidate | None:
        try:
            info = await self._info(host, port)
        except DeviceUnreachable:
            return None
        mac = normalize_mac(info.get("mac"))
        candidate = make_candidate(
            self,
            (mac or host).replace(":", ""),
            name=info.get("name") or "WLED",
            model=f"WLED {info.get('arch') or ''} {info.get('ver') or ''}".strip(),
            ip=host,
            port=port,
            mac=mac,
            protocol="wled-json",
            sources=[source],
            details={"ver": info.get("ver"), "leds": (info.get("leds") or {}).get("count")},
        )
        candidate.status = ConnectionStatus.IDENTIFIED
        return candidate

    async def probe(self, host: str) -> Candidate | None:
        return await self._identify_host(host, 80, "manual")

    async def pair(self, candidate: Candidate, credentials: dict[str, str], approval: ApprovalCallback) -> PairResult:
        if not candidate.ip:
            raise DeviceUnreachable("No address for this WLED; scan again.")
        info = await self._info(candidate.ip, candidate.port or 80)
        device = StoredDevice(id="pairing", adapter_id=self.info.id, brand="wled", unique_id=candidate.unique_id, name="WLED", category=Category.LIGHT, host=candidate.ip, port=candidate.port or 80)
        await self.get_state(device)
        return PairResult(
            unique_id=candidate.unique_id,
            name=info.get("name") or "WLED",
            category=Category.LIGHT,
            model=candidate.model,
            host=candidate.ip,
            port=candidate.port or 80,
            mac=normalize_mac(info.get("mac")),
            protocol="wled-json",
            params={"ver": info.get("ver")},
        )

    async def _state(self, device: StoredDevice, body: dict[str, Any] | None = None) -> dict[str, Any]:
        url = f"http://{device.host}:{device.port or 80}/json/state"
        try:
            if body is None:
                response = await self.ctx.http.get(url, timeout=4.0)
            else:
                response = await self.ctx.http.post(url, json={**body, "v": True}, timeout=4.0)
        except httpx.HTTPError as error:
            raise DeviceUnreachable(f"WLED at {device.host} did not answer.") from error
        if response.status_code >= 400:
            raise AdapterError(f"WLED answered {response.status_code}.", code="device_rejected")
        try:
            state = response.json()
        except ValueError as error:
            raise AdapterError("WLED sent an unreadable reply.") from error
        if not isinstance(state, dict) or "on" not in state:
            raise AdapterError("WLED's reply had no state.", code="device_rejected")
        return state

    @staticmethod
    def _to_state(raw: dict[str, Any]) -> DeviceState:
        capabilities = [caps.power(bool(raw.get("on"))), caps.brightness(round((raw.get("bri") or 0) * 100 / 255))]
        segments = raw.get("seg") or []
        first = segments[0] if isinstance(segments, list) and segments else {}
        colours = first.get("col") if isinstance(first, dict) else None
        if isinstance(colours, list) and colours and isinstance(colours[0], list) and len(colours[0]) >= 3:
            h, s = caps.rgb_to_hs(*[int(x) for x in colours[0][:3]])
            capabilities.append(caps.color(h, s))
        return DeviceState(capabilities=capabilities, commands=caps.commands_for(capabilities))

    async def get_state(self, device: StoredDevice) -> DeviceState:
        return self._to_state(await self._state(device))

    async def execute_command(self, device: StoredDevice, command: str, params: dict[str, Any]) -> CommandOutcome:
        if command == "turn_on":
            body: dict[str, Any] = {"on": True}
        elif command == "turn_off":
            body = {"on": False}
        elif command == "toggle":
            body = {"on": "t"}
        elif command == "set_brightness":
            level = caps.clamp(caps.param(params, "brightness"), 0, 100, "brightness")
            body = {"on": level > 0, "bri": max(1, round(level * 255 / 100))}
        elif command == "set_color":
            h = caps.clamp(caps.param(params, "h"), 0, 360, "h")
            s = caps.clamp(caps.param(params, "s"), 0, 100, "s")
            body = {"on": True, "seg": [{"col": [list(caps.hs_to_rgb(h, s))]}]}
        else:
            raise UnsupportedCommand(f"WLED does not support {command}.")
        return CommandOutcome(result=CommandResult(status="confirmed"), state=self._to_state(await self._state(device, body)))
