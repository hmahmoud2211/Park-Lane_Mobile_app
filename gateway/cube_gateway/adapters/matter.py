"""Matter devices, through a Matter Server running next to the gateway (experimental).

The gateway doesn't speak Matter itself. A Matter Server (the Open Home Foundation's matter.js server, or the older
python-matter-server, which share one WebSocket API) is the Matter controller: it holds CUBE's Matter fabric,
commissions devices and keeps a live subscription to each. CUBE_MATTER_URL points at it, e.g.
ws://127.0.0.1:5580/ws. This adapter:

- keeps one WebSocket open. The server first sends its info, `start_listening` returns every node, and then
  `attribute_updated` events ([node_id, "endpoint/cluster/attribute", value]) keep that copy current;
- finds devices two ways: ones in pairing mode on the network (the server's `discover`), which pair with their
  Matter setup code, and ones already on CUBE's fabric but not yet in CUBE, which need nothing;
- pairs with `commission_with_code` and `network_only`, so the device must already be reachable over IP: a Wi-Fi or
  Thread device shared from another app (Apple Home, Google Home, the maker's app) with a pairing code, or one in
  pairing mode on the network. Setting up a brand-new device over Bluetooth needs the server to have Bluetooth and
  the Wi-Fi password, which isn't offered yet;
- reads state from the copy and sends `device_command` / `write_attribute`.

One CUBE device per Matter node, controlled through the first endpoint that has each cluster. Not offered yet:
devices behind a Matter bridge, a power strip's other outlets, locks, fans and colour (hue/saturation).

Sources: python-matter-server 8.1.2 (matter_server/common/models.py, client/client.py, server/device_controller.py)
for the API; home-assistant-chip-clusters 2025.7.0 (chip/clusters/Objects.py) for cluster, attribute and command
ids and field names. No Matter device has been tried with this adapter yet.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import re
import time
import uuid
from collections.abc import Awaitable, Callable
from typing import Any

from ..models import AdapterInfo, AuthKind, Candidate, Capability, Category, CommandResult, FieldSpec, PairingRequirements, Reading, SupportLevel, clean_text
from ..tasks import spawn
from . import caps
from .base import (
    AdapterError,
    ApprovalCallback,
    AuthRequired,
    CommandOutcome,
    DeviceAdapter,
    DeviceState,
    DeviceUnreachable,
    NotSupported,
    PairingRejected,
    PairResult,
    ScanContext,
    StateCallback,
    StoredDevice,
    UnsupportedCommand,
    make_candidate,
)

PROTOCOL = "matter"
#: The oldest Matter Server API used here: network-only commissioning (6) and `discover` (7).
MIN_SCHEMA = 7
CALL_TIMEOUT = 15.0
#: Commissioning can take a minute; this stays below the 90 s the pairing manager allows.
COMMISSION_TIMEOUT = 80.0
DISCOVER_TIMEOUT = 20.0
#: How long a command waits for the device to report the new value before calling it pending.
CONFIRM_WAIT = 3.0
#: `start_listening` returns every node at once.
MAX_MESSAGE = 32 * 1024 * 1024

# Cluster ids (Matter 1.x).
BASIC = 40
DESCRIPTOR = 29
POWER_SOURCE = 47
ON_OFF = 6
LEVEL = 8
COLOR = 768
THERMOSTAT = 513
COVER = 258
BOOLEAN_STATE = 69
TEMPERATURE = 1026
HUMIDITY = 1029
OCCUPANCY = 1030
ELECTRICAL_POWER = 144

# Device type ids (Descriptor DeviceTypeList).
LIGHT_TYPES = {0x0100, 0x0101, 0x010C, 0x010D}
DIMMABLE_TYPES = {0x0101, 0x010C, 0x010D, 0x010B, 0x0110}
PLUG_TYPES = {0x010A, 0x010B}
SWITCH_TYPES = {0x010F, 0x0110}
CONTACT_SENSOR = 0x0015
AGGREGATOR = 0x000E

SYSTEM_MODES = {0: "off", 1: "auto", 3: "cool", 4: "heat", 7: "fan_only", 8: "dry"}
MODE_VALUES = {name: value for value, name in SYSTEM_MODES.items()}
#: ControlSequenceOfOperation values that can cool, and that can heat.
CAN_COOL = {0, 1, 4, 5}
CAN_HEAT = {2, 3, 4, 5}
#: An 11- or 21-digit manual pairing code, or the QR code's MT: payload (base-38: digits, capitals, '-', '.').
SETUP_CODE = re.compile(r"^(?:\d{11}|\d{21}|MT:[0-9A-Z.\-]{19,})$")


def normalize_code(raw: str) -> str:
    text = (raw or "").strip()
    if text.upper().startswith("MT:"):
        return "MT:" + text[3:].strip().upper()
    return re.sub(r"[\s\-]", "", text)


# ---- the server's copy of a node ---------------------------------------------------------------------


class Node:
    """One Matter node as the server reports it. Attributes are keyed "endpoint/cluster/attribute"."""

    def __init__(self, data: dict[str, Any]):
        self.node_id = int(data["node_id"])
        self.available = bool(data.get("available"))
        self.is_bridge = bool(data.get("is_bridge"))
        self.values: dict[str, Any] = dict(data.get("attributes") or {})

    def get(self, endpoint: int, cluster: int, attribute: int, default: Any = None) -> Any:
        value = self.values.get(f"{endpoint}/{cluster}/{attribute}", default)
        return default if value is None else value

    def has(self, endpoint: int, cluster: int, attribute: int) -> bool:
        return f"{endpoint}/{cluster}/{attribute}" in self.values

    def endpoints(self) -> dict[int, set[int]]:
        found: dict[int, set[int]] = {}
        for path in self.values:
            parts = path.split("/")
            if len(parts) == 3 and parts[0].isdigit() and parts[1].isdigit():
                found.setdefault(int(parts[0]), set()).add(int(parts[1]))
        return found

    def endpoint_for(self, cluster: int) -> int | None:
        """The first application endpoint with `cluster` (endpoint 0 is the node itself)."""
        with_cluster = sorted(e for e, clusters in self.endpoints().items() if cluster in clusters)
        application = [e for e in with_cluster if e != 0]
        return application[0] if application else (with_cluster[0] if with_cluster else None)

    def device_types(self) -> set[int]:
        types: set[int] = set()
        for endpoint in self.endpoints():
            for entry in self.get(endpoint, DESCRIPTOR, 0, []) or []:
                value = entry.get("0", entry.get("deviceType")) if isinstance(entry, dict) else None
                if isinstance(value, int) and endpoint != 0:
                    types.add(value)
        return types

    @property
    def bridge(self) -> bool:
        return self.is_bridge or AGGREGATOR in self.device_types()

    # identity
    @property
    def vendor(self) -> str | None:
        return clean_text(self.get(0, BASIC, 1), 64)

    @property
    def product(self) -> str | None:
        return clean_text(self.get(0, BASIC, 3), 64)

    @property
    def label(self) -> str | None:
        return clean_text(self.get(0, BASIC, 5), 64)

    @property
    def unique_id(self) -> str:
        """Stable across re-commissioning where the device offers UniqueID or a serial number."""
        unique = clean_text(self.get(0, BASIC, 18), 64)
        if unique:
            return unique
        serial = clean_text(self.get(0, BASIC, 15), 64)
        if serial:
            return f"{self.get(0, BASIC, 2, 0)}-{self.get(0, BASIC, 4, 0)}-{serial}"
        return f"node-{self.node_id}"


# ---- state mapping -----------------------------------------------------------------------------------


def _centi(value: Any) -> float | None:
    return round(value / 100, 1) if isinstance(value, int | float) else None


def category_of(node: Node) -> Category:
    types = node.device_types()
    clusters = set().union(*node.endpoints().values()) if node.endpoints() else set()
    if THERMOSTAT in clusters:
        return Category.CLIMATE
    if COVER in clusters:
        return Category.COVER
    if types & LIGHT_TYPES or (COLOR in clusters and ON_OFF in clusters):
        return Category.LIGHT
    if types & PLUG_TYPES:
        return Category.PLUG
    if types & SWITCH_TYPES or ON_OFF in clusters:
        return Category.SWITCH
    if clusters & {BOOLEAN_STATE, TEMPERATURE, HUMIDITY, OCCUPANCY}:
        return Category.SENSOR
    return Category.OTHER


def _climate(node: Node, endpoint: int) -> Capability:
    sequence = node.get(endpoint, THERMOSTAT, 27, 4)
    can_cool, can_heat = sequence in CAN_COOL, sequence in CAN_HEAT
    modes = ["off"] + (["heat"] if can_heat else []) + (["cool"] if can_cool else []) + (["auto"] if can_cool and can_heat else [])
    mode = SYSTEM_MODES.get(node.get(endpoint, THERMOSTAT, 28))
    if mode and mode not in modes:
        modes.append(mode)
    cooling, heating = _centi(node.get(endpoint, THERMOSTAT, 17)), _centi(node.get(endpoint, THERMOSTAT, 18))
    target = cooling if mode == "cool" else heating if mode == "heat" else (heating if can_heat else cooling)
    low = _centi(node.get(endpoint, THERMOSTAT, 3 if can_heat else 5)) or 7.0
    high = _centi(node.get(endpoint, THERMOSTAT, 6 if can_cool else 4)) or 30.0
    return caps.climate(current=_centi(node.get(endpoint, THERMOSTAT, 0)), target=target, mode=mode, modes=modes, low=low, high=high, step=0.5)


def _cover(node: Node, endpoint: int) -> Capability:
    # Matter counts lift from 0 (fully open) to 10000 (fully closed); the app's position is 100 = open.
    raw = node.get(endpoint, COVER, 14)
    position = None if raw is None else max(0, min(100, 100 - round(raw / 100)))
    state = None if position is None else ("open" if position > 0 else "closed")
    return Capability(key="cover", type="cover", label="Position", state=state, position=position, confirmed=raw is not None, updated_at=time.time())


def _readings(node: Node) -> list[Reading]:
    readings: list[Reading] = []
    if (ep := node.endpoint_for(TEMPERATURE)) is not None and (value := _centi(node.get(ep, TEMPERATURE, 0))) is not None:
        readings.append(caps.reading("temperature", "Temperature", value, "°C", "temperature"))
    if (ep := node.endpoint_for(HUMIDITY)) is not None and (value := _centi(node.get(ep, HUMIDITY, 0))) is not None:
        readings.append(caps.reading("humidity", "Humidity", round(value), "%", "humidity"))
    if (ep := node.endpoint_for(BOOLEAN_STATE)) is not None and node.has(ep, BOOLEAN_STATE, 0):
        value = bool(node.get(ep, BOOLEAN_STATE, 0))
        if CONTACT_SENSOR in node.device_types():
            readings.append(caps.reading("contact", "Door / window", "Closed" if value else "Open", None, "door"))
        else:
            readings.append(caps.reading("state", "State", value, None, None))
    if (ep := node.endpoint_for(OCCUPANCY)) is not None and node.has(ep, OCCUPANCY, 0):
        readings.append(caps.reading("occupancy", "Motion", "Detected" if int(node.get(ep, OCCUPANCY, 0)) & 1 else "Clear", None, "occupancy"))
    if (ep := node.endpoint_for(ELECTRICAL_POWER)) is not None and isinstance(milliwatts := node.get(ep, ELECTRICAL_POWER, 8), int | float):
        readings.append(caps.reading("power_w", "Power", round(milliwatts / 1000, 1), "W", "power"))
    if (ep := node.endpoint_for(POWER_SOURCE)) is not None and isinstance(half := node.get(ep, POWER_SOURCE, 12), int | float):
        readings.append(caps.reading("battery", "Battery", round(half / 2), "%", "battery"))
    return readings


def state_of(node: Node) -> DeviceState:
    capabilities: list[Capability] = []
    if (ep := node.endpoint_for(ON_OFF)) is not None:
        value = node.get(ep, ON_OFF, 0)
        capabilities.append(caps.power(None if value is None else bool(value), confirmed=value is not None))
    types = node.device_types()
    if (ep := node.endpoint_for(LEVEL)) is not None and (types & DIMMABLE_TYPES or not types):
        level = node.get(ep, LEVEL, 0)
        capabilities.append(caps.brightness(None if level is None else level / 254 * 100, confirmed=level is not None))
    if (ep := node.endpoint_for(COLOR)) is not None and node.has(ep, COLOR, 7):
        mireds = node.get(ep, COLOR, 7)
        coolest, warmest = node.get(ep, COLOR, 16395) or 153, node.get(ep, COLOR, 16396) or 500
        capabilities.append(caps.color_temp(1_000_000 / mireds if mireds else None, round(1_000_000 / warmest), round(1_000_000 / coolest), confirmed=bool(mireds)))
    if (ep := node.endpoint_for(THERMOSTAT)) is not None:
        capabilities.append(_climate(node, ep))
    commands = caps.commands_for(capabilities)
    if (ep := node.endpoint_for(COVER)) is not None:
        capabilities.append(_cover(node, ep))
        commands += ["cover_open", "cover_close", "cover_stop"] + (["set_position"] if node.has(ep, COVER, 14) else [])
    return DeviceState(capabilities=capabilities, readings=_readings(node), commands=commands, online=node.available, model=node.product)


# ---- the adapter -------------------------------------------------------------------------------------


class MatterAdapter(DeviceAdapter):
    info = AdapterInfo(
        id="matter",
        name="Matter (through a Matter Server)",
        brands=["matter"],
        protocols=[PROTOCOL],
        discovery=["matter_server"],
        categories=[Category.LIGHT, Category.PLUG, Category.SWITCH, Category.CLIMATE, Category.COVER, Category.SENSOR],
        status=SupportLevel.EXPERIMENTAL,
        account_free=True,
        # Devices in pairing mode ask for their setup code; ones already on CUBE's fabric need nothing.
        auth=AuthKind.NONE,
        push_updates=True,
        library="Matter Server WebSocket API (matter.js server or python-matter-server)",
        verified_models=[],
        notes=[
            "Needs a Matter Server next to the gateway (CUBE_MATTER_URL).",
            "Adds devices that are already on the network: share one from Apple Home, Google Home or its maker's app, or use one in pairing mode.",
            "Not yet: Matter bridges, a strip's other outlets, locks, fans, colour.",
        ],
    )
    #: State is pushed; the occasional poll only re-reads the server's copy.
    poll_interval = 300
    call_timeout = 15.0

    def __init__(self, ctx):
        super().__init__(ctx)
        self.url = ctx.settings.matter_url
        self.nodes: dict[int, Node] = {}
        self.server_info: dict[str, Any] | None = None
        self.connected = asyncio.Event()
        self.last_error: str | None = None
        self._socket: Any = None
        self._task: asyncio.Task | None = None
        self._pending: dict[str, asyncio.Future] = {}
        #: Push subscriptions by device id: the device and the coroutine that pushes its state.
        self._subscribers: dict[str, tuple[StoredDevice, Callable[[], Awaitable[None]]]] = {}
        self._debounce: dict[int, asyncio.TimerHandle] = {}
        self._send_lock = asyncio.Lock()

    def available(self) -> tuple[bool, str | None]:
        if not self.url:
            return False, "This gateway has no Matter Server yet. Whoever installed the gateway can add one (CUBE_MATTER_URL)."
        if not self.connected.is_set() and self.last_error:
            return False, f"The gateway can't reach its Matter Server: {self.last_error}"
        return True, None

    # ---- connection ----

    async def start(self) -> None:
        if not self.url or self._task is not None:
            return
        self._task = asyncio.create_task(self._run(), name="matter-server")
        # Give a running server a moment, so paired devices don't show offline right after a restart.
        with contextlib.suppress(TimeoutError):
            await asyncio.wait_for(self.connected.wait(), 5)

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await self._task
            self._task = None
        for handle in self._debounce.values():
            handle.cancel()
        self._debounce.clear()
        self.connected.clear()

    async def _run(self) -> None:
        from websockets.asyncio.client import connect

        backoff = 2.0
        while True:
            try:
                async with connect(self.url, max_size=MAX_MESSAGE, open_timeout=10, ping_interval=30, ping_timeout=30) as socket:
                    info = json.loads(await asyncio.wait_for(socket.recv(), 10))
                    schema = int(info.get("schema_version") or 0)
                    if schema < MIN_SCHEMA:
                        raise AdapterError(f"the Matter Server is too old (API version {schema}, needs {MIN_SCHEMA} or later); update it")
                    self.server_info = info
                    self._socket = socket
                    listen_id = uuid.uuid4().hex
                    await self._send({"message_id": listen_id, "command": "start_listening"})
                    async for raw in socket:
                        if self._handle(json.loads(raw), listen_id):
                            backoff = 2.0
                            self.log.info("connected to the Matter Server", extra={"nodes": len(self.nodes), "sdk": info.get("sdk_version")})
            except asyncio.CancelledError:
                raise
            except Exception as error:  # noqa: BLE001 - keep retrying; paired devices show offline meanwhile
                self.last_error = getattr(error, "message", None) or str(error) or type(error).__name__
                self.log.warning("Matter Server connection lost; retrying", extra={"reason": self.last_error, "retry_in": backoff})
            finally:
                self._socket = None
                self.connected.clear()
                for future in self._pending.values():
                    if not future.done():
                        future.set_exception(DeviceUnreachable("The connection to the Matter Server dropped."))
                self._pending.clear()
                self._notify_all()
            await asyncio.sleep(backoff)
            backoff = min(60.0, backoff * 2)

    async def _send(self, message: dict[str, Any]) -> None:
        socket = self._socket
        if socket is None:
            raise DeviceUnreachable("The gateway isn't connected to its Matter Server.")
        async with self._send_lock:
            await socket.send(json.dumps(message))

    def _handle(self, message: dict[str, Any], listen_id: str) -> bool:
        """Handles one message; True when it was the full node list that `start_listening` answers with."""
        if "event" in message:
            self._event(str(message["event"]), message.get("data"))
            return False
        message_id = message.get("message_id")
        if message_id == listen_id and "result" in message:
            self.nodes = {node.node_id: node for node in (Node(data) for data in message.get("result") or [])}
            self.last_error = None
            self.connected.set()
            self._notify_all()
            return True
        future = self._pending.pop(str(message_id), None)
        if future is not None and not future.done():
            if "error_code" in message:
                future.set_exception(_server_error(message))
            else:
                future.set_result(message.get("result"))
        return False

    def _event(self, event: str, data: Any) -> None:
        if event == "attribute_updated" and isinstance(data, list) and len(data) == 3:
            node_id, path, value = data
            node = self.nodes.get(int(node_id))
            if node is not None:
                node.values[str(path)] = value
                self._notify(node.node_id)
        elif event in {"node_added", "node_updated"} and isinstance(data, dict):
            node = Node(data)
            self.nodes[node.node_id] = node
            self._notify(node.node_id)
        elif event == "node_removed" and data is not None:
            self.nodes.pop(int(data), None)
            self._notify(int(data))
        elif event == "endpoint_removed" and isinstance(data, dict):
            node = self.nodes.get(int(data.get("node_id", -1)))
            if node is not None:
                prefix = f"{data.get('endpoint_id')}/"
                node.values = {path: value for path, value in node.values.items() if not path.startswith(prefix)}
                self._notify(node.node_id)

    async def _call(self, command: str, *, timeout: float = CALL_TIMEOUT, **args: Any) -> Any:
        if not self.connected.is_set():
            raise DeviceUnreachable("The gateway isn't connected to its Matter Server.", recovery="Check the Matter Server is running next to the gateway.")
        message_id = uuid.uuid4().hex
        future: asyncio.Future = asyncio.get_running_loop().create_future()
        self._pending[message_id] = future
        try:
            await self._send({"message_id": message_id, "command": command, "args": args})
            return await asyncio.wait_for(future, timeout)
        except TimeoutError as error:
            raise AdapterError("The Matter Server didn't answer in time.", code="adapter_timeout") from error
        finally:
            self._pending.pop(message_id, None)

    # ---- push updates ----

    def _notify(self, node_id: int) -> None:
        """A node changed: push the devices it backs, at most every 0.2 s per node (updates come in bursts)."""
        if not self._subscribers:
            return
        handle = self._debounce.pop(node_id, None)
        if handle:
            handle.cancel()

        def fire() -> None:
            self._debounce.pop(node_id, None)
            for device, push in list(self._subscribers.values()):
                node = self._find(device)
                if node_id < 0 or (node is not None and node.node_id == node_id) or node is None:
                    spawn(push(), name="matter-push")

        self._debounce[node_id] = asyncio.get_running_loop().call_later(0.2, fire)

    def _notify_all(self) -> None:
        self._notify(-1)

    async def subscribe_to_events(self, device: StoredDevice, callback: StateCallback) -> Callable[[], Awaitable[None]] | None:
        async def push() -> None:
            try:
                await callback(self._state(device, self._node(device)))
            except DeviceUnreachable:
                await callback(DeviceState(online=False))

        self._subscribers[device.id] = (device, push)

        async def unsubscribe() -> None:
            if self._subscribers.get(device.id, (None, None))[1] is push:
                self._subscribers.pop(device.id, None)

        return unsubscribe

    # ---- discovery and pairing ----

    async def discover(self, scan: ScanContext) -> None:
        if not self.connected.is_set():
            return
        for node in list(self.nodes.values()):
            scan.report(
                make_candidate(
                    self, node.unique_id, name=node.label or node.product or "Matter device", model=node.product, protocol=PROTOCOL,
                    sources=["matter_server"], control="detection_only" if node.bridge else "experimental",
                    details={"kind": "node", "node_id": node.node_id, "vendor": node.vendor},
                )
            )
        try:
            found = await self._call("discover", timeout=min(max(scan.timeout, 5), DISCOVER_TIMEOUT))
        except AdapterError as error:
            self.log.info("Matter discovery failed", extra={"reason": error.message})
            return
        for item in found or []:
            if not isinstance(item, dict):
                continue
            vendor_id, product_id, discriminator = item.get("vendor_id"), item.get("product_id"), item.get("long_discriminator")
            instance = clean_text(item.get("instance_name"), 64) or f"{vendor_id}-{product_id}-{discriminator}"
            ipv4 = next((a for a in item.get("addresses") or [] if isinstance(a, str) and scan.in_scope(a)), None)
            scan.report(
                make_candidate(
                    self, f"commissionable:{instance}", name=clean_text(item.get("device_name"), 64) or "Matter device in pairing mode",
                    ip=ipv4, protocol=PROTOCOL, sources=["matter_server"],
                    details={"kind": "commissionable", "vendor_id": vendor_id, "product_id": product_id, "discriminator": discriminator, "device_type": item.get("device_type")},
                )
            )

    def get_pairing_requirements(self, candidate: Candidate) -> PairingRequirements:
        if candidate.details.get("kind") == "node":
            return PairingRequirements(auth=AuthKind.NONE, instructions="Already on CUBE's Matter network.")
        return PairingRequirements(
            auth=AuthKind.PIN,
            fields=[
                FieldSpec(
                    name="setup_code", label="Matter setup code", kind="text",
                    help="The 11-digit code next to the Matter QR code on the device or its box, or a pairing code from another app's share option.",
                )
            ],
            instructions="Adding a Matter device can take up to a minute.",
        )

    async def pair(self, candidate: Candidate, credentials: dict[str, str], approval: ApprovalCallback) -> PairResult:
        if candidate.details.get("kind") == "node":
            node = self.nodes.get(int(candidate.details.get("node_id", -1)))
            if node is None:
                raise DeviceUnreachable("That device is no longer on CUBE's Matter network. Scan again.")
        else:
            code = normalize_code(credentials.get("setup_code", ""))
            if not code:
                raise AuthRequired("Enter the device's Matter setup code.", code="credentials_missing")
            if not SETUP_CODE.match(code):
                raise AuthRequired("That isn't a Matter setup code. It has 11 digits (sometimes 21), or starts with MT: when read from the QR code.", code="credentials_invalid")
            await approval("Adding the device to CUBE's Matter network. This can take a minute.")
            node = Node(await self._call("commission_with_code", timeout=COMMISSION_TIMEOUT, code=code, network_only=True))
            self.nodes[node.node_id] = node
        if node.bridge:
            if candidate.details.get("kind") != "node":
                with contextlib.suppress(AdapterError):
                    await self._call("remove_node", timeout=30, node_id=node.node_id)
            raise NotSupported("This is a Matter bridge (for example a Hue Bridge or a hub). Bridges aren't supported yet.")
        return PairResult(
            unique_id=node.unique_id, name=node.label or node.product or "Matter device", category=category_of(node), model=node.product,
            protocol=PROTOCOL, params={"node_id": node.node_id, "vendor": node.vendor},
        )

    # ---- state and control ----

    def _find(self, device: StoredDevice) -> Node | None:
        node = self.nodes.get(int(device.params.get("node_id", -1)))
        if node is None:
            # Re-commissioned under a new node id: found by its stable id.
            node = next((n for n in self.nodes.values() if n.unique_id == device.unique_id), None)
        return node

    def _state(self, device: StoredDevice, node: Node) -> DeviceState:
        state = state_of(node)
        if device.params.get("node_id") != node.node_id:
            state.params = {"node_id": node.node_id}  # persisted once, not on every update
        return state

    def _node(self, device: StoredDevice) -> Node:
        if not self.connected.is_set():
            raise DeviceUnreachable("The gateway can't reach its Matter Server.", recovery="Check the Matter Server is running next to the gateway.")
        node = self._find(device)
        if node is None:
            raise DeviceUnreachable("This device is no longer on CUBE's Matter network.", recovery="Remove it and add it again.")
        if not node.available:
            raise DeviceUnreachable("The device isn't answering the Matter Server.", recovery="Check it has power and is on the network.")
        return node

    async def get_state(self, device: StoredDevice) -> DeviceState:
        return self._state(device, self._node(device))

    async def execute_command(self, device: StoredDevice, command: str, params: dict[str, Any]) -> CommandOutcome:
        node = self._node(device)
        node_id = node.node_id
        expect: list[tuple[str, Callable[[Any], bool]]] = []

        def need(cluster: int) -> int:
            endpoint = node.endpoint_for(cluster)
            if endpoint is None:
                raise UnsupportedCommand(f"{device.name} doesn't offer {command}.")
            return endpoint

        if command in {"turn_on", "turn_off", "toggle"} and node.endpoint_for(ON_OFF) is None and node.endpoint_for(THERMOSTAT) is not None and command != "toggle":
            ep = need(THERMOSTAT)
            sequence = node.get(ep, THERMOSTAT, 27, 4)
            mode = 0 if command == "turn_off" else (1 if sequence in CAN_COOL and sequence in CAN_HEAT else 4 if sequence in CAN_HEAT else 3)
            await self._write(node_id, f"{ep}/{THERMOSTAT}/28", mode)
            expect.append((f"{ep}/{THERMOSTAT}/28", lambda v, m=mode: v == m))
        elif command in {"turn_on", "turn_off", "toggle"}:
            ep = need(ON_OFF)
            want = {"turn_on": True, "turn_off": False}.get(command, not bool(node.get(ep, ON_OFF, 0)))
            await self._command(node_id, ep, ON_OFF, {"turn_on": "On", "turn_off": "Off", "toggle": "Toggle"}[command])
            expect.append((f"{ep}/{ON_OFF}/0", lambda v, w=want: bool(v) is w))
        elif command == "set_brightness":
            ep = need(LEVEL)
            percent = caps.clamp(caps.param(params, "brightness"), 0, 100, "brightness")
            if percent == 0:
                off = need(ON_OFF)
                await self._command(node_id, off, ON_OFF, "Off")
                expect.append((f"{off}/{ON_OFF}/0", lambda v: v is False))
            else:
                level = max(1, round(percent / 100 * 254))
                await self._command(node_id, ep, LEVEL, "MoveToLevelWithOnOff", {"level": level, "transitionTime": 0})
                expect.append((f"{ep}/{LEVEL}/0", lambda v, want=level: isinstance(v, int) and abs(v - want) <= 2))
        elif command == "set_color_temp":
            ep = need(COLOR)
            kelvin = caps.clamp(caps.param(params, "kelvin"), 1000, 12000, "kelvin")
            coolest, warmest = node.get(ep, COLOR, 16395) or 153, node.get(ep, COLOR, 16396) or 500
            mireds = round(min(max(1_000_000 / kelvin, coolest), warmest))
            await self._command(node_id, ep, COLOR, "MoveToColorTemperature", {"colorTemperatureMireds": mireds, "transitionTime": 0})
            expect.append((f"{ep}/{COLOR}/7", lambda v, want=mireds: isinstance(v, int) and abs(v - want) <= 2))
        elif command == "set_temperature":
            ep = need(THERMOSTAT)
            target = caps.clamp(caps.param(params, "temperature"), 0, 50, "temperature")
            sequence, mode = node.get(ep, THERMOSTAT, 27, 4), SYSTEM_MODES.get(node.get(ep, THERMOSTAT, 28))
            can_cool, can_heat = sequence in CAN_COOL, sequence in CAN_HEAT
            attribute = 17 if mode == "cool" else 18 if mode == "heat" else (18 if can_heat and not can_cool else 17 if can_cool and not can_heat else None)
            if attribute is None:
                raise AdapterError("In this mode the thermostat keeps separate heating and cooling targets. Choose Heat or Cool first.", code="bad_params")
            value = round(target * 100)
            await self._write(node_id, f"{ep}/{THERMOSTAT}/{attribute}", value)
            expect.append((f"{ep}/{THERMOSTAT}/{attribute}", lambda v, want=value: v == want))
        elif command == "set_hvac_mode":
            ep = need(THERMOSTAT)
            mode = str(caps.param(params, "mode"))
            if mode not in MODE_VALUES or mode not in _climate(node, ep).modes:
                raise UnsupportedCommand(f"{device.name} doesn't offer the {mode} mode.")
            await self._write(node_id, f"{ep}/{THERMOSTAT}/28", MODE_VALUES[mode])
            expect.append((f"{ep}/{THERMOSTAT}/28", lambda v, want=MODE_VALUES[mode]: v == want))
        elif command in {"cover_open", "cover_close", "cover_stop"}:
            ep = need(COVER)
            await self._command(node_id, ep, COVER, {"cover_open": "UpOrOpen", "cover_close": "DownOrClose", "cover_stop": "StopMotion"}[command])
        elif command == "set_position":
            ep = need(COVER)
            if not node.has(ep, COVER, 14):
                raise UnsupportedCommand(f"{device.name} can only open, close and stop.")
            position = caps.clamp(caps.param(params, "position"), 0, 100, "position")
            await self._command(node_id, ep, COVER, "GoToLiftPercentage", {"liftPercent100thsValue": round(100 - position) * 100})
        else:
            raise UnsupportedCommand(f"{device.name} doesn't offer {command}.")
        result = await self._confirm(node_id, expect)
        return CommandOutcome(result=result, state=self._state(device, self.nodes.get(node_id, node)))

    async def _command(self, node_id: int, endpoint: int, cluster: int, name: str, payload: dict[str, Any] | None = None) -> None:
        await self._call("device_command", node_id=node_id, endpoint_id=endpoint, cluster_id=cluster, command_name=name, payload=payload or {})

    async def _write(self, node_id: int, path: str, value: Any) -> None:
        await self._call("write_attribute", node_id=node_id, attribute_path=path, value=value)

    async def _confirm(self, node_id: int, expect: list[tuple[str, Callable[[Any], bool]]]) -> CommandResult:
        """Confirmed once the device reports the new value (the subscription usually brings it within a second)."""
        if not expect:
            return CommandResult(status="pending", message="Sent. The device reports its new position as it moves.")

        def met() -> bool:
            node = self.nodes.get(node_id)
            return node is not None and all(check(node.values.get(path)) for path, check in expect)

        deadline = time.monotonic() + CONFIRM_WAIT
        while not met() and time.monotonic() < deadline:
            await asyncio.sleep(0.1)
        if not met():
            with contextlib.suppress(AdapterError):
                paths = [path for path, _ in expect]
                values = await self._call("read_attribute", node_id=node_id, attribute_path=paths if len(paths) > 1 else paths[0])
                node = self.nodes.get(node_id)
                if node is not None and isinstance(values, dict):
                    node.values.update({str(path): value for path, value in values.items()})
        if met():
            return CommandResult(status="confirmed")
        return CommandResult(status="pending", message="The device accepted the command but hasn't reported the new state yet.")

    async def forget(self, device: StoredDevice) -> None:
        node = self._find(device)
        node_id = node.node_id if node is not None else int(device.params.get("node_id", -1))
        try:
            await self._call("remove_node", timeout=30, node_id=node_id)
        except AdapterError as error:
            self.log.warning("could not remove the device from CUBE's Matter network", extra={"node_id": node_id, "reason": error.message})
            raise


def _server_error(message: dict[str, Any]) -> AdapterError:
    """Matter Server error codes: matter_server/common/errors.py."""
    code, details = message.get("error_code"), clean_text(message.get("details"), 200) or ""
    if code == 1:
        return PairingRejected(
            "The device couldn't be added to CUBE's Matter network.",
            recovery="Check the setup code, that the device is in pairing mode (or freshly shared from its other app) and that it is on this network.",
        )
    if code in {3, 4}:
        return DeviceUnreachable("The device isn't answering the Matter Server.")
    if code == 5:
        return DeviceUnreachable("This device is no longer on CUBE's Matter network.", recovery="Remove it and add it again.")
    if code in {8, 9}:
        return AdapterError(f"The Matter Server refused the command: {details}".rstrip(": "), code="bad_params")
    return AdapterError(f"The Matter Server reported an error: {details}".rstrip(": "))
