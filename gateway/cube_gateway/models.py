"""The gateway's data model, as the REST API and WebSocket events serialize it.

The app mirrors these in src/types/gateway.types.ts: change both together. Field names are snake_case
on the wire. Every state value says whether the device confirmed it (`confirmed`) or the gateway
assumes it (`confirmed: false`, e.g. after a command to a device that does not report back).
"""

from __future__ import annotations

import re
import time
from enum import StrEnum
from typing import Any, Literal

from pydantic import BaseModel, Field


class SupportLevel(StrEnum):
    #: Implemented against a documented local API.
    SUPPORTED = "supported"
    #: Implemented, but reverse engineered or model-dependent: may not work on every model or firmware.
    EXPERIMENTAL = "experimental"
    #: Some models or functions only (e.g. needs a key the user must obtain).
    LIMITED = "limited"
    #: Detected on the network, but there is no local control.
    UNSUPPORTED = "unsupported"


class Category(StrEnum):
    SWITCH = "switch"
    PLUG = "plug"
    LIGHT = "light"
    CLIMATE = "climate"
    TV = "tv"
    FAN = "fan"
    SENSOR = "sensor"
    CAMERA = "camera"
    COVER = "cover"
    OTHER = "other"


class AuthKind(StrEnum):
    NONE = "none"
    #: The user accepts a prompt on the device itself (TV "Allow" dialog).
    APPROVE_ON_DEVICE = "approve_on_device"
    #: A PIN shown on the device must be typed in the app.
    PIN = "pin"
    #: A per-device encryption key the user must supply (Tuya local key, eWeLink device key).
    LOCAL_KEY = "local_key"
    #: Username/password stored on the device (e.g. Shelly auth, Daikin key).
    DEVICE_CREDENTIALS = "device_credentials"
    #: The brand account's credentials, used only for local authentication (Tapo KLAP); never sent to a cloud.
    ACCOUNT_CREDENTIALS = "account_credentials"


class ConnectionStatus(StrEnum):
    """Prompt section 13. Device and provisioning states share one vocabulary so the app shows one set of labels."""

    SCANNING = "scanning"
    DISCOVERED = "discovered"
    IDENTIFIED = "identified"
    PAIRING_MODE_REQUIRED = "pairing_mode_required"
    CONNECTING_DEVICE_AP = "connecting_device_ap"
    HOTSPOT_PASSWORD_REQUIRED = "hotspot_password_required"
    SENDING_WIFI_CONFIG = "sending_wifi_config"
    CONNECTING_HOME_NETWORK = "connecting_home_network"
    WAITING_FOR_DEVICE = "waiting_for_device"
    LOCAL_AUTHORIZATION_REQUIRED = "local_authorization_required"
    CONNECTED = "connected"
    OFFLINE = "offline"
    LOCAL_KEY_REQUIRED = "local_key_required"
    EXPERIMENTAL = "experimental"
    UNSUPPORTED = "unsupported"
    PAIRING_FAILED = "pairing_failed"


# ---- input hygiene ---------------------------------------------------------------------------------

_CONTROL = re.compile(r"[\x00-\x1f\x7f]")


def clean_text(value: Any, limit: int = 96) -> str | None:
    """Text from the network (mDNS names, SSDP headers, device replies) before it is stored or shown."""
    if value is None:
        return None
    text = _CONTROL.sub("", str(value)).strip()
    return text[:limit] or None


# ---- catalog ---------------------------------------------------------------------------------------


class FieldSpec(BaseModel):
    """One input the app must collect, e.g. a Tuya local key or a TV PIN."""

    name: str
    label: str
    kind: Literal["text", "password", "number", "select"] = "text"
    required: bool = True
    secret: bool = False
    help: str | None = None
    options: list[str] = []
    pattern: str | None = None


class PairingRequirements(BaseModel):
    auth: AuthKind = AuthKind.NONE
    fields: list[FieldSpec] = []
    instructions: str | None = None
    manufacturer_account: bool = False
    #: Seconds the user has to react on the device (TV prompts).
    approval_timeout: int | None = None


class ConnectionMethod(BaseModel):
    id: str
    group: Literal["existing", "new", "advanced"]
    title: str
    description: str
    adapter_id: str
    plugin_id: str | None = None
    #: Who runs the setup: the phone (joins the device's hotspot), the gateway (its own Wi-Fi), the
    #: device's own setup page (guided), or the LAN (already on Wi-Fi).
    transport: Literal["lan", "phone", "gateway", "guided"] = "lan"
    status: SupportLevel = SupportLevel.SUPPORTED
    manufacturer_account: bool = False
    hotspot_password: Literal["none", "verified_rule", "user"] = "none"
    user_approval: bool = False
    local_key: bool = False
    available: bool = True
    unavailable_reason: str | None = None


class Brand(BaseModel):
    id: str
    name: str
    aliases: list[str] = []
    #: Icon key the app maps to its own artwork; no remote images.
    logo: str
    status: SupportLevel
    summary: str
    account_free: bool
    categories: list[Category] = []
    adapters: list[str] = []
    methods: list[ConnectionMethod] = []
    notes: list[str] = []


class AdapterInfo(BaseModel):
    id: str
    name: str
    brands: list[str]
    protocols: list[str]
    discovery: list[str]
    categories: list[Category]
    status: SupportLevel
    account_free: bool
    auth: AuthKind
    local_control: bool = True
    push_updates: bool = False
    library: str | None = None
    verified_models: list[str] = []
    notes: list[str] = []
    loaded: bool = True
    load_error: str | None = None


# ---- discovery -------------------------------------------------------------------------------------


class Candidate(BaseModel):
    """A device seen on the network. Being seen is not being controllable: see `control`."""

    id: str
    adapter_id: str
    brand: str
    name: str | None = None
    model: str | None = None
    ip: str | None = None
    port: int | None = None
    mac: str | None = None
    unique_id: str
    protocol: str | None = None
    sources: list[str] = []
    status: ConnectionStatus = ConnectionStatus.DISCOVERED
    control: Literal["supported", "experimental", "detection_only"] = "supported"
    account_free: bool = True
    pairing: PairingRequirements = PairingRequirements()
    paired_device_id: str | None = None
    first_seen: float = Field(default_factory=time.time)
    last_seen: float = Field(default_factory=time.time)
    #: Adapter-private connection details (never secrets): e.g. Shelly generation, Tuya protocol version.
    details: dict[str, Any] = {}


class DiscoveryJob(BaseModel):
    id: str
    status: Literal["running", "completed", "cancelled", "failed"]
    brand_id: str | None = None
    adapter_ids: list[str] = []
    methods: list[str] = []
    progress: float = 0.0
    phase: str = "starting"
    started_at: float
    finished_at: float | None = None
    timeout: float
    candidate_ids: list[str] = []
    errors: list[str] = []


# ---- devices ---------------------------------------------------------------------------------------


class Capability(BaseModel):
    """One controllable aspect. `key` tells several of a kind apart (a two-gang switch has power:0, power:1)."""

    key: str
    type: Literal["power", "brightness", "color_temp", "color", "climate", "media", "fan", "cover"]
    label: str
    confirmed: bool = True
    updated_at: float | None = None
    # power
    value: Any = None
    # brightness / color_temp ranges
    min: float | None = None
    max: float | None = None
    step: float | None = None
    # climate
    current: float | None = None
    target: float | None = None
    unit: str | None = None
    mode: str | None = None
    modes: list[str] = []
    fan_mode: str | None = None
    fan_modes: list[str] = []
    # media
    volume: float | None = None
    muted: bool | None = None
    source: str | None = None
    sources: list[str] = []
    state: str | None = None
    # fan
    percentage: float | None = None
    preset: str | None = None
    presets: list[str] = []
    # cover
    position: float | None = None


class Setting(BaseModel):
    """A setting or reading beyond the basic capabilities, e.g. an AC's swing, Jet, a timer or its filter hours.

    The device only lists what it supports. `select`, `number` and `switch` are set with the `set_setting` command,
    `button` with `press`; `sensor` only reads. `available` is false while the device would ignore it (Jet outside
    Cooling), with `requires` saying what it needs. `confirmed` is false for values the device does not echo back.
    """

    key: str
    kind: Literal["select", "number", "switch", "button", "sensor"]
    name: str
    value: str | float | bool | None = None
    options: list[str] = []
    min: float | None = None
    max: float | None = None
    step: float | None = None
    unit: str | None = None
    available: bool = True
    requires: str | None = None
    description: str | None = None
    diagnostic: bool = False
    confirmed: bool = True


class Reading(BaseModel):
    key: str
    label: str
    value: Any
    unit: str | None = None
    device_class: str | None = None


class DeviceConnection(BaseModel):
    status: ConnectionStatus = ConnectionStatus.CONNECTED
    last_seen: float | None = None
    last_error: str | None = None
    retry_at: float | None = None


class PendingCommand(BaseModel):
    command: str
    params: dict[str, Any] = {}
    since: float


class Device(BaseModel):
    id: str
    name: str
    brand: str
    model: str | None = None
    adapter_id: str
    category: Category
    room_id: str | None = None
    room: str | None = None
    ip: str | None = None
    mac: str | None = None
    unique_id: str
    protocol: str | None = None
    experimental: bool = False
    dashboard: bool = True
    connection: DeviceConnection = DeviceConnection()
    capabilities: list[Capability] = []
    readings: list[Reading] = []
    settings: list[Setting] = []
    commands: list[str] = []
    pending: PendingCommand | None = None
    created_at: float
    updated_at: float


class Room(BaseModel):
    id: str
    name: str
    device_count: int = 0


#: The normalized commands; an adapter lists the ones each device supports in `Device.commands`.
COMMANDS: dict[str, str] = {
    "turn_on": "Turn on",
    "turn_off": "Turn off",
    "toggle": "Toggle",
    "set_brightness": "Set brightness (params.brightness 0-100)",
    "set_color": "Set colour (params.h 0-360, params.s 0-100)",
    "set_color_temp": "Set white temperature (params.kelvin)",
    "set_temperature": "Set target temperature (params.temperature)",
    "set_hvac_mode": "Set HVAC mode (params.mode)",
    "set_fan_mode": "Set fan mode (params.fan_mode)",
    "set_fan_speed": "Set fan speed (params.percentage 0-100)",
    "set_volume": "Set volume (params.volume 0-100)",
    "volume_up": "Volume up",
    "volume_down": "Volume down",
    "mute": "Mute (params.muted)",
    "set_source": "Select input or app (params.source)",
    "media_play": "Play",
    "media_pause": "Pause",
    "media_next": "Next / channel up",
    "media_previous": "Previous / channel down",
    "cover_open": "Open",
    "cover_close": "Close",
    "cover_stop": "Stop",
    "set_position": "Set position (params.position 0-100)",
    "set_setting": "Change one of the device's settings (params.key, params.value)",
    "press": "Press one of the device's buttons (params.key)",
}


class CommandRequest(BaseModel):
    command: str = Field(min_length=1, max_length=40)
    params: dict[str, Any] = {}


class CommandResult(BaseModel):
    #: confirmed: the device reported the new state. assumed: the protocol gives no feedback, so the gateway
    #: shows the expected state marked unconfirmed. pending: accepted, the device will report later.
    status: Literal["confirmed", "assumed", "pending"]
    message: str | None = None


# ---- pairing and provisioning ----------------------------------------------------------------------


class PairingRequest(BaseModel):
    candidate_id: str
    credentials: dict[str, str] = {}
    name: str | None = Field(default=None, max_length=64)
    room_id: str | None = None


class Pairing(BaseModel):
    id: str
    candidate_id: str
    status: Literal["running", "awaiting_approval", "needs_input", "paired", "failed"]
    message: str | None = None
    fields: list[FieldSpec] = []
    device_id: str | None = None
    error_code: str | None = None
    started_at: float
    finished_at: float | None = None


class HotspotInfo(BaseModel):
    ssid_pattern: str
    ssid_prefixes: list[str] = []
    password_rule: Literal["none", "verified_rule", "user"]
    #: Only when a verified, model-specific rule applies; otherwise the user types it.
    password: str | None = None
    rule_source: str | None = None
    device_ip: str | None = None


class ProvisioningStep(BaseModel):
    state: ConnectionStatus
    title: str
    detail: str


class ProvisioningError(BaseModel):
    code: str
    message: str
    recovery: str


class ProvisioningSession(BaseModel):
    id: str
    brand_id: str
    plugin_id: str
    adapter_id: str
    model: str | None = None
    transport: Literal["phone", "gateway", "guided"]
    state: ConnectionStatus
    experimental: bool = False
    hotspot: HotspotInfo
    steps: list[ProvisioningStep] = []
    #: What identifies the device once it is on the home network (filled from the hotspot name or the
    #: device's own reply on its setup network).
    expect: dict[str, str] = {}
    #: Values the phone needs to run the setup, e.g. ReThink's public addresses for an LG ThinQ2 appliance.
    setup: dict[str, str] = {}
    candidate_id: str | None = None
    device_id: str | None = None
    pairing_id: str | None = None
    error: ProvisioningError | None = None
    history: list[dict[str, Any]] = []
    created_at: float
    expires_at: float
    updated_at: float


class ProvisioningEvent(BaseModel):
    """The phone reports what it did on the device's hotspot (phone and guided transports)."""

    event: Literal[
        "pairing_mode_confirmed",
        "joining_device_ap",
        "device_ap_joined",
        "hotspot_password_needed",
        "device_info",
        "wifi_config_sent",
        "phone_returned",
        "failed",
        "cancel",
    ]
    data: dict[str, Any] = {}


class GatewayProvisionRequest(BaseModel):
    """The gateway joins the device's hotspot itself. Wi-Fi passwords are used in memory and never stored."""

    home_ssid: str = Field(min_length=1, max_length=32)
    home_password: str = Field(default="", max_length=64)
    hotspot_ssid: str = Field(min_length=1, max_length=32)
    hotspot_password: str | None = Field(default=None, max_length=64)


class Event(BaseModel):
    """One WebSocket message from /api/v1/events."""

    type: str
    data: dict[str, Any] = {}
    at: float = Field(default_factory=time.time)
