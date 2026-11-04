"""Yeelight lights over the Yeelight Inter-Operation Specification (published by Yeelight).

Discovery: an SSDP-like M-SEARCH to 239.255.255.250:1982 with `ST: wifi_bulb`; each light answers with
`Location: yeelight://<ip>:55443` and headers for id, model, firmware, supported methods and state.
Control: newline-terminated JSON over TCP port 55443 (get_prop, set_power, toggle, set_bright,
set_ct_abx, set_hsv). The light answers each request with `result: ["ok"]` or an error.

The light only listens when "LAN Control" is switched on for it in the Yeelight app.
"""

from __future__ import annotations

import asyncio
import contextlib
import itertools
import json
from typing import Any
from urllib.parse import urlparse

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
)

MULTICAST = ("239.255.255.250", 1982)
CONTROL_PORT = 55443
SEARCH = b'M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1982\r\nMAN: "ssdp:discover"\r\nST: wifi_bulb\r\n\r\n'
PROPS = ["power", "bright", "ct", "rgb", "hue", "sat", "color_mode", "name"]
KELVIN_MIN, KELVIN_MAX = 1700, 6500
LAN_CONTROL_OFF = "The light refused the connection. Turn on LAN Control for it in the Yeelight app."


def parse_search_reply(data: bytes) -> dict[str, str] | None:
    try:
        text = data.decode("utf-8", "replace")
    except UnicodeDecodeError:
        return None
    lines = text.split("\r\n")
    if not lines or not (lines[0].startswith("HTTP/1.1 200") or lines[0].startswith("NOTIFY")):
        return None
    headers: dict[str, str] = {}
    for line in lines[1:]:
        key, sep, value = line.partition(":")
        if sep:
            headers[key.strip().lower()] = value.strip()
    location = urlparse(headers.get("location", ""))
    if location.scheme != "yeelight" or not location.hostname or not headers.get("id"):
        return None
    headers["ip"] = location.hostname
    headers["port"] = str(location.port or CONTROL_PORT)
    return headers


def _features(support: str | None, model: str | None) -> tuple[bool, bool, bool]:
    """(brightness, colour temperature, colour) from the light's advertised methods, else its model family."""
    methods = set((support or "").split())
    if methods:
        return "set_bright" in methods, "set_ct_abx" in methods, bool({"set_hsv", "set_rgb"} & methods)
    family = (model or "").lower()
    return True, family not in {"mono", "mono1"}, family in {"color", "color1", "color2", "stripe", "strip1", "bslamp1"}


class YeelightAdapter(DeviceAdapter):
    info = AdapterInfo(
        id="yeelight",
        name="Yeelight (LAN Control)",
        brands=["xiaomi"],
        protocols=["yeelight-inter-operation"],
        discovery=["ssdp-1982"],
        categories=[Category.LIGHT],
        status=SupportLevel.SUPPORTED,
        account_free=True,
        auth=AuthKind.NONE,
        library=None,
        notes=[
            "Published Yeelight Inter-Operation Specification.",
            "Turn on LAN Control for each light once in the Yeelight app.",
            "Yeelight limits each light to about 60 commands per minute.",
        ],
    )
    poll_interval = 20

    def __init__(self, ctx):
        super().__init__(ctx)
        self.discovery_targets: list[tuple[str, int]] | None = None
        self._ids = itertools.count(1)

    # ---- transport ----

    async def _call(self, host: str, port: int, method: str, params: list[Any]) -> list[Any]:
        request_id = next(self._ids)
        try:
            reader, writer = await asyncio.wait_for(asyncio.open_connection(host, port), timeout=3.0)
        except ConnectionRefusedError as error:
            raise DeviceUnreachable(
                LAN_CONTROL_OFF, code="lan_control_off", recovery="Open the Yeelight app, pick the light and turn on LAN Control."
            ) from error
        except (OSError, TimeoutError) as error:
            raise DeviceUnreachable(f"The Yeelight at {host} did not answer.") from error
        try:
            writer.write((json.dumps({"id": request_id, "method": method, "params": params}) + "\r\n").encode())
            await writer.drain()
            async with asyncio.timeout(4.0):
                while True:
                    line = await reader.readline()
                    if not line:
                        raise DeviceUnreachable("The Yeelight closed the connection.")
                    try:
                        message = json.loads(line)
                    except ValueError:
                        continue
                    if message.get("id") != request_id:
                        continue  # a "props" notification
                    if "error" in message:
                        raise AdapterError(f"The Yeelight refused {method}: {message['error'].get('message', 'error')}.", code="device_rejected")
                    return list(message.get("result") or [])
        except TimeoutError as error:
            raise DeviceUnreachable(f"The Yeelight at {host} did not answer {method}.") from error
        finally:
            writer.close()
            with contextlib.suppress(Exception):
                await writer.wait_closed()

    async def _props(self, host: str, port: int) -> dict[str, str]:
        values = await self._call(host, port, "get_prop", PROPS)
        return dict(zip(PROPS, [str(v) for v in values], strict=False))

    # ---- discovery ----

    async def discover(self, scan: ScanContext) -> None:
        replies = await _lan.udp_broadcast(self.discovery_targets or [MULTICAST], SEARCH, duration=_lan.window(scan, 4.0), cancelled=scan.cancelled)
        seen: set[str] = set()
        for data, _ip, _port in replies:
            headers = parse_search_reply(data)
            if not headers or headers["id"] in seen or not scan.in_scope(headers["ip"]):
                continue
            seen.add(headers["id"])
            _lan.report(scan, self._candidate(headers, "ssdp-1982"))

    def _candidate(self, headers: dict[str, str], source: str) -> Candidate:
        model = headers.get("model")
        candidate = make_candidate(
            self,
            headers["id"].lower(),
            name=headers.get("name") or f"Yeelight {model or 'light'}",
            model=model,
            ip=headers["ip"],
            port=int(headers.get("port") or CONTROL_PORT),
            protocol="yeelight-inter-operation",
            sources=[source],
            details={"support": headers.get("support", ""), "fw": headers.get("fw_ver")},
        )
        candidate.status = ConnectionStatus.IDENTIFIED
        candidate.pairing = self.get_pairing_requirements(candidate)
        return candidate

    async def probe(self, host: str) -> Candidate | None:
        # The search sent straight to the light: its answer carries the stable id the TCP API does not report.
        try:
            reply = await _lan.udp_request(
                host, MULTICAST[1], SEARCH, timeout=1.5, attempts=2, accept=lambda d: parse_search_reply(d) is not None, what="The Yeelight"
            )
        except AdapterError:
            return None
        headers = parse_search_reply(reply)
        return self._candidate(headers, "manual") if headers and headers["ip"] == host else None

    def get_pairing_requirements(self, candidate: Candidate) -> PairingRequirements:
        return PairingRequirements(
            auth=AuthKind.NONE,
            instructions="Make sure LAN Control is on for this light in the Yeelight app. No other pairing is needed.",
        )

    # ---- pairing ----

    async def pair(self, candidate: Candidate, credentials: dict[str, str], approval: ApprovalCallback) -> PairResult:
        if not candidate.ip:
            raise DeviceUnreachable("No address for this Yeelight; scan again.")
        port = candidate.port or CONTROL_PORT
        props = await self._props(candidate.ip, port)
        return PairResult(
            unique_id=candidate.unique_id,
            name=props.get("name") or candidate.name or "Yeelight",
            category=Category.LIGHT,
            model=candidate.model,
            host=candidate.ip,
            port=port,
            protocol="yeelight-inter-operation",
            params={"support": candidate.details.get("support", ""), "model": candidate.model, "fw": candidate.details.get("fw")},
        )

    # ---- state ----

    async def get_state(self, device: StoredDevice) -> DeviceState:
        props = await self._props(device.host or "", device.port or CONTROL_PORT)
        return _state(props, device.params.get("support"), device.params.get("model") or device.model)

    async def execute_command(self, device: StoredDevice, command: str, params: dict[str, Any]) -> CommandOutcome:
        host, port = device.host or "", device.port or CONTROL_PORT
        dimmable, tunable, colour = _features(device.params.get("support"), device.params.get("model") or device.model)
        if command in {"turn_on", "turn_off"}:
            await self._call(host, port, "set_power", ["on" if command == "turn_on" else "off", "smooth", 300])
        elif command == "toggle":
            await self._call(host, port, "toggle", [])
        elif command == "set_brightness" and dimmable:
            level = round(caps.clamp(caps.param(params, "brightness"), 0, 100, "brightness"))
            if level == 0:
                await self._call(host, port, "set_power", ["off", "smooth", 300])
            else:
                await self._call(host, port, "set_bright", [level, "smooth", 300])
        elif command == "set_color_temp" and tunable:
            kelvin = round(caps.clamp(caps.param(params, "kelvin"), KELVIN_MIN, KELVIN_MAX, "kelvin"))
            await self._call(host, port, "set_ct_abx", [kelvin, "smooth", 300])
        elif command == "set_color" and colour:
            hue = round(caps.clamp(caps.param(params, "h"), 0, 359, "h"))
            sat = round(caps.clamp(caps.param(params, "s"), 0, 100, "s"))
            await self._call(host, port, "set_hsv", [hue, sat, "smooth", 300])
        else:
            raise UnsupportedCommand(f"This Yeelight does not support {command}.")
        return CommandOutcome(result=CommandResult(status="confirmed"), state=await self.get_state(device))


def _num(value: str | None) -> float | None:
    try:
        return float(value) if value not in (None, "") else None
    except ValueError:
        return None


def _state(props: dict[str, str], support: str | None, model: str | None) -> DeviceState:
    dimmable, tunable, colour = _features(support, model)
    capabilities = [caps.power(props.get("power") == "on" if props.get("power") in {"on", "off"} else None)]
    if dimmable:
        capabilities.append(caps.brightness(_num(props.get("bright"))))
    mode = props.get("color_mode")
    if tunable:
        capabilities.append(caps.color_temp(_num(props.get("ct")) if mode in {None, "", "2"} else None, KELVIN_MIN, KELVIN_MAX))
    if colour:
        if mode == "3":
            capabilities.append(caps.color(_num(props.get("hue")), _num(props.get("sat"))))
        elif mode == "1" and _num(props.get("rgb")) is not None:
            rgb = int(_num(props.get("rgb")) or 0)
            capabilities.append(caps.color(*caps.rgb_to_hs((rgb >> 16) & 0xFF, (rgb >> 8) & 0xFF, rgb & 0xFF)))
        else:
            capabilities.append(caps.color(None, None))
    return DeviceState(capabilities=capabilities, commands=caps.commands_for(capabilities))
