"""WiZ adapter against a fake light speaking the WiZ UDP JSON protocol."""

import asyncio
import ipaddress
import json

import pytest

from cube_gateway.adapters.base import AdapterContext, DeviceUnreachable, ScanContext, StoredDevice, UnsupportedCommand
from cube_gateway.adapters.wiz import WizAdapter
from cube_gateway.config import load_settings
from cube_gateway.models import Category

MAC = "a8bb50112233"


class FakeWiz(asyncio.DatagramProtocol):
    def __init__(self, module="ESP01_SHRGB1C_31"):
        self.module = module
        self.pilot = {"mac": MAC, "rssi": -55, "state": True, "sceneId": 0, "temp": 2700, "dimming": 60}

    def connection_made(self, transport):
        self.transport = transport

    def datagram_received(self, data, addr):
        request = json.loads(data)
        method = request["method"]
        if method == "getPilot":
            result = dict(self.pilot)
        elif method == "getSystemConfig":
            result = {"mac": MAC, "moduleName": self.module, "fwVersion": "1.22.0"}
        elif method == "setPilot":
            params = request["params"]
            if any(k in params for k in ("r", "g", "b")):
                self.pilot.pop("temp", None)
            if "temp" in params:
                for k in ("r", "g", "b"):
                    self.pilot.pop(k, None)
            self.pilot.update(params)
            result = {"success": True}
        else:
            self.transport.sendto(json.dumps({"method": method, "error": {"code": -32601, "message": "Method not found"}}).encode(), addr)
            return
        self.transport.sendto(json.dumps({"method": method, "env": "pro", "result": result}).encode(), addr)


@pytest.fixture
def ctx(tmp_path, monkeypatch):
    monkeypatch.setenv("CUBE_DATA_DIR", str(tmp_path))
    return AdapterContext(load_settings())


@pytest.fixture
async def light():
    loop = asyncio.get_running_loop()
    transport, protocol = await loop.create_datagram_endpoint(FakeWiz, local_addr=("127.0.0.1", 0))
    yield protocol, transport.get_extra_info("sockname")[1]
    transport.close()


def adapter_for(ctx, port):
    adapter = WizAdapter(ctx)
    adapter.port = port
    adapter.discovery_targets = [("127.0.0.1", port)]
    return adapter


def device(port, module="ESP01_SHRGB1C_31"):
    return StoredDevice(
        id="d1", adapter_id="wiz", brand="wiz", unique_id=MAC, name="Lamp", category=Category.LIGHT, host="127.0.0.1", port=port, params={"module": module}
    )


async def test_discovery_identifies_the_light(ctx, light):
    _protocol, port = light
    adapter = adapter_for(ctx, port)
    found = []
    scan = ScanContext(timeout=1, subnets=[], report=found.append)
    scan.in_scope = lambda ip: True  # the fake light answers from loopback
    await adapter.discover(scan)
    assert len(found) == 1
    candidate = found[0]
    assert candidate.unique_id == MAC and candidate.mac == "a8:bb:50:11:22:33"
    assert candidate.model == "ESP01_SHRGB1C_31" and candidate.status == "identified"
    assert candidate.pairing.auth == "none"
    assert "127.0.0.1" in scan.claimed_ips


async def test_discovery_skips_out_of_scope_replies(ctx, light):
    _protocol, port = light
    found = []
    scan = ScanContext(timeout=1, subnets=[ipaddress.ip_network("192.168.1.0/24")], report=found.append)
    await adapter_for(ctx, port).discover(scan)
    assert found == []


async def test_pair_and_state(ctx, light):
    _protocol, port = light
    adapter = adapter_for(ctx, port)
    candidate = await adapter.probe("127.0.0.1")
    result = await adapter.pair(candidate, {}, approval=None)
    assert result.category == Category.LIGHT and result.params["module"] == "ESP01_SHRGB1C_31"
    state = await adapter.get_state(device(port))
    by_type = {cap.type: cap for cap in state.capabilities}
    assert by_type["power"].value == "on"
    assert by_type["brightness"].value == 60
    assert by_type["color_temp"].value == 2700
    assert {"turn_on", "set_brightness", "set_color", "set_color_temp"} <= set(state.commands)


async def test_commands_are_confirmed_by_reading_back(ctx, light):
    protocol, port = light
    adapter = adapter_for(ctx, port)
    outcome = await adapter.execute_command(device(port), "set_brightness", {"brightness": 5})
    assert outcome.result.status == "confirmed"
    assert protocol.pilot["dimming"] == 10  # WiZ's floor
    await adapter.execute_command(device(port), "set_color", {"h": 240, "s": 100})
    assert (protocol.pilot["r"], protocol.pilot["g"], protocol.pilot["b"]) == (0, 0, 255)
    outcome = await adapter.execute_command(device(port), "toggle", {})
    assert protocol.pilot["state"] is False
    assert next(c for c in outcome.state.capabilities if c.type == "power").value == "off"
    await adapter.execute_command(device(port), "set_color_temp", {"kelvin": 9000})
    assert protocol.pilot["temp"] == 6500


async def test_plug_has_no_dimmer(ctx, light):
    _protocol, port = light
    with pytest.raises(UnsupportedCommand):
        await adapter_for(ctx, port).execute_command(device(port, "ESP10_SOCKET_06"), "set_brightness", {"brightness": 50})


async def test_unreachable_light(ctx, light):
    _protocol, port = light
    adapter = adapter_for(ctx, port)
    stored = device(port)
    stored.port = 9
    adapter.port = 1  # nothing listens there
    with pytest.raises(DeviceUnreachable):
        await adapter.get_state(stored)
