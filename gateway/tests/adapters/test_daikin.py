"""Daikin adapter against a mocked BRP069 HTTP API and a fake UDP responder."""

import asyncio
from urllib.parse import parse_qs

import httpx
import pytest

from cube_gateway.adapters.base import AdapterContext, AdapterError, AuthRequired, DeviceUnreachable, ScanContext, StoredDevice, UnsupportedCommand
from cube_gateway.adapters.daikin import DaikinAdapter, parse_kv
from cube_gateway.config import load_settings
from cube_gateway.models import Category

BASIC = "ret=OK,type=aircon,reg=eu,ver=1_2_51,pow=1,err=0,name=%4c%69%76%69%6e%67,mac=A408EA123456,adp_kind=3"


class FakeDaikin:
    def __init__(self):
        self.control = {
            "pow": "1",
            "mode": "3",
            "stemp": "24.0",
            "shum": "0",
            "f_rate": "A",
            "f_dir": "0",
            "dt2": "M",
            "dh2": "50",
            "dt3": "24.0",
            "dh3": "0",
            "dt6": "--",
            "dh6": "--",
        }
        self.sets = []
        self.down = False

    def handler(self, request: httpx.Request) -> httpx.Response:
        if self.down:
            raise httpx.ConnectError("unreachable", request=request)
        if request.url.host == "192.168.1.9":
            return httpx.Response(200, text="<html>router</html>")
        if request.url.host == "192.168.1.8":
            return httpx.Response(403)
        path = request.url.path
        if path == "/common/basic_info":
            return httpx.Response(200, text=BASIC)
        if path == "/aircon/get_control_info":
            return httpx.Response(200, text="ret=OK," + ",".join(f"{k}={v}" for k, v in self.control.items()))
        if path == "/aircon/get_sensor_info":
            return httpx.Response(200, text="ret=OK,htemp=23.5,hhum=-,otemp=31.0,err=0")
        if path == "/aircon/set_control_info":
            values = {k: v[0] for k, v in parse_qs(request.url.query.decode()).items()}
            self.sets.append(values)
            if values["stemp"] in {"", "None"}:
                return httpx.Response(200, text="ret=PARAM NG")
            self.control.update(values)
            return httpx.Response(200, text="ret=OK")
        return httpx.Response(404)


@pytest.fixture
def fake():
    return FakeDaikin()


@pytest.fixture
def ctx(tmp_path, monkeypatch, fake):
    monkeypatch.setenv("CUBE_DATA_DIR", str(tmp_path))
    return AdapterContext(load_settings(), http=httpx.AsyncClient(transport=httpx.MockTransport(fake.handler)))


def device():
    return StoredDevice(
        id="d1",
        adapter_id="daikin",
        brand="daikin",
        unique_id="a408ea123456",
        name="Living",
        category=Category.CLIMATE,
        host="192.168.1.20",
        port=80,
        params={"https": False},
    )


def test_parse_kv():
    assert parse_kv("ret=OK,pow=1,name=%4c") == {"ret": "OK", "pow": "1", "name": "%4c"}


async def test_probe_identifies_and_rejects_other_hosts(ctx):
    adapter = DaikinAdapter(ctx)
    candidate = await adapter.probe("192.168.1.20")
    assert candidate.name == "Living" and candidate.mac == "a4:08:ea:12:34:56"
    assert candidate.control == "experimental" and candidate.pairing.auth == "none"
    assert await adapter.probe("192.168.1.9") is None  # some web server that is not a Daikin


async def test_subnet_scan_does_not_take_any_403_for_a_daikin(ctx):
    adapter = DaikinAdapter(ctx)
    adapter.discovery_targets = [("127.0.0.1", 9)]
    found = []
    scan = ScanContext(timeout=1, subnets=[], report=found.append)
    scan.open_ports[80] = {"192.168.1.8", "192.168.1.9", "192.168.1.20"}
    scan.passive_done.set()
    await adapter.discover(scan)
    assert [c.ip for c in found] == ["192.168.1.20"]


async def test_udp_discovery(ctx):
    class Responder(asyncio.DatagramProtocol):
        def connection_made(self, transport):
            self.transport = transport

        def datagram_received(self, data, addr):
            assert data == b"DAIKIN_UDP/common/basic_info"
            self.transport.sendto(BASIC.encode(), addr)

    transport, _ = await asyncio.get_running_loop().create_datagram_endpoint(Responder, local_addr=("127.0.0.1", 0))
    try:
        adapter = DaikinAdapter(ctx)
        adapter.discovery_targets = [("127.0.0.1", transport.get_extra_info("sockname")[1])]
        found = []
        scan = ScanContext(timeout=1, subnets=[], report=found.append)
        scan.in_scope = lambda ip: True
        scan.passive_done.set()
        await adapter.discover(scan)
    finally:
        transport.close()
    assert len(found) == 1 and found[0].sources == ["udp-broadcast"]


async def test_pair_and_state(ctx):
    adapter = DaikinAdapter(ctx)
    candidate = await adapter.probe("192.168.1.20")
    result = await adapter.pair(candidate, {}, approval=None)
    assert result.category == Category.CLIMATE and result.params["https"] is False
    state = await adapter.get_state(device())
    climate = state.capabilities[0]
    assert (climate.mode, climate.target, climate.current, climate.fan_mode) == ("cool", 24.0, 23.5, "auto")
    assert state.readings[0].value == 31.0
    assert {"set_temperature", "set_hvac_mode", "set_fan_mode", "turn_on", "turn_off"} <= set(state.commands)


async def test_commands(ctx, fake):
    adapter = DaikinAdapter(ctx)
    outcome = await adapter.execute_command(device(), "set_temperature", {"temperature": 21.5})
    assert fake.sets[-1]["stemp"] == "21.5" and outcome.result.status == "confirmed"
    await adapter.execute_command(device(), "set_hvac_mode", {"mode": "dry"})
    assert fake.sets[-1]["mode"] == "2" and fake.sets[-1]["stemp"] == "M"  # dry keeps its own setpoint
    with pytest.raises(AdapterError):
        await adapter.execute_command(device(), "set_temperature", {"temperature": 22})
    await adapter.execute_command(device(), "set_fan_mode", {"fan_mode": "3"})
    assert fake.sets[-1]["f_rate"] == "5"
    outcome = await adapter.execute_command(device(), "set_hvac_mode", {"mode": "off"})
    assert outcome.state.capabilities[0].mode == "off"
    with pytest.raises(UnsupportedCommand):
        await adapter.execute_command(device(), "set_volume", {})


async def test_unreachable(ctx, fake):
    fake.down = True
    with pytest.raises(DeviceUnreachable):
        await DaikinAdapter(ctx).get_state(device())


async def test_brp072c_needs_its_key(ctx):
    adapter = DaikinAdapter(ctx)
    locked = await adapter._identify_host("192.168.1.30", "manual", {"ret": "OK", "type": "aircon"})
    locked.details["https"] = True
    requirements = adapter.get_pairing_requirements(locked)
    assert requirements.auth == "device_credentials" and requirements.fields[0].secret
    with pytest.raises(AuthRequired):
        await adapter.pair(locked, {}, approval=None)
