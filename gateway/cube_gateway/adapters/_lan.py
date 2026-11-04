"""UDP discovery, request/response and Wake-on-LAN helpers shared by the vendor adapters.

Every helper is bounded in time and stops early when the scan is cancelled. Broadcasts go to
255.255.255.255 and to the broadcast address of each network being scanned; nothing is sent elsewhere.
"""

from __future__ import annotations

import asyncio
import contextlib
import socket
from collections.abc import Callable

from ..models import Candidate
from .base import DeviceUnreachable, ScanContext

#: Longest a vendor UDP discovery listens, whatever the job's timeout.
DISCOVERY_WINDOW = 6.0

Reply = tuple[bytes, str, int]


def report(scan: ScanContext, candidate: Candidate) -> None:
    """Reports a candidate and claims its address, so the generic adapter does not list it again."""
    if candidate.ip:
        scan.claimed_ips.add(candidate.ip)
    scan.report(candidate)


def window(scan: ScanContext, cap: float = DISCOVERY_WINDOW) -> float:
    return max(0.5, min(scan.timeout, cap))


def broadcast_targets(scan: ScanContext, port: int) -> list[tuple[str, int]]:
    targets = [("255.255.255.255", port)]
    for network in scan.subnets:
        target = (str(network.broadcast_address), port)
        if target not in targets:
            targets.append(target)
    return targets


class _Collector(asyncio.DatagramProtocol):
    def __init__(self, on_reply: Callable[[Reply], None] | None):
        self.replies: list[Reply] = []
        self.on_reply = on_reply

    def datagram_received(self, data: bytes, addr: tuple[str, int]) -> None:  # type: ignore[override]
        reply = (data, addr[0], addr[1])
        self.replies.append(reply)
        if self.on_reply:
            self.on_reply(reply)

    def error_received(self, exc: Exception) -> None:
        pass


def _udp_socket(local_port: int = 0, reuse: bool = False) -> socket.socket:
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
    if reuse:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        if hasattr(socket, "SO_REUSEPORT"):
            with contextlib.suppress(OSError):
                sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEPORT, 1)
    sock.bind(("0.0.0.0", local_port))
    sock.setblocking(False)
    return sock


async def _sleep_or_cancel(seconds: float, cancelled: asyncio.Event | None) -> None:
    if cancelled is None:
        await asyncio.sleep(seconds)
        return
    with contextlib.suppress(TimeoutError):
        await asyncio.wait_for(cancelled.wait(), timeout=seconds)


async def udp_broadcast(
    targets: list[tuple[str, int]],
    payload: bytes,
    *,
    duration: float,
    cancelled: asyncio.Event | None = None,
    repeat: int = 3,
    interval: float = 1.0,
    on_reply: Callable[[Reply], None] | None = None,
) -> list[Reply]:
    """Sends `payload` to every target a few times and collects replies for `duration` seconds."""
    loop = asyncio.get_running_loop()
    transport, protocol = await loop.create_datagram_endpoint(lambda: _Collector(on_reply), sock=_udp_socket())
    try:
        deadline = loop.time() + duration
        sent = 0
        while loop.time() < deadline and not (cancelled and cancelled.is_set()):
            if sent < repeat:
                for target in targets:
                    with contextlib.suppress(OSError):
                        transport.sendto(payload, target)
                sent += 1
            await _sleep_or_cancel(min(interval, max(0.0, deadline - loop.time())), cancelled)
    finally:
        transport.close()
    return list(protocol.replies)


async def udp_listen(
    port: int,
    *,
    duration: float,
    cancelled: asyncio.Event | None = None,
    on_reply: Callable[[Reply], None] | None = None,
) -> list[Reply]:
    """Listens on a fixed port (devices that announce themselves by broadcast). Raises OSError if it is taken."""
    loop = asyncio.get_running_loop()
    transport, protocol = await loop.create_datagram_endpoint(lambda: _Collector(on_reply), sock=_udp_socket(port, reuse=True))
    try:
        await _sleep_or_cancel(duration, cancelled)
    finally:
        transport.close()
    return list(protocol.replies)


class _Requester(asyncio.DatagramProtocol):
    def __init__(self, accept: Callable[[bytes], bool] | None):
        self.accept = accept
        self.future: asyncio.Future[bytes] = asyncio.get_running_loop().create_future()

    def datagram_received(self, data: bytes, addr: tuple[str, int]) -> None:  # type: ignore[override]
        if not self.future.done() and (self.accept is None or self.accept(data)):
            self.future.set_result(data)

    def error_received(self, exc: Exception) -> None:
        if not self.future.done():
            self.future.set_exception(exc)


async def udp_request(
    host: str,
    port: int,
    payload: bytes,
    *,
    timeout: float = 2.0,
    attempts: int = 3,
    accept: Callable[[bytes], bool] | None = None,
    what: str = "The device",
) -> bytes:
    """One unicast request and its reply, retried on loss. Raises DeviceUnreachable."""
    loop = asyncio.get_running_loop()
    for _ in range(max(1, attempts)):
        try:
            transport, protocol = await loop.create_datagram_endpoint(lambda: _Requester(accept), remote_addr=(host, port))
        except OSError as error:
            raise DeviceUnreachable(f"{what} at {host} is not reachable.") from error
        try:
            transport.sendto(payload)
            return await asyncio.wait_for(asyncio.shield(protocol.future), timeout=timeout)
        except (TimeoutError, OSError):
            continue
        finally:
            transport.close()
    raise DeviceUnreachable(f"{what} at {host} did not answer.")


def magic_packet(mac: str) -> bytes:
    digits = "".join(ch for ch in mac.lower() if ch in "0123456789abcdef")
    if len(digits) != 12:
        raise ValueError("a MAC address has 12 hex digits")
    return b"\xff" * 6 + bytes.fromhex(digits) * 16


async def wake_on_lan(mac: str, targets: list[tuple[str, int]] | None = None) -> None:
    """Sends the Wake-on-LAN magic packet. There is no reply: whether the device woke is not known."""
    packet = magic_packet(mac)
    sock = _udp_socket()
    try:
        for _ in range(3):
            for target in targets or [("255.255.255.255", 9)]:
                with contextlib.suppress(OSError):
                    sock.sendto(packet, target)
            await asyncio.sleep(0.1)
    finally:
        sock.close()
