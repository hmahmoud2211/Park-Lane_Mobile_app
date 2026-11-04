"""Yeelight adapter against a fake light: the M-SEARCH reply over UDP and JSON lines over TCP."""

import asyncio
import ipaddress
import json
import socket

import pytest

from cube_gateway.adapters import yeelight
from cube_gateway.adapters.base import AdapterContext, DeviceUnreachable, ScanContext, StoredDevice, UnsupportedCommand
from cube_gateway.config import load_settings
from cube_gateway.models import Category


class FakeLight:
    def __init__(self, support="get_prop set_power toggle set_bright set_ct_abx set_hsv set_rgb"):
        self.props = {"power": "on", "bright": "80", "ct": "4000", "rgb": "16711680", "hue": "0", "sat": "100", "color_mode": "2", "name": "Bedside"}
        self.support = support
        self.calls = []

    async def handle(self, reader, writer):
        while line := await reader.readline():
            request = json.loads(line)
            method, params = request["method"], request["params"]
            self.calls.append((method, params))
            if method not in self.support.split():
                reply = {"id": request["id"], "error": {"code": -1, "message": "method not supported"}}
            elif method == "get_prop":
                writer.write(b'{"method":"props","params":{"power":"on"}}\r\n')  # a notification interleaved
                reply = {"id": request["id"], "result": [self.props[p] for p in params]}
            else:
                if method == "set_power":
                    self.props["power"] = params[0]
                elif method == "toggle":
                    self.props["power"] = "off" if self.props["power"] == "on" else "on"
                elif method == "set_bright":
                    self.props["bright"] = str(params[0])
                elif method == "set_ct_abx":
                    self.props.update(ct=str(params[0]), color_mode="2")
                elif method == "set_hsv":
                    self.props.update(hue=str(params[0]), sat=str(params[1]), color_mode="3")
                reply = {"id": request["id"], "result": ["ok"]}
            writer.write((json.dumps(reply) + "\r\n").encode())
            await writer.drain()
        writer.close()


class Searchable(asyncio.DatagramProtocol):
    def __init__(self, tcp_port):
        self.tcp_port = tcp_port

    def connection_made(self, transport):
        self.transport = transport

    def datagram_received(self, data, addr):
        assert b"wifi_bulb" in data
        reply = (
            "HTTP/1.1 200 OK\r\nCache-Control: max-age=3600\r\n"
            f"Location: yeelight://192.168.1.50:{self.tcp_port}\r\n"
            "id: 0x000000000015243f\r\nmodel: color\r\nfw_ver: 18\r\n"
            "support: get_prop set_power toggle set_bright set_ct_abx set_hsv\r\npower: on\r\nbright: 80\r\nname: Bedside\r\n\r\n"
        )
        self.transport.sendto(reply.encode(), addr)


@pytest.fixture
def ctx(tmp_path, monkeypatch):
    monkeypatch.setenv("CUBE_DATA_DIR", str(tmp_path))
    return AdapterContext(load_settings())


@pytest.fixture
async def light():
    fake = FakeLight()
    server = await asyncio.start_server(fake.handle, "127.0.0.1", 0)
    yield fake, server.sockets[0].getsockname()[1]
    server.close()


def device(port, support="get_prop set_power toggle set_bright set_ct_abx set_hsv"):
    return StoredDevice(
        id="d1",
        adapter_id="yeelight",
        brand="xiaomi",
        unique_id="0x15243f",
        name="Bedside",
        category=Category.LIGHT,
        host="127.0.0.1",
        port=port,
        params={"support": support, "model": "color"},
    )


def test_parse_search_reply_rejects_foreign_answers():
    assert yeelight.parse_search_reply(b"HTTP/1.1 200 OK\r\nLocation: http://192.168.1.2/desc.xml\r\nid: 1\r\n\r\n") is None
    assert yeelight.parse_search_reply(b"garbage") is None


async def test_discovery_reads_the_search_reply(ctx, light):
    _fake, tcp_port = light
    loop = asyncio.get_running_loop()
    transport, _ = await loop.create_datagram_endpoint(lambda: Searchable(tcp_port), local_addr=("127.0.0.1", 0))
    try:
        adapter = yeelight.YeelightAdapter(ctx)
        adapter.discovery_targets = [("127.0.0.1", transport.get_extra_info("sockname")[1])]
        found = []
        await adapter.discover(ScanContext(timeout=1, subnets=[ipaddress.ip_network("192.168.1.0/24")], report=found.append))
    finally:
        transport.close()
    assert len(found) == 1
    candidate = found[0]
    assert candidate.ip == "192.168.1.50" and candidate.port == tcp_port
    assert candidate.unique_id == "0x000000000015243f" and candidate.model == "color" and candidate.name == "Bedside"
    assert "LAN Control" in candidate.pairing.instructions


async def test_pair_state_and_commands(ctx, light):
    fake, port = light
    adapter = yeelight.YeelightAdapter(ctx)
    candidate = adapter._candidate({"id": "0x15243f", "ip": "127.0.0.1", "port": str(port), "model": "color", "support": fake.support}, "manual")
    result = await adapter.pair(candidate, {}, approval=None)
    assert result.name == "Bedside" and result.category == Category.LIGHT

    state = await adapter.get_state(device(port))
    by_type = {cap.type: cap for cap in state.capabilities}
    assert by_type["power"].value == "on" and by_type["brightness"].value == 80 and by_type["color_temp"].value == 4000
    assert by_type["color"].value is None  # in white mode

    outcome = await adapter.execute_command(device(port), "set_color", {"h": 200, "s": 50})
    assert outcome.result.status == "confirmed"
    assert next(c for c in outcome.state.capabilities if c.type == "color").value == {"h": 200, "s": 50}
    await adapter.execute_command(device(port), "set_brightness", {"brightness": 0})
    assert fake.props["power"] == "off"
    await adapter.execute_command(device(port), "set_color_temp", {"kelvin": 10000})
    assert fake.props["ct"] == "6500"
    await adapter.execute_command(device(port), "toggle", {})
    assert fake.props["power"] == "on"


async def test_mono_light_rejects_colour(ctx, light):
    _fake, port = light
    with pytest.raises(UnsupportedCommand):
        await yeelight.YeelightAdapter(ctx).execute_command(device(port, "get_prop set_power toggle set_bright"), "set_color", {"h": 1, "s": 1})


async def test_lan_control_off_is_explained(ctx):
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]  # closed: connections are refused
    with pytest.raises(DeviceUnreachable) as error:
        await yeelight.YeelightAdapter(ctx).get_state(device(port))
    assert error.value.code == "lan_control_off"
