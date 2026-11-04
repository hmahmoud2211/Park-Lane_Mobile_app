"""Shelly, WLED, SONOFF LAN, LG via ReThink and the generic adapter, against protocol mocks (no network)."""

from __future__ import annotations

import ipaddress
import json
from typing import Any

import httpx
import pytest

from cube_gateway.adapters.base import (
    AdapterContext,
    AuthRequired,
    LocalKeyRequired,
    MdnsRecord,
    NotSupported,
    ScanContext,
    SsdpRecord,
    StoredDevice,
    UnsupportedCommand,
)
from cube_gateway.adapters.generic import GenericAdapter
from cube_gateway.adapters.lg_rethink import LgRethinkAdapter
from cube_gateway.adapters.shelly import ShellyAdapter
from cube_gateway.adapters.sonoff import SonoffLanAdapter, decode_txt, decrypt, encrypt
from cube_gateway.adapters.wled import WledAdapter
from cube_gateway.models import AuthKind, Category


async def _approve(message: str) -> None: ...


def _scan(found: list) -> ScanContext:
    scan = ScanContext(timeout=3, subnets=[ipaddress.ip_network("192.168.50.0/24")], report=found.append)
    scan.passive_done.set()
    return scan


def _ctx(settings, handler) -> AdapterContext:
    return AdapterContext(settings, httpx.AsyncClient(transport=httpx.MockTransport(handler)))


# ---- Shelly ----------------------------------------------------------------------------------------


class FakeShellyGen2:
    def __init__(self, auth: bool = False, password: str = "pw"):
        self.auth = auth
        self.password = password
        self.output = False

    def __call__(self, request: httpx.Request) -> httpx.Response:
        if request.url.path == "/shelly":
            return httpx.Response(200, json={"id": "shellyplus1pm-a8032ab1c2d3", "mac": "A8032AB1C2D3", "model": "SNSW-001P16EU", "gen": 2, "app": "Plus1PM", "fw_id": "1.4.4", "auth_en": self.auth})
        if self.auth and "authorization" not in request.headers:
            return httpx.Response(401, headers={"WWW-Authenticate": 'Digest qop="auth", realm="shellyplus1pm-a8032ab1c2d3", nonce="60dc59c6", algorithm=SHA-256'})
        body = json.loads(request.content)
        if body["method"] == "Shelly.GetStatus":
            return httpx.Response(200, json={"id": body["id"], "result": {"switch:0": {"id": 0, "output": self.output, "apower": 12.5, "aenergy": {"total": 1234.56}, "temperature": {"tC": 41.2}}, "sys": {}}})
        if body["method"] == "Switch.Set":
            self.output = body["params"]["on"]
            return httpx.Response(200, json={"id": body["id"], "result": {"was_on": not self.output}})
        if body["method"] == "Switch.Toggle":
            self.output = not self.output
            return httpx.Response(200, json={"id": body["id"], "result": {"was_on": not self.output}})
        return httpx.Response(200, json={"id": body["id"], "error": {"code": 404, "message": "No handler"}})


async def test_shelly_gen2_discover_pair_control(settings):
    device = FakeShellyGen2()
    adapter = ShellyAdapter(_ctx(settings, device))
    found: list = []
    scan = _scan(found)
    scan.mdns = [MdnsRecord("_shelly._tcp.local.", "shellyplus1pm-a8032ab1c2d3", "192.168.50.31", 80, {"gen": "2"})]
    await adapter.discover(scan)
    assert len(found) == 1
    candidate = found[0]
    assert candidate.unique_id == "a8032ab1c2d3" and candidate.mac == "a8:03:2a:b1:c2:d3" and candidate.details["gen"] == 2
    assert candidate.pairing.auth == AuthKind.NONE
    result = await adapter.pair(candidate, {}, _approve)
    assert result.category == Category.SWITCH and result.params["gen"] == 2
    stored = StoredDevice(id="d1", adapter_id="shelly", brand="shelly", unique_id=result.unique_id, name="x", category=result.category, host=result.host, params=result.params)
    state = await adapter.get_state(stored)
    assert state.capabilities[0].key == "power:0" and state.capabilities[0].value == "off"
    assert {r.key for r in state.readings} == {"power_w:0", "energy_wh:0", "device_temperature"}
    outcome = await adapter.execute_command(stored, "turn_on", {})
    assert outcome.result.status == "confirmed" and outcome.state.capabilities[0].value == "on"
    await adapter.execute_command(stored, "toggle", {"key": "power:0"})
    assert device.output is False
    with pytest.raises(UnsupportedCommand):
        await adapter.execute_command(stored, "set_brightness", {"brightness": 50})


async def test_shelly_gen2_password(settings):
    adapter = ShellyAdapter(_ctx(settings, FakeShellyGen2(auth=True)))
    candidate = await adapter.probe("192.168.50.31")
    assert candidate.details["auth"] is True and candidate.pairing.auth == AuthKind.DEVICE_CREDENTIALS
    assert [f.name for f in candidate.pairing.fields] == ["password"]
    with pytest.raises(AuthRequired):
        await adapter.pair(candidate, {}, _approve)


async def test_shelly_gen1_dimmer(settings):
    state = {"ison": False, "brightness": 40}

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/shelly":
            return httpx.Response(200, json={"type": "SHDM-2", "mac": "C45BBE001122", "auth": False, "fw": "20230913"})
        if request.url.path == "/status":
            return httpx.Response(200, json={"lights": [state], "meters": [{"power": 7.1}]})
        if request.url.path == "/light/0":
            params = dict(request.url.params)
            state["ison"] = params["turn"] == "on"
            if "brightness" in params:
                state["brightness"] = int(params["brightness"])
            return httpx.Response(200, json=state)
        return httpx.Response(404)

    adapter = ShellyAdapter(_ctx(settings, handler))
    candidate = await adapter.probe("192.168.50.32")
    assert candidate.protocol == "shelly-gen1-http" and candidate.model == "SHDM-2"
    result = await adapter.pair(candidate, {}, _approve)
    assert result.category == Category.LIGHT
    stored = StoredDevice(id="d", adapter_id="shelly", brand="shelly", unique_id=result.unique_id, name="x", category=result.category, host="192.168.50.32", params=result.params)
    outcome = await adapter.execute_command(stored, "set_brightness", {"brightness": 75})
    caps = {c.key: c for c in outcome.state.capabilities}
    assert caps["light:0"].value == "on" and caps["brightness:0"].value == 75


async def test_shelly_ignores_non_shelly_http_services(settings):
    adapter = ShellyAdapter(_ctx(settings, lambda r: httpx.Response(200, json={"hello": "world"})))
    found: list = []
    scan = _scan(found)
    scan.mdns = [MdnsRecord("_http._tcp.local.", "printer", "192.168.50.9", 80, {})]
    await adapter.discover(scan)
    assert found == []


# ---- WLED ------------------------------------------------------------------------------------------


async def test_wled(settings):
    state: dict[str, Any] = {"on": False, "bri": 128, "seg": [{"col": [[255, 0, 0]]}]}

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/json/info":
            return httpx.Response(200, json={"ver": "0.15.0", "name": "Shelf", "mac": "aabbccddeeff", "arch": "esp32", "leds": {"count": 60}})
        if request.url.path == "/json/state":
            if request.method == "POST":
                body = json.loads(request.content)
                assert body.pop("v") is True
                if body.get("on") == "t":
                    body["on"] = not state["on"]
                state.update(body)
            return httpx.Response(200, json=state)
        return httpx.Response(404)

    adapter = WledAdapter(_ctx(settings, handler))
    found: list = []
    scan = _scan(found)
    scan.mdns = [MdnsRecord("_wled._tcp.local.", "wled-shelf", "192.168.50.50", 80, {})]
    await adapter.discover(scan)
    candidate = found[0]
    assert candidate.name == "Shelf" and candidate.unique_id == "aabbccddeeff"
    result = await adapter.pair(candidate, {}, _approve)
    stored = StoredDevice(id="w", adapter_id="wled", brand="wled", unique_id=result.unique_id, name="Shelf", category=Category.LIGHT, host="192.168.50.50", port=80)
    initial = await adapter.get_state(stored)
    assert {c.type for c in initial.capabilities} == {"power", "brightness", "color"}
    assert next(c for c in initial.capabilities if c.type == "brightness").value == 50
    outcome = await adapter.execute_command(stored, "set_brightness", {"brightness": 100})
    assert state["bri"] == 255 and outcome.state.capabilities[0].value == "on"
    await adapter.execute_command(stored, "set_color", {"h": 120, "s": 100})
    assert state["seg"][0]["col"][0] == [0, 255, 0]


# ---- SONOFF ----------------------------------------------------------------------------------------


KEY = "a1b2c3d4-e5f6-7890-abcd-ef1234567890"


def test_sonoff_cipher_roundtrip_and_wrong_key():
    data, iv = encrypt({"switch": "on"}, KEY)
    assert decrypt(data, iv, KEY) == {"switch": "on"}
    props = {"encrypt": "true", "iv": iv, "data1": data}
    assert decode_txt(props, KEY) == ({"switch": "on"}, True)
    assert decode_txt(props, "00000000-0000-0000-0000-000000000000")[1] is False
    assert decode_txt(props, None) == (None, None)
    plain = {"data1": json.dumps({"switch": "off", "startup": "stay"})}
    assert decode_txt(plain, None) == ({"switch": "off", "startup": "stay"}, None)


async def test_sonoff_diy(settings):
    state = {"switch": "off"}
    seen: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        seen.append(body)
        if request.url.path == "/zeroconf/info":
            return httpx.Response(200, json={"seq": 1, "error": 0, "data": {**state, "deviceid": "1000abcdef", "fwVersion": "3.6.0", "signalStrength": -61}})
        if request.url.path == "/zeroconf/switch":
            state["switch"] = body["data"]["switch"]
            return httpx.Response(200, json={"seq": 2, "error": 0})
        return httpx.Response(200, json={"error": 404})

    adapter = SonoffLanAdapter(_ctx(settings, handler))
    found: list = []
    scan = _scan(found)
    scan.mdns = [MdnsRecord("_ewelink._tcp.local.", "eWeLink_1000abcdef", "192.168.50.40", 8081, {"txtvers": "1", "id": "1000abcdef", "type": "diy_plug", "apivers": "1", "seq": "1", "data1": '{"switch":"off"}'})]
    await adapter.discover(scan)
    candidate = found[0]
    assert candidate.protocol == "sonoff-diy-v2" and candidate.control == "supported" and candidate.pairing.auth == AuthKind.NONE
    result = await adapter.pair(candidate, {}, _approve)
    assert result.category == Category.PLUG and result.credentials == {}
    stored = StoredDevice(id="s", adapter_id="sonoff_lan", brand="sonoff", unique_id="1000abcdef", name="x", category=Category.PLUG, host="192.168.50.40", port=8081, params=result.params)
    outcome = await adapter.execute_command(stored, "turn_on", {})
    assert outcome.result.status == "confirmed" and state["switch"] == "on"
    assert seen[-2]["data"] == {"switch": "on"} and seen[-2]["deviceid"] == "1000abcdef"
    assert any(r.key == "rssi" for r in outcome.state.readings)


async def test_sonoff_encrypted_needs_a_working_key(settings):
    data, iv = encrypt({"switch": "on"}, KEY)
    record = MdnsRecord("_ewelink._tcp.local.", "eWeLink_1000aaaaaa", "192.168.50.41", 8081, {"id": "1000aaaaaa", "type": "plug", "encrypt": "true", "iv": iv, "data1": data})
    sent: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        sent.append(json.loads(request.content))
        return httpx.Response(200, json={"error": 0})

    ctx = _ctx(settings, handler)

    class Mdns:
        async def resolve(self, service_type, instance):
            return record

    ctx.mdns = Mdns()
    adapter = SonoffLanAdapter(ctx)
    found: list = []
    scan = _scan(found)
    scan.mdns = [record]
    await adapter.discover(scan)
    candidate = found[0]
    assert candidate.control == "experimental" and candidate.status == "local_key_required"
    assert candidate.pairing.auth == AuthKind.LOCAL_KEY and candidate.pairing.fields[0].secret
    with pytest.raises(LocalKeyRequired):
        await adapter.pair(candidate, {}, _approve)
    with pytest.raises(LocalKeyRequired) as wrong:
        await adapter.pair(candidate, {"device_key": "00000000-0000-0000-0000-000000000000"}, _approve)
    assert wrong.value.code == "local_key_invalid"
    result = await adapter.pair(candidate, {"device_key": KEY}, _approve)
    assert result.credentials == {"device_key": KEY}
    stored = StoredDevice(id="s", adapter_id="sonoff_lan", brand="sonoff", unique_id="1000aaaaaa", name="x", category=Category.PLUG, host="192.168.50.41", port=8081, params=result.params, credentials=result.credentials)
    outcome = await adapter.execute_command(stored, "turn_off", {})
    assert sent[-1]["encrypt"] is True and "switch" not in json.dumps(sent[-1])
    assert decrypt(sent[-1]["data"], sent[-1]["iv"], KEY) == {"switch": "off"}
    # The announcement still says "on": the result is pending, shown as unconfirmed.
    assert outcome.result.status == "pending" and outcome.state.capabilities[0].confirmed is False


# ---- LG via ReThink --------------------------------------------------------------------------------


class FakeMqtt:
    def __init__(self, adapter: LgRethinkAdapter, echo: bool = True):
        self.adapter = adapter
        self.echo = echo
        self.published: list[tuple[str, str]] = []

    async def publish(self, topic: str, payload: str) -> None:
        self.published.append((topic, payload))
        if self.echo and topic.endswith("/set"):
            self.adapter.handle_message(topic[: -len("/set")], payload.encode())


DEVICE = "7bd22121-1a4f-11e0-a28c-28876113fdac"


def _rethink(settings, echo: bool = True) -> tuple[LgRethinkAdapter, FakeMqtt]:
    from dataclasses import replace

    adapter = LgRethinkAdapter(AdapterContext(replace(settings, rethink_mqtt_url="mqtt://127.0.0.1:1885")))
    adapter.connected = True
    mqtt = FakeMqtt(adapter, echo)
    adapter._client = mqtt
    base = f"rethink/{DEVICE}"
    for topic, value in {
        "rethink/availability": "online",
        f"{base}/availability": "online",
        f"{base}/climate-mode": "off",
        f"{base}/climate-temperature": "24",
        f"{base}/climate-current_temperature": "25.5",
        f"{base}/climate-fan_mode": "very high",
        f"{base}/filterlife": "720",
    }.items():
        adapter.handle_message(topic, value.encode())
    return adapter, mqtt


async def test_rethink_without_discovery_uses_known_topics(settings):
    adapter, _ = _rethink(settings)
    found: list = []
    await adapter.discover(_scan(found))
    assert len(found) == 1 and found[0].unique_id == DEVICE and found[0].control == "experimental"
    result = await adapter.pair(found[0], {}, _approve)
    assert result.category == Category.CLIMATE
    stored = StoredDevice(id="lg", adapter_id="lg_thinq_rethink", brand="lg", unique_id=DEVICE, name="AC", category=Category.CLIMATE)
    state = await adapter.get_state(stored)
    climate = state.capabilities[0]
    assert (climate.mode, climate.target, climate.current, climate.fan_mode) == ("off", 24.0, 25.5, "very high")
    assert "set_temperature" in state.commands and "turn_on" in state.commands and state.online


async def test_rethink_commands_confirm_from_state_topics(settings):
    adapter, mqtt = _rethink(settings)
    stored = StoredDevice(id="lg", adapter_id="lg_thinq_rethink", brand="lg", unique_id=DEVICE, name="AC", category=Category.CLIMATE)
    outcome = await adapter.execute_command(stored, "set_temperature", {"temperature": 22.3})
    assert mqtt.published[-1] == (f"rethink/{DEVICE}/climate-temperature/set", "22.5")
    assert outcome.result.status == "confirmed"
    await adapter.execute_command(stored, "set_hvac_mode", {"mode": "cool"})
    off = await adapter.execute_command(stored, "turn_off", {})
    assert mqtt.published[-1][1] == "off" and off.result.status == "confirmed"
    await adapter.execute_command(stored, "turn_on", {})
    assert mqtt.published[-1][1] == "cool"  # back to the last mode it ran in
    with pytest.raises(Exception, match="not offered"):
        await adapter.execute_command(stored, "set_fan_mode", {"fan_mode": "turbo"})


async def test_rethink_unconfirmed_command_is_pending(settings, monkeypatch):
    import cube_gateway.adapters.lg_rethink as module

    adapter, _ = _rethink(settings, echo=False)
    stored = StoredDevice(id="lg", adapter_id="lg_thinq_rethink", brand="lg", unique_id=DEVICE, name="AC", category=Category.CLIMATE)

    async def no_wait(awaitable, *args, **kwargs):
        awaitable.close()
        raise TimeoutError

    monkeypatch.setattr(module.asyncio, "wait_for", no_wait)
    outcome = await adapter.execute_command(stored, "set_hvac_mode", {"mode": "dry"})
    assert outcome.result.status == "pending"


async def test_rethink_discovery_config(settings):
    adapter, _ = _rethink(settings)
    config = {
        "device": {"identifiers": DEVICE, "manufacturer": "LG", "model": "RAC_056905_WW", "name": "LG Air Conditioner"},
        "components": {
            "climate": {
                "platform": "climate", "mode_state_topic": f"rethink/{DEVICE}/climate-mode", "mode_command_topic": f"rethink/{DEVICE}/climate-mode/set",
                "temperature_state_topic": f"rethink/{DEVICE}/climate-temperature", "temperature_command_topic": f"rethink/{DEVICE}/climate-temperature/set",
                "current_temperature_topic": f"rethink/{DEVICE}/climate-current_temperature", "min_temp": 16, "max_temp": 30, "temp_step": 0.5,
                "fan_modes": ["auto", "low", "high"], "modes": ["off", "cool", "fan_only"],
            },
            "filterlife": {"platform": "sensor", "state_topic": f"rethink/{DEVICE}/filterlife", "name": "Filter life", "unit_of_measurement": "h"},
        },
    }
    adapter.handle_message(f"homeassistant/device/rethink/{DEVICE}/config", json.dumps(config).encode())
    adapter.handle_message("homeassistant/device/rethink/x/config", b"not json")
    stored = StoredDevice(id="lg", adapter_id="lg_thinq_rethink", brand="lg", unique_id=DEVICE, name="AC", category=Category.CLIMATE)
    state = await adapter.get_state(stored)
    assert state.capabilities[0].modes == ["off", "cool", "fan_only"] and state.capabilities[0].min == 16
    assert state.readings[0].label == "Filter life" and state.readings[0].value == 720.0
    found: list = []
    await adapter.discover(_scan(found))
    assert found[0].model == "RAC_056905_WW"


async def test_rethink_real_sized_config_and_power_on(settings):
    """ReThink's discovery for a RAC_056905_WW is ~11 KB with a power_command_topic (captured from a live unit)."""
    adapter, mqtt = _rethink(settings)
    base = f"rethink/{DEVICE}"
    components = {
        "climate": {
            "platform": "climate", "mode_state_topic": f"{base}/climate-mode", "mode_command_topic": f"{base}/climate-mode/set",
            "power_command_topic": f"{base}/climate-power/set", "temperature_state_topic": f"{base}/climate-temperature",
            "temperature_command_topic": f"{base}/climate-temperature/set", "current_temperature_topic": f"{base}/climate-current_temperature",
            "fan_modes": ["auto", "very low", "low", "medium", "high", "very high"], "min_temp": 18, "max_temp": 30, "temp_step": 0.5,
        },
    }
    for index in range(60):
        components[f"sensor{index}"] = {"platform": "sensor", "state_topic": f"{base}/sensor{index}", "name": None, "description": "x" * 150}
    payload = json.dumps({"device": {"identifiers": DEVICE, "manufacturer": "LG", "model": "RAC_056905_WW", "name": "LG Air Conditioner"}, "components": components})
    assert len(payload) > 11000
    adapter.handle_message(f"homeassistant/device/rethink/{DEVICE}/config", payload.encode())
    assert adapter.configs[DEVICE]["device"]["model"] == "RAC_056905_WW"
    adapter.handle_message(f"{base}/sensor1", b"42")
    stored = StoredDevice(id="lg", adapter_id="lg_thinq_rethink", brand="lg", unique_id=DEVICE, name="AC", category=Category.CLIMATE)
    state = await adapter.get_state(stored)
    assert any(r.key == "sensor1" and r.label == "Sensor1" and r.value == 42.0 for r in state.readings)

    async def device_resumes(topic: str, payload: str) -> None:
        mqtt.published.append((topic, payload))
        adapter.handle_message(f"{base}/climate-mode", b"cool")

    mqtt.publish = device_resumes
    outcome = await adapter.execute_command(stored, "turn_on", {})
    assert mqtt.published[-1] == (f"{base}/climate-power/set", "ON") and outcome.result.status == "confirmed"


def test_rethink_unavailable_without_broker(settings):
    adapter = LgRethinkAdapter(AdapterContext(settings))
    ok, reason = adapter.available()
    assert not ok and "CUBE_RETHINK_MQTT_URL" in reason


# ---- generic ---------------------------------------------------------------------------------------


async def test_generic_reports_unclaimed_devices_only(settings):
    adapter = GenericAdapter(AdapterContext(settings))
    found: list = []
    scan = _scan(found)
    scan.mdns = [
        MdnsRecord("_googlecast._tcp.local.", "Living Room TV", "192.168.50.70", 8009, {"md": "Chromecast"}),
        MdnsRecord("_http._tcp.local.", "shelly1-abc", "192.168.50.31", 80, {}),
    ]
    scan.ssdp = [SsdpRecord("192.168.50.71", "upnp:rootdevice", "uuid:abc::upnp:rootdevice", None, "Linux UPnP/1.0 Router", {})]
    scan.claimed_ips = {"192.168.50.31"}
    await adapter.discover(scan)
    assert {c.ip for c in found} == {"192.168.50.70", "192.168.50.71"}
    assert all(c.control == "detection_only" for c in found)
    with pytest.raises(NotSupported):
        await adapter.pair(found[0], {}, _approve)
