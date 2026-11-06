"""The interface every manufacturer or protocol adapter implements.

An adapter is one class per protocol (Shelly RPC, Kasa, Tuya, webOS, ...). The gateway calls it through
`AdapterRegistry`, which wraps every call in a timeout and an exception guard: an adapter that hangs or
crashes fails its own operation and nothing else.

Lifecycle of a device through an adapter:

    discover()  ->  identify()  ->  get_pairing_requirements()  ->  pair()  ->  StoredDevice (persisted)
    then, for the stored device:  get_state() / execute_command() / subscribe_to_events() / disconnect()

`provision()` (Wi-Fi setup of a factory-new device) is implemented by provisioning plugins in
cube_gateway.provisioning, which name the adapter that takes over once the device is on the LAN.
"""

from __future__ import annotations

import asyncio
import hashlib
import ipaddress
import logging
from abc import ABC, abstractmethod
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any, ClassVar

import httpx

from ..config import Settings
from ..models import (
    AdapterInfo,
    AuthKind,
    Candidate,
    Capability,
    Category,
    CommandResult,
    PairingRequirements,
    Reading,
    Setting,
    clean_text,
)

# ---- errors ----------------------------------------------------------------------------------------


class AdapterError(Exception):
    """A failure with a code the app can act on and a sentence the user can read."""

    code = "adapter_error"
    recovery = "Try again. If it keeps failing, restart the device."

    def __init__(self, message: str, *, code: str | None = None, recovery: str | None = None):
        super().__init__(message)
        self.message = message
        if code:
            self.code = code
        if recovery:
            self.recovery = recovery


class DeviceUnreachable(AdapterError):
    code = "device_unreachable"
    recovery = "Check the device has power and is on the same network as the gateway."


class AuthRequired(AdapterError):
    code = "auth_required"
    recovery = "Enter the device's credentials, or approve the request on the device."


class LocalKeyRequired(AdapterError):
    code = "local_key_required"
    recovery = "This device encrypts its local protocol. Enter its local key to control it."


class PairingRejected(AdapterError):
    code = "pairing_rejected"
    recovery = "Start pairing again and accept the request on the device when it appears."


class UnsupportedCommand(AdapterError):
    code = "unsupported_command"
    recovery = "This device does not offer that control."


class NotSupported(AdapterError):
    code = "not_supported"
    recovery = "Use another connection method for this device."


# ---- records the discovery engine hands to adapters ------------------------------------------------


@dataclass(frozen=True)
class MdnsRecord:
    type: str
    name: str
    ip: str
    port: int
    properties: dict[str, str]
    server: str | None = None


@dataclass(frozen=True)
class SsdpRecord:
    ip: str
    st: str
    usn: str
    location: str | None
    server: str | None
    headers: dict[str, str]


class ScanContext:
    """One discovery job's view of the network, shared by all adapters taking part.

    The engine fills the mDNS and SSDP records while adapters run their own vendor discovery; adapters call
    `wait_passive()` before reading them. Every candidate goes through `report()`.
    """

    def __init__(
        self,
        *,
        timeout: float,
        subnets: list[ipaddress.IPv4Network],
        report: Callable[[Candidate], None],
        cancelled: asyncio.Event | None = None,
    ):
        self.timeout = timeout
        self.subnets = subnets
        self._report = report
        self.cancelled = cancelled or asyncio.Event()
        self.mdns: list[MdnsRecord] = []
        self.ssdp: list[SsdpRecord] = []
        self.open_ports: dict[int, set[str]] = {}
        self.passive_done = asyncio.Event()
        #: Addresses a specific adapter already claimed; the generic adapter reports only the rest.
        self.claimed_ips: set[str] = set()

    def report(self, candidate: Candidate) -> None:
        if not self.cancelled.is_set():
            self._report(candidate)

    async def wait_passive(self) -> None:
        """Waits until mDNS/SSDP collection and the subnet probe have finished (or the scan is cancelled)."""
        waiters = [asyncio.ensure_future(self.passive_done.wait()), asyncio.ensure_future(self.cancelled.wait())]
        try:
            await asyncio.wait(waiters, return_when=asyncio.FIRST_COMPLETED)
        finally:
            for waiter in waiters:
                waiter.cancel()

    def mdns_of(self, *types: str) -> list[MdnsRecord]:
        wanted = {t.rstrip(".") for t in types}
        return [record for record in self.mdns if record.type.rstrip(".") in wanted]

    def ssdp_matching(self, predicate: Callable[[SsdpRecord], bool]) -> list[SsdpRecord]:
        return [record for record in self.ssdp if predicate(record)]

    def hosts_with_port(self, port: int) -> list[str]:
        return sorted(self.open_ports.get(port, set()), key=lambda ip: ipaddress.ip_address(ip))

    def in_scope(self, ip: str | None) -> bool:
        """Only devices on the home networks being scanned are accepted, whatever a reply claims."""
        if not ip:
            return False
        try:
            address = ipaddress.ip_address(ip)
        except ValueError:
            return False
        if not address.is_private or address.is_loopback or address.is_link_local:
            return False
        return any(address in network for network in self.subnets) if self.subnets else True


# ---- stored devices and live state -----------------------------------------------------------------


@dataclass
class StoredDevice:
    """A paired device as the registry keeps it. `credentials` are unsealed in memory only."""

    id: str
    adapter_id: str
    brand: str
    unique_id: str
    name: str
    category: Category
    model: str | None = None
    host: str | None = None
    port: int | None = None
    mac: str | None = None
    protocol: str | None = None
    params: dict[str, Any] = field(default_factory=dict)
    credentials: dict[str, Any] = field(default_factory=dict)


@dataclass
class PairResult:
    """What pair() learned: enough to reconnect after a gateway restart without asking the user again."""

    unique_id: str
    name: str
    category: Category
    model: str | None = None
    host: str | None = None
    port: int | None = None
    mac: str | None = None
    protocol: str | None = None
    params: dict[str, Any] = field(default_factory=dict)
    credentials: dict[str, Any] = field(default_factory=dict)


@dataclass
class DeviceState:
    capabilities: list[Capability] = field(default_factory=list)
    readings: list[Reading] = field(default_factory=list)
    settings: list[Setting] = field(default_factory=list)
    commands: list[str] = field(default_factory=list)
    online: bool = True
    #: Changes to connection details seen while reading state (a new IP after DHCP renewal, a firmware version).
    host: str | None = None
    params: dict[str, Any] | None = None
    #: A model name learned after pairing (e.g. from a later announcement).
    model: str | None = None


@dataclass
class CommandOutcome:
    result: CommandResult
    state: DeviceState | None = None


#: Called by pair() while it waits for the user, e.g. "Accept the prompt on your TV".
ApprovalCallback = Callable[[str], Awaitable[None]]
#: Called by subscribe_to_events() whenever the device pushes a change.
StateCallback = Callable[[DeviceState], Awaitable[None]]


class AdapterContext:
    """Shared resources: settings, a pooled HTTP client, and a logger per adapter."""

    def __init__(self, settings: Settings, http: httpx.AsyncClient | None = None):
        self.settings = settings
        self.http = http or httpx.AsyncClient(timeout=httpx.Timeout(6.0, connect=3.0), follow_redirects=False)
        #: The gateway's MdnsService, for adapters that read state from mDNS announcements (SONOFF LAN mode).
        self.mdns: Any = None
        #: The gateway's CloudLink to the device broker (server-hosted mode), else None.
        self.cloud: Any = None

    def logger(self, adapter_id: str) -> logging.Logger:
        return logging.getLogger(f"cube.adapter.{adapter_id}")

    async def close(self) -> None:
        await self.http.aclose()


# ---- the interface ---------------------------------------------------------------------------------


class DeviceAdapter(ABC):
    info: ClassVar[AdapterInfo]
    #: Service types the engine browses for this adapter, e.g. "_shelly._tcp.local.".
    mdns_types: ClassVar[tuple[str, ...]] = ()
    #: SSDP search targets the engine sends, e.g. "urn:dial-multiscreen-org:service:dial:1".
    ssdp_targets: ClassVar[tuple[str, ...]] = ()
    #: TCP ports the authorized subnet probe checks for this adapter (for devices that do not advertise).
    probe_ports: ClassVar[tuple[int, ...]] = ()
    #: Seconds between state polls when the adapter has no push updates; None uses CUBE_POLL_INTERVAL.
    poll_interval: ClassVar[int | None] = None
    #: Per-call timeout the registry enforces on get_state/execute_command.
    call_timeout: ClassVar[float] = 10.0

    def __init__(self, ctx: AdapterContext):
        self.ctx = ctx
        self.log = ctx.logger(self.info.id)

    # -- lifecycle --

    async def start(self) -> None:
        """Opens long-lived resources (e.g. an MQTT connection). Must not raise for a missing optional service."""

    async def stop(self) -> None:
        """Closes them."""

    def available(self) -> tuple[bool, str | None]:
        """Whether the adapter can work in this deployment, and why not."""
        return True, None

    # -- discovery --

    @abstractmethod
    async def discover(self, scan: ScanContext) -> None:
        """Finds devices: reads the shared mDNS/SSDP records and runs vendor discovery, calling scan.report()."""

    async def identify(self, candidate: Candidate) -> Candidate:
        """Asks the device for its model and firmware. Returns the candidate unchanged when it cannot."""
        return candidate

    async def probe(self, host: str) -> Candidate | None:
        """Checks one address the user typed. None when this adapter does not recognise a device there."""
        return None

    def get_pairing_requirements(self, candidate: Candidate) -> PairingRequirements:
        return PairingRequirements(auth=self.info.auth)

    # -- provisioning (delegated to cube_gateway.provisioning plugins) --

    async def provision(self, *args: Any, **kwargs: Any) -> None:
        raise NotSupported(f"{self.info.name} devices are set up on Wi-Fi with a provisioning plugin, not the adapter.")

    # -- pairing --

    @abstractmethod
    async def pair(self, candidate: Candidate, credentials: dict[str, str], approval: ApprovalCallback) -> PairResult:
        """Authorizes locally and proves control works (reads state). Raises AdapterError subclasses on failure."""

    # -- control --

    async def get_capabilities(self, device: StoredDevice) -> list[Capability]:
        return (await self.get_state(device)).capabilities

    @abstractmethod
    async def get_state(self, device: StoredDevice) -> DeviceState:
        """Reads the device's current state. Raises DeviceUnreachable when it does not answer."""

    @abstractmethod
    async def execute_command(self, device: StoredDevice, command: str, params: dict[str, Any]) -> CommandOutcome:
        """Runs one normalized command. Raises UnsupportedCommand for anything the device does not offer."""

    async def subscribe_to_events(self, device: StoredDevice, callback: StateCallback) -> Callable[[], Awaitable[None]] | None:
        """Starts push updates for a device and returns an unsubscribe coroutine; None means poll instead."""
        return None

    async def disconnect(self, device: StoredDevice) -> None:
        """Releases anything held open for the device (sockets, sessions)."""

    async def forget(self, device: StoredDevice) -> None:
        """The user removed the device: gives up anything kept for it beyond a restart, such as a broker login."""


# ---- helpers shared by adapters --------------------------------------------------------------------


def candidate_id(adapter_id: str, unique_id: str) -> str:
    return "cand_" + hashlib.sha256(f"{adapter_id}|{unique_id}".encode()).hexdigest()[:16]


def make_candidate(adapter: DeviceAdapter | type[DeviceAdapter], unique_id: str, **fields: Any) -> Candidate:
    info = adapter.info
    for text_field in ("name", "model", "protocol"):
        if text_field in fields:
            fields[text_field] = clean_text(fields[text_field])
    if fields.get("mac"):
        fields["mac"] = normalize_mac(fields["mac"])
    unique = clean_text(unique_id, 128) or "unknown"
    return Candidate(
        id=candidate_id(info.id, unique),
        adapter_id=info.id,
        brand=fields.pop("brand", info.brands[0]),
        unique_id=unique,
        account_free=fields.pop("account_free", info.account_free),
        control=fields.pop("control", "experimental" if info.status == "experimental" else "supported"),
        **fields,
    )


def normalize_mac(value: str | None) -> str | None:
    if not value:
        return None
    digits = "".join(ch for ch in str(value).lower() if ch in "0123456789abcdef")
    if len(digits) != 12:
        return None
    return ":".join(digits[i : i + 2] for i in range(0, 12, 2))


def require_auth_fields(credentials: dict[str, str], *names: str) -> dict[str, str]:
    missing = [name for name in names if not credentials.get(name, "").strip()]
    if missing:
        raise AuthRequired(f"Missing {', '.join(missing)}.", code="credentials_missing")
    return {name: credentials[name].strip() for name in names}


AUTH_NONE = AuthKind.NONE
