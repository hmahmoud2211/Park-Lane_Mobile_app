"""LG webOS TVs over their local WebSocket API (SSAP), with aiowebostv.

Discovery: SSDP, service `urn:lge-com:service:webos-second-screen:1`. Pairing: the first connection
without a client key makes the TV show an "Allow this device?" prompt; accepting it gives a client key
that later connections present. aiowebostv waits about 10 s for the answer, so pairing re-sends the
request a few times within a minute.

A TV that is off usually drops off the network, so an unreachable TV is reported as off (unconfirmed)
rather than offline. Turning it on uses Wake-on-LAN to its MAC address ("Turn on via Wi-Fi/mobile" must
be enabled on the TV); there is no reply, so that result is "assumed".
"""

from __future__ import annotations

import asyncio
import contextlib
import re
from typing import Any
from urllib.parse import urlparse

from aiowebostv import WebOsClient, WebOsTvCommandError, WebOsTvPairError

from ..models import AdapterInfo, AuthKind, Candidate, Category, CommandResult, ConnectionStatus, PairingRequirements, Setting, SupportLevel
from . import _lan, caps
from .base import (
    AdapterError,
    ApprovalCallback,
    CommandOutcome,
    DeviceAdapter,
    DeviceState,
    DeviceUnreachable,
    PairingRejected,
    PairResult,
    ScanContext,
    SsdpRecord,
    StoredDevice,
    UnsupportedCommand,
    make_candidate,
    normalize_mac,
)

SERVICE = "urn:lge-com:service:webos-second-screen:1"
PAIR_ATTEMPTS = 5
APPROVAL_TIMEOUT = 60
MAX_SOURCES = 40


def _is_webos(record: SsdpRecord) -> bool:
    text = f"{record.st} {record.usn} {record.server or ''}".lower()
    return "webos-second-screen" in text or "webos" in text


def _uuid(usn: str) -> str | None:
    match = re.match(r"uuid:([0-9a-fA-F-]{8,})", usn or "")
    return match.group(1).lower() if match else None


def _xml_value(xml: str, tag: str) -> str | None:
    match = re.search(rf"<{tag}>([^<]{{1,128}})</{tag}>", xml)
    return match.group(1).strip() if match else None


async def _reachable(host: str, ports: tuple[int, ...] = (3000, 3001), timeout: float = 2.0) -> bool:
    for port in ports:
        try:
            _reader, writer = await asyncio.wait_for(asyncio.open_connection(host, port), timeout=timeout)
        except (OSError, TimeoutError):
            continue
        writer.close()
        with contextlib.suppress(Exception):
            await writer.wait_closed()
        return True
    return False


def _mac_from_info(client: Any) -> str | None:
    connection = getattr(getattr(client, "tv_info", None), "connection", None) or {}
    for section in ("wiredInfo", "wifiInfo"):
        mac = normalize_mac((connection.get(section) or {}).get("macAddress"))
        if mac:
            return mac
    return None


def _sources(tv_state: Any) -> tuple[list[str], dict[str, tuple[str, str, str]]]:
    """Source labels (inputs first, then apps) and label -> (kind, id to select it, app id the TV reports when it is on)."""
    lookup: dict[str, tuple[str, str, str]] = {}
    for input_id, entry in (getattr(tv_state, "inputs", None) or {}).items():
        label = str(entry.get("label") or input_id)
        ident = str(entry.get("id") or input_id)
        lookup.setdefault(label, ("input", ident, str(entry.get("appId") or ident)))
    for app_id, entry in sorted((getattr(tv_state, "apps", None) or {}).items(), key=lambda kv: str(kv[1].get("title", kv[0]))):
        label = str(entry.get("title") or app_id)
        ident = str(entry.get("id") or app_id)
        lookup.setdefault(label, ("app", ident, ident))
    return list(lookup)[:MAX_SOURCES], lookup


#: The TV remote's keys the app offers while the TV is on, as `button` settings pressed with `press` (params.key):
#: our key → (name shown, aiowebostv button name). Sent over the TV's pointer input socket.
REMOTE_KEYS: dict[str, tuple[str, str]] = {
    "up": ("Up", "UP"),
    "down": ("Down", "DOWN"),
    "left": ("Left", "LEFT"),
    "right": ("Right", "RIGHT"),
    "ok": ("OK", "ENTER"),
    "back": ("Back", "BACK"),
    "home": ("Home", "HOME"),
    "menu": ("Settings", "MENU"),
    "channel_up": ("Channel up", "CHANNELUP"),
    "channel_down": ("Channel down", "CHANNELDOWN"),
    "info": ("Info", "INFO"),
    "exit": ("Exit", "EXIT"),
}


#: Screens of the TV itself, which it reports as the current app but doesn't list among its apps.
SYSTEM_SCREENS: dict[str, str] = {
    "com.webos.app.home": "Home screen",
    "com.webos.app.livetv": "Live TV",
    "com.webos.app.browser": "Web browser",
    "com.webos.app.discovery": "LG Content Store",
    "com.palm.app.settings": "Settings",
}


def _remote_settings() -> list[Setting]:
    return [Setting(key=key, kind="button", name=name) for key, (name, _button) in REMOTE_KEYS.items()]


def _state_from(tv_state: Any, *, reachable: bool = True) -> DeviceState:
    if not reachable or tv_state is None:
        capabilities = [caps.power(False, confirmed=False), caps.media(state="off", confirmed=False)]
        return DeviceState(capabilities=capabilities, commands=["turn_on", "turn_off"])
    sources, lookup = _sources(tv_state)
    current = getattr(tv_state, "current_app_id", None)
    # The TV's own screens aren't in its app list: name them in words rather than showing an app id.
    source = next((label for label, (_kind, _ident, app_id) in lookup.items() if app_id == current), None) or SYSTEM_SCREENS.get(str(current))
    on = bool(getattr(tv_state, "is_on", False))
    capabilities = [
        caps.power(on),
        caps.media(
            state="on" if on else "off",
            volume=getattr(tv_state, "volume", None),
            muted=getattr(tv_state, "muted", None),
            source=source,
            sources=sources,
        ),
    ]
    commands = [
        "turn_on",
        "turn_off",
        "set_volume",
        "volume_up",
        "volume_down",
        "mute",
        "set_source",
        "media_play",
        "media_pause",
        "media_next",
        "media_previous",
    ]
    if not on:
        return DeviceState(capabilities=capabilities, commands=commands)
    # The remote's keys work only while the TV is on (its input socket is up).
    return DeviceState(capabilities=capabilities, commands=[*commands, "press"], settings=_remote_settings())


class WebOsAdapter(DeviceAdapter):
    info = AdapterInfo(
        id="lg_webos",
        name="LG webOS TV (aiowebostv)",
        brands=["lg"],
        protocols=["webos-ssap"],
        discovery=["ssdp"],
        categories=[Category.TV],
        status=SupportLevel.SUPPORTED,
        account_free=True,
        auth=AuthKind.APPROVE_ON_DEVICE,
        push_updates=False,
        library="aiowebostv",
        notes=[
            "Accept the pairing prompt on the TV.",
            "Turning the TV on uses Wake-on-LAN: enable 'Turn on via Wi-Fi' (or 'Mobile TV On') in the TV's settings.",
        ],
    )
    ssdp_targets = (SERVICE,)
    poll_interval = 20
    call_timeout = 15.0

    def __init__(self, ctx):
        super().__init__(ctx)
        self._clients: dict[str, WebOsClient] = {}
        self.client_factory = WebOsClient

    async def stop(self) -> None:
        for client in list(self._clients.values()):
            with contextlib.suppress(Exception):
                await client.disconnect()
        self._clients.clear()

    # ---- discovery ----

    async def discover(self, scan: ScanContext) -> None:
        await scan.wait_passive()
        seen: set[str] = set()
        for record in scan.ssdp_matching(_is_webos):
            uid = _uuid(record.usn) or record.ip
            if uid in seen or not scan.in_scope(record.ip):
                continue
            seen.add(uid)
            _lan.report(scan, await self._candidate(record.ip, uid, record.location, "ssdp"))

    async def _candidate(self, ip: str, uid: str, location: str | None, source: str) -> Candidate:
        name = model = None
        if location and urlparse(location).hostname == ip:
            try:
                response = await self.ctx.http.get(location, timeout=3.0)
                xml = response.text[:20000]
                name, model = _xml_value(xml, "friendlyName"), _xml_value(xml, "modelName")
            except Exception:  # noqa: BLE001 - the description is optional
                pass
        candidate = make_candidate(
            self,
            uid,
            name=name or "LG TV",
            model=model,
            ip=ip,
            port=3000,
            protocol="webos-ssap",
            sources=[source],
        )
        candidate.status = ConnectionStatus.LOCAL_AUTHORIZATION_REQUIRED
        candidate.pairing = self.get_pairing_requirements(candidate)
        return candidate

    async def probe(self, host: str) -> Candidate | None:
        if not await _reachable(host):
            return None
        return await self._candidate(host, f"ip-{host}", None, "manual")

    def get_pairing_requirements(self, candidate: Candidate) -> PairingRequirements:
        return PairingRequirements(
            auth=AuthKind.APPROVE_ON_DEVICE,
            approval_timeout=APPROVAL_TIMEOUT,
            instructions="Turn the TV on. When pairing starts, the TV asks whether to allow this device: choose Accept.",
        )

    # ---- pairing ----

    async def pair(self, candidate: Candidate, credentials: dict[str, str], approval: ApprovalCallback) -> PairResult:
        host = candidate.ip
        if not host or not await _reachable(host):
            raise DeviceUnreachable("The TV did not answer. Turn it on and make sure it is on the same network.")
        client = self.client_factory(host, client_key=credentials.get("client_key") or None)
        try:
            for _attempt in range(PAIR_ATTEMPTS):
                await approval("Accept the request on your LG TV.")
                try:
                    await client.connect()
                    break
                except WebOsTvPairError as error:
                    raise PairingRejected("The TV declined the pairing request.") from error
                except TimeoutError:
                    continue
                except OSError as error:
                    raise DeviceUnreachable("Lost the connection to the TV during pairing.") from error
            else:
                raise PairingRejected("The TV's prompt was not accepted in time.", code="approval_timeout")
            key = client.client_key
            if not key:
                raise PairingRejected("The TV did not grant access.")
            state = _state_from(client.tv_state)
            mac = _mac_from_info(client) or candidate.mac
            system = getattr(client.tv_info, "system", None) or {}
            # An address typed by hand has no SSDP uuid; the MAC is the stable identity then.
            unique_id = mac.replace(":", "") if candidate.unique_id.startswith("ip-") and mac else candidate.unique_id
            return PairResult(
                unique_id=unique_id,
                name=candidate.name or "LG TV",
                category=Category.TV,
                model=system.get("modelName") or candidate.model,
                host=host,
                port=3000,
                mac=mac,
                protocol="webos-ssap",
                params={"wol": bool(mac), "power_on_ok": any(c.type == "power" for c in state.capabilities)},
                credentials={"client_key": key},
            )
        finally:
            with contextlib.suppress(Exception):
                await client.disconnect()

    # ---- runtime ----

    async def _client(self, device: StoredDevice) -> WebOsClient | None:
        """The connected client, or None when the TV is off/unreachable."""
        client = self._clients.get(device.id)
        if client is None:
            client = self.client_factory(device.host or "", client_key=device.credentials.get("client_key"))
            self._clients[device.id] = client
        if client.is_connected():
            return client
        if not await _reachable(device.host or ""):
            return None
        try:
            await asyncio.wait_for(client.connect(), timeout=8)
        except WebOsTvPairError as error:
            raise PairingRejected("The TV no longer accepts this gateway. Pair it again.", code="device_auth_failed") from error
        except (TimeoutError, OSError):
            return None
        return client

    async def get_state(self, device: StoredDevice) -> DeviceState:
        client = await self._client(device)
        if client is None:
            return _state_from(None, reachable=False)
        return _state_from(client.tv_state)

    async def execute_command(self, device: StoredDevice, command: str, params: dict[str, Any]) -> CommandOutcome:
        if command == "turn_on":
            if not device.mac:
                raise UnsupportedCommand("The TV's MAC address is unknown, so it cannot be woken. Turn it on with its remote.")
            await _lan.wake_on_lan(device.mac)
            return CommandOutcome(
                result=CommandResult(status="assumed", message="Wake-on-LAN sent. The TV gives no reply until it is on."),
                state=DeviceState(capabilities=[caps.power(True, confirmed=False), caps.media(state="on", confirmed=False)], commands=["turn_on", "turn_off"]),
            )
        client = await self._client(device)
        if client is None:
            raise DeviceUnreachable("The TV is off or unreachable.", recovery="Turn the TV on, then try again.")
        state = client.tv_state
        try:
            if command == "turn_off":
                await client.power_off()
                return CommandOutcome(
                    result=CommandResult(status="assumed", message="The TV is turning off."),
                    state=DeviceState(
                        capabilities=[caps.power(False, confirmed=False), caps.media(state="off", confirmed=False)], commands=["turn_on", "turn_off"]
                    ),
                )
            if command == "set_volume":
                volume = round(caps.clamp(caps.param(params, "volume"), 0, 100, "volume"))
                await client.set_volume(volume)
                return await self._settle(client, lambda s: getattr(s, "volume", None) == volume)
            if command in {"volume_up", "volume_down"}:
                await (client.volume_up() if command == "volume_up" else client.volume_down())
                return await self._settle(client, None)
            if command == "mute":
                muted = bool(params.get("muted", not getattr(state, "muted", False)))
                await client.set_mute(muted)
                return await self._settle(client, lambda s: getattr(s, "muted", None) == muted)
            if command == "set_source":
                label = str(caps.param(params, "source"))
                _labels, lookup = _sources(state)
                if label not in lookup:
                    raise AdapterError(f"The TV has no source called {label!r}.", code="bad_params")
                kind, ident, app_id = lookup[label]
                await (client.set_input(ident) if kind == "input" else client.launch_app(ident))
                return await self._settle(client, lambda s: getattr(s, "current_app_id", None) == app_id)
            if command == "press":
                key = str(caps.param(params, "key"))
                if key not in REMOTE_KEYS:
                    raise AdapterError(f"The TV remote has no key called {key!r}.", code="bad_params")
                await client.button(REMOTE_KEYS[key][1])
                return CommandOutcome(result=CommandResult(status="assumed", message=f"{REMOTE_KEYS[key][0]} sent."), state=_state_from(client.tv_state))
            actions = {"media_play": "play", "media_pause": "pause", "media_next": "channel_up", "media_previous": "channel_down"}
            if command in actions:
                await getattr(client, actions[command])()
                return CommandOutcome(result=CommandResult(status="assumed", message="Sent to the TV."), state=_state_from(client.tv_state))
        except WebOsTvCommandError as error:
            raise AdapterError("The TV refused the command.", code="device_rejected") from error
        raise UnsupportedCommand(f"LG TVs do not support {command}.")

    async def _settle(self, client: WebOsClient, check: Any) -> CommandOutcome:
        """Waits briefly for the TV's own state update; confirmed only if it reports the change."""
        for _ in range(10):
            await asyncio.sleep(0.15)
            if check is not None and check(client.tv_state):
                return CommandOutcome(result=CommandResult(status="confirmed"), state=_state_from(client.tv_state))
        status = "assumed" if check is None else "pending"
        return CommandOutcome(result=CommandResult(status=status), state=_state_from(client.tv_state))

    async def disconnect(self, device: StoredDevice) -> None:
        client = self._clients.pop(device.id, None)
        if client is not None:
            with contextlib.suppress(Exception):
                await client.disconnect()
