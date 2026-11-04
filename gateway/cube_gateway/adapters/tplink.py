"""TP-Link Kasa and Tapo plugs, power strips, switches and bulbs, with python-kasa.

python-kasa speaks both local protocols:
- the legacy Kasa protocol (XOR-obfuscated JSON on TCP 9999): no authentication;
- KLAP / AES (Tapo and newer Kasa firmware, HTTP on port 80): authenticated with the user's TP-Link
  account email and password. The gateway uses them only for that local handshake and never sends them
  to TP-Link.

Discovery is python-kasa's UDP broadcast on ports 9999 and 20002. `wifi_join()` below is the legacy
protocol's set_stainfo call, used by the kasa_softap provisioning plugin while the gateway is on the
device's own setup network.
"""

from __future__ import annotations

import asyncio
import contextlib
from typing import Any

from kasa import (
    AuthenticationError,
    Credentials,
    Device,
    DeviceConfig,
    DeviceConnectionParameters,
    DeviceEncryptionType,
    DeviceType,
    Discover,
    KasaException,
    Module,
)
from kasa import TimeoutError as KasaTimeout
from kasa.exceptions import DeviceError

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
    NotSupported,
    PairResult,
    ScanContext,
    StoredDevice,
    UnsupportedCommand,
    make_candidate,
    normalize_mac,
)

ACCOUNT_NOTE = (
    "This device authenticates with your TP-Link (Kasa / Tapo) account. The gateway uses the email and password "
    "only for the handshake with the device on your network and never sends them to TP-Link."
)


def _safe(getter: Any, default: Any = None) -> Any:
    """python-kasa raises for attributes that need an update() the device has not had yet."""
    try:
        value = getter()
    except Exception:  # noqa: BLE001
        return default
    return default if value is None else value


def _category(device_type: Any) -> Category:
    return {
        DeviceType.Bulb: Category.LIGHT,
        DeviceType.LightStrip: Category.LIGHT,
        DeviceType.Dimmer: Category.LIGHT,
        DeviceType.Plug: Category.PLUG,
        DeviceType.Strip: Category.PLUG,
        DeviceType.StripSocket: Category.PLUG,
        DeviceType.WallSwitch: Category.SWITCH,
        DeviceType.Fan: Category.FAN,
        DeviceType.Camera: Category.CAMERA,
        DeviceType.Sensor: Category.SENSOR,
    }.get(device_type, Category.OTHER)


def _map_error(error: Exception, host: str) -> AdapterError:
    if isinstance(error, AuthenticationError):
        return AuthRequired("The device rejected the TP-Link account credentials.", code="device_auth_failed", recovery=ACCOUNT_NOTE)
    if isinstance(error, KasaTimeout | TimeoutError | OSError):
        return DeviceUnreachable(f"The TP-Link device at {host} did not answer.")
    if isinstance(error, DeviceError):
        return AdapterError("The TP-Link device refused the request.", code="device_rejected")
    if isinstance(error, KasaException):
        return DeviceUnreachable(f"Could not talk to the TP-Link device at {host}.")
    return AdapterError("Unexpected error from the TP-Link library.", code="adapter_error")


class TplinkAdapter(DeviceAdapter):
    info = AdapterInfo(
        id="tplink",
        name="TP-Link Kasa / Tapo (python-kasa)",
        brands=["tplink"],
        protocols=["kasa-legacy-9999", "tplink-klap", "tplink-aes"],
        discovery=["udp-broadcast"],
        categories=[Category.PLUG, Category.SWITCH, Category.LIGHT],
        status=SupportLevel.SUPPORTED,
        account_free=True,
        auth=AuthKind.NONE,
        library="python-kasa",
        notes=[
            "Kasa devices on the legacy protocol need no account.",
            "Tapo and newer Kasa firmware authenticate with your TP-Link account; it is used locally only.",
        ],
    )
    poll_interval = 15
    call_timeout = 15.0

    def __init__(self, ctx):
        super().__init__(ctx)
        self.discovery_targets: list[str] | None = None
        self._devices: dict[str, Device] = {}
        self._locks: dict[str, asyncio.Lock] = {}

    async def stop(self) -> None:
        for device in list(self._devices.values()):
            with contextlib.suppress(Exception):
                await device.disconnect()
        self._devices.clear()

    # ---- discovery ----

    async def discover(self, scan: ScanContext) -> None:
        targets = self.discovery_targets or [ip for ip, _port in _lan.broadcast_targets(scan, 9999)]
        duration = max(1, int(_lan.window(scan)))
        work = asyncio.gather(*(Discover.discover(target=target, discovery_timeout=duration) for target in targets), return_exceptions=True)
        stop = asyncio.ensure_future(scan.cancelled.wait())
        done, _pending = await asyncio.wait({work, stop}, return_when=asyncio.FIRST_COMPLETED)
        stop.cancel()
        if work not in done:
            work.cancel()
            return
        seen: set[str] = set()
        for result in work.result():
            if isinstance(result, BaseException):
                self.log.debug("kasa discovery failed", extra={"reason": repr(result)})
                continue
            for ip, device in result.items():
                try:
                    if ip in seen or not scan.in_scope(ip):
                        continue
                    seen.add(ip)
                    _lan.report(scan, self._candidate(device, ip, "udp-broadcast"))
                finally:
                    with contextlib.suppress(Exception):
                        await device.disconnect()

    def _candidate(self, device: Device, ip: str, source: str) -> Candidate:
        connection = device.config.connection_type
        legacy = connection.encryption_type == DeviceEncryptionType.Xor
        mac = normalize_mac(_safe(lambda: device.mac))
        device_type = _safe(lambda: device.device_type, DeviceType.Unknown)
        model = _safe(lambda: device.model)
        candidate = make_candidate(
            self,
            (mac or ip).replace(":", ""),
            name=_safe(lambda: device.alias) or f"TP-Link {model or 'device'}",
            model=model,
            ip=ip,
            port=device.config.port_override or (9999 if legacy else 80),
            mac=mac,
            protocol="kasa-legacy-9999" if legacy else f"tplink-{connection.encryption_type.value.lower()}",
            sources=[source],
            details={
                "connection_type": connection.to_dict(),
                "port_override": device.config.port_override,
                "needs_credentials": not legacy,
                "device_type": getattr(device_type, "value", str(device_type)),
            },
        )
        candidate.status = ConnectionStatus.IDENTIFIED if legacy else ConnectionStatus.LOCAL_AUTHORIZATION_REQUIRED
        candidate.account_free = legacy
        candidate.pairing = self.get_pairing_requirements(candidate)
        return candidate

    async def probe(self, host: str) -> Candidate | None:
        try:
            device = await Discover.discover_single(host, discovery_timeout=3)
        except (KasaException, OSError, TimeoutError):
            return None
        if device is None:
            return None
        try:
            return self._candidate(device, host, "manual")
        finally:
            with contextlib.suppress(Exception):
                await device.disconnect()

    def get_pairing_requirements(self, candidate: Candidate) -> PairingRequirements:
        if not candidate.details.get("needs_credentials"):
            return PairingRequirements(auth=AuthKind.NONE, instructions="This Kasa device needs no account or password.")
        return PairingRequirements(
            auth=AuthKind.ACCOUNT_CREDENTIALS,
            manufacturer_account=True,
            fields=[
                FieldSpec(name="username", label="TP-Link account email", help="The email you use in the Kasa or Tapo app"),
                FieldSpec(name="password", label="TP-Link account password", kind="password", secret=True),
            ],
            instructions=ACCOUNT_NOTE,
        )

    # ---- connection ----

    def _config(self, host: str, params: dict[str, Any], credentials: dict[str, Any]) -> DeviceConfig:
        connection = params.get("connection_type")
        # No stored connection type means the legacy protocol, DeviceConfig's default.
        config = DeviceConfig(host=host, timeout=5, port_override=params.get("port_override"))
        if connection:
            config.connection_type = DeviceConnectionParameters.from_dict(connection)
        if credentials.get("username") and credentials.get("password"):
            config.credentials = Credentials(credentials["username"], credentials["password"])
        return config

    async def _connect(self, host: str, params: dict[str, Any], credentials: dict[str, Any]) -> Device:
        try:
            return await Device.connect(config=self._config(host, params, credentials))
        except Exception as error:  # noqa: BLE001 - mapped to user-facing errors
            raise _map_error(error, host) from error

    async def _live(self, device: StoredDevice) -> Device:
        live = self._devices.get(device.id)
        if live is None:
            live = await self._connect(device.host or "", device.params, device.credentials)
            self._devices[device.id] = live
            return live
        try:
            await live.update()
        except Exception as error:  # noqa: BLE001
            self._devices.pop(device.id, None)
            with contextlib.suppress(Exception):
                await live.disconnect()
            raise _map_error(error, device.host or "") from error
        return live

    # ---- pairing ----

    async def pair(self, candidate: Candidate, credentials: dict[str, str], approval: ApprovalCallback) -> PairResult:
        if not candidate.ip:
            raise DeviceUnreachable("No address for this TP-Link device; scan again.")
        creds = {k: credentials[k].strip() for k in ("username", "password") if credentials.get(k, "").strip()}
        params = {"connection_type": candidate.details.get("connection_type"), "port_override": candidate.details.get("port_override")}
        try:
            live = await self._connect(candidate.ip, params, creds)
        except AuthRequired as error:
            if not creds:
                raise AuthRequired("This device needs your TP-Link account to pair locally.", code="credentials_missing", recovery=ACCOUNT_NOTE) from error
            raise
        try:
            state = _state(live)
            category = _category(_safe(lambda: live.device_type, DeviceType.Unknown))
            if category == Category.OTHER and any(cap.type == "power" for cap in state.capabilities):
                category = Category.PLUG
            return PairResult(
                unique_id=candidate.unique_id,
                name=_safe(lambda: live.alias) or candidate.name or "TP-Link device",
                category=category,
                model=_safe(lambda: live.model) or candidate.model,
                host=candidate.ip,
                port=candidate.port,
                mac=normalize_mac(_safe(lambda: live.mac)) or candidate.mac,
                protocol=candidate.protocol,
                params={**params, "connection_type": live.config.connection_type.to_dict()},
                credentials=creds,
            )
        finally:
            with contextlib.suppress(Exception):
                await live.disconnect()

    # ---- state ----

    async def get_state(self, device: StoredDevice) -> DeviceState:
        return _state(await self._live(device))

    async def execute_command(self, device: StoredDevice, command: str, params: dict[str, Any]) -> CommandOutcome:
        lock = self._locks.setdefault(device.id, asyncio.Lock())
        async with lock:
            live = await self._live(device)
            try:
                await self._apply(live, command, params)
                await live.update()
            except AdapterError:
                raise
            except Exception as error:  # noqa: BLE001
                self._devices.pop(device.id, None)
                raise _map_error(error, device.host or "") from error
            return CommandOutcome(result=CommandResult(status="confirmed"), state=_state(live))

    async def _apply(self, live: Device, command: str, params: dict[str, Any]) -> None:
        light = live.modules.get(Module.Light) if Module.Light in live.modules else None
        if command in {"turn_on", "turn_off", "toggle"}:
            target: Any = live
            if live.children and _safe(lambda: live.device_type) == DeviceType.Strip:
                key = str(params.get("key") or "")
                index = int(key.split(":")[-1]) if key.startswith("power:") else int(params.get("channel") or 0)
                if not 0 <= index < len(live.children):
                    raise AdapterError("That outlet does not exist on this power strip.", code="bad_params")
                target = live.children[index]
            on = (not target.is_on) if command == "toggle" else command == "turn_on"
            await (target.turn_on() if on else target.turn_off())
        elif command == "set_brightness" and light and light.has_feature("brightness"):
            level = round(caps.clamp(caps.param(params, "brightness"), 0, 100, "brightness"))
            if level == 0:
                await live.turn_off()
            else:
                await light.set_brightness(level)
        elif command == "set_color" and light and light.has_feature("hsv"):
            h = round(caps.clamp(caps.param(params, "h"), 0, 360, "h")) % 360
            s = round(caps.clamp(caps.param(params, "s"), 0, 100, "s"))
            brightness = light.brightness if light.has_feature("brightness") else 100
            await light.set_hsv(h, s, brightness or 100)
        elif command == "set_color_temp" and light and light.has_feature("color_temp"):
            feature = light.get_feature("color_temp")
            low, high = (feature.minimum_value, feature.maximum_value) if feature else (2500, 6500)
            await light.set_color_temp(round(caps.clamp(caps.param(params, "kelvin"), low, high, "kelvin")))
        else:
            raise UnsupportedCommand(f"This TP-Link device does not support {command}.")

    async def disconnect(self, device: StoredDevice) -> None:
        live = self._devices.pop(device.id, None)
        if live is not None:
            with contextlib.suppress(Exception):
                await live.disconnect()


def _state(live: Device) -> DeviceState:
    capabilities = []
    readings = []
    if live.children and _safe(lambda: live.device_type) == DeviceType.Strip:
        for index, child in enumerate(live.children):
            capabilities.append(
                caps.power(_safe(lambda child=child: child.is_on), key=f"power:{index}", label=_safe(lambda child=child: child.alias) or f"Outlet {index + 1}")
            )
    else:
        capabilities.append(caps.power(_safe(lambda: live.is_on)))
    if Module.Light in live.modules:
        light = live.modules[Module.Light]
        if light.has_feature("brightness"):
            capabilities.append(caps.brightness(_safe(lambda: light.brightness)))
        if light.has_feature("color_temp"):
            feature = light.get_feature("color_temp")
            low, high = (feature.minimum_value, feature.maximum_value) if feature else (2500, 6500)
            if high:
                capabilities.append(caps.color_temp(_safe(lambda: light.color_temp) or None, low, high))
        if light.has_feature("hsv"):
            hsv = _safe(lambda: light.hsv)
            capabilities.append(caps.color(hsv[0], hsv[1]) if hsv else caps.color(None, None))
    if Module.Energy in live.modules:
        energy = live.modules[Module.Energy]
        watts = _safe(lambda: energy.current_consumption)
        if watts is not None:
            readings.append(caps.reading("power_w", "Power", round(float(watts), 1), "W", "power"))
        today = _safe(lambda: energy.consumption_today)
        if today is not None:
            readings.append(caps.reading("energy_today_kwh", "Energy today", round(float(today), 3), "kWh", "energy"))
    return DeviceState(capabilities=capabilities, readings=readings, commands=caps.commands_for(capabilities))


async def wifi_join(host: str, ssid: str, password: str, *, timeout: float = 10.0) -> str:
    """Sends home Wi-Fi settings to a Kasa device on its setup network (legacy protocol only).

    Returns "accepted" when the device acknowledged, "no_response" when it dropped its hotspot before
    answering (common, and not proof of failure). Raises for a device that is not there, or one whose
    firmware needs a TP-Link account to be set up. Success is only known once the device appears on the
    home network.
    """
    try:
        device = await Discover.discover_single(host, discovery_timeout=5)
    except (KasaException, OSError, TimeoutError) as error:
        raise DeviceUnreachable(f"No Kasa device answered at {host}.") from error
    if device is None:
        raise DeviceUnreachable(f"No Kasa device answered at {host}.")
    try:
        if device.config.connection_type.encryption_type != DeviceEncryptionType.Xor:
            raise NotSupported(
                "This device's firmware needs a TP-Link account to join Wi-Fi.",
                recovery="Set it up with the Kasa or Tapo app, then find it here.",
            )
        try:
            await asyncio.wait_for(device.wifi_join(ssid, password), timeout=timeout)
        except DeviceError as error:
            raise AdapterError("The device refused the Wi-Fi settings.", code="device_rejected") from error
        except (KasaTimeout, KasaException, TimeoutError, OSError):
            return "no_response"
        return "accepted"
    finally:
        with contextlib.suppress(Exception):
            await device.disconnect()
