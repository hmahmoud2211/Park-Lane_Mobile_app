"""SSDP / UPnP M-SEARCH. Replies are parsed defensively: headers are size-limited and cleaned, and only
replies from private addresses are kept."""

from __future__ import annotations

import asyncio
import logging
import socket

from ..adapters.base import SsdpRecord
from ..models import clean_text
from ..netutil import is_private_host

log = logging.getLogger("cube.ssdp")
GROUP = ("239.255.255.250", 1900)
MAX_REPLY = 4096


def build_search(target: str, mx: int = 2) -> bytes:
    return (
        "M-SEARCH * HTTP/1.1\r\n"
        f"HOST: {GROUP[0]}:{GROUP[1]}\r\n"
        'MAN: "ssdp:discover"\r\n'
        f"MX: {mx}\r\n"
        f"ST: {target}\r\n"
        "\r\n"
    ).encode()


def parse_reply(data: bytes, ip: str) -> SsdpRecord | None:
    if len(data) > MAX_REPLY or not is_private_host(ip):
        return None
    try:
        text = data.decode("utf-8", "replace")
    except Exception:  # noqa: BLE001
        return None
    lines = text.split("\r\n")
    if not lines or not (lines[0].startswith("HTTP/1.1 200") or lines[0].startswith("NOTIFY")):
        return None
    headers: dict[str, str] = {}
    for line in lines[1:40]:
        key, sep, value = line.partition(":")
        if sep:
            headers[key.strip().lower()[:40]] = clean_text(value, 512) or ""
    st = headers.get("st") or headers.get("nt") or ""
    usn = headers.get("usn") or ""
    if not st and not usn:
        return None
    return SsdpRecord(ip=ip, st=st, usn=usn, location=headers.get("location"), server=headers.get("server"), headers=headers)


class _Collector(asyncio.DatagramProtocol):
    def __init__(self) -> None:
        self.records: dict[tuple[str, str], SsdpRecord] = {}

    def datagram_received(self, data: bytes, addr: tuple[str, int]) -> None:  # type: ignore[override]
        record = parse_reply(data, addr[0])
        if record:
            self.records[(record.ip, record.usn or record.st)] = record


async def search(targets: list[str], duration: float, cancelled: asyncio.Event) -> list[SsdpRecord]:
    loop = asyncio.get_running_loop()
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP)
    sock.setsockopt(socket.IPPROTO_IP, socket.IP_MULTICAST_TTL, 2)
    sock.bind(("0.0.0.0", 0))
    sock.setblocking(False)
    try:
        transport, protocol = await loop.create_datagram_endpoint(_Collector, sock=sock)
    except OSError as error:
        sock.close()
        log.warning("SSDP unavailable", extra={"reason": str(error)})
        return []
    try:
        deadline = loop.time() + duration
        rounds = 0
        while loop.time() < deadline and not cancelled.is_set():
            if rounds < 3:
                for target in targets:
                    try:
                        transport.sendto(build_search(target), GROUP)
                    except OSError:
                        pass
                rounds += 1
            await asyncio.sleep(min(1.0, max(0.05, deadline - loop.time())))
    finally:
        transport.close()
    return list(protocol.records.values())
