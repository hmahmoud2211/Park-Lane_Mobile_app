"""Midea adapter with msmart-ng's discovery and AirConditioner replaced by fakes."""

import ipaddress
from types import SimpleNamespace

import pytest
from msmart.const import DeviceType
from msmart.device import AirConditioner
from msmart.lan import AuthenticationError

from cube_gateway.adapters import midea
from cube_gateway.adapters.base import AdapterContext, AdapterError, DeviceUnreachable, LocalKeyRequired, ScanContext, StoredDevice, UnsupportedCommand
from cube_gateway.config import load_settings
from cube_gateway.models import Category

TOKEN, KEY = "ab" * 64, "cd" * 32
Mode, Fan = AirConditioner.OperationalMode, AirConditioner.FanSpeed


class FakeAC:
    online_after_refresh = True

    def __init__(self, ip, device_id, port, **kwargs):
        self.ip, self.id, self.port, self.version = ip, device_id, port, kwargs.get("version")
        self.power_state, self.target_temperature, self.operational_mode, self.fan_speed = True, 24.0, Mode.COOL, Fan.AUTO
        self.indoor_temperature, self.outdoor_temperature = 26.5, 33.0
        self.supported_operation_modes = [Mode.AUTO, Mode.COOL, Mode.DRY, Mode.FAN_ONLY]
        self.supported_fan_speeds = [Fan.AUTO, Fan.LOW, Fan.MEDIUM, Fan.HIGH]
        self.min_target_temperature, self.max_target_temperature = 16, 30
        self.online = False
        self.applied = 0

    async def authenticate(self, token, key):
        if (token, key) != (TOKEN, KEY):
            raise AuthenticationError("bad token")

    async def get_capabilities(self):
        pass

    async def refresh(self):
        self.online = self.online_after_refresh

    async def apply(self):
        self.applied += 1


@pytest.fixture
def adapter(tmp_path, monkeypatch):
    monkeypatch.setenv("CUBE_DATA_DIR", str(tmp_path))
    monkeypatch.setattr(midea, "AirConditioner", FakeAC)
    FakeAC.online_after_refresh = True
    return midea.MideaAdapter(AdapterContext(load_settings()))


def unit(**overrides):
    values = {
        "id": 150633094,
        "ip": "192.168.1.70",
        "port": 6444,
        "version": 3,
        "type": DeviceType.AIR_CONDITIONER,
        "name": "net_ac_1234",
        "sn": "000000P0000000Q1",
    }
    return SimpleNamespace(**{**values, **overrides})


def stored(version=3):
    return StoredDevice(
        id="d1",
        adapter_id="midea",
        brand="midea",
        unique_id="150633094",
        name="AC",
        category=Category.CLIMATE,
        host="192.168.1.70",
        params={"device_id": 150633094, "port": 6444, "version": version},
        credentials={"token": TOKEN, "key": KEY} if version >= 3 else {},
    )


async def test_discovery_never_uses_the_cloud(adapter, monkeypatch):
    calls = []

    async def discover(**kwargs):
        calls.append(kwargs)
        return [unit(), unit(id=2, ip="192.168.1.71", type=DeviceType.COMMERCIAL_AC), unit(id=3, ip="10.1.1.1")]

    monkeypatch.setattr(midea.MideaDiscover, "discover", discover)
    adapter.discovery_targets = ["192.168.1.255"]
    found = []
    await adapter.discover(ScanContext(timeout=1, subnets=[ipaddress.ip_network("192.168.1.0/24")], report=found.append))
    assert calls and all(call["auto_connect"] is False for call in calls)
    by_id = {c.unique_id: c for c in found}
    assert set(by_id) == {"150633094", "2"}
    ac = by_id["150633094"]
    assert ac.status == "local_key_required" and {f.name for f in ac.pairing.fields} == {"token", "key"}
    assert all(f.secret for f in ac.pairing.fields)
    assert by_id["2"].control == "detection_only" and by_id["2"].status == "unsupported"


async def test_pairing_v3(adapter):
    candidate = adapter._candidate(unit(), "manual")
    with pytest.raises(LocalKeyRequired) as missing:
        await adapter.pair(candidate, {}, approval=None)
    assert missing.value.code == "credentials_missing"
    with pytest.raises(LocalKeyRequired) as wrong:
        await adapter.pair(candidate, {"token": "00" * 64, "key": KEY}, approval=None)
    assert wrong.value.code == "local_key_invalid"
    result = await adapter.pair(candidate, {"token": TOKEN, "key": KEY}, approval=None)
    assert result.category == Category.CLIMATE and result.credentials == {"token": TOKEN, "key": KEY}


async def test_v2_needs_no_key_and_other_appliances_are_refused(adapter):
    v2 = adapter._candidate(unit(version=2), "manual")
    assert v2.pairing.auth == "none"
    assert (await adapter.pair(v2, {}, approval=None)).credentials == {}
    other = adapter._candidate(unit(type=DeviceType.COMMERCIAL_AC), "manual")
    with pytest.raises(UnsupportedCommand):
        await adapter.pair(other, {}, approval=None)


async def test_state_and_commands(adapter):
    state = await adapter.get_state(stored())
    climate = state.capabilities[0]
    assert (climate.mode, climate.target, climate.current, climate.fan_mode) == ("cool", 24.0, 26.5, "auto")
    assert climate.modes == ["off", "auto", "cool", "dry", "fan_only"]
    assert state.readings[0].value == 33.0
    outcome = await adapter.execute_command(stored(), "set_temperature", {"temperature": 21.3})
    assert outcome.result.status == "confirmed" and outcome.state.capabilities[0].target == 21.5
    outcome = await adapter.execute_command(stored(), "set_hvac_mode", {"mode": "off"})
    assert outcome.state.capabilities[0].mode == "off"
    with pytest.raises(AdapterError):
        await adapter.execute_command(stored(), "set_hvac_mode", {"mode": "heat"})  # not supported by this unit
    with pytest.raises(AdapterError):
        await adapter.execute_command(stored(), "set_fan_mode", {"fan_mode": "max"})
    with pytest.raises(UnsupportedCommand):
        await adapter.execute_command(stored(), "set_volume", {})


async def test_unreachable(adapter):
    FakeAC.online_after_refresh = False
    with pytest.raises(DeviceUnreachable):
        await adapter.get_state(stored(version=2))
