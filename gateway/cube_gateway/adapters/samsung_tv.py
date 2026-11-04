"""Samsung Smart TVs (2016 and later, Tizen) over their local REST and WebSocket APIs, with samsungtvws.

- REST, http://<ip>:8001/api/v2/: model, name, Wi-Fi MAC and, on most models since 2018, PowerState
  ("on" / "standby"). No authentication. Used to identify the TV and read its power state.
- WebSocket remote, wss://<ip>:8002 (TokenAuthSupport models) or ws://<ip>:8001: key presses. The first
  connection makes the TV ask "Allow?"; accepting returns a token stored for later connections.

The remote API only sends key presses and never reports back, so every key command is "assumed":
power (KEY_POWER toggles), volume up/down, mute (toggles), play/pause and channel up/down. There is no
absolute volume. Power-on from deep standby uses Wake-on-LAN to the TV's MAC ("assumed").
"""

from __future__ import annotations

import asyncio
import contextlib
from typing import Any

import httpx
from samsungtvws.async_remote import SamsungTVWSAsyncRemote
from samsungtvws.exceptions import ConnectionFailure, UnauthorizedError
from samsungtvws.remote import SendRemoteKey

from ..models import AdapterInfo, AuthKind, Candidate, Category, CommandResult, ConnectionStatus, PairingRequirements, SupportLevel
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

REST_PORT = 8001
TOKEN_PORT = 8002
REMOTE_NAME = "CUBE OS"
APPROVAL_TIMEOUT = 45
KEYS = {
    "volume_up": "KEY_VOLUP",
    "volume_down": "KEY_VOLDOWN",
    "mute": "KEY_MUTE",
    "media_play": "KEY_PLAY",
    "media_pause": "KEY_PAUSE",
    "media_next": "KEY_CHUP",
    "media_previous": "KEY_CHDOWN",
}
COMMANDS = ["turn_on", "turn_off", *KEYS]


def _is_samsung(record: SsdpRecord) -> bool:
    text = f"{record.st} {record.usn} {record.server or ''}".lower()
    return "samsung" in text or "remotecontrolreceiver" in text


def _state(power: bool | None, *, confirmed: bool) -> DeviceState:
    capabilities = [caps.power(power, confirmed=confirmed), caps.media(state=None if power is None else ("on" if power else "off"), confirmed=confirmed)]
    return DeviceState(capabilities=capabilities, commands=list(COMMANDS))


class SamsungTvAdapter(DeviceAdapter):
    info = AdapterInfo(
        id="samsung_tv",
        name="Samsung Smart TV (samsungtvws)",
        brands=["samsung"],
        protocols=["samsung-tv-rest", "samsung-tv-ws"],
        discovery=["ssdp", "subnet"],
        categories=[Category.TV],
        status=SupportLevel.SUPPORTED,
        account_free=True,
        auth=AuthKind.APPROVE_ON_DEVICE,
        library="samsungtvws",
        notes=[
            "Allow the connection on the TV when pairing.",
            "The TV does not report volume, input or playback, so those commands show as sent, not confirmed.",
            "Power-on from deep standby needs Wake-on-LAN ('Power on with mobile' in the TV's settings).",
        ],
    )
    ssdp_targets = ("urn:samsung.com:device:RemoteControlReceiver:1", "urn:dial-multiscreen-org:service:dial:1")
    probe_ports = (REST_PORT,)
    poll_interval = 30
    call_timeout = 15.0

    def __init__(self, ctx):
        super().__init__(ctx)
        self._remotes: dict[str, SamsungTVWSAsyncRemote] = {}
        self.remote_factory = SamsungTVWSAsyncRemote

    async def stop(self) -> None:
        for remote in list(self._remotes.values()):
            with contextlib.suppress(Exception):
                await remote.close()
        self._remotes.clear()

    # ---- REST ----

    async def _info(self, host: str, timeout: float = 3.0) -> dict[str, Any]:
        try:
            response = await self.ctx.http.get(f"http://{host}:{REST_PORT}/api/v2/", timeout=timeout)
            info = response.json()
        except (httpx.HTTPError, ValueError) as error:
            raise DeviceUnreachable(f"The Samsung TV at {host} did not answer.") from error
        device = info.get("device") if isinstance(info, dict) else None
        if not isinstance(device, dict) or "samsung" not in str(device.get("type") or info.get("type") or "").lower():
            raise AdapterError(f"The device at {host} is not a Samsung TV.", code="not_samsung_tv")
        return device

    # ---- discovery ----

    async def discover(self, scan: ScanContext) -> None:
        await scan.wait_passive()
        hosts = {record.ip: "ssdp" for record in scan.ssdp_matching(_is_samsung)}
        for ip in scan.hosts_with_port(REST_PORT):
            hosts.setdefault(ip, "subnet")

        async def check(ip: str, source: str) -> None:
            if not scan.in_scope(ip):
                return
            candidate = await self._identify_host(ip, source)
            if candidate:
                _lan.report(scan, candidate)

        await asyncio.gather(*(check(ip, source) for ip, source in hosts.items()))

    async def _identify_host(self, ip: str, source: str) -> Candidate | None:
        try:
            device = await self._info(ip)
        except AdapterError:
            return None
        mac = normalize_mac(device.get("wifiMac"))
        uid = str(device.get("id") or "").removeprefix("uuid:") or (mac or ip).replace(":", "")
        token_auth = str(device.get("TokenAuthSupport", "")).lower() == "true"
        candidate = make_candidate(
            self,
            uid.lower(),
            name=device.get("name") or "Samsung TV",
            model=device.get("modelName"),
            ip=ip,
            port=TOKEN_PORT if token_auth else REST_PORT,
            mac=mac,
            protocol="samsung-tv-ws",
            sources=[source],
            details={"token_auth": token_auth, "power_state": device.get("PowerState")},
        )
        candidate.status = ConnectionStatus.LOCAL_AUTHORIZATION_REQUIRED
        candidate.pairing = self.get_pairing_requirements(candidate)
        return candidate

    async def probe(self, host: str) -> Candidate | None:
        return await self._identify_host(host, "manual")

    def get_pairing_requirements(self, candidate: Candidate) -> PairingRequirements:
        return PairingRequirements(
            auth=AuthKind.APPROVE_ON_DEVICE,
            approval_timeout=APPROVAL_TIMEOUT,
            instructions="Turn the TV on. When pairing starts, the TV asks whether to allow CUBE OS: choose Allow.",
        )

    # ---- remote ----

    def _remote(self, host: str, port: int, token: str | None) -> SamsungTVWSAsyncRemote:
        return self.remote_factory(host, token=token, port=port, timeout=APPROVAL_TIMEOUT, name=REMOTE_NAME)

    async def _open(self, remote: SamsungTVWSAsyncRemote, timeout: float) -> None:
        try:
            await asyncio.wait_for(remote.open(), timeout=timeout)
        except UnauthorizedError as error:
            raise PairingRejected("The TV did not allow the connection.", code="device_auth_failed") from error
        except (ConnectionFailure, OSError, TimeoutError) as error:
            raise DeviceUnreachable("Could not open the TV's remote-control connection.") from error

    async def _live_remote(self, device: StoredDevice) -> SamsungTVWSAsyncRemote:
        remote = self._remotes.get(device.id)
        if remote is not None and remote.is_alive():
            return remote
        remote = self._remote(device.host or "", int(device.params.get("port") or TOKEN_PORT), device.credentials.get("token"))
        await self._open(remote, 10)
        self._remotes[device.id] = remote
        return remote

    async def _send(self, device: StoredDevice, key: str) -> None:
        for attempt in range(2):
            remote = await self._live_remote(device)
            try:
                await remote.send_command(SendRemoteKey.click(key))
                return
            except Exception as error:  # noqa: BLE001 - a dropped socket is retried once on a fresh connection
                self._remotes.pop(device.id, None)
                with contextlib.suppress(Exception):
                    await remote.close()
                if attempt:
                    raise DeviceUnreachable("The TV dropped the remote-control connection.") from error

    # ---- pairing ----

    async def pair(self, candidate: Candidate, credentials: dict[str, str], approval: ApprovalCallback) -> PairResult:
        if not candidate.ip:
            raise DeviceUnreachable("No address for this TV; scan again.")
        device = await self._info(candidate.ip)
        token_auth = str(device.get("TokenAuthSupport", "")).lower() == "true"
        port = TOKEN_PORT if token_auth else REST_PORT
        remote = self._remote(candidate.ip, port, credentials.get("token") or None)
        await approval("Allow CUBE OS on your Samsung TV.")
        try:
            await self._open(remote, APPROVAL_TIMEOUT)
            token = remote.token
        finally:
            with contextlib.suppress(Exception):
                await remote.close()
        if token_auth and not token:
            raise PairingRejected("The TV did not grant access.")
        mac = normalize_mac(device.get("wifiMac")) or candidate.mac
        return PairResult(
            unique_id=candidate.unique_id,
            name=device.get("name") or candidate.name or "Samsung TV",
            category=Category.TV,
            model=device.get("modelName") or candidate.model,
            host=candidate.ip,
            port=port,
            mac=mac,
            protocol="samsung-tv-ws",
            params={"port": port, "power_state_reported": "PowerState" in device},
            credentials={"token": token} if token else {},
        )

    # ---- state ----

    async def _power(self, device: StoredDevice) -> tuple[bool | None, bool]:
        """(on, confirmed). An unreachable TV is assumed off."""
        try:
            info = await self._info(device.host or "", timeout=2.5)
        except DeviceUnreachable:
            return False, False
        power = str(info.get("PowerState") or "").lower()
        if power in {"on", "standby"}:
            return power == "on", True
        return True, False

    async def get_state(self, device: StoredDevice) -> DeviceState:
        on, confirmed = await self._power(device)
        return _state(on, confirmed=confirmed)

    async def execute_command(self, device: StoredDevice, command: str, params: dict[str, Any]) -> CommandOutcome:
        if command == "turn_on":
            on, confirmed = await self._power(device)
            if on and confirmed:
                return CommandOutcome(result=CommandResult(status="confirmed", message="The TV is already on."), state=_state(True, confirmed=True))
            if confirmed:  # in standby, reachable: the power key wakes it
                await self._send(device, "KEY_POWER")
            elif device.mac:
                await _lan.wake_on_lan(device.mac)
            else:
                raise UnsupportedCommand("The TV's MAC address is unknown, so it cannot be woken. Turn it on with its remote.")
            return CommandOutcome(
                result=CommandResult(status="assumed", message="Sent. The TV does not confirm power-on."), state=_state(True, confirmed=False)
            )
        if command == "turn_off":
            on, confirmed = await self._power(device)
            if confirmed and not on:
                return CommandOutcome(result=CommandResult(status="confirmed", message="The TV is already off."), state=_state(False, confirmed=True))
            await self._send(device, "KEY_POWER")
            return CommandOutcome(
                result=CommandResult(status="assumed", message="Sent. The TV does not confirm power-off."), state=_state(False, confirmed=False)
            )
        if command in KEYS:
            await self._send(device, KEYS[command])
            on, confirmed = await self._power(device)
            return CommandOutcome(
                result=CommandResult(status="assumed", message="Key sent. The TV does not report the result."), state=_state(on, confirmed=confirmed)
            )
        raise UnsupportedCommand(f"Samsung TVs do not support {command} over the local API.")

    async def disconnect(self, device: StoredDevice) -> None:
        remote = self._remotes.pop(device.id, None)
        if remote is not None:
            with contextlib.suppress(Exception):
                await remote.close()
