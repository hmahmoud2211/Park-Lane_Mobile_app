"""Daikin air conditioners through their Wi-Fi adapter's local HTTP API (experimental).

Daikin does not publish this API; it is the one the BRP069 adapters serve and that pydaikin and Home
Assistant use. Answers are `key=value` pairs separated by commas:

- GET /common/basic_info          identification (name is percent-encoded, mac, type, ver)
- GET /aircon/get_control_info    pow, mode, stemp, shum, f_rate, f_dir and per-mode setpoints dt1..dt7
- GET /aircon/get_sensor_info     htemp (indoor), otemp (outdoor)
- GET /aircon/set_control_info    pow, mode, stemp, shum, f_rate, f_dir (all required)

BRP072C adapters answer only over HTTPS and need a key printed on the adapter, registered once with
/common/register_terminal and sent as X-Daikin-uuid afterwards. That path is implemented but untested.
SKYFi and Daikin Cloud-only units are not supported.
"""

from __future__ import annotations

import asyncio
import uuid
from typing import Any
from urllib.parse import unquote

import httpx

from ..models import AdapterInfo, AuthKind, Candidate, Category, CommandResult, ConnectionStatus, FieldSpec, PairingRequirements, SupportLevel
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

UDP_PORT = 30050
UDP_QUERY = b"DAIKIN_UDP/common/basic_info"

#: Daikin mode code -> normalized HVAC mode. 0, 1 and 7 are all auto on different firmware.
MODES = {"0": "auto", "1": "auto", "7": "auto", "2": "dry", "3": "cool", "4": "heat", "6": "fan_only"}
MODE_CODES = {"auto": "1", "dry": "2", "cool": "3", "heat": "4", "fan_only": "6"}
FAN_RATES = {"A": "auto", "B": "silence", "3": "1", "4": "2", "5": "3", "6": "4", "7": "5"}
FAN_CODES = {name: code for code, name in FAN_RATES.items()}


def parse_kv(text: str) -> dict[str, str]:
    values: dict[str, str] = {}
    for part in text.strip().split(","):
        key, sep, value = part.partition("=")
        if sep:
            values[key.strip()] = value.strip()
    return values


def _float(value: str | None) -> float | None:
    try:
        return float(value) if value not in (None, "", "-", "--", "M") else None
    except ValueError:
        return None


class DaikinAdapter(DeviceAdapter):
    info = AdapterInfo(
        id="daikin",
        name="Daikin Wi-Fi adapter (local HTTP)",
        brands=["daikin"],
        protocols=["daikin-brp069-http", "daikin-brp072c-https"],
        discovery=["udp-broadcast", "subnet"],
        categories=[Category.CLIMATE],
        status=SupportLevel.EXPERIMENTAL,
        account_free=True,
        auth=AuthKind.NONE,
        library=None,
        notes=[
            "Unofficial local API of BRP069-series adapters (as used by pydaikin / Home Assistant).",
            "BRP072C adapters need the key printed on the adapter; that path is untested.",
            "SKYFi and cloud-only (Daikin Onecta) units are not supported.",
        ],
    )
    probe_ports = (80,)
    poll_interval = 30

    def __init__(self, ctx):
        super().__init__(ctx)
        self.udp_port = UDP_PORT
        self.discovery_targets: list[tuple[str, int]] | None = None
        self._insecure: httpx.AsyncClient | None = None

    async def stop(self) -> None:
        if self._insecure is not None:
            await self._insecure.aclose()
            self._insecure = None

    # ---- transport ----

    def _client(self, https: bool) -> httpx.AsyncClient:
        if not https:
            return self.ctx.http
        # BRP072C serves a self-signed certificate on the LAN; there is no CA to check it against.
        if self._insecure is None:
            self._insecure = httpx.AsyncClient(verify=False, timeout=httpx.Timeout(6.0, connect=3.0))  # noqa: S501
        return self._insecure

    async def _get(self, host: str, path: str, params: dict[str, str] | None = None, *, https: bool = False, key_uuid: str | None = None) -> dict[str, str]:
        scheme = "https" if https else "http"
        headers = {"X-Daikin-uuid": key_uuid} if key_uuid else None
        try:
            response = await self._client(https).get(f"{scheme}://{host}{path}", params=params, headers=headers, timeout=5.0)
        except httpx.HTTPError as error:
            raise DeviceUnreachable(f"The Daikin adapter at {host} did not answer.") from error
        if response.status_code == 403:
            raise AuthRequired("The Daikin adapter needs its key.", code="device_auth_failed")
        if response.status_code >= 400:
            raise AdapterError(f"The Daikin adapter answered {response.status_code}.", code="device_rejected")
        values = parse_kv(response.text)
        if values.get("ret") != "OK":
            if "ret" not in values:
                raise AdapterError(f"The device at {host} is not a Daikin adapter.", code="not_daikin")
            raise AdapterError(f"The Daikin adapter refused the request ({values.get('ret')}).", code="device_rejected")
        return values

    # ---- discovery ----

    async def discover(self, scan: ScanContext) -> None:
        targets = self.discovery_targets or _lan.broadcast_targets(scan, self.udp_port)
        udp = asyncio.ensure_future(_lan.udp_broadcast(targets, UDP_QUERY, duration=_lan.window(scan, 4.0), cancelled=scan.cancelled))
        await scan.wait_passive()
        replies = await udp
        found: dict[str, tuple[str, dict[str, str] | None]] = {}
        for data, ip, _port in replies:
            info = parse_kv(data.decode("utf-8", "replace"))
            if info.get("ret") == "OK" and info.get("mac"):
                found[ip] = ("udp-broadcast", info)
        for ip in scan.hosts_with_port(80):
            found.setdefault(ip, ("subnet", None))

        async def check(ip: str, source: str, info: dict[str, str] | None) -> None:
            if not scan.in_scope(ip):
                return
            candidate = await self._identify_host(ip, source, info)
            if candidate:
                _lan.report(scan, candidate)

        await asyncio.gather(*(check(ip, source, info) for ip, (source, info) in found.items()))

    async def _identify_host(self, ip: str, source: str, info: dict[str, str] | None = None, *, allow_locked: bool = False) -> Candidate | None:
        """A Daikin adapter only counts when /common/basic_info answers `ret=OK` for an aircon. With
        `allow_locked` (an address the user typed for Daikin), an HTTPS-only adapter that refuses without
        its key is also accepted, so the user can enter the key."""
        https = False
        if info is None:
            try:
                info = await self._get(ip, "/common/basic_info")
            except AdapterError:
                try:
                    info, https = await self._get(ip, "/common/basic_info", https=True), True
                except AuthRequired:
                    if not allow_locked:
                        return None
                    info, https = {"ret": "OK", "type": "aircon"}, True
                except AdapterError:
                    return None
        if info.get("ret") != "OK" or info.get("type", "aircon") != "aircon":
            return None
        mac = normalize_mac(info.get("mac"))
        unique = (mac or ip).replace(":", "")
        candidate = make_candidate(
            self,
            unique,
            name=unquote(info.get("name", "")) or "Daikin air conditioner",
            model=f"Daikin adapter {info.get('ver', '').replace('_', '.')}".strip() if info.get("ver") else None,
            ip=ip,
            port=443 if https else 80,
            mac=mac,
            protocol="daikin-brp072c-https" if https else "daikin-brp069-http",
            sources=[source],
            details={"https": https, "ver": info.get("ver"), "adp_kind": info.get("adp_kind")},
        )
        candidate.status = ConnectionStatus.IDENTIFIED if mac else ConnectionStatus.DISCOVERED
        candidate.pairing = self.get_pairing_requirements(candidate)
        return candidate

    async def probe(self, host: str) -> Candidate | None:
        return await self._identify_host(host, "manual", allow_locked=True)

    def get_pairing_requirements(self, candidate: Candidate) -> PairingRequirements:
        if candidate.details.get("https"):
            return PairingRequirements(
                auth=AuthKind.DEVICE_CREDENTIALS,
                fields=[FieldSpec(name="key", label="Adapter key", kind="password", secret=True, help="The 13-digit key printed on the Wi-Fi adapter's label")],
                instructions="This Daikin adapter (BRP072C) only answers with the key printed on its label. Experimental.",
            )
        return PairingRequirements(auth=AuthKind.NONE, instructions="Experimental: the local API is unofficial and not every adapter supports it.")

    # ---- pairing ----

    async def pair(self, candidate: Candidate, credentials: dict[str, str], approval: ApprovalCallback) -> PairResult:
        if not candidate.ip:
            raise DeviceUnreachable("No address for this Daikin adapter; scan again.")
        https = bool(candidate.details.get("https"))
        creds: dict[str, str] = {}
        if https:
            key = credentials.get("key", "").strip()
            if not key:
                raise AuthRequired("Enter the key printed on the Daikin adapter.", code="credentials_missing")
            key_uuid = uuid.uuid4().hex
            await self._get(candidate.ip, "/common/register_terminal", {"key": key}, https=True, key_uuid=key_uuid)
            creds = {"uuid": key_uuid}
        device = StoredDevice(
            id="pairing",
            adapter_id=self.info.id,
            brand="daikin",
            unique_id=candidate.unique_id,
            name=candidate.name or "Daikin",
            category=Category.CLIMATE,
            host=candidate.ip,
            port=candidate.port,
            params={"https": https},
            credentials=creds,
        )
        await self.get_state(device)
        return PairResult(
            unique_id=candidate.unique_id,
            name=candidate.name or "Daikin air conditioner",
            category=Category.CLIMATE,
            model=candidate.model,
            host=candidate.ip,
            port=candidate.port,
            mac=candidate.mac,
            protocol=candidate.protocol,
            params={"https": https, "ver": candidate.details.get("ver")},
            credentials=creds,
        )

    # ---- state ----

    async def _read(self, device: StoredDevice) -> tuple[dict[str, str], dict[str, str]]:
        https = bool(device.params.get("https"))
        key_uuid = device.credentials.get("uuid")
        control = await self._get(device.host or "", "/aircon/get_control_info", https=https, key_uuid=key_uuid)
        try:
            sensors = await self._get(device.host or "", "/aircon/get_sensor_info", https=https, key_uuid=key_uuid)
        except AdapterError:
            sensors = {}
        return control, sensors

    async def get_state(self, device: StoredDevice) -> DeviceState:
        control, sensors = await self._read(device)
        return _state(control, sensors)

    async def execute_command(self, device: StoredDevice, command: str, params: dict[str, Any]) -> CommandOutcome:
        control, _sensors = await self._read(device)
        pow_, mode = control.get("pow", "0"), control.get("mode", "3")
        stemp, shum = control.get("stemp", "25"), control.get("shum", "0")
        f_rate, f_dir = control.get("f_rate", "A"), control.get("f_dir", "0")

        if command == "turn_on":
            pow_ = "1"
        elif command == "turn_off":
            pow_ = "0"
        elif command == "set_temperature":
            if MODES.get(mode) in {"dry", "fan_only"}:
                raise AdapterError("The temperature cannot be set in dry or fan mode.", code="bad_params")
            stemp = f"{caps.clamp(caps.param(params, 'temperature'), 10, 32, 'temperature'):.1f}"
        elif command == "set_hvac_mode":
            wanted = str(caps.param(params, "mode"))
            if wanted == "off":
                pow_ = "0"
            elif wanted in MODE_CODES:
                pow_, mode = "1", MODE_CODES[wanted]
                # Each mode keeps its own setpoint (dtN / dhN); dry and fan modes need theirs, not the cool one.
                stemp = control.get(f"dt{mode}", stemp)
                shum = control.get(f"dh{mode}", shum)
            else:
                raise AdapterError(f"Unknown mode {wanted!r}.", code="bad_params")
        elif command == "set_fan_mode":
            wanted = str(caps.param(params, "fan_mode"))
            if wanted not in FAN_CODES:
                raise AdapterError(f"Unknown fan mode {wanted!r}.", code="bad_params")
            f_rate = FAN_CODES[wanted]
        else:
            raise UnsupportedCommand(f"Daikin adapters do not support {command}.")

        await self._get(
            device.host or "",
            "/aircon/set_control_info",
            {"pow": pow_, "mode": mode, "stemp": stemp, "shum": shum, "f_rate": f_rate, "f_dir": f_dir},
            https=bool(device.params.get("https")),
            key_uuid=device.credentials.get("uuid"),
        )
        return CommandOutcome(result=CommandResult(status="confirmed"), state=await self.get_state(device))


def _state(control: dict[str, str], sensors: dict[str, str]) -> DeviceState:
    on = control.get("pow") == "1"
    mode = MODES.get(control.get("mode", ""), "auto") if on else "off"
    capability = caps.climate(
        current=_float(sensors.get("htemp")),
        target=_float(control.get("stemp")),
        mode=mode,
        modes=["off", "auto", "cool", "heat", "dry", "fan_only"],
        fan_mode=FAN_RATES.get(control.get("f_rate", "")),
        fan_modes=list(FAN_CODES),
        low=10,
        high=32,
        step=0.5,
    )
    readings = []
    outdoor = _float(sensors.get("otemp"))
    if outdoor is not None:
        readings.append(caps.reading("outdoor_temperature", "Outdoor temperature", outdoor, "°C", "temperature"))
    return DeviceState(capabilities=[capability], readings=readings, commands=caps.commands_for([capability]))
