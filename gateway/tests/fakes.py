"""Test doubles: a scriptable adapter and an mDNS service that returns canned records."""

from __future__ import annotations

import asyncio
from typing import Any

from cube_gateway.adapters import caps
from cube_gateway.adapters.base import (
    AdapterError,
    AuthRequired,
    CommandOutcome,
    DeviceAdapter,
    DeviceState,
    DeviceUnreachable,
    LocalKeyRequired,
    MdnsRecord,
    PairResult,
    ScanContext,
    StoredDevice,
    UnsupportedCommand,
    make_candidate,
)
from cube_gateway.models import AdapterInfo, AuthKind, Candidate, Category, CommandResult, FieldSpec, PairingRequirements


class FakeMdns:
    def __init__(self, records: list[MdnsRecord] | None = None):
        self.records = records or []
        self.advertised: list[tuple] = []
        self.available = True

    async def start(self) -> None: ...

    async def stop(self) -> None: ...

    async def advertise(self, *args: Any) -> None:
        self.advertised.append(args)

    async def browse(self, types: list[str], duration: float, cancelled: asyncio.Event) -> list[MdnsRecord]:
        await asyncio.sleep(min(duration, 0.05))
        return [r for r in self.records if r.type in types]

    async def resolve(self, service_type: str, instance: str) -> MdnsRecord | None:
        return next((r for r in self.records if r.type == service_type and r.name == instance), None)


def info(adapter_id: str = "fake", brand: str = "fakebrand", auth: AuthKind = AuthKind.NONE, status: str = "supported") -> AdapterInfo:
    return AdapterInfo(
        id=adapter_id,
        name=f"{adapter_id} adapter",
        brands=[brand],
        protocols=["fake"],
        discovery=["fake"],
        categories=[Category.PLUG],
        status=status,
        account_free=True,
        auth=auth,
    )


class FakeAdapter(DeviceAdapter):
    """Reports `self.devices` (unique_id -> fields) on discover; keeps a power state per device."""

    info = info()
    poll_interval = 1

    def __init__(self, ctx, *, adapter_info: AdapterInfo | None = None):
        if adapter_info is not None:
            self.info = adapter_info  # type: ignore[misc]
        super().__init__(ctx)
        self.devices: dict[str, dict[str, Any]] = {}
        self.power: dict[str, bool] = {}
        self.reachable = True
        self.crash_on: set[str] = set()
        self.assumed = False
        self.required_key: str | None = None
        #: The credential name the fake's key arrives under ("device_key" for the SONOFF provisioning path).
        self.key_field = "local_key"
        self.discover_delay = 0.0
        self.calls: list[str] = []

    async def discover(self, scan: ScanContext) -> None:
        self.calls.append("discover")
        if "discover" in self.crash_on:
            raise RuntimeError("discovery exploded")
        if self.discover_delay:
            await asyncio.sleep(self.discover_delay)
        for unique_id, fields in self.devices.items():
            if scan.in_scope(fields.get("ip")):
                scan.report(make_candidate(self, unique_id, sources=["fake"], **fields))

    def get_pairing_requirements(self, candidate: Candidate) -> PairingRequirements:
        if self.required_key:
            return PairingRequirements(auth=AuthKind.LOCAL_KEY, fields=[FieldSpec(name=self.key_field, label="Local key", kind="password", secret=True)])
        return PairingRequirements(auth=self.info.auth)

    async def identify(self, candidate: Candidate) -> Candidate:
        candidate.pairing = self.get_pairing_requirements(candidate)
        return candidate

    async def pair(self, candidate: Candidate, credentials: dict[str, str], approval) -> PairResult:
        self.calls.append("pair")
        if "pair" in self.crash_on:
            raise RuntimeError("pairing exploded")
        if self.info.auth == AuthKind.APPROVE_ON_DEVICE:
            await approval("Accept on the device")
            await asyncio.sleep(0.05)
        if self.required_key and credentials.get(self.key_field) != self.required_key:
            if not credentials.get(self.key_field):
                raise LocalKeyRequired("Needs the local key.")
            raise LocalKeyRequired("Wrong key.", code="local_key_invalid")
        if not self.reachable:
            raise DeviceUnreachable("Fake device is off.")
        self.power.setdefault(candidate.unique_id, False)
        creds = {"local_key": credentials[self.key_field]} if self.required_key else {}
        return PairResult(unique_id=candidate.unique_id, name=candidate.name or "Fake plug", category=Category.PLUG, model=candidate.model, host=candidate.ip, mac=candidate.mac, credentials=creds)

    def _state(self, unique_id: str, confirmed: bool = True) -> DeviceState:
        capabilities = [caps.power(self.power.get(unique_id, False), confirmed=confirmed)]
        return DeviceState(capabilities=capabilities, readings=[caps.reading("power_w", "Power", 3.5, "W")], commands=caps.commands_for(capabilities))

    async def get_state(self, device: StoredDevice) -> DeviceState:
        self.calls.append("get_state")
        if "get_state" in self.crash_on:
            raise RuntimeError("state exploded")
        if not self.reachable:
            raise DeviceUnreachable("Fake device is off.")
        if self.required_key and device.credentials.get("local_key") != self.required_key:
            raise AuthRequired("bad key")
        return self._state(device.unique_id)

    async def execute_command(self, device: StoredDevice, command: str, params: dict[str, Any]) -> CommandOutcome:
        self.calls.append(f"cmd:{command}")
        if "command" in self.crash_on:
            raise RuntimeError("command exploded")
        if not self.reachable:
            raise DeviceUnreachable("Fake device is off.")
        if command == "slow":
            await asyncio.sleep(30)
        if command not in {"turn_on", "turn_off", "toggle"}:
            raise UnsupportedCommand(f"no {command}")
        current = self.power.get(device.unique_id, False)
        self.power[device.unique_id] = {"turn_on": True, "turn_off": False}.get(command, not current)
        if self.assumed:
            return CommandOutcome(result=CommandResult(status="assumed", message="no feedback"), state=self._state(device.unique_id, confirmed=False))
        return CommandOutcome(result=CommandResult(status="confirmed"), state=self._state(device.unique_id))


class BrokenAdapter(FakeAdapter):
    info = info("broken", "fakebrand")

    async def discover(self, scan: ScanContext) -> None:
        raise AdapterError("broken on purpose")
