"""Tuya adapter: broadcast parsing, discovery over a real UDP port, and control through a fake tinytuya device."""

import asyncio
import ipaddress
import json
import socket

import pytest
import tinytuya

from cube_gateway.adapters import tuya
from cube_gateway.adapters.base import AdapterContext, DeviceUnreachable, LocalKeyRequired, ScanContext, StoredDevice, UnsupportedCommand
from cube_gateway.config import load_settings
from cube_gateway.models import Category

KEY = "0123456789abcdef"
GW = "bf1234567890abcdef"


def frame_55aa(info: dict, encrypted: bool) -> bytes:
    body = json.dumps(info).encode()
    payload = tinytuya.AESCipher(tinytuya.udpkey).encrypt(body, False) if encrypted else body
    # Device broadcasts carry a 4-byte return code before the payload.
    return tinytuya.pack_message(tinytuya.TuyaMessage(0, 0x13, 0, b"\0\0\0\0" + payload, 0, True, tinytuya.PREFIX_55AA_VALUE, None))


class FakeTuyaDevice:
    """Stands in for tinytuya.Device; `world` is shared so a test can see what was written."""

    world: dict = {}

    def __init__(self, dev_id, address=None, local_key="", version=3.3, **kwargs):
        self.local_key, self.version = local_key, version

    def _guard(self):
        if self.world.get("down"):
            return {"Error": "Network Error: Device Unreachable", "Err": "905", "Payload": None}
        if self.local_key != KEY:
            return {"Error": "Check device key or version", "Err": "914", "Payload": None}
        return None

    def status(self):
        return self._guard() or {"dps": dict(self.world["dps"])}

    def set_multiple_values(self, data):
        if error := self._guard():
            return error
        self.world["dps"].update(data)
        self.world.setdefault("writes", []).append(data)
        return None  # acknowledged without a payload, as some firmware does

    def close(self):
        pass


@pytest.fixture
def ctx(tmp_path, monkeypatch):
    monkeypatch.setenv("CUBE_DATA_DIR", str(tmp_path))
    return AdapterContext(load_settings())


@pytest.fixture
def adapter(ctx):
    adapter = tuya.TuyaLocalAdapter(ctx)
    adapter.client_factory = FakeTuyaDevice
    FakeTuyaDevice.world = {"dps": {"1": True, "2": False, "3": True}}
    return adapter


def device(key=KEY):
    return StoredDevice(
        id="d1",
        adapter_id="tuya_local",
        brand="tuya",
        unique_id=GW,
        name="Strip",
        category=Category.SWITCH,
        host="192.168.1.60",
        params={"version": "3.3"},
        credentials={"local_key": key} if key else {},
    )


def test_parse_every_broadcast_flavour():
    info = {"ip": "192.168.1.60", "gwId": GW, "version": "3.3", "productKey": "pk"}
    assert tuya.parse_broadcast(frame_55aa(info, encrypted=False))["gwId"] == GW
    assert tuya.parse_broadcast(frame_55aa(info, encrypted=True))["ip"] == "192.168.1.60"
    v35 = tinytuya.pack_message(
        tinytuya.TuyaMessage(0, 0x13, None, json.dumps(info).encode(), 0, True, tinytuya.PREFIX_6699_VALUE, True), hmac_key=tinytuya.udpkey
    )
    assert tuya.parse_broadcast(v35)["version"] == "3.3"
    assert tuya.parse_broadcast(tuya.discovery_request("192.168.1.2")) is None  # our own request, heard back
    assert tuya.parse_broadcast(b"junk") is None


async def test_discovery_listens_and_never_learns_the_key(adapter):
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    adapter.listen_ports = (port,)
    adapter.request_targets = [("127.0.0.1", 9)]
    found = []
    scan = ScanContext(timeout=1.5, subnets=[ipaddress.ip_network("192.168.1.0/24")], report=found.append)

    async def announce():
        await asyncio.sleep(0.3)
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sender:
            sender.sendto(frame_55aa({"ip": "192.168.1.60", "gwId": GW, "version": "3.4", "productKey": "pk"}, True), ("127.0.0.1", port))
            sender.sendto(frame_55aa({"ip": "8.8.8.8", "gwId": "outsider", "version": "3.3"}, True), ("127.0.0.1", port))

    await asyncio.gather(adapter.discover(scan), announce())
    assert [c.unique_id for c in found] == [GW]
    candidate = found[0]
    assert candidate.status == "local_key_required" and candidate.details["version"] == "3.4"
    fields = {f.name: f for f in candidate.pairing.fields}
    assert fields["local_key"].secret and fields["local_key"].required
    assert "local_key" not in json.dumps(candidate.details)


async def test_pairing_needs_the_right_key(adapter):
    candidate = adapter._candidate(GW, "192.168.1.60", {"version": "3.3"}, "manual")
    with pytest.raises(LocalKeyRequired) as missing:
        await adapter.pair(candidate, {}, approval=None)
    assert missing.value.code == "credentials_missing"
    with pytest.raises(LocalKeyRequired) as wrong:
        await adapter.pair(candidate, {"local_key": "wrongwrongwrong!"}, approval=None)
    assert wrong.value.code == "local_key_invalid"
    assert "wrongwrong" not in wrong.value.message
    result = await adapter.pair(candidate, {"local_key": KEY}, approval=None)
    assert result.credentials == {"local_key": KEY} and result.category == Category.SWITCH


async def test_multi_gang_switch(adapter):
    state = await adapter.get_state(device())
    assert [c.key for c in state.capabilities] == ["power:1", "power:2", "power:3"]
    outcome = await adapter.execute_command(device(), "toggle", {"key": "power:2"})
    assert FakeTuyaDevice.world["writes"][-1] == {"2": True}
    assert outcome.result.status == "confirmed"
    with pytest.raises(UnsupportedCommand):
        await adapter.execute_command(device(), "set_brightness", {"brightness": 10})


async def test_metering_plug_readings(adapter):
    FakeTuyaDevice.world["dps"] = {"1": True, "18": 120, "19": 254, "20": 2301}
    state = await adapter.get_state(device())
    readings = {r.key: r.value for r in state.readings}
    assert readings == {"power_w": 25.4, "current_ma": 120, "voltage_v": 230.1}


async def test_bulb(adapter):
    FakeTuyaDevice.world["dps"] = {"20": True, "21": "white", "22": 505, "23": 500, "24": "007803e803e8"}
    state = await adapter.get_state(device())
    by_type = {c.type: c for c in state.capabilities}
    assert by_type["brightness"].value == 50 and by_type["color_temp"].value == 4600 and by_type["color"].value is None
    await adapter.execute_command(device(), "set_color", {"h": 240, "s": 50})
    assert FakeTuyaDevice.world["dps"]["21"] == "colour" and FakeTuyaDevice.world["dps"]["24"] == "00f001f403e8"
    await adapter.execute_command(device(), "set_brightness", {"brightness": 20})
    assert FakeTuyaDevice.world["dps"]["24"] == "00f001f400c8"
    await adapter.execute_command(device(), "set_color_temp", {"kelvin": 2700})
    assert FakeTuyaDevice.world["dps"]["21"] == "white" and FakeTuyaDevice.world["dps"]["23"] == 0


async def test_unknown_layout_falls_back_to_power_only(adapter):
    FakeTuyaDevice.world["dps"] = {"101": False, "102": 37}
    state = await adapter.get_state(device())
    assert [c.key for c in state.capabilities] == ["power:101"]
    FakeTuyaDevice.world["dps"] = {"102": 37}
    assert (await adapter.get_state(device())).capabilities == []


async def test_unreachable_and_no_key(adapter):
    with pytest.raises(LocalKeyRequired):
        await adapter.get_state(device(key=None))
    FakeTuyaDevice.world["down"] = True
    with pytest.raises(DeviceUnreachable):
        await adapter.get_state(device())
