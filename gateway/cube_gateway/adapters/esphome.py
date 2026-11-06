"""ESPHome devices over their native API (TCP 6053), with aioesphomeapi. https://esphome.io/components/api/

ESPHome firmware is built per device from its owner's YAML, so there are no models here: a device offers
whatever it lists when connected, and the same plug can differ from one home to the next.

Discovery: mDNS `_esphomelib._tcp`. The TXT records (esphome/components/mdns/mdns_component.cpp) carry `mac`,
`friendly_name`, `board`, `project_name`, and `api_encryption` when the device has a key set, which is why the
app can ask for the key up front. `api_encryption_supported` means encryption is compiled in but no key is set.

Encryption: Noise with a pre-shared key, the base64 `api: encryption: key:` from the device's YAML, passed to
the client as `noise_psk`. Without one the client speaks plaintext. Pairing falls back to plaintext when a key is
offered to a device that does not use encryption, unless its advert said it does. After pairing a stored key is
never given up: a device that stops using encryption is refused, not downgraded to.

Connection: one client per device, kept open. Entities are listed on connect and the device then pushes every
state, so get_state() reads that cache and costs nothing while connected. There is no reconnect loop here:
DeviceManager's monitor keeps calling get_state(), which reconnects. Commands have no reply, so a result is
`confirmed` only once the device pushes the new state.

An entity's `key` is unique only within its sub-device: entities are told apart by (device_id, key), and every
command carries device_id. Capability keys are `power:<key>`, or `power:<device_id>.<key>` on a sub-device.
"""

from __future__ import annotations

import asyncio
import base64
import binascii
import contextlib
import math
import time
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from functools import partial
from typing import Any

from aioesphomeapi import (
    APIClient,
    APIConnectionError,
    BinarySensorInfo,
    ClimateFeature,
    ClimateInfo,
    ClimateMode,
    ClimateState,
    ColorMode,
    CoverInfo,
    CoverOperation,
    EncryptionHelloAPIError,
    EncryptionPlaintextAPIError,
    EntityCategory,
    FanInfo,
    InvalidAuthAPIError,
    InvalidEncryptionKeyAPIError,
    LightColorCapability,
    LightInfo,
    RequiresEncryptionAPIError,
    SensorInfo,
    SwitchInfo,
    TemperatureUnit,
)

from ..models import (
    AdapterInfo,
    AuthKind,
    Candidate,
    Capability,
    Category,
    CommandResult,
    ConnectionStatus,
    FieldSpec,
    PairingRequirements,
    Reading,
    SupportLevel,
    clean_text,
)
from . import _lan, caps
from .base import (
    AdapterError,
    ApprovalCallback,
    AuthRequired,
    CommandOutcome,
    DeviceAdapter,
    DeviceState,
    DeviceUnreachable,
    LocalKeyRequired,
    PairResult,
    ScanContext,
    StateCallback,
    StoredDevice,
    UnsupportedCommand,
    make_candidate,
    normalize_mac,
)

SERVICE = "_esphomelib._tcp.local."
PROTOCOL = "esphome-native-api"
PORT = 6053
CLIENT_INFO = "CUBE Gateway"
KEY_FIELD = "local_key"

#: One connection attempt in normal running; two of these plus an mDNS lookup must fit in call_timeout.
CONNECT_TIMEOUT = 10.0
#: Pairing can wait: the library has seen 30 s handshakes on an ESP8266 with weak Wi-Fi.
PAIR_TIMEOUT = 45.0
#: The discovery engine gives probe() 8 s in all.
PROBE_TIMEOUT = 3.0
DISCONNECT_TIMEOUT = 3.0
#: How long the device gets to send its first states. Sensors with no value yet may never send one.
FIRST_STATE_TIMEOUT = 3.0
SETTLE_STEPS = 15
SETTLE_DELAY = 0.1
#: Several entities often change together; they reach the app as one update.
PUSH_DELAY = 0.3

MAX_ENTITIES = 64
MAX_OPTIONS = 24
MIREDS = 1_000_000

CONTROLS = (SwitchInfo, LightInfo, CoverInfo, FanInfo, ClimateInfo)
READINGS = (SensorInfo, BinarySensorInfo)
POWERED = (SwitchInfo, LightInfo, FanInfo, ClimateInfo)

BRIGHTNESS = LightColorCapability.BRIGHTNESS
RGB = LightColorCapability.RGB
WHITE_TEMPERATURE = LightColorCapability.COLOR_TEMPERATURE | LightColorCapability.COLD_WARM_WHITE

#: Combined modes drive the colour and white channels together, so choosing a colour has to turn the white off.
NO_WHITE: dict[int, dict[str, float]] = {
    ColorMode.RGB_WHITE: {"white": 0.0},
    ColorMode.RGB_COLOR_TEMPERATURE: {"white": 0.0},
    ColorMode.RGB_COLD_WARM_WHITE: {"cold_white": 0.0, "warm_white": 0.0},
}
UNITS = {TemperatureUnit.CELSIUS: "°C", TemperatureUnit.FAHRENHEIT: "°F", TemperatureUnit.KELVIN: "K"}

Check = Callable[[Any], bool]


class _NotEncrypted(DeviceUnreachable):
    """A key was offered, and the device answered without encryption."""


@dataclass
class _Session:
    """One device's connection. It outlives reconnects, so an event subscription survives them."""

    host: str
    port: int
    key: str | None = None
    mac: str | None = None
    #: The address in the registry. `host` differs from it after a move, until the registry catches up.
    stored_host: str | None = None
    client: Any = None
    api_version: Any = None
    info: Any = None
    sub_devices: dict[int, str] = field(default_factory=dict)
    entities: dict[str, Any] = field(default_factory=dict)
    states: dict[str, Any] = field(default_factory=dict)
    last_mode: dict[str, ClimateMode] = field(default_factory=dict)
    callback: StateCallback | None = None
    push_task: asyncio.Task | None = None
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)


# ---- reading what the device sent ------------------------------------------------------------------


def _ref(item: Any) -> str:
    """An entity or state's identity on this device, as used in capability keys."""
    return f"{item.device_id}.{item.key}" if item.device_id else str(item.key)


def _known(state: Any) -> Any:
    return None if state is None or getattr(state, "missing_state", False) else state


def _number(value: float | None, digits: int | None = None) -> float | None:
    """A float from the device, which sends NaN for "no value"."""
    if value is None or not math.isfinite(value):
        return None
    return value if digits is None else round(value, digits)


def _ratio(value: float | None) -> float | None:
    number = _number(value)
    return None if number is None else max(0.0, min(1.0, number))


def _options(values: Iterable[str]) -> list[str]:
    return [text for value in list(values)[:MAX_OPTIONS] if (text := clean_text(value))]


def _pick(values: Iterable[str], chosen: str) -> str | None:
    """The device's own spelling of an option the app chose from the cleaned list."""
    return next((value for value in values if clean_text(value) == chosen), None)


def _usable(entity: Any) -> bool:
    """Entities a resident should see. A `config` switch may be the firmware's factory reset or restart."""
    if entity.disabled_by_default:
        return False
    if isinstance(entity, CONTROLS):
        return entity.entity_category == EntityCategory.NONE
    return isinstance(entity, READINGS)


def _label(session: _Session, entity: Any) -> str:
    name = clean_text(entity.name) or clean_text(getattr(session.info, "friendly_name", None)) or "ESPHome"
    sub_device = session.sub_devices.get(entity.device_id)
    return f"{sub_device} {name}" if sub_device else name


def _color_modes(session: _Session, entity: Any) -> list[int]:
    return list(entity.supported_color_modes_compat(session.api_version))


def _light_features(session: _Session, entity: Any) -> int:
    features = 0
    for mode in _color_modes(session, entity):
        features |= int(mode)
    return features


def _kelvin_range(entity: Any) -> tuple[int, int] | None:
    if not entity.min_mireds > 0 or not entity.max_mireds > entity.min_mireds:
        return None
    return round(MIREDS / entity.max_mireds), round(MIREDS / entity.min_mireds)


def _temperature_range(entity: Any) -> tuple[float, float]:
    low, high = entity.visual_min_temperature, entity.visual_max_temperature
    return (low, high) if high > low else (16, 30)


def _climate_flags(session: _Session, entity: Any) -> int:
    return entity.supported_feature_flags_compat(session.api_version)


def _target_temperature(state: Any, flags: int) -> float | None:
    if flags & ClimateFeature.REQUIRES_TWO_POINT_TARGET_TEMPERATURE:
        low, high = _number(state.target_temperature_low), _number(state.target_temperature_high)
        return None if low is None or high is None else (low + high) / 2
    return _number(state.target_temperature)


def _is_on(entity: Any, state: Any) -> bool | None:
    state = _known(state)
    if state is None:
        return None
    if isinstance(entity, ClimateInfo):
        return state.mode not in (None, ClimateMode.OFF)
    return bool(state.state)


# ---- capabilities ----------------------------------------------------------------------------------


def _light_caps(session: _Session, ref: str, entity: Any, state: Any, label: str) -> list[Capability]:
    seen = state is not None
    features = _light_features(session, entity)
    found = [caps.power(state.state if seen else None, key=f"light:{ref}", label=label, confirmed=seen)]
    if features & BRIGHTNESS:
        level = _ratio(state.brightness) if seen else None
        found.append(caps.brightness(None if level is None else level * 100, key=f"brightness:{ref}", confirmed=seen))
    if features & RGB:
        h, s = None, None
        if seen and state.color_mode & RGB:
            red, green, blue = (_ratio(c) or 0.0 for c in (state.red, state.green, state.blue))
            h, s = caps.rgb_to_hs(round(red * 255), round(green * 255), round(blue * 255))
        found.append(caps.color(h, s, key=f"color:{ref}", confirmed=seen))
    span = _kelvin_range(entity)
    if features & WHITE_TEMPERATURE and span:
        mireds = _number(state.color_temperature) if seen else None
        kelvin = MIREDS / mireds if mireds and mireds > 0 else None
        found.append(caps.color_temp(kelvin, *span, key=f"color_temp:{ref}", confirmed=seen))
    return found


def _cover_cap(ref: str, entity: Any, state: Any, label: str) -> Capability:
    seen = state is not None
    position = _ratio(state.position) if seen else None
    moving = {CoverOperation.IS_OPENING: "opening", CoverOperation.IS_CLOSING: "closing"}
    text = None
    if seen:
        text = moving.get(state.current_operation) or ("open" if position else "closed")
    return Capability(
        key=f"cover:{ref}",
        type="cover",
        label=label,
        state=text,
        position=round(position * 100) if position is not None and entity.supports_position else None,
        confirmed=seen and not entity.assumed_state,
        updated_at=time.time(),
    )


def _fan_caps(ref: str, entity: Any, state: Any, label: str) -> list[Capability]:
    seen = state is not None
    found = [caps.power(state.state if seen else None, key=f"fan_power:{ref}", label=label, confirmed=seen)]
    presets = _options(entity.supported_preset_modes)
    if entity.supports_speed or presets:
        count = entity.supported_speed_count
        percentage = round(state.speed_level * 100 / count) if seen and entity.supports_speed and count else None
        preset = clean_text(state.preset_mode) if seen else None
        fan = caps.fan(percentage, presets=presets, preset=preset, key=f"fan:{ref}", confirmed=seen)
        found.append(fan.model_copy(update={"label": label}))
    return found


def _climate_cap(session: _Session, ref: str, entity: Any, state: Any, label: str) -> Capability:
    flags = _climate_flags(session, entity)
    fan_modes = [mode.name.lower() for mode in entity.supported_fan_modes] + _options(entity.supported_custom_fan_modes)
    current = target = mode = fan_mode = None
    if state is not None:
        current = _number(state.current_temperature) if flags & ClimateFeature.SUPPORTS_CURRENT_TEMPERATURE else None
        target = _target_temperature(state, flags)
        mode = state.mode.name.lower() if state.mode is not None else None
        if fan_modes:
            fan_mode = clean_text(state.custom_fan_mode) or (state.fan_mode.name.lower() if state.fan_mode is not None else None)
    low, high = _temperature_range(entity)
    step = entity.visual_target_temperature_step
    capability = caps.climate(
        current=current,
        target=target,
        mode=mode,
        modes=[item.name.lower() for item in entity.supported_modes],
        fan_mode=fan_mode,
        fan_modes=fan_modes,
        low=low,
        high=high,
        step=step if step > 0 else 0.5,
        unit=UNITS.get(entity.temperature_unit, "°C"),
        key=f"climate:{ref}",
        confirmed=state is not None,
    )
    return capability.model_copy(update={"label": label})


def _reading(ref: str, entity: Any, state: Any, label: str) -> Reading:
    device_class = clean_text(entity.device_class, 40)
    if isinstance(entity, BinarySensorInfo):
        return caps.reading(f"binary:{ref}", label, state.state if state else None, None, device_class)
    value = _number(state.state, entity.accuracy_decimals) if state else None
    return caps.reading(f"sensor:{ref}", label, value, clean_text(entity.unit_of_measurement, 16), device_class)


def _commands(session: _Session, capabilities: list[Capability]) -> list[str]:
    commands = caps.commands_for(capabilities)
    entities = list(session.entities.values())
    covers = [entity for entity in entities if isinstance(entity, CoverInfo)]
    fans = [entity for entity in entities if isinstance(entity, FanInfo)]
    if covers:
        commands += ["cover_open", "cover_close"]
        if any(cover.supports_stop for cover in covers):
            commands.append("cover_stop")
        if any(cover.supports_position for cover in covers):
            commands.append("set_position")
    if "set_fan_speed" in commands and not any(fan.supports_speed for fan in fans):
        commands.remove("set_fan_speed")
    if any(fan.supported_preset_modes for fan in fans) and "set_fan_mode" not in commands:
        commands.append("set_fan_mode")
    return commands


def _device_state(session: _Session, *, online: bool = True) -> DeviceState:
    capabilities: list[Capability] = []
    readings: dict[str, Reading] = {}
    for ref, entity in session.entities.items():
        state = _known(session.states.get(ref))
        label = _label(session, entity)
        if isinstance(entity, SwitchInfo):
            value = state.state if state else None
            capabilities.append(caps.power(value, key=f"power:{ref}", label=label, confirmed=state is not None and not entity.assumed_state))
        elif isinstance(entity, LightInfo):
            capabilities += _light_caps(session, ref, entity, state, label)
        elif isinstance(entity, CoverInfo):
            capabilities.append(_cover_cap(ref, entity, state, label))
        elif isinstance(entity, FanInfo):
            capabilities += _fan_caps(ref, entity, state, label)
        elif isinstance(entity, ClimateInfo):
            capabilities.append(_climate_cap(session, ref, entity, state, label))
            if state and _climate_flags(session, entity) & ClimateFeature.SUPPORTS_CURRENT_HUMIDITY:
                # The app's climate screen looks humidity up by this key.
                readings.setdefault("current_humidity", caps.reading("current_humidity", "Humidity", _number(state.current_humidity), "%", "humidity"))
        else:
            reading = _reading(ref, entity, state, label)
            readings[reading.key] = reading
    if not online:
        capabilities = [capability.model_copy(update={"confirmed": False}) for capability in capabilities]
    return DeviceState(capabilities=capabilities, readings=list(readings.values()), commands=_commands(session, capabilities), online=online, host=session.host)


def _category(entities: Iterable[Any]) -> Category:
    entities = list(entities)
    for kind, category in ((ClimateInfo, Category.CLIMATE), (CoverInfo, Category.COVER), (FanInfo, Category.FAN), (LightInfo, Category.LIGHT)):
        if any(isinstance(entity, kind) for entity in entities):
            return category
    switches = [entity for entity in entities if isinstance(entity, SwitchInfo)]
    if not switches:
        return Category.SENSOR
    return Category.PLUG if all(switch.device_class == "outlet" for switch in switches) else Category.SWITCH


# ---- errors and keys -------------------------------------------------------------------------------


def _translate(error: BaseException) -> AdapterError:
    """The library's text can carry what the device sent, so residents get a fixed sentence instead."""
    if isinstance(error, InvalidEncryptionKeyAPIError):
        return LocalKeyRequired("This ESPHome device rejected the encryption key. Check it and try again.", code="local_key_invalid")
    if isinstance(error, RequiresEncryptionAPIError):
        return LocalKeyRequired("This ESPHome device encrypts its connection. Enter its API encryption key.")
    if isinstance(error, EncryptionPlaintextAPIError | EncryptionHelloAPIError):
        return _NotEncrypted(
            "This ESPHome device is not using encryption, though it was added with a key.",
            code="encryption_mismatch",
            recovery="Add the device again, or turn encryption back on in its configuration.",
        )
    if isinstance(error, InvalidAuthAPIError):
        return AuthRequired(
            "This ESPHome device uses an API password, which CUBE does not support.",
            code="device_auth_failed",
            recovery="Update its firmware and replace the password with an encryption key.",
        )
    return DeviceUnreachable("The ESPHome device did not answer.")


def _valid_key(value: str | None) -> str | None:
    key = (value or "").strip()
    if not key:
        return None
    try:
        valid = len(base64.b64decode(key, validate=True)) == 32
    except (binascii.Error, ValueError):
        valid = False
    if not valid:
        raise LocalKeyRequired("That is not an ESPHome encryption key. It has 44 characters and ends in =.", code="local_key_invalid")
    return key


# ---- the adapter -----------------------------------------------------------------------------------


class EsphomeAdapter(DeviceAdapter):
    info = AdapterInfo(
        id="esphome",
        name="ESPHome (native API)",
        brands=["esphome"],
        protocols=[PROTOCOL],
        discovery=["mdns"],
        categories=[Category.SWITCH, Category.PLUG, Category.LIGHT, Category.COVER, Category.FAN, Category.CLIMATE, Category.SENSOR],
        status=SupportLevel.EXPERIMENTAL,
        account_free=True,
        auth=AuthKind.LOCAL_KEY,
        push_updates=True,
        library="aioesphomeapi",
        verified_models=[],
        notes=[
            "ESPHome firmware is built per device, so the controls shown are whatever that device's configuration defines.",
            "If the device has an API encryption key, enter it when pairing: it is the api: encryption: key value in the device's YAML.",
            "Not shown: buttons, numbers, selects, text sensors, locks, valves, media players, cameras, and entities marked as configuration or disabled.",
            "Battery devices that deep-sleep appear offline while they sleep.",
            "Not yet tested on real hardware.",
        ],
    )
    mdns_types = (SERVICE,)
    #: Reads the pushed cache while connected; a poll only does work when the connection is down.
    poll_interval = 15
    call_timeout = 25.0

    def __init__(self, ctx):
        super().__init__(ctx)
        self._sessions: dict[str, _Session] = {}
        self.client_factory = APIClient

    async def stop(self) -> None:
        for session in list(self._sessions.values()):
            await self._close(session)
        self._sessions.clear()

    # ---- discovery ----

    async def discover(self, scan: ScanContext) -> None:
        await scan.wait_passive()
        for record in scan.mdns_of(SERVICE):
            if not scan.in_scope(record.ip):
                continue
            txt = record.properties
            mac = normalize_mac(txt.get("mac"))
            _lan.report(
                scan,
                self._candidate(
                    mac.replace(":", "") if mac else record.name,
                    name=txt.get("friendly_name") or record.name,
                    model=txt.get("project_name") or txt.get("board"),
                    ip=record.ip,
                    port=record.port,
                    mac=mac,
                    source="mdns",
                    encrypted="api_encryption" in txt,
                ),
            )

    def _candidate(self, unique_id: str, *, name: str, model: str | None, ip: str, port: int, mac: str | None, source: str, encrypted: bool) -> Candidate:
        candidate = make_candidate(
            self,
            unique_id,
            name=name,
            model=model,
            ip=ip,
            port=port,
            mac=mac,
            protocol=PROTOCOL,
            sources=[source],
            details={"encryption": "required" if encrypted else "none"},
        )
        candidate.status = ConnectionStatus.LOCAL_KEY_REQUIRED if encrypted else ConnectionStatus.IDENTIFIED
        candidate.pairing = self.get_pairing_requirements(candidate)
        return candidate

    async def probe(self, host: str) -> Candidate | None:
        session = _Session(host=host, port=PORT)
        try:
            await self._open(session, PROBE_TIMEOUT)
        except LocalKeyRequired:
            # Only an ESPHome device answers a hello that way. An address typed by hand has no MAC until pairing.
            return self._candidate(f"ip-{host}", name="ESPHome device", model=None, ip=host, port=PORT, mac=None, source="manual", encrypted=True)
        except AdapterError:
            return None
        try:
            info = session.info
            mac = normalize_mac(info.mac_address)
            return self._candidate(
                mac.replace(":", "") if mac else f"ip-{host}",
                name=info.friendly_name or info.name or "ESPHome device",
                model=info.project_name or info.model,
                ip=host,
                port=PORT,
                mac=mac,
                source="manual",
                encrypted=False,
            )
        finally:
            await self._close(session)

    def get_pairing_requirements(self, candidate: Candidate) -> PairingRequirements:
        if candidate.details.get("encryption") != "required":
            return PairingRequirements(auth=AuthKind.NONE, instructions="This device does not ask for an encryption key.")
        key = FieldSpec(
            name=KEY_FIELD,
            label="API encryption key",
            kind="password",
            secret=True,
            help="The api: encryption: key value in this device's ESPHome configuration.",
            pattern=r"^[A-Za-z0-9+/]{43}=$",
        )
        return PairingRequirements(
            auth=AuthKind.LOCAL_KEY,
            fields=[key],
            instructions="This device encrypts its connection. Whoever built its firmware has the key.",
        )

    # ---- pairing ----

    async def pair(self, candidate: Candidate, credentials: dict[str, str], approval: ApprovalCallback) -> PairResult:
        try:
            return await self._pair(candidate, credentials)
        except LocalKeyRequired:
            # After this the app asks for get_pairing_requirements(), which must offer the key whatever the scan showed.
            candidate.details["encryption"] = "required"
            raise

    async def _pair(self, candidate: Candidate, credentials: dict[str, str]) -> PairResult:
        if not candidate.ip:
            raise DeviceUnreachable("No address for this ESPHome device; scan again.")
        session = _Session(host=candidate.ip, port=candidate.port or PORT, key=_valid_key(credentials.get(KEY_FIELD)))
        try:
            try:
                await self._open(session, PAIR_TIMEOUT)
            except _NotEncrypted:
                if candidate.details.get("encryption") == "required":
                    raise
                self.log.info("device does not use encryption; pairing without the key")
                session.key = None
                await self._open(session, PAIR_TIMEOUT)
            await self._first_states(session)
            if not session.entities:
                raise AdapterError("This ESPHome device has nothing CUBE can show or control.", code="no_entities", recovery="Add a switch, light or sensor to its configuration.")
            if not session.states:
                raise DeviceUnreachable("The ESPHome device connected but sent no state.")
            info = session.info
            mac = normalize_mac(info.mac_address)
            return PairResult(
                unique_id=mac.replace(":", "") if mac else candidate.unique_id,
                name=clean_text(info.friendly_name) or clean_text(info.name) or candidate.name or "ESPHome device",
                category=_category(session.entities.values()),
                model=clean_text(info.project_name) or clean_text(info.model) or candidate.model,
                host=session.host,
                port=session.port,
                mac=mac or candidate.mac,
                protocol=PROTOCOL,
                params={"mdns_name": info.name, "esphome_version": clean_text(info.esphome_version), "encrypted": bool(session.key)},
                credentials={KEY_FIELD: session.key} if session.key else {},
            )
        finally:
            await self._close(session)

    # ---- connection ----

    async def _open(self, session: _Session, timeout: float) -> None:
        """Connects, lists the entities and subscribes to their states. Raises AdapterError; never leaves a socket open."""
        client = self.client_factory(session.host, session.port, None, client_info=CLIENT_INFO, noise_psk=session.key)

        async def on_stop(expected: bool) -> None:
            await self._dropped(session, client, expected)

        try:
            # login=True is what completes authentication: reboot_timeout counts only clients that did.
            await asyncio.wait_for(client.connect(on_stop=on_stop, login=True, log_errors=False), timeout)
            info, entities, _services = await asyncio.wait_for(client.device_info_and_list_entities(), timeout)
            mac = normalize_mac(info.mac_address)
            if session.mac and mac != session.mac:
                raise DeviceUnreachable("A different device now answers at this ESPHome device's address.")
            session.client, session.api_version, session.info, session.mac = client, client.api_version, info, mac
            session.sub_devices = {sub.device_id: text for sub in info.devices if (text := clean_text(sub.name))}
            session.entities = {_ref(entity): entity for entity in [e for e in entities if _usable(e)][:MAX_ENTITIES]}
            session.states = {}
            client.subscribe_states(partial(self._on_state, session, client))
        except (APIConnectionError, TimeoutError, OSError) as error:
            client.force_disconnect()
            if session.client is client:
                session.client = None
            # The type only: a library message can quote the device.
            self.log.info("connection failed", extra={"adapter": self.info.id, "reason": type(error).__name__})
            raise _translate(error) from error
        except BaseException:
            client.force_disconnect()
            raise

    async def _first_states(self, session: _Session) -> None:
        loop = asyncio.get_running_loop()
        deadline = loop.time() + FIRST_STATE_TIMEOUT
        while session.client is not None and session.states.keys() < session.entities.keys() and loop.time() < deadline:
            await asyncio.sleep(0.05)

    async def _close(self, session: _Session) -> None:
        if session.push_task:
            session.push_task.cancel()
        client, session.client = session.client, None
        if client is None:
            return
        with contextlib.suppress(APIConnectionError, TimeoutError, OSError):
            await asyncio.wait_for(client.disconnect(), DISCONNECT_TIMEOUT)
        client.force_disconnect()

    def _session(self, device: StoredDevice) -> _Session:
        session = self._sessions.get(device.id)
        if session is None:
            session = _Session(host=device.host or "", port=device.port or PORT, key=device.credentials.get(KEY_FIELD), mac=device.mac, stored_host=device.host)
            self._sessions[device.id] = session
        return session

    async def _connected(self, device: StoredDevice) -> _Session:
        session = self._session(device)
        async with session.lock:
            key = device.credentials.get(KEY_FIELD)
            if key != session.key:  # paired again with another key
                await self._close(session)
                session.key = key
            if device.host != session.stored_host:
                session.host, session.stored_host, session.port = device.host or "", device.host, device.port or PORT
            if session.client is None:
                try:
                    await self._open(session, CONNECT_TIMEOUT)
                except DeviceUnreachable:
                    if not await self._moved(session, device):
                        raise
                    await self._open(session, CONNECT_TIMEOUT)
                await self._first_states(session)
        return session

    async def _moved(self, session: _Session, device: StoredDevice) -> bool:
        """DHCP may have given the device a new address, which its mDNS name still finds. _open() checks the MAC."""
        name = device.params.get("mdns_name")
        record = await self.ctx.mdns.resolve(SERVICE, name) if self.ctx.mdns and name else None
        if record is None or record.ip == session.host:
            return False
        session.host, session.port = record.ip, record.port
        return True

    def _on_state(self, session: _Session, client: Any, state: Any) -> None:
        ref = _ref(state)
        if session.client is not client or ref not in session.entities or session.states.get(ref) == state:
            return
        session.states[ref] = state
        if isinstance(state, ClimateState) and state.mode not in (None, ClimateMode.OFF):
            session.last_mode[ref] = state.mode
        if session.callback and (session.push_task is None or session.push_task.done()):
            session.push_task = asyncio.create_task(self._push_soon(session))

    async def _push_soon(self, session: _Session) -> None:
        await asyncio.sleep(PUSH_DELAY)
        await self._push(session)

    async def _push(self, session: _Session) -> None:
        callback = session.callback
        if callback is None:
            return
        try:
            await callback(_device_state(session, online=session.client is not None))
        except Exception:  # noqa: BLE001 - a failed update must not take the connection's task with it
            self.log.exception("state update failed", extra={"adapter": self.info.id})

    async def _dropped(self, session: _Session, client: Any, expected: bool) -> None:
        if session.client is not client:
            return
        session.client = None
        if not expected:
            await self._push(session)

    # ---- state ----

    async def get_state(self, device: StoredDevice) -> DeviceState:
        return _device_state(await self._connected(device))

    async def subscribe_to_events(self, device: StoredDevice, callback: StateCallback):
        session = await self._connected(device)
        session.callback = callback

        async def unsubscribe() -> None:
            if session.callback is callback:
                session.callback = None

        return unsubscribe

    async def disconnect(self, device: StoredDevice) -> None:
        session = self._sessions.pop(device.id, None)
        if session is not None:
            await self._close(session)

    # ---- commands ----

    async def execute_command(self, device: StoredDevice, command: str, params: dict[str, Any]) -> CommandOutcome:
        session = await self._connected(device)
        try:
            entity, done = self._send(session, command, params)
        except APIConnectionError as error:
            raise DeviceUnreachable("Lost the connection to the ESPHome device.") from error
        settled = await self._settle(session, entity, done)
        if getattr(entity, "assumed_state", False):
            result = CommandResult(status="assumed", message="This device cannot report its real state.")
        else:
            result = CommandResult(status="confirmed" if settled else "pending")
        return CommandOutcome(result=result, state=_device_state(session, online=session.client is not None))

    async def _settle(self, session: _Session, entity: Any, done: Check) -> bool:
        """Waits briefly for the state the device pushes after a command."""
        ref = _ref(entity)
        for _ in range(SETTLE_STEPS):
            state = _known(session.states.get(ref))
            if state is not None and done(state):
                return True
            await asyncio.sleep(SETTLE_DELAY)
        return False

    def _send(self, session: _Session, command: str, params: dict[str, Any]) -> tuple[Any, Check]:
        """Sends one command, returning its entity and how to tell the device has applied it."""
        if command in {"turn_on", "turn_off", "toggle"}:
            return self._send_power(session, command, params)
        if command in {"set_brightness", "set_color", "set_color_temp"}:
            return self._send_light(session, command, params)
        if command in {"set_temperature", "set_hvac_mode"}:
            return self._send_climate(session, command, params)
        if command in {"set_fan_speed", "set_fan_mode"}:
            return self._send_fan(session, command, params)
        if command in {"cover_open", "cover_close", "cover_stop", "set_position"}:
            return self._send_cover(session, command, params)
        raise UnsupportedCommand(f"ESPHome devices do not support {command}.")

    def _send_power(self, session: _Session, command: str, params: dict[str, Any]) -> tuple[Any, Check]:
        entity = _target(session, params, POWERED)
        client, ref = session.client, _ref(entity)
        on = not _is_on(entity, session.states.get(ref)) if command == "toggle" else command == "turn_on"
        if isinstance(entity, SwitchInfo):
            client.switch_command(entity.key, on, device_id=entity.device_id)
        elif isinstance(entity, LightInfo):
            client.light_command(entity.key, state=on, device_id=entity.device_id)
        elif isinstance(entity, FanInfo):
            client.fan_command(entity.key, state=on, device_id=entity.device_id)
        else:
            client.climate_command(entity.key, mode=_climate_on_mode(session, ref, entity) if on else ClimateMode.OFF, device_id=entity.device_id)
        return entity, lambda state: _is_on(entity, state) == on

    def _send_light(self, session: _Session, command: str, params: dict[str, Any]) -> tuple[Any, Check]:
        entity = _target(session, params, (LightInfo,))
        client = session.client
        features = _light_features(session, entity)
        if command == "set_brightness":
            if not features & BRIGHTNESS:
                raise UnsupportedCommand("This light cannot dim.")
            level = round(caps.clamp(caps.param(params, "brightness"), 0, 100, "brightness"))
            if level == 0:
                client.light_command(entity.key, state=False, device_id=entity.device_id)
                return entity, lambda state: not state.state
            client.light_command(entity.key, state=True, brightness=level / 100, device_id=entity.device_id)
            return entity, lambda state: state.state and abs((_ratio(state.brightness) or 0) * 100 - level) <= 1
        if command == "set_color":
            if not features & RGB:
                raise UnsupportedCommand("This light has no colour.")
            h = caps.clamp(caps.param(params, "h"), 0, 360, "h")
            s = caps.clamp(caps.param(params, "s"), 0, 100, "s")
            rgb = tuple(channel / 255 for channel in caps.hs_to_rgb(h, s))
            mode = min(mode for mode in _color_modes(session, entity) if mode & RGB)
            client.light_command(entity.key, state=True, rgb=rgb, color_mode=mode, color_brightness=1.0, device_id=entity.device_id, **NO_WHITE.get(mode, {}))
            return entity, lambda state: state.state and state.color_mode & RGB and all(abs(sent - (_ratio(got) or 0)) < 0.02 for sent, got in zip(rgb, (state.red, state.green, state.blue), strict=True))
        span = _kelvin_range(entity)
        if not features & WHITE_TEMPERATURE or not span:
            raise UnsupportedCommand("This light has no white temperature.")
        kelvin = caps.clamp(caps.param(params, "kelvin"), *span, "kelvin")
        mireds = max(entity.min_mireds, min(entity.max_mireds, MIREDS / kelvin))
        mode = min(mode for mode in _color_modes(session, entity) if mode & WHITE_TEMPERATURE)
        extra: dict[str, float] = {"color_brightness": 0.0} if mode & RGB else {}
        if mode == ColorMode.RGB_COLOR_TEMPERATURE:
            extra["white"] = 1.0
        client.light_command(entity.key, state=True, color_temperature=mireds, color_mode=mode, device_id=entity.device_id, **extra)
        # The colour mode matters: a light showing a colour keeps its old white temperature in its state.
        return entity, lambda state: state.state and state.color_mode & WHITE_TEMPERATURE and abs((_number(state.color_temperature) or 0) - mireds) <= 5

    def _send_climate(self, session: _Session, command: str, params: dict[str, Any]) -> tuple[Any, Check]:
        entity = _target(session, params, (ClimateInfo,))
        client = session.client
        if command == "set_hvac_mode":
            name = str(caps.param(params, "mode")).lower()
            mode = next((item for item in entity.supported_modes if item.name.lower() == name), None)
            if mode is None:
                raise AdapterError("This device has no such mode.", code="bad_params")
            client.climate_command(entity.key, mode=mode, device_id=entity.device_id)
            return entity, lambda state: state.mode == mode
        flags = _climate_flags(session, entity)
        target = caps.clamp(caps.param(params, "temperature"), *_temperature_range(entity), "temperature")
        if flags & ClimateFeature.REQUIRES_TWO_POINT_TARGET_TEMPERATURE:
            # The app has one target, so moving it moves the device's low-high band and keeps its width.
            state = _known(session.states.get(_ref(entity)))
            low, high = (_number(state.target_temperature_low), _number(state.target_temperature_high)) if state else (None, None)
            if low is None or high is None:
                raise UnsupportedCommand("This device has not reported its temperature range yet.")
            half = (high - low) / 2
            client.climate_command(entity.key, target_temperature_low=target - half, target_temperature_high=target + half, device_id=entity.device_id)
        else:
            client.climate_command(entity.key, target_temperature=target, device_id=entity.device_id)
        return entity, lambda state: abs((_target_temperature(state, flags) or math.inf) - target) < 0.05

    def _send_fan(self, session: _Session, command: str, params: dict[str, Any]) -> tuple[Any, Check]:
        client = session.client
        if command == "set_fan_speed":
            entity = _target(session, params, (FanInfo,))
            if not entity.supports_speed or not entity.supported_speed_count:
                raise UnsupportedCommand("This fan has no speed control.")
            percentage = caps.clamp(caps.param(params, "percentage"), 0, 100, "percentage")
            if percentage == 0:
                client.fan_command(entity.key, state=False, device_id=entity.device_id)
                return entity, lambda state: not state.state
            level = max(1, math.ceil(percentage * entity.supported_speed_count / 100))
            client.fan_command(entity.key, state=True, speed_level=level, device_id=entity.device_id)
            return entity, lambda state: state.state and state.speed_level == level

        entity = _target(session, params, (ClimateInfo, FanInfo))
        name = str(caps.param(params, "fan_mode"))
        if isinstance(entity, FanInfo):
            preset = _pick(entity.supported_preset_modes, name)
            if preset is None:
                raise AdapterError("This fan has no such mode.", code="bad_params")
            client.fan_command(entity.key, preset_mode=preset, device_id=entity.device_id)
            return entity, lambda state: state.preset_mode == preset
        custom = _pick(entity.supported_custom_fan_modes, name)
        if custom is not None:
            client.climate_command(entity.key, custom_fan_mode=custom, device_id=entity.device_id)
            return entity, lambda state: state.custom_fan_mode == custom
        fan_mode = next((item for item in entity.supported_fan_modes if item.name.lower() == name.lower()), None)
        if fan_mode is None:
            raise AdapterError("This device has no such fan mode.", code="bad_params")
        client.climate_command(entity.key, fan_mode=fan_mode, device_id=entity.device_id)
        return entity, lambda state: state.fan_mode == fan_mode

    def _send_cover(self, session: _Session, command: str, params: dict[str, Any]) -> tuple[Any, Check]:
        entity = _target(session, params, (CoverInfo,))
        client = session.client
        if command == "cover_stop":
            if not entity.supports_stop:
                raise UnsupportedCommand("This cover cannot stop part-way.")
            client.cover_command(entity.key, stop=True, device_id=entity.device_id)
            return entity, lambda state: state.current_operation == CoverOperation.IDLE
        if command == "set_position":
            if not entity.supports_position:
                raise UnsupportedCommand("This cover has no position control.")
            position = round(caps.clamp(caps.param(params, "position"), 0, 100, "position")) / 100
        else:
            position = 1.0 if command == "cover_open" else 0.0
        client.cover_command(entity.key, position=position, device_id=entity.device_id)
        return entity, lambda state: state.current_operation == CoverOperation.IDLE and abs((_ratio(state.position) or 0) - position) < 0.01


def _target(session: _Session, params: dict[str, Any], kinds: tuple[type, ...]) -> Any:
    """Which entity a command is for: params.key (any of its capability keys), else the first that can take it."""
    key = str(params.get("key") or "")
    if key:
        entity = session.entities.get(key.rpartition(":")[2])
    else:
        entity = next((item for item in session.entities.values() if isinstance(item, kinds)), None)
    # A key that matches nothing must not fall through to some other relay.
    if not isinstance(entity, kinds):
        raise UnsupportedCommand("This device has no such control.")
    return entity


def _climate_on_mode(session: _Session, ref: str, entity: Any) -> ClimateMode:
    if mode := session.last_mode.get(ref):
        return mode
    mode = next((item for item in entity.supported_modes if item != ClimateMode.OFF), None)
    if mode is None:
        raise UnsupportedCommand("This device can only be off.")
    return mode
