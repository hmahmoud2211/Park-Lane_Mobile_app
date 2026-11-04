"""The UDP and Wake-on-LAN helpers shared by vendor adapters."""

import asyncio
import ipaddress

import pytest

from cube_gateway.adapters import _lan
from cube_gateway.adapters.base import DeviceUnreachable, ScanContext


class Echo(asyncio.DatagramProtocol):
    def connection_made(self, transport):
        self.transport = transport

    def datagram_received(self, data, addr):
        self.transport.sendto(b"echo:" + data, addr)


async def echo_server():
    loop = asyncio.get_running_loop()
    transport, _ = await loop.create_datagram_endpoint(Echo, local_addr=("127.0.0.1", 0))
    return transport, transport.get_extra_info("sockname")[1]


def test_magic_packet():
    packet = _lan.magic_packet("AA:BB:CC:DD:EE:FF")
    assert packet[:6] == b"\xff" * 6
    assert packet[6:12] == bytes.fromhex("aabbccddeeff")
    assert len(packet) == 6 + 16 * 6
    with pytest.raises(ValueError):
        _lan.magic_packet("nope")


def test_broadcast_targets_cover_each_scanned_network():
    scan = ScanContext(timeout=5, subnets=[ipaddress.ip_network("192.168.1.0/24"), ipaddress.ip_network("10.0.0.0/24")], report=lambda c: None)
    assert _lan.broadcast_targets(scan, 38899) == [("255.255.255.255", 38899), ("192.168.1.255", 38899), ("10.0.0.255", 38899)]


def test_window_is_capped():
    scan = ScanContext(timeout=60, subnets=[], report=lambda c: None)
    assert _lan.window(scan) == _lan.DISCOVERY_WINDOW
    scan.timeout = 2
    assert _lan.window(scan) == 2


async def test_udp_request_and_broadcast_roundtrip():
    transport, port = await echo_server()
    try:
        assert await _lan.udp_request("127.0.0.1", port, b"hi", timeout=1) == b"echo:hi"
        replies = await _lan.udp_broadcast([("127.0.0.1", port)], b"scan", duration=0.3, repeat=1)
        assert replies and replies[0][0] == b"echo:scan" and replies[0][1] == "127.0.0.1"
    finally:
        transport.close()


async def test_udp_request_unreachable():
    transport, port = await echo_server()
    transport.close()  # nothing listens there any more
    with pytest.raises(DeviceUnreachable):
        await _lan.udp_request("127.0.0.1", port, b"hi", timeout=0.2, attempts=2)


async def test_broadcast_stops_when_cancelled():
    cancelled = asyncio.Event()
    cancelled.set()
    started = asyncio.get_running_loop().time()
    await _lan.udp_broadcast([("127.0.0.1", 9)], b"x", duration=5, cancelled=cancelled)
    assert asyncio.get_running_loop().time() - started < 1
