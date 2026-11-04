"""Other / unknown brands: shows what answers on the network that no specific adapter claimed.

These candidates are `detection_only`. The gateway never pretends to control them: pairing one fails with a
clear message. Useful to confirm a device is on the network and to see what it advertises.
"""

from __future__ import annotations

from typing import Any

from ..models import AdapterInfo, AuthKind, Candidate, Category, ConnectionStatus, PairingRequirements, SupportLevel
from .base import ApprovalCallback, CommandOutcome, DeviceAdapter, DeviceState, NotSupported, PairResult, ScanContext, StoredDevice, make_candidate

_KNOWN = {
    "_googlecast._tcp.local.": "Google Cast device",
    "_airplay._tcp.local.": "AirPlay device",
    "_hap._tcp.local.": "HomeKit accessory",
    "_matter._tcp.local.": "Matter device",
    "_matterc._udp.local.": "Matter device (commissioning)",
    "_ipp._tcp.local.": "Printer",
    "_spotify-connect._tcp.local.": "Spotify Connect speaker",
    "_http._tcp.local.": "Web-enabled device",
}


class GenericAdapter(DeviceAdapter):
    info = AdapterInfo(
        id="generic",
        name="Unknown devices (detection only)",
        brands=["other"],
        protocols=["mdns", "ssdp"],
        discovery=["mdns", "ssdp"],
        categories=[Category.OTHER],
        status=SupportLevel.UNSUPPORTED,
        account_free=True,
        auth=AuthKind.NONE,
        local_control=False,
        notes=["Shows devices no adapter recognises. They cannot be controlled."],
    )
    mdns_types = tuple(_KNOWN)

    async def discover(self, scan: ScanContext) -> None:
        await scan.wait_passive()
        claimed = scan.claimed_ips
        for record in scan.mdns:
            if record.ip in claimed or not scan.in_scope(record.ip):
                continue
            kind = _KNOWN.get(record.type, "Network device")
            scan.report(self._candidate(f"mdns:{record.type}:{record.name}", record.name or kind, record.properties.get("md") or kind, record.ip, record.port, f"mdns:{record.type.split('.')[0]}"))
        for record in scan.ssdp:
            if record.ip in claimed or not scan.in_scope(record.ip):
                continue
            identity = record.usn.split("::")[0] or record.st
            scan.report(self._candidate(f"ssdp:{identity}", record.server or "UPnP device", record.st, record.ip, None, "ssdp"))

    def _candidate(self, unique: str, name: str, model: str | None, ip: str, port: int | None, protocol: str) -> Candidate:
        candidate = make_candidate(self, unique, name=name, model=model, ip=ip, port=port, protocol=protocol, sources=[protocol.split(":")[0]], control="detection_only")
        candidate.status = ConnectionStatus.UNSUPPORTED
        candidate.pairing = self.get_pairing_requirements(candidate)
        return candidate

    def get_pairing_requirements(self, candidate: Candidate) -> PairingRequirements:
        return PairingRequirements(auth=AuthKind.NONE, instructions="CUBE cannot control this device yet. It is shown so you can see it is on your network.")

    async def pair(self, candidate: Candidate, credentials: dict[str, str], approval: ApprovalCallback) -> PairResult:
        raise NotSupported("CUBE has no adapter for this device, so it cannot be added.", code="unsupported_device")

    async def get_state(self, device: StoredDevice) -> DeviceState:
        raise NotSupported("Unknown devices cannot be read.")

    async def execute_command(self, device: StoredDevice, command: str, params: dict[str, Any]) -> CommandOutcome:
        raise NotSupported("Unknown devices cannot be controlled.")
