"""Shelly relays, plugs, dimmers and roller shutters over their documented local HTTP APIs.

- Gen1 (shelly1, shellyplug-s, shellydimmer2, shellyswitch25, ...): REST, GET /shelly, /status,
  /relay/N?turn=, /light/N?turn=&brightness=, /roller/N?go=. https://shelly-api-docs.shelly.cloud/gen1/
- Gen2+ (Plus, Pro, Gen3, Gen4): JSON-RPC 2.0 over POST /rpc: Shelly.GetStatus, Switch.Set, Light.Set,
  Cover.Open/Close/Stop/GoToPosition. https://shelly-api-docs.shelly.cloud/gen2/

Both advertise over mDNS (Gen2: _shelly._tcp; both: _http._tcp with a "shelly..." instance name). No cloud,
no account. Authentication is optional on the device: Gen1 uses HTTP Basic, Gen2 HTTP Digest (user "admin").
"""

from __future__ import annotations

import asyncio
import itertools
from typing import Any

import httpx

from ..models import AdapterInfo, AuthKind, Candidate, Category, CommandResult, FieldSpec, PairingRequirements, SupportLevel
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
    normalize_mac,
)

_rpc_ids = itertools.count(1)


class ShellyAdapter(DeviceAdapter):
    info = AdapterInfo(
        id="shelly",
        name="Shelly (local HTTP / RPC)",
        brands=["shelly"],
        protocols=["shelly-gen1-http", "shelly-gen2-rpc"],
        discovery=["mdns", "subnet"],
        categories=[Category.SWITCH, Category.PLUG, Category.LIGHT, Category.COVER],
        status=SupportLevel.SUPPORTED,
        account_free=True,
        auth=AuthKind.NONE,
        library=None,
        notes=[
            "Documented local API; works without the Shelly app or cloud.",
            "If the device has a password set, enter it when pairing.",
        ],
    )
    mdns_types = ("_shelly._tcp.local.", "_http._tcp.local.")
    probe_ports = (80,)
    poll_interval = 15

    # ---- discovery ----

    async def discover(self, scan: ScanContext) -> None:
        await scan.wait_passive()
        hosts: dict[str, str] = {}
        for record in scan.mdns_of("_shelly._tcp.local."):
            hosts[record.ip] = "mdns"
        for record in scan.mdns_of("_http._tcp.local."):
            if record.name.lower().startswith("shelly"):
                hosts.setdefault(record.ip, "mdns")
        for ip in scan.hosts_with_port(80):
            hosts.setdefault(ip, "subnet")

        async def check(ip: str, source: str) -> None:
            if not scan.in_scope(ip):
                return
            candidate = await self._identify_host(ip, source)
            if candidate:
                scan.report(candidate)

        await asyncio.gather(*(check(ip, source) for ip, source in hosts.items()))

    async def _identify_host(self, ip: str, source: str) -> Candidate | None:
        try:
            response = await self.ctx.http.get(f"http://{ip}/shelly", timeout=3.0)
            info = response.json()
        except (httpx.HTTPError, ValueError):
            return None
        if not isinstance(info, dict) or not info.get("mac"):
            return None
        gen = int(info.get("gen") or 1)
        if gen == 1 and "type" not in info:
            return None
        mac = normalize_mac(info.get("mac"))
        if not mac:
            return None
        auth = bool(info.get("auth_en") if gen >= 2 else info.get("auth"))
        model = info.get("model") or info.get("type")
        name = info.get("name") or info.get("id") or f"Shelly {info.get('app') or model}"
        candidate = make_candidate(
            self,
            mac.replace(":", ""),
            name=name,
            model=model,
            ip=ip,
            port=80,
            mac=mac,
            protocol="shelly-gen2-rpc" if gen >= 2 else "shelly-gen1-http",
            sources=[source],
            details={"gen": gen, "app": info.get("app"), "fw": info.get("fw_id") or info.get("fw"), "auth": auth},
        )
        candidate.status = "identified"
        candidate.pairing = self.get_pairing_requirements(candidate)
        return candidate

    async def probe(self, host: str) -> Candidate | None:
        return await self._identify_host(host, "manual")

    async def identify(self, candidate: Candidate) -> Candidate:
        if candidate.ip and not candidate.details.get("gen"):
            fresh = await self._identify_host(candidate.ip, candidate.sources[0] if candidate.sources else "mdns")
            return fresh or candidate
        return candidate

    def get_pairing_requirements(self, candidate: Candidate) -> PairingRequirements:
        if not candidate.details.get("auth"):
            return PairingRequirements(auth=AuthKind.NONE, instructions="No password is set on this device.")
        fields = [FieldSpec(name="password", label="Device password", kind="password", secret=True)]
        if candidate.details.get("gen", 1) == 1:
            fields.insert(0, FieldSpec(name="username", label="Device username", help="Set in the device's web page"))
        return PairingRequirements(
            auth=AuthKind.DEVICE_CREDENTIALS,
            fields=fields,
            instructions="This Shelly has a password set in its web page. Enter it to let the gateway control it.",
        )

    # ---- transport ----

    def _auth(self, device: StoredDevice | None, gen: int, credentials: dict[str, Any] | None = None) -> httpx.Auth | None:
        creds = credentials if credentials is not None else (device.credentials if device else {})
        password = creds.get("password")
        if not password:
            return None
        if gen >= 2:
            return httpx.DigestAuth("admin", password)
        return httpx.BasicAuth(creds.get("username") or "admin", password)

    async def _rpc(self, host: str, method: str, params: dict[str, Any] | None, auth: httpx.Auth | None) -> Any:
        body = {"id": next(_rpc_ids), "method": method, "params": params or {}}
        try:
            response = await self.ctx.http.post(f"http://{host}/rpc", json=body, auth=auth, timeout=5.0)
        except httpx.HTTPError as error:
            raise DeviceUnreachable(f"The Shelly at {host} did not answer.") from error
        if response.status_code == 401:
            raise AuthRequired("The Shelly rejected the password.", code="device_auth_failed")
        try:
            payload = response.json()
        except ValueError as error:
            raise AdapterError("The Shelly sent an unreadable reply.") from error
        if "error" in payload:
            raise AdapterError(f"The Shelly refused {method}: {payload['error'].get('message', 'error')}.", code="device_rejected")
        return payload.get("result")

    async def _get(self, host: str, path: str, params: dict[str, Any] | None, auth: httpx.Auth | None) -> Any:
        try:
            response = await self.ctx.http.get(f"http://{host}{path}", params=params, auth=auth, timeout=5.0)
        except httpx.HTTPError as error:
            raise DeviceUnreachable(f"The Shelly at {host} did not answer.") from error
        if response.status_code == 401:
            raise AuthRequired("The Shelly rejected the username or password.", code="device_auth_failed")
        if response.status_code >= 400:
            raise AdapterError(f"The Shelly answered {response.status_code}.", code="device_rejected")
        try:
            return response.json()
        except ValueError as error:
            raise AdapterError("The Shelly sent an unreadable reply.") from error

    # ---- pairing ----

    async def pair(self, candidate: Candidate, credentials: dict[str, str], approval: ApprovalCallback) -> PairResult:
        if not candidate.ip:
            raise DeviceUnreachable("No address for this Shelly; scan again.")
        fresh = await self._identify_host(candidate.ip, "pairing") or candidate
        gen = int(fresh.details.get("gen") or 1)
        if fresh.details.get("auth") and not credentials.get("password"):
            raise AuthRequired("This Shelly has a password. Enter it to continue.")
        creds = {k: v for k, v in credentials.items() if k in {"username", "password"} and v}
        device = StoredDevice(
            id="pairing",
            adapter_id=self.info.id,
            brand="shelly",
            unique_id=fresh.unique_id,
            name=fresh.name or "Shelly",
            category=Category.SWITCH,
            host=fresh.ip,
            port=80,
            params={"gen": gen, "app": fresh.details.get("app")},
            credentials=creds,
        )
        state = await self.get_state(device)
        return PairResult(
            unique_id=fresh.unique_id,
            name=fresh.name or "Shelly",
            category=_category(state, fresh.model, fresh.details.get("app")),
            model=fresh.model,
            host=fresh.ip,
            port=80,
            mac=fresh.mac,
            protocol=fresh.protocol,
            params={"gen": gen, "app": fresh.details.get("app"), "fw": fresh.details.get("fw")},
            credentials=creds,
        )

    # ---- state ----

    async def get_state(self, device: StoredDevice) -> DeviceState:
        gen = int(device.params.get("gen") or 1)
        auth = self._auth(device, gen)
        if gen >= 2:
            status = await self._rpc(device.host or "", "Shelly.GetStatus", None, auth)
            return _state_gen2(status or {})
        status = await self._get(device.host or "", "/status", None, auth)
        return _state_gen1(status or {})

    async def execute_command(self, device: StoredDevice, command: str, params: dict[str, Any]) -> CommandOutcome:
        gen = int(device.params.get("gen") or 1)
        auth = self._auth(device, gen)
        host = device.host or ""
        state = await self.get_state(device)
        channel_kind, channel = _target(state, params)

        if command in {"turn_on", "turn_off", "toggle"}:
            if gen >= 2:
                component = "Light" if channel_kind == "light" else "Switch"
                if command == "toggle":
                    await self._rpc(host, f"{component}.Toggle", {"id": channel}, auth)
                else:
                    await self._rpc(host, f"{component}.Set", {"id": channel, "on": command == "turn_on"}, auth)
            else:
                path = f"/light/{channel}" if channel_kind == "light" else f"/relay/{channel}"
                await self._get(host, path, {"turn": {"turn_on": "on", "turn_off": "off"}.get(command, "toggle")}, auth)
        elif command == "set_brightness":
            if channel_kind != "light":
                raise UnsupportedCommand("This Shelly has no dimmer.")
            level = round(caps.clamp(caps.param(params, "brightness"), 0, 100, "brightness"))
            if gen >= 2:
                await self._rpc(host, "Light.Set", {"id": channel, "on": level > 0, "brightness": max(level, 1)}, auth)
            else:
                await self._get(host, f"/light/{channel}", {"turn": "on" if level > 0 else "off", "brightness": max(level, 1)}, auth)
        elif command in {"cover_open", "cover_close", "cover_stop", "set_position"}:
            if channel_kind != "cover":
                raise UnsupportedCommand("This Shelly is not set up as a roller shutter.")
            if gen >= 2:
                if command == "set_position":
                    pos = round(caps.clamp(caps.param(params, "position"), 0, 100, "position"))
                    await self._rpc(host, "Cover.GoToPosition", {"id": channel, "pos": pos}, auth)
                else:
                    method = {"cover_open": "Cover.Open", "cover_close": "Cover.Close", "cover_stop": "Cover.Stop"}[command]
                    await self._rpc(host, method, {"id": channel}, auth)
            else:
                if command == "set_position":
                    pos = round(caps.clamp(caps.param(params, "position"), 0, 100, "position"))
                    await self._get(host, f"/roller/{channel}", {"go": "to_pos", "roller_pos": pos}, auth)
                else:
                    go = {"cover_open": "open", "cover_close": "close", "cover_stop": "stop"}[command]
                    await self._get(host, f"/roller/{channel}", {"go": go}, auth)
        else:
            raise UnsupportedCommand(f"Shelly devices do not support {command}.")

        # The device applies the change before answering; read it back so the app shows what really happened.
        confirmed = await self.get_state(device)
        return CommandOutcome(result=CommandResult(status="confirmed"), state=confirmed)


def _target(state: DeviceState, params: dict[str, Any]) -> tuple[str, int]:
    """Which component a command is for: params.key ("power:1", "brightness:0") or params.channel, else the first."""
    key = str(params.get("key") or "")
    channel = params.get("channel")
    for cap in state.capabilities:
        if cap.type not in {"power", "cover"}:
            continue
        kind, _, index = cap.key.partition(":")
        if key and key.split(":")[-1] != index:
            continue
        if channel is not None and str(channel) != index:
            continue
        component = "cover" if cap.type == "cover" else ("light" if kind == "light" else "switch")
        return component, int(index or 0)
    return "switch", int(channel or 0)


def _category(state: DeviceState, model: str | None, app: str | None) -> Category:
    keys = [cap.key for cap in state.capabilities]
    text = f"{model or ''} {app or ''}".lower()
    if any(k.startswith("cover") for k in keys):
        return Category.COVER
    if any(k.startswith("light") for k in keys):
        return Category.LIGHT
    if "plug" in text or "shplg" in text:
        return Category.PLUG
    return Category.SWITCH


def _state_gen2(status: dict[str, Any]) -> DeviceState:
    capabilities = []
    readings = []
    for name, component in sorted(status.items()):
        if not isinstance(component, dict):
            continue
        kind, _, index = name.partition(":")
        if kind == "switch":
            capabilities.append(caps.power(component.get("output"), key=f"power:{index}", label=f"Output {int(index) + 1}"))
            if component.get("apower") is not None:
                readings.append(caps.reading(f"power_w:{index}", "Power", component["apower"], "W", "power"))
            energy = (component.get("aenergy") or {}).get("total")
            if energy is not None:
                readings.append(caps.reading(f"energy_wh:{index}", "Energy", round(energy, 1), "Wh", "energy"))
        elif kind == "light":
            capabilities.append(caps.power(component.get("output"), key=f"light:{index}", label=f"Light {int(index) + 1}"))
            capabilities.append(caps.brightness(component.get("brightness"), key=f"brightness:{index}"))
        elif kind == "cover":
            from ..models import Capability

            capabilities.append(
                Capability(key=f"cover:{index}", type="cover", label="Shutter", state=component.get("state"), position=component.get("current_pos"))
            )
    temp = next((c.get("temperature", {}).get("tC") for c in status.values() if isinstance(c, dict) and isinstance(c.get("temperature"), dict)), None)
    if temp is not None:
        readings.append(caps.reading("device_temperature", "Device temperature", temp, "°C", "temperature"))
    commands = caps.commands_for(capabilities)
    if any(c.type == "cover" for c in capabilities):
        commands += ["cover_open", "cover_close", "cover_stop", "set_position"]
    return DeviceState(capabilities=capabilities, readings=readings, commands=commands)


def _state_gen1(status: dict[str, Any]) -> DeviceState:
    capabilities = []
    readings = []
    for index, relay in enumerate(status.get("relays") or []):
        capabilities.append(caps.power(relay.get("ison"), key=f"power:{index}", label=f"Output {index + 1}"))
    for index, light in enumerate(status.get("lights") or []):
        capabilities.append(caps.power(light.get("ison"), key=f"light:{index}", label=f"Light {index + 1}"))
        capabilities.append(caps.brightness(light.get("brightness"), key=f"brightness:{index}"))
    for index, roller in enumerate(status.get("rollers") or []):
        from ..models import Capability

        capabilities.append(
            Capability(key=f"cover:{index}", type="cover", label="Shutter", state=roller.get("state"), position=roller.get("current_pos"))
        )
    for index, meter in enumerate(status.get("meters") or []):
        if meter.get("power") is not None:
            readings.append(caps.reading(f"power_w:{index}", "Power", meter["power"], "W", "power"))
    if isinstance(status.get("temperature"), int | float):
        readings.append(caps.reading("device_temperature", "Device temperature", status["temperature"], "°C", "temperature"))
    commands = caps.commands_for(capabilities)
    if any(c.type == "cover" for c in capabilities):
        commands += ["cover_open", "cover_close", "cover_stop", "set_position"]
    return DeviceState(capabilities=capabilities, readings=readings, commands=commands)
