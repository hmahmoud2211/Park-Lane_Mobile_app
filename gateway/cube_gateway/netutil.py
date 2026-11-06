"""The host's network interfaces, as seen with --network host: which subnets may be scanned, and
whether Tailscale is up for remote access.

Only private IPv4 networks are ever scanned. Without CUBE_SCAN_SUBNETS the gateway takes the /24 around
each private interface address, skipping Docker bridges, loopback, link-local and VPN ranges.
"""

from __future__ import annotations

import fcntl
import ipaddress
import os
import socket
import struct
from dataclasses import dataclass

_SKIP_PREFIXES = ("lo", "docker", "br-", "veth", "virbr", "cni", "flannel", "kube", "tailscale", "wg", "tun", "zt")
_CGNAT = ipaddress.ip_network("100.64.0.0/10")
SIOCGIFADDR = 0x8915
SIOCGIFNETMASK = 0x891B


@dataclass(frozen=True)
class Interface:
    name: str
    address: ipaddress.IPv4Address
    network: ipaddress.IPv4Network


def _ioctl_addr(sock: socket.socket, name: str, request: int) -> str | None:
    try:
        packed = fcntl.ioctl(sock.fileno(), request, struct.pack("256s", name[:15].encode()))
    except OSError:
        return None
    return socket.inet_ntoa(packed[20:24])


def interfaces() -> list[Interface]:
    found: list[Interface] = []
    try:
        names = [name for _, name in socket.if_nameindex()]
    except OSError:
        return found
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
        for name in names:
            address = _ioctl_addr(sock, name, SIOCGIFADDR)
            netmask = _ioctl_addr(sock, name, SIOCGIFNETMASK)
            if not address or not netmask:
                continue
            network = ipaddress.ip_network(f"{address}/{netmask}", strict=False)
            found.append(Interface(name, ipaddress.ip_address(address), network))  # type: ignore[arg-type]
    return found


def lan_interfaces() -> list[Interface]:
    result = []
    for iface in interfaces():
        if iface.name.startswith(_SKIP_PREFIXES):
            continue
        if not iface.address.is_private or iface.address.is_loopback or iface.address.is_link_local:
            continue
        if iface.address in _CGNAT:
            continue
        result.append(iface)
    return result


def scan_subnets(configured: list[ipaddress.IPv4Network]) -> list[ipaddress.IPv4Network]:
    if configured:
        return configured
    subnets: list[ipaddress.IPv4Network] = []
    for iface in lan_interfaces():
        # Never wider than a /24 around the gateway, even on a /16 home network.
        prefix = max(iface.network.prefixlen, 24)
        subnet = ipaddress.ip_network(f"{iface.address}/{prefix}", strict=False)
        if subnet not in subnets:
            subnets.append(subnet)  # type: ignore[arg-type]
    return subnets


def primary_address() -> str | None:
    lan = lan_interfaces()
    return str(lan[0].address) if lan else None


def _is_loopback(host: str) -> bool:
    if host == "localhost":
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def phone_address(bind_host: str) -> str | None:
    """The address phones should use: the bind address when it names one, else the first private LAN address.
    None when the gateway listens only on this machine, where no phone can reach it."""
    if not bind_host or bind_host in {"0.0.0.0", "::"}:
        return primary_address()
    return None if _is_loopback(bind_host) else bind_host


def tailscale_addresses() -> list[str]:
    return [str(iface.address) for iface in interfaces() if iface.name.startswith("tailscale") or iface.address in _CGNAT]


def is_private_host(host: str) -> bool:
    try:
        address = ipaddress.ip_address(host)
    except ValueError:
        return False
    return address.version == 4 and address.is_private and not address.is_loopback and not address.is_link_local


def running_in_container() -> bool:
    return os.path.exists("/.dockerenv")
