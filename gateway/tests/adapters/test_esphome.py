"""ESPHome adapter with aioesphomeapi's client replaced by a fake device.

Entities and states are the library's own classes, and every call the adapter makes on the fake is bound against
the real APIClient's signature, so a renamed field or argument fails here instead of on a resident's device.
"""

import asyncio
import base64
import builtins
import dataclasses
import inspect
import ipaddress
import json
import logging
import math
import sys

import pytest
from aioesphomeapi import (
    APIClient,
    APIConnectionError,
    APIVersion,
    BinarySensorInfo,
    BinarySensorState,
    ButtonInfo,
    ClimateFanMode,
    ClimateFeature,
    ClimateInfo,
    ClimateMode,
    ClimateState,
    ColorMode,
    CoverInfo,
    CoverOperation,
    CoverState,
    DeviceInfo,
    EncryptionPlaintextAPIError,
    EntityCategory,
    FanInfo,
    FanState,
    InvalidAuthAPIError,
    InvalidEncryptionKeyAPIError,
    LightInfo,
    LightState,
    ProtocolAPIError,
    RequiresEncryptionAPIError,
    SensorInfo,
    SensorState,
    SocketAPIError,
    SwitchInfo,
    SwitchState,
    TemperatureUnit,
)

from cube_gateway.adapters import esphome
from cube_gateway.adapters.base import (
    AdapterContext,
    AdapterError,
    AuthRequired,
    DeviceUnreachable,
    LocalKeyRequired,
    MdnsRecord,
    ScanContext,
    StoredDevice,
    UnsupportedCommand,
)
from cube_gateway.adapters.esphome import EsphomeAdapter
from cube_gateway.adapters.registry import AdapterRegistry
from cube_gateway.config import load_settings
from cube_gateway.models import AuthKind, Candidate, Category, ConnectionStatus, SupportLevel
from tests.fakes import FakeMdns

MAC = "AA:BB:CC:DD:EE:01"
BARE_MAC = "aabbccddee01"
KEY = base64.b64encode(bytes(range(32))).decode()
OTHER_KEY = base64.b64encode(bytes(range(1, 33))).decode()
HOST = "192.168.1.50"


class FakeDevice:
    """What is on the network: the firmware, its key, and the clients connected to it."""

    def __init__(self, entities=None, states=None, key=None, mac=MAC, sub_devices=()):
        self.entities = entities if entities is not None else [SwitchInfo(key=1, name="Relay")]
        self.states = {(s.device_id, s.key): s for s in (states if states is not None else [SwitchState(key=1, state=False)])}
        self.key = key
        self.mac = mac
        self.sub_devices = list(sub_devices)
        self.reachable = {HOST}
        #: Raised by connect(), whatever else is true.
        self.failure = None
        #: Whether commands change the state and the device reports it.
        self.echo = True
        self.clients = []
        self.calls = []

    def client(self, *args, **kwargs):
        client = FakeClient(self, *args, **kwargs)
        self.clients.append(client)
        return client

    @property
    def live(self):
        return [client for client in self.clients if client.connected]

    def info(self):
        return DeviceInfo(name="bench", friendly_name="Bench", mac_address=self.mac, model="esp32dev", esphome_version="2026.10.2", devices=self.sub_devices)

    def emit(self, state):
        self.states[(state.device_id, state.key)] = state
        for client in self.live:
            if client.on_state:
                client.on_state(state)

    def change(self, call, **changes):
        if self.echo:
            key = (call.get("device_id", 0), call["key"])
            self.emit(dataclasses.replace(self.states[key], **changes))

    async def drop(self):
        for client in self.live:
            client.connected = False
            await client.stop(False)


class FakeClient:
    def __init__(self, device, address, port, password=None, *, client_info="", noise_psk=None):
        # The real constructor is compiled, so inspect cannot read it: building one checks these arguments instead.
        APIClient(address, port, password, client_info=client_info, noise_psk=noise_psk)
        self.device = device
        self.address, self.noise_psk, self.client_info = address, noise_psk, client_info
        self.connected = False
        self.on_state = None
        self.stop = None
        self.login = None

    def _call(self, name, args, kwargs):
        arguments = dict(inspect.signature(getattr(APIClient, name)).bind(self, *args, **kwargs).arguments)
        del arguments["self"]
        self.device.calls.append((name, arguments))
        return arguments

    @property
    def api_version(self):
        return APIVersion(1, 14)

    async def connect(self, *args, **kwargs):
        call = inspect.signature(APIClient.connect).bind(self, *args, **kwargs).arguments
        device = self.device
        if device.failure:
            raise device.failure
        if self.address not in device.reachable:
            raise SocketAPIError("connect failed: raw library text")
        if device.key and not self.noise_psk:
            raise RequiresEncryptionAPIError("requires encryption")
        if self.noise_psk and not device.key:
            raise EncryptionPlaintextAPIError("plaintext")
        if self.noise_psk != device.key:
            raise InvalidEncryptionKeyAPIError("bad key", "bench", "aabbccddee01")
        self.stop = call["on_stop"]
        self.login = call["login"]
        self.connected = True

    async def device_info_and_list_entities(self):
        return self.device.info(), list(self.device.entities), []

    def subscribe_states(self, on_state):
        self.on_state = on_state
        for state in list(self.device.states.values()):
            on_state(state)

    async def disconnect(self, force=False):
        if self.connected:
            self.connected = False
            await self.stop(True)

    def force_disconnect(self):
        self.connected = False

    def switch_command(self, *args, **kwargs):
        call = self._call("switch_command", args, kwargs)
        self.device.change(call, state=call["state"])

    def light_command(self, *args, **kwargs):
        call = self._call("light_command", args, kwargs)
        changes = {name: call[name] for name in ("state", "brightness", "color_temperature", "color_mode") if call.get(name) is not None}
        if call.get("rgb"):
            changes.update(zip(("red", "green", "blue"), call["rgb"], strict=True))
        self.device.change(call, **changes)

    def cover_command(self, *args, **kwargs):
        call = self._call("cover_command", args, kwargs)
        self.device.change(call, **({"position": call["position"]} if call.get("position") is not None else {}))

    def fan_command(self, *args, **kwargs):
        call = self._call("fan_command", args, kwargs)
        self.device.change(call, **{name: call[name] for name in ("state", "speed_level", "preset_mode") if call.get(name) is not None})

    def climate_command(self, *args, **kwargs):
        call = self._call("climate_command", args, kwargs)
        names = ("mode", "target_temperature", "target_temperature_low", "target_temperature_high", "fan_mode", "custom_fan_mode")
        self.device.change(call, **{name: call[name] for name in names if call.get(name) is not None})


# ---- fixtures and builders ---------------------------------------------------------------------------


@pytest.fixture
def ctx(tmp_path, monkeypatch):
    monkeypatch.setenv("CUBE_DATA_DIR", str(tmp_path))
    return AdapterContext(load_settings())


@pytest.fixture
def network():
    """Whichever device the test puts on the network; `network.device` starts as one relay."""

    class Network:
        device = FakeDevice()

        def client(self, *args, **kwargs):
            return self.device.client(*args, **kwargs)

    return Network()


@pytest.fixture
def adapter(ctx, monkeypatch, network):
    monkeypatch.setattr(esphome, "FIRST_STATE_TIMEOUT", 0.05)
    monkeypatch.setattr(esphome, "SETTLE_DELAY", 0.001)
    monkeypatch.setattr(esphome, "PUSH_DELAY", 0.01)
    adapter = EsphomeAdapter(ctx)
    adapter.client_factory = network.client
    return adapter


def candidate(encryption="none", **fields):
    defaults = {"id": "c", "adapter_id": "esphome", "brand": "esphome", "unique_id": "seen", "ip": HOST, "port": 6053, "name": "Seen", "details": {"encryption": encryption}}
    return Candidate(**{**defaults, **fields})


def stored(key=None, **fields):
    defaults = {
        "id": "d1",
        "adapter_id": "esphome",
        "brand": "esphome",
        "unique_id": BARE_MAC,
        "name": "Bench",
        "category": Category.SWITCH,
        "host": HOST,
        "port": 6053,
        "mac": "aa:bb:cc:dd:ee:01",
        "params": {"mdns_name": "bench"},
        "credentials": {"local_key": key} if key else {},
    }
    return StoredDevice(**{**defaults, **fields})


def record(ip=HOST, name="bench", **txt):
    return MdnsRecord(type=esphome.SERVICE, name=name, ip=ip, port=6053, properties=txt)


async def scan_of(adapter, *records):
    found = []
    scan = ScanContext(timeout=1, subnets=[ipaddress.ip_network("192.168.1.0/24")], report=found.append)
    scan.mdns = list(records)
    scan.passive_done.set()
    await adapter.discover(scan)
    return found, scan


async def no_approval(_message):
    pass


def cap(state, key):
    return next(item for item in state.capabilities if item.key == key)


def reading(state, key):
    return next(item for item in state.readings if item.key == key)


LIGHT = LightInfo(key=2, name="Strip", supported_color_modes=[ColorMode.RGB, ColorMode.COLOR_TEMPERATURE], min_mireds=153, max_mireds=500)
LIGHT_ON = LightState(key=2, state=True, brightness=0.5, color_mode=ColorMode.RGB, red=1.0, green=0.0, blue=0.0, color_temperature=250.0)
COVER = CoverInfo(key=3, name="Blind", supports_position=True, supports_stop=True)
COVER_HALF = CoverState(key=3, position=0.5, current_operation=CoverOperation.IDLE)
FAN = FanInfo(key=4, name="Ceiling fan", supports_speed=True, supported_speed_count=4, supported_preset_modes=["sleep"])
FAN_ON = FanState(key=4, state=True, speed_level=2, preset_mode="")
CLIMATE = ClimateInfo(
    key=5,
    name="AC",
    feature_flags=ClimateFeature.SUPPORTS_CURRENT_TEMPERATURE | ClimateFeature.SUPPORTS_CURRENT_HUMIDITY,
    supported_modes=[ClimateMode.OFF, ClimateMode.COOL, ClimateMode.HEAT],
    visual_min_temperature=16,
    visual_max_temperature=30,
    visual_target_temperature_step=0.5,
    supported_fan_modes=[ClimateFanMode.AUTO, ClimateFanMode.LOW],
    supported_custom_fan_modes=["Turbo"],
)
CLIMATE_HEAT = ClimateState(key=5, mode=ClimateMode.HEAT, current_temperature=20.5, target_temperature=21.0, fan_mode=ClimateFanMode.AUTO, current_humidity=44.0)
TWO_POINT = ClimateInfo(key=6, name="Band", feature_flags=ClimateFeature.REQUIRES_TWO_POINT_TARGET_TEMPERATURE, supported_modes=[ClimateMode.HEAT_COOL], visual_min_temperature=10, visual_max_temperature=35)
TWO_POINT_STATE = ClimateState(key=6, mode=ClimateMode.HEAT_COOL, target_temperature_low=20.0, target_temperature_high=24.0)


# ---- metadata and discovery --------------------------------------------------------------------------


def test_the_fake_only_stands_in_for_what_the_real_client_has():
    for name in vars(FakeClient):
        if not name.startswith("_"):
            assert hasattr(APIClient, name), name


def test_metadata_makes_no_hardware_claim():
    info = EsphomeAdapter.info
    assert (info.id, info.brands, info.library) == ("esphome", ["esphome"], "aioesphomeapi")
    assert info.status == SupportLevel.EXPERIMENTAL and info.verified_models == []
    assert info.account_free is True and info.push_updates is True and info.auth == AuthKind.LOCAL_KEY
    assert EsphomeAdapter.mdns_types == ("_esphomelib._tcp.local.",)


async def test_mdns_discovery_reads_the_txt_records(adapter):
    found, scan = await scan_of(adapter, record(friendly_name="Bench\nPlug", mac=BARE_MAC, board="esp32dev", project_name="acme.plug"))
    candidate_ = found[0]
    assert candidate_.name == "BenchPlug" and candidate_.model == "acme.plug" and candidate_.mac == "aa:bb:cc:dd:ee:01"
    assert candidate_.unique_id == BARE_MAC and candidate_.control == "experimental" and HOST in scan.claimed_ips


async def test_a_device_without_a_mac_in_its_advert_falls_back_to_its_name(adapter):
    found, _ = await scan_of(adapter, record(board="esp8266"))
    assert found[0].unique_id == "bench" and found[0].name == "bench" and found[0].model == "esp8266"


async def test_an_encrypted_advert_asks_for_the_key_up_front(adapter):
    found, _ = await scan_of(adapter, record(mac=BARE_MAC, api_encryption="Noise_NNpsk0_25519_ChaChaPoly_SHA256"))
    pairing = found[0].pairing
    assert found[0].status == ConnectionStatus.LOCAL_KEY_REQUIRED
    assert pairing.auth == AuthKind.LOCAL_KEY and [f.name for f in pairing.fields] == ["local_key"]
    assert pairing.fields[0].secret is True and pairing.fields[0].kind == "password"


async def test_supported_but_unset_encryption_needs_no_key(adapter):
    found, _ = await scan_of(adapter, record(mac=BARE_MAC, api_encryption_supported="Noise_NNpsk0_25519_ChaChaPoly_SHA256"))
    assert found[0].status == ConnectionStatus.IDENTIFIED and found[0].pairing.fields == []


async def test_discovery_ignores_addresses_outside_the_scan(adapter):
    found, _ = await scan_of(adapter, record(ip="8.8.8.8"), record(ip="10.9.9.9"))
    assert found == []


async def test_probe_identifies_a_plaintext_device_and_lets_go(adapter, network):
    found = await adapter.probe(HOST)
    assert found.unique_id == BARE_MAC and found.name == "Bench" and found.model == "esp32dev" and found.details["encryption"] == "none"
    assert network.device.live == []


async def test_probe_recognises_an_encrypted_device_it_cannot_read(adapter, network):
    network.device = FakeDevice(key=KEY)
    found = await adapter.probe(HOST)
    assert found.unique_id == f"ip-{HOST}" and found.pairing.fields and found.details["encryption"] == "required"


async def test_probe_leaves_other_services_alone(adapter, network):
    network.device.failure = ProtocolAPIError("Invalid preamble")
    assert await adapter.probe(HOST) is None


# ---- pairing -----------------------------------------------------------------------------------------


async def test_pairing_reads_state_and_identifies_the_device(adapter, network):
    result = await adapter.pair(candidate(unique_id=f"ip-{HOST}"), {}, no_approval)
    assert result.unique_id == BARE_MAC and result.mac == "aa:bb:cc:dd:ee:01" and result.host == HOST and result.port == 6053
    assert (result.name, result.model, result.category) == ("Bench", "esp32dev", Category.SWITCH)
    assert result.params == {"mdns_name": "bench", "esphome_version": "2026.10.2", "encrypted": False}
    assert result.credentials == {}
    client = network.device.clients[0]
    assert client.login is True and client.client_info == "CUBE Gateway" and client.noise_psk is None
    assert network.device.live == [], "pairing must release its connection"


async def test_pairing_stores_a_key_the_device_accepts(adapter, network):
    network.device = FakeDevice(key=KEY)
    result = await adapter.pair(candidate("required"), {"local_key": f"  {KEY}\n"}, no_approval)
    assert network.device.clients[0].noise_psk == KEY
    assert result.credentials == {"local_key": KEY} and result.params["encrypted"] is True


async def test_an_encrypted_device_found_without_an_advert_gets_the_key_field(adapter, network):
    network.device = FakeDevice(key=KEY)
    found = candidate("none")
    assert adapter.get_pairing_requirements(found).fields == []
    with pytest.raises(LocalKeyRequired) as error:
        await adapter.pair(found, {}, no_approval)
    assert error.value.code == "local_key_required"
    assert [f.name for f in adapter.get_pairing_requirements(found).fields] == ["local_key"]


async def test_a_wrong_key_asks_again(adapter, network):
    network.device = FakeDevice(key=KEY)
    found = candidate("required")
    with pytest.raises(LocalKeyRequired) as error:
        await adapter.pair(found, {"local_key": OTHER_KEY}, no_approval)
    assert error.value.code == "local_key_invalid" and adapter.get_pairing_requirements(found).fields
    assert network.device.live == []


@pytest.mark.parametrize("bad", ["short", "A" * 44, "!" * 44, base64.b64encode(bytes(16)).decode()])
async def test_a_malformed_key_never_reaches_the_library(adapter, network, bad):
    with pytest.raises(LocalKeyRequired) as error:
        await adapter.pair(candidate("none"), {"local_key": bad}, no_approval)
    assert error.value.code == "local_key_invalid" and bad not in error.value.message
    assert network.device.clients == []


async def test_a_key_offered_to_an_unencrypted_device_is_dropped(adapter, network, caplog):
    with caplog.at_level(logging.INFO):
        result = await adapter.pair(candidate("none"), {"local_key": KEY}, no_approval)
    assert [client.noise_psk for client in network.device.clients] == [KEY, None]
    assert result.credentials == {} and result.params["encrypted"] is False
    assert KEY not in caplog.text


async def test_no_fallback_when_the_advert_said_the_device_is_encrypted(adapter, network):
    with pytest.raises(DeviceUnreachable) as error:
        await adapter.pair(candidate("required"), {"local_key": KEY}, no_approval)
    assert error.value.code == "encryption_mismatch"
    assert [client.noise_psk for client in network.device.clients] == [KEY]


async def test_the_key_is_never_logged(adapter, network, caplog):
    network.device = FakeDevice(key=KEY)
    with caplog.at_level(logging.DEBUG):
        await adapter.pair(candidate("required"), {"local_key": KEY}, no_approval)
        with pytest.raises(LocalKeyRequired):
            await adapter.pair(candidate("required"), {"local_key": OTHER_KEY}, no_approval)
        await adapter.get_state(stored(KEY))
    assert KEY not in caplog.text and OTHER_KEY not in caplog.text


async def test_pairing_failures_read_well_and_quote_nothing_from_the_network(adapter, network):
    network.device.failure = SocketAPIError("<script>device said this</script>")
    with pytest.raises(DeviceUnreachable) as error:
        await adapter.pair(candidate(), {}, no_approval)
    assert error.value.message == "The ESPHome device did not answer."


@pytest.mark.parametrize("failure", [OSError("no route"), TimeoutError(), APIConnectionError("x"), ProtocolAPIError("x")])
async def test_every_connection_failure_is_an_adapter_error(adapter, network, failure):
    network.device.failure = failure
    with pytest.raises(DeviceUnreachable):
        await adapter.pair(candidate(), {}, no_approval)


async def test_a_device_that_never_answers_times_out(adapter, network, monkeypatch):
    class Hanging(FakeClient):
        async def connect(self, *args, **kwargs):
            await asyncio.sleep(30)

    monkeypatch.setattr(esphome, "PAIR_TIMEOUT", 0.01)
    adapter.client_factory = lambda *args, **kwargs: Hanging(network.device, *args, **kwargs)
    with pytest.raises(DeviceUnreachable):
        await adapter.pair(candidate(), {}, no_approval)


async def test_a_failure_after_connecting_lets_go_of_the_socket(adapter, network):
    class DropsDuringListing(FakeClient):
        async def device_info_and_list_entities(self):
            raise SocketAPIError("connection lost")

    adapter.client_factory = lambda *args, **kwargs: network.device.clients.append(client := DropsDuringListing(network.device, *args, **kwargs)) or client
    with pytest.raises(DeviceUnreachable):
        await adapter.pair(candidate(), {}, no_approval)
    assert network.device.clients and network.device.live == []


async def test_a_legacy_api_password_is_explained(adapter, network):
    network.device.failure = InvalidAuthAPIError("Invalid password!")
    with pytest.raises(AuthRequired) as error:
        await adapter.pair(candidate(), {}, no_approval)
    assert "password" in error.value.message and error.value.code == "device_auth_failed"


async def test_pairing_without_a_candidate_address(adapter):
    with pytest.raises(DeviceUnreachable):
        await adapter.pair(candidate(ip=None), {}, no_approval)


async def test_pairing_needs_a_state_to_prove_control(adapter, network):
    network.device = FakeDevice(states=[])
    with pytest.raises(DeviceUnreachable):
        await adapter.pair(candidate(), {}, no_approval)
    assert network.device.live == []


async def test_pairing_refuses_a_device_with_nothing_to_offer(adapter, network):
    network.device = FakeDevice(entities=[ButtonInfo(key=1, name="Restart")], states=[])
    with pytest.raises(AdapterError) as error:
        await adapter.pair(candidate(), {}, no_approval)
    assert error.value.code == "no_entities"


@pytest.mark.parametrize(
    ("entities", "category"),
    [
        ([SwitchInfo(key=1)], Category.SWITCH),
        ([SwitchInfo(key=1, device_class="outlet")], Category.PLUG),
        ([SwitchInfo(key=1, device_class="outlet"), SwitchInfo(key=2)], Category.SWITCH),
        ([SwitchInfo(key=1), LIGHT], Category.LIGHT),
        ([LIGHT, FAN], Category.FAN),
        ([LIGHT, COVER], Category.COVER),
        ([COVER, CLIMATE], Category.CLIMATE),
        ([SensorInfo(key=1)], Category.SENSOR),
    ],
)
def test_the_category_follows_the_main_entity(entities, category):
    assert esphome._category(entities) == category


# ---- entities to capabilities --------------------------------------------------------------------------


async def test_each_switch_is_its_own_capability(adapter, network):
    network.device = FakeDevice(
        entities=[SwitchInfo(key=11, name="Relay 1"), SwitchInfo(key=12, name="Relay 2")],
        states=[SwitchState(key=11, state=True), SwitchState(key=12, state=False)],
    )
    state = await adapter.get_state(stored())
    assert [(c.key, c.type, c.label, c.value) for c in state.capabilities] == [("power:11", "power", "Relay 1", "on"), ("power:12", "power", "Relay 2", "off")]
    assert state.commands == ["turn_on", "turn_off", "toggle"] and state.online is True


async def test_firmware_maintenance_switches_are_not_controls(adapter, network):
    """ESPHome's factory_reset, restart and safe_mode are plain switches with entity_category: config."""
    reset = SwitchInfo(key=9, name="Factory reset", entity_category=EntityCategory.CONFIG)
    hidden = SwitchInfo(key=8, name="Hidden", disabled_by_default=True)
    diagnostic = SwitchInfo(key=7, name="Debug", entity_category=EntityCategory.DIAGNOSTIC)
    network.device = FakeDevice(entities=[SwitchInfo(key=1, name="Relay"), reset, hidden, diagnostic], states=[SwitchState(key=1), SwitchState(key=9)])
    device = stored()
    state = await adapter.get_state(device)
    assert [c.key for c in state.capabilities] == ["power:1"]
    with pytest.raises(UnsupportedCommand):
        await adapter.execute_command(device, "turn_on", {"key": "power:9"})
    assert network.device.calls == []


async def test_entities_on_sub_devices_with_the_same_key_stay_apart(adapter, network):
    network.device = FakeDevice(
        entities=[SwitchInfo(key=1, name="Relay"), SwitchInfo(key=1, name="Relay", device_id=7)],
        states=[SwitchState(key=1, state=True), SwitchState(key=1, state=False, device_id=7)],
        sub_devices=[{"device_id": 7, "name": "Kitchen\t"}],
    )
    device = stored()
    state = await adapter.get_state(device)
    assert [(c.key, c.label, c.value) for c in state.capabilities] == [("power:1", "Relay", "on"), ("power:7.1", "Kitchen Relay", "off")]
    outcome = await adapter.execute_command(device, "turn_on", {"key": "power:7.1"})
    assert network.device.calls[-1] == ("switch_command", {"key": 1, "state": True, "device_id": 7})
    assert outcome.result.status == "confirmed" and cap(outcome.state, "power:7.1").value == "on"


async def test_an_entity_without_a_name_takes_the_device_name(adapter, network):
    network.device = FakeDevice(entities=[SwitchInfo(key=1, name="")])
    assert (await adapter.get_state(stored())).capabilities[0].label == "Bench"


async def test_an_entity_with_no_state_yet_is_not_confirmed(adapter, network):
    network.device = FakeDevice(states=[])
    power = (await adapter.get_state(stored())).capabilities[0]
    assert power.value == "unknown" and power.confirmed is False


async def test_a_switch_that_cannot_report_is_not_confirmed(adapter, network):
    network.device = FakeDevice(entities=[SwitchInfo(key=1, name="RF outlet", assumed_state=True)], states=[SwitchState(key=1, state=True)])
    power = (await adapter.get_state(stored())).capabilities[0]
    assert power.value == "on" and power.confirmed is False


async def test_a_switch_with_a_missing_state_is_unknown(adapter, network):
    network.device = FakeDevice(states=[SwitchState(key=1, state=False, missing_state=True)])
    assert (await adapter.get_state(stored())).capabilities[0].value == "unknown"


@pytest.mark.parametrize(
    ("modes", "types"),
    [
        ([ColorMode.ON_OFF], {"power"}),
        ([ColorMode.BRIGHTNESS], {"power", "brightness"}),
        ([ColorMode.COLOR_TEMPERATURE], {"power", "brightness", "color_temp"}),
        ([ColorMode.COLD_WARM_WHITE], {"power", "brightness", "color_temp"}),
        ([ColorMode.RGB], {"power", "brightness", "color"}),
        ([ColorMode.RGB_WHITE], {"power", "brightness", "color"}),
        ([ColorMode.RGB_COLD_WARM_WHITE], {"power", "brightness", "color", "color_temp"}),
    ],
)
async def test_a_light_offers_only_what_its_colour_modes_support(adapter, network, modes, types):
    network.device = FakeDevice(entities=[LightInfo(key=2, name="L", supported_color_modes=modes, min_mireds=153, max_mireds=500)], states=[LightState(key=2)])
    state = await adapter.get_state(stored())
    assert {c.type for c in state.capabilities} == types
    assert ("set_brightness" in state.commands) == ("brightness" in types) and ("set_color" in state.commands) == ("color" in types)


async def test_a_white_temperature_light_without_a_range_offers_none(adapter, network):
    network.device = FakeDevice(entities=[LightInfo(key=2, supported_color_modes=[ColorMode.COLOR_TEMPERATURE])], states=[LightState(key=2)])
    assert "color_temp" not in {c.type for c in (await adapter.get_state(stored())).capabilities}


async def test_light_values(adapter, network):
    network.device = FakeDevice(entities=[LIGHT], states=[LIGHT_ON])
    state = await adapter.get_state(stored())
    assert cap(state, "light:2").value == "on" and cap(state, "brightness:2").value == 50
    assert cap(state, "color:2").value == {"h": 0, "s": 100}
    temperature = cap(state, "color_temp:2")
    assert temperature.value == 4000 and temperature.min == 2000 and temperature.max == 6536


async def test_a_light_in_white_mode_has_no_colour_to_report(adapter, network):
    network.device = FakeDevice(entities=[LIGHT], states=[dataclasses.replace(LIGHT_ON, color_mode=ColorMode.COLOR_TEMPERATURE)])
    assert cap(await adapter.get_state(stored()), "color:2").value is None


async def test_nan_in_a_light_state_does_not_break_the_device(adapter, network):
    network.device = FakeDevice(entities=[LIGHT], states=[dataclasses.replace(LIGHT_ON, brightness=math.nan, red=math.nan, color_temperature=math.nan)])
    state = await adapter.get_state(stored())
    assert cap(state, "brightness:2").value is None and cap(state, "color_temp:2").value is None


@pytest.mark.parametrize(
    ("position", "operation", "text", "percent"),
    [
        (0.0, CoverOperation.IDLE, "closed", 0),
        (1.0, CoverOperation.IDLE, "open", 100),
        (0.25, CoverOperation.IDLE, "open", 25),
        (0.25, CoverOperation.IS_OPENING, "opening", 25),
        (0.25, CoverOperation.IS_CLOSING, "closing", 25),
    ],
)
async def test_cover_state(adapter, network, position, operation, text, percent):
    network.device = FakeDevice(entities=[COVER], states=[CoverState(key=3, position=position, current_operation=operation)])
    state = await adapter.get_state(stored())
    cover = cap(state, "cover:3")
    assert (cover.type, cover.label, cover.state, cover.position) == ("cover", "Blind", text, percent)
    assert {"cover_open", "cover_close", "cover_stop", "set_position"} <= set(state.commands)


async def test_a_simple_cover_offers_no_position_or_stop(adapter, network):
    network.device = FakeDevice(entities=[CoverInfo(key=3, assumed_state=True)], states=[CoverState(key=3)])
    state = await adapter.get_state(stored())
    assert cap(state, "cover:3").position is None and cap(state, "cover:3").confirmed is False
    assert "cover_stop" not in state.commands and "set_position" not in state.commands and "cover_open" in state.commands


async def test_fan_capabilities(adapter, network):
    network.device = FakeDevice(entities=[FAN], states=[FAN_ON])
    state = await adapter.get_state(stored())
    fan = cap(state, "fan:4")
    assert cap(state, "fan_power:4").value == "on"
    assert (fan.percentage, fan.presets, fan.label) == (50, ["sleep"], "Ceiling fan")
    assert {"turn_on", "set_fan_speed", "set_fan_mode"} <= set(state.commands)


async def test_an_on_off_fan_has_no_speed_control(adapter, network):
    network.device = FakeDevice(entities=[FanInfo(key=4, name="F")], states=[FanState(key=4)])
    state = await adapter.get_state(stored())
    assert [c.type for c in state.capabilities] == ["power"] and "set_fan_speed" not in state.commands


async def test_a_preset_only_fan_lists_no_speed_command(adapter, network):
    network.device = FakeDevice(entities=[FanInfo(key=4, name="F", supported_preset_modes=["sleep"])], states=[FanState(key=4)])
    state = await adapter.get_state(stored())
    assert "set_fan_speed" not in state.commands and "set_fan_mode" in state.commands


async def test_climate_capability(adapter, network):
    network.device = FakeDevice(entities=[CLIMATE], states=[CLIMATE_HEAT])
    state = await adapter.get_state(stored())
    climate = cap(state, "climate:5")
    assert (climate.current, climate.target, climate.mode, climate.label) == (20.5, 21.0, "heat", "AC")
    assert climate.modes == ["off", "cool", "heat"] and climate.fan_modes == ["auto", "low", "Turbo"] and climate.fan_mode == "auto"
    assert (climate.min, climate.max, climate.step, climate.unit) == (16, 30, 0.5, "°C")
    assert reading(state, "current_humidity").value == 44.0
    assert {"set_temperature", "set_hvac_mode", "set_fan_mode", "turn_on", "turn_off"} <= set(state.commands)


async def test_climate_without_optional_features(adapter, network):
    bare = ClimateInfo(key=5, name="AC", supported_modes=[ClimateMode.HEAT], temperature_unit=TemperatureUnit.FAHRENHEIT)
    network.device = FakeDevice(entities=[bare], states=[ClimateState(key=5, mode=ClimateMode.HEAT, target_temperature=math.nan, current_temperature=20.0)])
    state = await adapter.get_state(stored())
    climate = cap(state, "climate:5")
    assert climate.current is None and climate.target is None and climate.fan_mode is None and climate.unit == "°F"
    assert (climate.min, climate.max, climate.step) == (16, 30, 0.5) and state.readings == []


async def test_a_custom_fan_mode_in_use_is_reported(adapter, network):
    network.device = FakeDevice(entities=[CLIMATE], states=[dataclasses.replace(CLIMATE_HEAT, custom_fan_mode="Turbo")])
    assert cap(await adapter.get_state(stored()), "climate:5").fan_mode == "Turbo"


async def test_a_two_point_climate_shows_the_middle_of_its_band(adapter, network):
    network.device = FakeDevice(entities=[TWO_POINT], states=[TWO_POINT_STATE])
    assert cap(await adapter.get_state(stored()), "climate:6").target == 22.0


async def test_sensors_become_readings(adapter, network):
    network.device = FakeDevice(
        entities=[
            SensorInfo(key=1, name="Temp\x07", unit_of_measurement="°C", accuracy_decimals=1, device_class="temperature"),
            SensorInfo(key=2, name="Broken", unit_of_measurement="V"),
            SensorInfo(key=3, name="Waiting", unit_of_measurement="W"),
            BinarySensorInfo(key=4, name="Door", device_class="door"),
            BinarySensorInfo(key=5, name="Unknown"),
        ],
        states=[
            SensorState(key=1, state=21.123456),
            SensorState(key=2, state=math.nan),
            SensorState(key=3, state=0.0, missing_state=True),
            BinarySensorState(key=4, state=True),
            BinarySensorState(key=5, state=False, missing_state=True),
        ],
    )
    state = await adapter.get_state(stored())
    temperature = reading(state, "sensor:1")
    assert (temperature.label, temperature.value, temperature.unit, temperature.device_class) == ("Temp", 21.1, "°C", "temperature")
    assert reading(state, "sensor:2").value is None and reading(state, "sensor:3").value is None
    assert reading(state, "binary:4").value is True and reading(state, "binary:5").value is None
    assert state.capabilities == [] and state.commands == []


async def test_state_is_strict_json_whatever_the_device_sends(adapter, network):
    entities = [LIGHT, COVER, FAN, CLIMATE, SensorInfo(key=7, name="S")]
    bad = float("inf")
    states = [
        dataclasses.replace(LIGHT_ON, brightness=bad),
        CoverState(key=3, position=math.nan),
        FAN_ON,
        ClimateState(key=5, current_temperature=math.nan, target_temperature=bad, current_humidity=math.nan),
        SensorState(key=7, state=bad),
    ]
    network.device = FakeDevice(entities=entities, states=states)
    state = await adapter.get_state(stored())
    json.dumps([c.model_dump(mode="json") for c in state.capabilities] + [r.model_dump(mode="json") for r in state.readings], allow_nan=False)


async def test_a_device_cannot_flood_the_api(adapter, network):
    many = [SwitchInfo(key=i + 1, name=f"Relay {i}") for i in range(500)]
    wordy = FanInfo(key=9000, name="F", supported_preset_modes=[f"preset {i}" for i in range(500)])
    network.device = FakeDevice(entities=[wordy, *many], states=[FanState(key=9000)])
    state = await adapter.get_state(stored())
    assert len(state.capabilities) <= esphome.MAX_ENTITIES + 1
    assert len(cap(state, "fan:9000").presets) == esphome.MAX_OPTIONS


async def test_unsupported_entity_types_are_ignored(adapter, network):
    network.device = FakeDevice(entities=[ButtonInfo(key=1, name="Press"), SwitchInfo(key=2, name="Relay")], states=[SwitchState(key=2)])
    assert [c.key for c in (await adapter.get_state(stored())).capabilities] == ["power:2"]


# ---- commands --------------------------------------------------------------------------------------------


@pytest.fixture
def relays(network):
    network.device = FakeDevice(
        entities=[SwitchInfo(key=11, name="Relay 1"), SwitchInfo(key=12, name="Relay 2")],
        states=[SwitchState(key=11, state=False), SwitchState(key=12, state=False)],
    )
    return network.device


async def test_a_command_goes_to_the_relay_it_names(adapter, relays):
    outcome = await adapter.execute_command(stored(), "turn_on", {"key": "power:12"})
    assert relays.calls == [("switch_command", {"key": 12, "state": True, "device_id": 0})]
    assert outcome.result.status == "confirmed"
    assert cap(outcome.state, "power:12").value == "on" and cap(outcome.state, "power:11").value == "off"


async def test_without_a_key_the_first_control_is_used(adapter, relays):
    await adapter.execute_command(stored(), "turn_on", {})
    assert relays.calls[-1][1]["key"] == 11


@pytest.mark.parametrize("key", ["power:99", "power:", "nonsense", "light:12x"])
async def test_a_key_that_matches_nothing_switches_nothing(adapter, relays, key):
    with pytest.raises(UnsupportedCommand):
        await adapter.execute_command(stored(), "turn_on", {"key": key})
    assert relays.calls == []


async def test_toggle_reads_the_current_state(adapter, relays):
    await adapter.execute_command(stored(), "toggle", {"key": "power:11"})
    await adapter.execute_command(stored(), "toggle", {"key": "power:11"})
    assert [call[1]["state"] for call in relays.calls] == [True, False]


async def test_a_silent_device_leaves_the_command_pending(adapter, relays):
    relays.echo = False
    outcome = await adapter.execute_command(stored(), "turn_on", {"key": "power:11"})
    assert outcome.result.status == "pending" and cap(outcome.state, "power:11").value == "off"


async def test_a_device_that_cannot_report_gives_an_assumed_result(adapter, network):
    network.device = FakeDevice(entities=[SwitchInfo(key=1, assumed_state=True)], states=[SwitchState(key=1)])
    outcome = await adapter.execute_command(stored(), "turn_on", {})
    assert outcome.result.status == "assumed" and outcome.result.message


async def test_commands_outside_the_vocabulary_are_refused(adapter, relays):
    with pytest.raises(UnsupportedCommand):
        await adapter.execute_command(stored(), "set_volume", {"volume": 5})


async def test_a_command_for_a_kind_the_device_lacks_is_refused(adapter, relays):
    for command, params in [("set_brightness", {"brightness": 5}), ("cover_open", {}), ("set_temperature", {"temperature": 20}), ("set_fan_speed", {"percentage": 5})]:
        with pytest.raises(UnsupportedCommand):
            await adapter.execute_command(stored(), command, params)


async def test_a_connection_lost_while_sending_is_reported(adapter, relays):
    device = stored()
    await adapter.get_state(device)

    def broken(*args, **kwargs):
        raise APIConnectionError("Not connected")

    relays.clients[0].switch_command = broken
    with pytest.raises(DeviceUnreachable) as error:
        await adapter.execute_command(device, "turn_on", {})
    assert error.value.message == "Lost the connection to the ESPHome device."


@pytest.fixture
def strip(network):
    network.device = FakeDevice(entities=[LIGHT], states=[LIGHT_ON])
    return network.device


async def test_power_for_lights_and_fans(adapter, network):
    network.device = FakeDevice(entities=[LIGHT, FAN], states=[LIGHT_ON, FAN_ON])
    outcome = await adapter.execute_command(stored(), "turn_off", {"key": "light:2"})
    assert network.device.calls[-1] == ("light_command", {"key": 2, "state": False, "device_id": 0}) and outcome.result.status == "confirmed"
    outcome = await adapter.execute_command(stored(), "turn_off", {"key": "fan_power:4"})
    assert network.device.calls[-1] == ("fan_command", {"key": 4, "state": False, "device_id": 0}) and outcome.result.status == "confirmed"


async def test_brightness(adapter, strip):
    outcome = await adapter.execute_command(stored(), "set_brightness", {"key": "brightness:2", "brightness": 40})
    assert strip.calls[-1] == ("light_command", {"key": 2, "state": True, "brightness": 0.4, "device_id": 0})
    assert outcome.result.status == "confirmed" and cap(outcome.state, "brightness:2").value == 40


async def test_brightness_zero_turns_the_light_off(adapter, strip):
    await adapter.execute_command(stored(), "set_brightness", {"brightness": 0})
    assert strip.calls[-1] == ("light_command", {"key": 2, "state": False, "device_id": 0})


async def test_colour_uses_the_purest_rgb_mode(adapter, strip):
    outcome = await adapter.execute_command(stored(), "set_color", {"key": "color:2", "h": 120, "s": 100})
    name, call = strip.calls[-1]
    assert name == "light_command" and call["rgb"] == (0.0, 1.0, 0.0) and call["color_mode"] == ColorMode.RGB and call["color_brightness"] == 1.0
    assert outcome.result.status == "confirmed" and cap(outcome.state, "color:2").value == {"h": 120, "s": 100}


@pytest.mark.parametrize(
    ("mode", "white"),
    [
        (ColorMode.RGB_WHITE, {"white": 0.0}),
        (ColorMode.RGB_COLOR_TEMPERATURE, {"white": 0.0}),
        (ColorMode.RGB_COLD_WARM_WHITE, {"cold_white": 0.0, "warm_white": 0.0}),
    ],
)
async def test_a_colour_on_a_combined_light_turns_its_white_off(adapter, network, mode, white):
    network.device = FakeDevice(entities=[LightInfo(key=2, supported_color_modes=[mode])], states=[LightState(key=2, color_mode=mode)])
    await adapter.execute_command(stored(), "set_color", {"h": 10, "s": 50})
    assert white.items() <= network.device.calls[-1][1].items()


async def test_white_temperature_switches_the_light_to_white(adapter, strip):
    outcome = await adapter.execute_command(stored(), "set_color_temp", {"key": "color_temp:2", "kelvin": 2500})
    call = strip.calls[-1][1]
    assert call["color_temperature"] == 400 and call["color_mode"] == ColorMode.COLOR_TEMPERATURE and "color_brightness" not in call
    assert outcome.result.status == "confirmed" and cap(outcome.state, "color_temp:2").value == 2500


async def test_a_white_temperature_is_clamped_to_the_lights_range(adapter, strip):
    await adapter.execute_command(stored(), "set_color_temp", {"kelvin": 100000})
    assert strip.calls[-1][1]["color_temperature"] == 153


@pytest.mark.parametrize(
    ("mode", "expected"),
    [(ColorMode.RGB_COLOR_TEMPERATURE, {"color_brightness": 0.0, "white": 1.0}), (ColorMode.RGB_COLD_WARM_WHITE, {"color_brightness": 0.0})],
)
async def test_white_on_a_combined_light_turns_its_colour_off(adapter, network, mode, expected):
    light = LightInfo(key=2, supported_color_modes=[mode], min_mireds=153, max_mireds=500)
    network.device = FakeDevice(entities=[light], states=[LightState(key=2, color_mode=mode)])
    await adapter.execute_command(stored(), "set_color_temp", {"kelvin": 4000})
    assert expected.items() <= network.device.calls[-1][1].items()


async def test_a_matching_white_temperature_on_a_coloured_light_is_not_confirmed_early(adapter, strip):
    """The state keeps its old temperature while showing a colour, so the value alone proves nothing."""
    strip.echo = False
    outcome = await adapter.execute_command(stored(), "set_color_temp", {"kelvin": 4000})
    assert outcome.result.status == "pending"


async def test_a_light_refuses_what_it_cannot_do(adapter, network):
    network.device = FakeDevice(entities=[LightInfo(key=2, supported_color_modes=[ColorMode.ON_OFF])], states=[LightState(key=2)])
    for command, params in [("set_brightness", {"brightness": 5}), ("set_color", {"h": 1, "s": 1}), ("set_color_temp", {"kelvin": 3000})]:
        with pytest.raises(UnsupportedCommand):
            await adapter.execute_command(stored(), command, params)


@pytest.mark.parametrize("params", [{}, {"brightness": "bright"}])
async def test_bad_parameters_are_reported(adapter, strip, params):
    with pytest.raises(AdapterError) as error:
        await adapter.execute_command(stored(), "set_brightness", params)
    assert error.value.code == "bad_params"


@pytest.fixture
def blind(network):
    network.device = FakeDevice(entities=[COVER], states=[COVER_HALF])
    return network.device


@pytest.mark.parametrize(("command", "position"), [("cover_open", 1.0), ("cover_close", 0.0)])
async def test_open_and_close(adapter, blind, command, position):
    outcome = await adapter.execute_command(stored(), command, {"key": "cover:3"})
    assert blind.calls[-1] == ("cover_command", {"key": 3, "position": position, "device_id": 0}) and outcome.result.status == "confirmed"


async def test_position_and_stop(adapter, blind):
    await adapter.execute_command(stored(), "set_position", {"position": 60})
    assert blind.calls[-1][1]["position"] == 0.6
    await adapter.execute_command(stored(), "cover_stop", {})
    assert blind.calls[-1] == ("cover_command", {"key": 3, "stop": True, "device_id": 0})


async def test_a_cover_still_moving_is_pending(adapter, blind):
    blind.echo = False
    blind.states[(0, 3)] = dataclasses.replace(COVER_HALF, current_operation=CoverOperation.IS_OPENING)
    outcome = await adapter.execute_command(stored(), "cover_open", {})
    assert outcome.result.status == "pending" and cap(outcome.state, "cover:3").state == "opening"


async def test_a_simple_cover_refuses_stop_and_position(adapter, network):
    network.device = FakeDevice(entities=[CoverInfo(key=3)], states=[CoverState(key=3)])
    for command, params in [("cover_stop", {}), ("set_position", {"position": 5})]:
        with pytest.raises(UnsupportedCommand):
            await adapter.execute_command(stored(), command, params)


@pytest.mark.parametrize(("percentage", "level"), [(1, 1), (25, 1), (26, 2), (50, 2), (100, 4)])
async def test_fan_speed_maps_to_the_fans_own_levels(adapter, network, percentage, level):
    network.device = FakeDevice(entities=[FAN], states=[FAN_ON])
    await adapter.execute_command(stored(), "set_fan_speed", {"key": "fan:4", "percentage": percentage})
    assert network.device.calls[-1] == ("fan_command", {"key": 4, "state": True, "speed_level": level, "device_id": 0})


async def test_fan_speed_zero_turns_it_off_and_presets_apply(adapter, network):
    network.device = FakeDevice(entities=[FAN], states=[FAN_ON])
    await adapter.execute_command(stored(), "set_fan_speed", {"percentage": 0})
    assert network.device.calls[-1] == ("fan_command", {"key": 4, "state": False, "device_id": 0})
    outcome = await adapter.execute_command(stored(), "set_fan_mode", {"key": "fan:4", "fan_mode": "sleep"})
    assert network.device.calls[-1] == ("fan_command", {"key": 4, "preset_mode": "sleep", "device_id": 0}) and outcome.result.status == "confirmed"
    with pytest.raises(AdapterError) as error:
        await adapter.execute_command(stored(), "set_fan_mode", {"key": "fan:4", "fan_mode": "turbo"})
    assert error.value.code == "bad_params"


async def test_a_fan_without_speed_refuses_a_speed(adapter, network):
    network.device = FakeDevice(entities=[FanInfo(key=4)], states=[FanState(key=4)])
    with pytest.raises(UnsupportedCommand):
        await adapter.execute_command(stored(), "set_fan_speed", {"percentage": 50})


@pytest.fixture
def ac(network):
    network.device = FakeDevice(entities=[CLIMATE], states=[CLIMATE_HEAT])
    return network.device


async def test_set_temperature_is_clamped_to_the_device(adapter, ac):
    outcome = await adapter.execute_command(stored(), "set_temperature", {"key": "climate:5", "temperature": 23.5})
    assert ac.calls[-1] == ("climate_command", {"key": 5, "target_temperature": 23.5, "device_id": 0}) and outcome.result.status == "confirmed"
    await adapter.execute_command(stored(), "set_temperature", {"temperature": 99})
    assert ac.calls[-1][1]["target_temperature"] == 30


async def test_a_two_point_device_moves_its_band(adapter, network):
    network.device = FakeDevice(entities=[TWO_POINT], states=[TWO_POINT_STATE])
    outcome = await adapter.execute_command(stored(), "set_temperature", {"temperature": 26})
    assert network.device.calls[-1] == ("climate_command", {"key": 6, "target_temperature_low": 24.0, "target_temperature_high": 28.0, "device_id": 0})
    assert outcome.result.status == "confirmed" and cap(outcome.state, "climate:6").target == 26


async def test_a_two_point_device_needs_its_band_first(adapter, network):
    network.device = FakeDevice(entities=[TWO_POINT], states=[])
    with pytest.raises(UnsupportedCommand):
        await adapter.execute_command(stored(), "set_temperature", {"temperature": 26})


async def test_hvac_mode(adapter, ac):
    outcome = await adapter.execute_command(stored(), "set_hvac_mode", {"mode": "cool"})
    assert ac.calls[-1] == ("climate_command", {"key": 5, "mode": ClimateMode.COOL, "device_id": 0}) and outcome.result.status == "confirmed"
    with pytest.raises(AdapterError) as error:
        await adapter.execute_command(stored(), "set_hvac_mode", {"mode": "dry"})
    assert error.value.code == "bad_params"


async def test_climate_fan_modes_standard_and_custom(adapter, ac):
    await adapter.execute_command(stored(), "set_fan_mode", {"fan_mode": "low"})
    assert ac.calls[-1] == ("climate_command", {"key": 5, "fan_mode": ClimateFanMode.LOW, "device_id": 0})
    outcome = await adapter.execute_command(stored(), "set_fan_mode", {"fan_mode": "Turbo"})
    assert ac.calls[-1] == ("climate_command", {"key": 5, "custom_fan_mode": "Turbo", "device_id": 0}) and outcome.result.status == "confirmed"
    with pytest.raises(AdapterError) as error:
        await adapter.execute_command(stored(), "set_fan_mode", {"fan_mode": "gale"})
    assert error.value.code == "bad_params"


async def test_climate_turns_back_on_in_its_last_mode(adapter, ac):
    await adapter.execute_command(stored(), "set_hvac_mode", {"mode": "cool"})
    await adapter.execute_command(stored(), "turn_off", {"key": "climate:5"})
    assert ac.calls[-1][1]["mode"] == ClimateMode.OFF
    outcome = await adapter.execute_command(stored(), "turn_on", {"key": "climate:5"})
    assert ac.calls[-1][1]["mode"] == ClimateMode.COOL and outcome.result.status == "confirmed"


async def test_climate_with_no_history_uses_its_first_active_mode(adapter, network):
    network.device = FakeDevice(entities=[CLIMATE], states=[ClimateState(key=5, mode=ClimateMode.OFF)])
    await adapter.execute_command(stored(), "turn_on", {})
    assert network.device.calls[-1][1]["mode"] == ClimateMode.COOL


# ---- the connection and push updates ---------------------------------------------------------------------


async def test_one_connection_serves_every_call(adapter, network):
    device = stored()
    await adapter.get_state(device)
    await adapter.get_state(device)
    await adapter.execute_command(device, "turn_on", {})
    assert len(network.device.clients) == 1


async def test_a_change_on_the_device_is_pushed_once_for_a_burst(adapter, relays):
    device = stored()
    pushed = []

    async def on_state(state):
        pushed.append(state)

    await adapter.subscribe_to_events(device, on_state)
    relays.emit(SwitchState(key=11, state=True))
    relays.emit(SwitchState(key=12, state=True))
    await asyncio.sleep(0.05)
    assert len(pushed) == 1
    assert cap(pushed[0], "power:11").value == "on" and cap(pushed[0], "power:12").value == "on" and pushed[0].online is True


async def test_an_unchanged_state_is_not_pushed(adapter, relays):
    device = stored()
    pushed = []

    async def on_state(state):
        pushed.append(state)

    await adapter.subscribe_to_events(device, on_state)
    relays.emit(SwitchState(key=11, state=False))
    await asyncio.sleep(0.03)
    assert pushed == []


async def test_states_of_hidden_entities_are_dropped(adapter, network):
    reset = SwitchInfo(key=9, name="Factory reset", entity_category=EntityCategory.CONFIG)
    network.device = FakeDevice(entities=[SwitchInfo(key=1), reset])
    device = stored()
    pushed = []

    async def on_state(state):
        pushed.append(state)

    await adapter.subscribe_to_events(device, on_state)
    network.device.emit(SwitchState(key=9, state=True))
    await asyncio.sleep(0.03)
    assert pushed == []


async def test_unsubscribing_stops_pushes_but_keeps_the_connection(adapter, relays):
    device = stored()
    pushed = []

    async def on_state(state):
        pushed.append(state)

    unsubscribe = await adapter.subscribe_to_events(device, on_state)
    await unsubscribe()
    relays.emit(SwitchState(key=11, state=True))
    await asyncio.sleep(0.03)
    assert pushed == [] and len(relays.live) == 1
    assert cap(await adapter.get_state(device), "power:11").value == "on"


async def test_a_dropped_connection_goes_offline_and_get_state_reconnects(adapter, relays):
    device = stored()
    pushed = []

    async def on_state(state):
        pushed.append(state)

    await adapter.subscribe_to_events(device, on_state)
    await relays.drop()
    offline = pushed[-1]
    assert offline.online is False and [c.confirmed for c in offline.capabilities] == [False, False]
    assert cap(offline, "power:11").value == "off", "the last known values stay"

    state = await adapter.get_state(device)
    assert state.online is True and len(relays.clients) == 2

    relays.emit(SwitchState(key=11, state=True))
    await asyncio.sleep(0.03)
    assert cap(pushed[-1], "power:11").value == "on", "the subscription survives the reconnect"


async def test_an_old_clients_late_events_are_ignored(adapter, relays):
    device = stored()
    await adapter.get_state(device)
    old = relays.clients[0]
    old_state = old.on_state
    await relays.drop()
    await adapter.get_state(device)
    old_state(SwitchState(key=11, state=True))
    await old.stop(False)
    assert cap(await adapter.get_state(device), "power:11").value == "off"
    assert len(relays.clients) == 2


async def test_a_failing_subscriber_does_not_break_the_connection(adapter, relays, caplog):
    device = stored()

    async def on_state(state):
        raise RuntimeError("database locked")

    await adapter.subscribe_to_events(device, on_state)
    relays.emit(SwitchState(key=11, state=True))
    await asyncio.sleep(0.03)
    assert "state update failed" in caplog.text and len(relays.live) == 1


async def test_get_state_raises_when_the_device_is_gone(adapter, network):
    network.device.reachable = set()
    with pytest.raises(DeviceUnreachable):
        await adapter.get_state(stored())


async def test_a_stored_key_is_never_given_up(adapter, network):
    """A device that stops encrypting could be anything: nothing is sent to it in the clear."""
    with pytest.raises(DeviceUnreachable) as error:
        await adapter.get_state(stored(KEY))
    assert error.value.code == "encryption_mismatch"
    assert [client.noise_psk for client in network.device.clients] == [KEY]


async def test_a_device_that_gained_encryption_asks_for_its_key(adapter, network):
    network.device = FakeDevice(key=KEY)
    with pytest.raises(LocalKeyRequired):
        await adapter.get_state(stored())


async def test_a_rotated_key_is_reported_for_a_stored_device(adapter, network):
    network.device = FakeDevice(key=OTHER_KEY)
    with pytest.raises(LocalKeyRequired) as error:
        await adapter.get_state(stored(KEY))
    assert error.value.code == "local_key_invalid"


async def test_pairing_again_with_a_new_key_replaces_the_connection(adapter, network):
    network.device = FakeDevice(key=KEY)
    device = stored(KEY)
    pushed = []

    async def on_state(state):
        pushed.append(state)

    await adapter.subscribe_to_events(device, on_state)
    old = network.device.clients[0]
    network.device.key = OTHER_KEY
    device.credentials = {"local_key": OTHER_KEY}
    await adapter.get_state(device)
    assert old.connected is False and network.device.clients[-1].noise_psk == OTHER_KEY
    network.device.emit(SwitchState(key=1, state=True))
    await asyncio.sleep(0.03)
    assert pushed, "the manager keeps its subscription across a new pairing, so it must keep working"


async def test_a_different_device_at_the_address_is_refused(adapter, network):
    network.device = FakeDevice(mac="AA:BB:CC:DD:EE:99")
    with pytest.raises(DeviceUnreachable) as error:
        await adapter.get_state(stored())
    assert "different device" in error.value.message
    assert network.device.live == [], "nothing stays connected to the wrong device"


async def test_a_device_that_moved_is_found_by_its_mdns_name(adapter, ctx, network):
    ctx.mdns = FakeMdns([record(ip="192.168.1.77")])
    network.device.reachable = {"192.168.1.77"}
    device = stored()
    state = await adapter.get_state(device)
    assert state.host == "192.168.1.77" and network.device.clients[-1].address == "192.168.1.77"
    device.host = state.host  # what DeviceManager does with it
    await adapter.get_state(device)
    assert len(network.device.live) == 1 and len(network.device.clients) == 2


async def test_moving_to_another_devices_address_is_refused(adapter, ctx, network):
    ctx.mdns = FakeMdns([record(ip="192.168.1.77")])
    network.device.reachable = {"192.168.1.77"}
    network.device.mac = "AA:BB:CC:DD:EE:99"
    with pytest.raises(DeviceUnreachable):
        await adapter.get_state(stored())
    assert network.device.live == []


async def test_an_unreachable_device_with_no_new_address_stays_unreachable(adapter, ctx, network):
    ctx.mdns = FakeMdns([])
    network.device.reachable = set()
    with pytest.raises(DeviceUnreachable):
        await adapter.get_state(stored())
    assert len(network.device.clients) == 1


async def test_an_address_changed_in_the_registry_is_used(adapter, network):
    network.device.reachable = {HOST, "192.168.1.60"}
    device = stored()
    await adapter.get_state(device)
    await network.device.drop()
    device.host = "192.168.1.60"
    await adapter.get_state(device)
    assert network.device.clients[-1].address == "192.168.1.60"


async def test_disconnect_releases_the_connection(adapter, relays):
    device = stored()
    await adapter.get_state(device)
    await adapter.disconnect(device)
    assert relays.live == [] and adapter._sessions == {}
    await adapter.disconnect(device)


async def test_a_disconnect_that_hangs_still_lets_go(adapter, relays, monkeypatch):
    monkeypatch.setattr(esphome, "DISCONNECT_TIMEOUT", 0.01)
    device = stored()
    await adapter.get_state(device)

    async def hangs(force=False):
        await asyncio.sleep(30)

    relays.clients[0].disconnect = hangs
    await adapter.disconnect(device)
    assert relays.live == []


async def test_stop_releases_everything(adapter, relays):
    await adapter.get_state(stored(id="a"))
    await adapter.get_state(stored(id="b"))
    await adapter.stop()
    assert relays.live == [] and adapter._sessions == {}


# ---- loading ---------------------------------------------------------------------------------------------


def test_a_missing_library_disables_only_this_adapter(ctx, monkeypatch):
    real_import = builtins.__import__

    def refuse(name, *args, **kwargs):
        if name == "aioesphomeapi":
            raise ImportError("aioesphomeapi is not installed")
        return real_import(name, *args, **kwargs)

    monkeypatch.delitem(sys.modules, "cube_gateway.adapters.esphome")
    monkeypatch.setattr(builtins, "__import__", refuse)
    registry = AdapterRegistry(ctx, modules=[("cube_gateway.adapters.esphome", "EsphomeAdapter"), ("cube_gateway.adapters.generic", "GenericAdapter")])
    assert "generic" in registry.adapters and "esphome" not in registry.adapters
    assert "aioesphomeapi" in registry.failed["esphome"].load_error
