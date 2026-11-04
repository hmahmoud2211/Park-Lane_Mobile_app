"""LIFX adapter against a fake bulb speaking the binary LIFX LAN protocol."""

import asyncio
import struct

import pytest

from cube_gateway.adapters import lifx
from cube_gateway.adapters.base import AdapterContext, DeviceUnreachable, ScanContext, StoredDevice, UnsupportedCommand
from cube_gateway.config import load_settings
from cube_gateway.models import Category

MAC = "d073d5010203"


class FakeBulb(asyncio.DatagramProtocol):
    def __init__(self):
        self.h, self.s, self.b, self.k, self.power = 0, 0, 65535 // 2, 3500, 65535
        self.label = "Desk"

    def connection_made(self, transport):
        self.transport = transport

    def reply(self, addr, source, sequence, msg_type, payload):
        self.transport.sendto(lifx.encode(msg_type, payload, source=source, sequence=sequence, target=bytes.fromhex(MAC) + b"\0\0"), addr)

    def state(self):
        return lifx._STATE.pack(self.h, self.s, self.b, self.k, 0, self.power, self.label.encode().ljust(32, b"\0"), 0)

    def datagram_received(self, data, addr):
        msg_type, source, _target, sequence, payload = lifx.decode(data)
        if msg_type == lifx.GET_SERVICE:
            self.reply(addr, source, sequence, lifx.STATE_SERVICE, struct.pack("<BI", 1, 56700))
        elif msg_type == lifx.GET_VERSION:
            self.reply(addr, source, sequence, lifx.STATE_VERSION, struct.pack("<III", 1, 27, 0))
        elif msg_type == lifx.LIGHT_GET:
            self.reply(addr, source, sequence, lifx.LIGHT_STATE, self.state())
        elif msg_type == lifx.LIGHT_SET_POWER:
            self.power = struct.unpack_from("<H", payload)[0]
            self.reply(addr, source, sequence, lifx.LIGHT_STATE_POWER, struct.pack("<H", self.power))
        elif msg_type == lifx.LIGHT_SET_COLOR:
            _r, self.h, self.s, self.b, self.k, _d = struct.unpack_from("<BHHHHI", payload)
            self.reply(addr, source, sequence, lifx.LIGHT_STATE, self.state())


@pytest.fixture
def ctx(tmp_path, monkeypatch):
    monkeypatch.setenv("CUBE_DATA_DIR", str(tmp_path))
    return AdapterContext(load_settings())


@pytest.fixture
async def bulb():
    loop = asyncio.get_running_loop()
    transport, protocol = await loop.create_datagram_endpoint(FakeBulb, local_addr=("127.0.0.1", 0))
    yield protocol, transport.get_extra_info("sockname")[1]
    transport.close()


def adapter_for(ctx, port):
    adapter = lifx.LifxAdapter(ctx)
    adapter.port = port
    adapter.discovery_targets = [("127.0.0.1", port)]
    return adapter


def device(port):
    return StoredDevice(
        id="d1", adapter_id="lifx", brand="lifx", unique_id=MAC, name="Desk", category=Category.LIGHT, host="127.0.0.1", port=port, mac="d0:73:d5:01:02:03"
    )


def test_header_roundtrip():
    message = lifx.encode(lifx.LIGHT_GET, b"", source=1234, sequence=7, target=bytes.fromhex(MAC), res_required=True)
    assert len(message) == 36
    msg_type, source, target, sequence, payload = lifx.decode(message)
    assert (msg_type, source, target[:6].hex(), sequence, payload) == (lifx.LIGHT_GET, 1234, MAC, 7, b"")
    assert lifx.decode(b"short") is None
    assert lifx.decode(b"\x00" * 36) is None  # wrong protocol number


async def test_discovery_and_pairing(ctx, bulb):
    _protocol, port = bulb
    adapter = adapter_for(ctx, port)
    found = []
    scan = ScanContext(timeout=1, subnets=[], report=found.append)
    scan.in_scope = lambda ip: True
    await adapter.discover(scan)
    assert len(found) == 1
    candidate = found[0]
    assert candidate.name == "Desk" and candidate.mac == "d0:73:d5:01:02:03" and candidate.model == "LIFX product 27"
    result = await adapter.pair(candidate, {}, approval=None)
    assert result.category == Category.LIGHT and result.unique_id == MAC


async def test_state_mapping(ctx, bulb):
    _protocol, port = bulb
    state = await adapter_for(ctx, port).get_state(device(port))
    by_type = {cap.type: cap for cap in state.capabilities}
    assert by_type["power"].value == "on"
    assert by_type["brightness"].value == 50
    assert by_type["color_temp"].value == 3500
    assert set(state.commands) >= {"turn_on", "turn_off", "toggle", "set_brightness", "set_color", "set_color_temp"}


async def test_commands(ctx, bulb):
    protocol, port = bulb
    adapter = adapter_for(ctx, port)
    outcome = await adapter.execute_command(device(port), "turn_off", {})
    assert protocol.power == 0 and outcome.result.status == "confirmed"
    await adapter.execute_command(device(port), "set_color", {"h": 120, "s": 100})
    assert round(protocol.h * 360 / 65535) == 120 and protocol.s == 65535
    assert protocol.power == 65535  # setting a colour turns the light on
    await adapter.execute_command(device(port), "set_brightness", {"brightness": 25})
    assert round(protocol.b * 100 / 65535) == 25
    await adapter.execute_command(device(port), "set_color_temp", {"kelvin": 2700})
    assert protocol.k == 2700 and protocol.s == 0
    outcome = await adapter.execute_command(device(port), "toggle", {})
    assert next(c for c in outcome.state.capabilities if c.type == "power").value == "off"


async def test_unsupported_and_unreachable(ctx, bulb):
    _protocol, port = bulb
    adapter = adapter_for(ctx, port)
    with pytest.raises(UnsupportedCommand):
        await adapter.execute_command(device(port), "set_volume", {"volume": 3})
    adapter.port = 1
    with pytest.raises(DeviceUnreachable):
        await adapter.get_state(device(port))
