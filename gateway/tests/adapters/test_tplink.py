"""TP-Link adapter with python-kasa's discovery and connection replaced by fakes."""

import ipaddress
from types import SimpleNamespace

import pytest
from kasa import AuthenticationError, DeviceConfig, DeviceConnectionParameters, DeviceType, Module
from kasa import TimeoutError as KasaTimeout

from cube_gateway.adapters import tplink
from cube_gateway.adapters.base import AdapterContext, AuthRequired, DeviceUnreachable, NotSupported, ScanContext, StoredDevice, UnsupportedCommand
from cube_gateway.config import load_settings
from cube_gateway.models import Category

LEGACY = {"device_family": "IOT.SMARTPLUGSWITCH", "encryption_type": "XOR", "https": False}
KLAP = {"device_family": "SMART.TAPOPLUG", "encryption_type": "KLAP", "https": False, "login_version": 2}


class FakeLight:
    def __init__(self):
        self.brightness, self.color_temp, self.hsv = 40, 2700, (0, 0, 40)

    def has_feature(self, name):
        return name in {"brightness", "color_temp", "hsv"}

    def get_feature(self, name):
        return SimpleNamespace(minimum_value=2500, maximum_value=6500) if name == "color_temp" else None

    async def set_brightness(self, value):
        self.brightness = value

    async def set_hsv(self, h, s, v):
        self.hsv = (h, s, v)

    async def set_color_temp(self, kelvin):
        self.color_temp = kelvin


class FakeKasa:
    def __init__(self, host, *, connection=LEGACY, device_type=DeviceType.Plug, children=0, light=False, energy=False, alias="Kettle"):
        self.host = host
        self.config = DeviceConfig(host=host, connection_type=DeviceConnectionParameters.from_dict(connection))
        self.mac = "50:C7:BF:00:11:22"
        self.model = "HS110"
        self.alias = alias
        self.device_type = device_type
        self.is_on = False
        self.children = [FakeKasa(host, device_type=DeviceType.StripSocket, alias=f"Socket {i + 1}") for i in range(children)]
        self.modules = {}
        if light:
            self.modules[Module.Light] = FakeLight()
        if energy:
            self.modules[Module.Energy] = SimpleNamespace(current_consumption=12.34, consumption_today=0.5)
        self.updates = 0
        self.disconnected = False

    async def update(self):
        self.updates += 1

    async def turn_on(self):
        self.is_on = True

    async def turn_off(self):
        self.is_on = False

    async def disconnect(self):
        self.disconnected = True


@pytest.fixture
def ctx(tmp_path, monkeypatch):
    monkeypatch.setenv("CUBE_DATA_DIR", str(tmp_path))
    return AdapterContext(load_settings())


def stored(**params):
    return StoredDevice(
        id="d1",
        adapter_id="tplink",
        brand="tplink",
        unique_id="50c7bf001122",
        name="Kettle",
        category=Category.PLUG,
        host="192.168.1.30",
        params={"connection_type": LEGACY, **params},
    )


async def test_discovery_marks_which_devices_need_an_account(ctx, monkeypatch):
    plug, tapo = FakeKasa("192.168.1.30", energy=True), FakeKasa("192.168.1.31", connection=KLAP)
    tapo.mac = "AA:BB:CC:00:00:01"
    calls = []

    async def discover(target, discovery_timeout):
        calls.append((target, discovery_timeout))
        return {"192.168.1.30": plug, "192.168.1.31": tapo, "10.9.9.9": FakeKasa("10.9.9.9")}

    monkeypatch.setattr(tplink.Discover, "discover", discover)
    adapter = tplink.TplinkAdapter(ctx)
    adapter.discovery_targets = ["192.168.1.255"]
    found = []
    await adapter.discover(ScanContext(timeout=2, subnets=[ipaddress.ip_network("192.168.1.0/24")], report=found.append))
    assert calls == [("192.168.1.255", 2)]
    by_ip = {c.ip: c for c in found}
    assert set(by_ip) == {"192.168.1.30", "192.168.1.31"}
    assert by_ip["192.168.1.30"].pairing.auth == "none" and by_ip["192.168.1.30"].account_free
    klap = by_ip["192.168.1.31"]
    assert klap.pairing.auth == "account_credentials" and not klap.account_free and klap.status == "local_authorization_required"
    assert "never sends them to TP-Link" in klap.pairing.instructions
    assert plug.disconnected and tapo.disconnected


async def test_pairing_legacy_and_klap(ctx, monkeypatch):
    adapter = tplink.TplinkAdapter(ctx)
    tapo = FakeKasa("192.168.1.31", connection=KLAP)
    candidate = adapter._candidate(tapo, "192.168.1.31", "manual")

    async def connect(config):
        if config.connection_type.encryption_type.value == "KLAP" and not config.credentials:
            raise AuthenticationError("no creds")
        if config.credentials and config.credentials.password != "right":
            raise AuthenticationError("bad creds")
        return FakeKasa(config.host, connection=KLAP)

    monkeypatch.setattr(tplink.Device, "connect", staticmethod(connect))
    with pytest.raises(AuthRequired) as missing:
        await adapter.pair(candidate, {}, approval=None)
    assert missing.value.code == "credentials_missing"
    with pytest.raises(AuthRequired) as wrong:
        await adapter.pair(candidate, {"username": "me@example.com", "password": "nope"}, approval=None)
    assert wrong.value.code == "device_auth_failed"
    result = await adapter.pair(candidate, {"username": "me@example.com", "password": "right"}, approval=None)
    assert result.credentials == {"username": "me@example.com", "password": "right"}
    assert result.category == Category.PLUG and result.params["connection_type"]["encryption_type"] == "KLAP"


async def test_power_strip_outlets(ctx, monkeypatch):
    strip = FakeKasa("192.168.1.30", device_type=DeviceType.Strip, children=3)
    monkeypatch.setattr(tplink.Device, "connect", staticmethod(lambda config: _ret(strip)))
    adapter = tplink.TplinkAdapter(ctx)
    state = await adapter.get_state(stored())
    assert [c.key for c in state.capabilities] == ["power:0", "power:1", "power:2"]
    assert state.capabilities[1].label == "Socket 2"
    outcome = await adapter.execute_command(stored(), "turn_on", {"key": "power:2"})
    assert strip.children[2].is_on and not strip.children[0].is_on
    assert outcome.result.status == "confirmed" and outcome.state.capabilities[2].value == "on"


async def test_bulb_and_energy(ctx, monkeypatch):
    bulb = FakeKasa("192.168.1.30", device_type=DeviceType.Bulb, light=True, energy=True)
    monkeypatch.setattr(tplink.Device, "connect", staticmethod(lambda config: _ret(bulb)))
    adapter = tplink.TplinkAdapter(ctx)
    state = await adapter.get_state(stored())
    by_type = {c.type: c for c in state.capabilities}
    assert by_type["brightness"].value == 40 and by_type["color_temp"].value == 2700 and by_type["color_temp"].max == 6500
    assert {r.key: r.value for r in state.readings} == {"power_w": 12.3, "energy_today_kwh": 0.5}
    await adapter.execute_command(stored(), "set_color", {"h": 300, "s": 80})
    assert bulb.modules[Module.Light].hsv == (300, 80, 40)
    await adapter.execute_command(stored(), "set_color_temp", {"kelvin": 9000})
    assert bulb.modules[Module.Light].color_temp == 6500
    await adapter.execute_command(stored(), "set_brightness", {"brightness": 0})
    assert bulb.is_on is False


async def test_plug_has_no_dimmer_and_errors_map(ctx, monkeypatch):
    plug = FakeKasa("192.168.1.30")
    monkeypatch.setattr(tplink.Device, "connect", staticmethod(lambda config: _ret(plug)))
    adapter = tplink.TplinkAdapter(ctx)
    with pytest.raises(UnsupportedCommand):
        await adapter.execute_command(stored(), "set_brightness", {"brightness": 5})

    async def unreachable(config):
        raise KasaTimeout("timed out")

    monkeypatch.setattr(tplink.Device, "connect", staticmethod(unreachable))
    with pytest.raises(DeviceUnreachable):
        await tplink.TplinkAdapter(ctx).get_state(stored())


async def test_wifi_join(monkeypatch):
    legacy = FakeKasa("192.168.0.1")
    sent = []

    async def join(ssid, password):
        sent.append((ssid, password))
        return {"err_code": 0}

    legacy.wifi_join = join
    monkeypatch.setattr(tplink.Discover, "discover_single", staticmethod(lambda host, discovery_timeout: _ret(legacy)))
    assert await tplink.wifi_join("192.168.0.1", "Home", "secret") == "accepted"
    assert sent == [("Home", "secret")] and legacy.disconnected

    async def drop(ssid, password):
        raise KasaTimeout("hotspot gone")

    legacy.wifi_join = drop
    assert await tplink.wifi_join("192.168.0.1", "Home", "secret") == "no_response"

    tapo = FakeKasa("192.168.0.1", connection=KLAP)
    monkeypatch.setattr(tplink.Discover, "discover_single", staticmethod(lambda host, discovery_timeout: _ret(tapo)))
    with pytest.raises(NotSupported):
        await tplink.wifi_join("192.168.0.1", "Home", "secret")

    monkeypatch.setattr(tplink.Discover, "discover_single", staticmethod(lambda host, discovery_timeout: _ret(None)))
    with pytest.raises(DeviceUnreachable):
        await tplink.wifi_join("192.168.0.1", "Home", "secret")


async def _ret(value):
    return value
