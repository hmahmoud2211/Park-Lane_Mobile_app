"""Meross devices connecting out to the company's broker: the adapter, setup and the relay's control plane.

The simulated device is built from a real mss310r trace (krahabb/meross_lan, emulator_traces) and checks each
request's signature the way the firmware does, so a wrong key or envelope fails here.
"""

from __future__ import annotations

import asyncio
import json
import sqlite3
import time
from dataclasses import replace

import httpx
import pytest

from cube_gateway.adapters import _meross as protocol
from cube_gateway.adapters.base import AdapterContext, AdapterError, ScanContext, StoredDevice, UnsupportedCommand
from cube_gateway.adapters.meross_cloud import MerossCloudAdapter
from cube_gateway.adapters.registry import AdapterRegistry
from cube_gateway.catalog import build_brands
from cube_gateway.cloud.link import CloudError, CloudLink
from cube_gateway.models import Category
from tests.conftest import Harness
from tests.test_server_mode import GW, FakeDynsec, FakeLink

UUID = "0123456789abcdef0123456789abcdef"
MAC = "48:e1:e9:aa:bb:cc"
KEY = "deadbeefdeadbeefdeadbeefdeadbeef"
PLUG_ABILITY = {protocol.NS_ALL: {}, protocol.NS_TOGGLEX: {}, protocol.NS_ELECTRICITY: {}, protocol.NS_BIND: {}}


class FakeMeross:
    """Answers requests on /appliance/<uuid>/subscribe by publishing to the topic in the request's `from`."""

    def __init__(self, link: MerossLink, key: str = KEY, uuid: str = UUID, *, kind: str = "mss310r", channels: int = 1, ability: dict | None = None, togglex: bool = True):
        self.link, self.key, self.uuid, self.kind = link, key, uuid, kind
        self.ability = PLUG_ABILITY if ability is None else ability
        self.togglex = togglex
        self.on = {channel: False for channel in range(channels)}
        self.light = {"capacity": 5, "channel": 0, "rgb": 0xFF0000, "temperature": 50, "luminance": 40}
        self.answered: list[dict] = []
        self.requests: list[dict] = []

    async def connect(self) -> None:
        await self.link.deliver(protocol.response_topic(self.uuid), json.dumps(self._message(protocol.NS_BIND, protocol.SET, {"bind": {"bindTime": 1}})))
        await self.link.deliver(protocol.response_topic(self.uuid), json.dumps(self._message(protocol.NS_CLOCK, protocol.PUSH, {"clock": {"timestamp": 1}})))

    def _message(self, namespace: str, method: str, payload: dict) -> dict:
        return protocol.build(namespace, method, payload, self.key, protocol.response_topic(self.uuid))

    def _all(self) -> dict:
        digest: dict = {}
        if self.togglex:
            digest["togglex"] = [{"channel": c, "onoff": int(on), "lmTime": 1} for c, on in self.on.items()]
        if protocol.NS_LIGHT in self.ability:
            digest["light"] = self.light
        everything = {
            "system": {
                "hardware": {"type": self.kind, "subType": "un", "version": "2.0.0", "uuid": self.uuid, "macAddress": MAC},
                "firmware": {"version": "2.1.4"},
            },
            "digest": digest,
        }
        if not self.togglex:
            everything["control"] = {"toggle": {"onoff": int(self.on[0])}}
        return {"all": everything}

    async def handle(self, topic: str, raw: str) -> None:
        if topic != protocol.request_topic(self.uuid):
            return
        message = json.loads(raw)
        header = message["header"]
        if header["method"] not in {protocol.GET, protocol.SET}:
            self.answered.append(message)
            return
        self.requests.append(message)
        namespace = header["namespace"]
        if header["sign"] != protocol.signature(header["messageId"], self.key, header["timestamp"]):
            reply = {"error": {"code": 5001, "detail": "sign error"}}
            await self._reply(header, protocol.ERROR, reply)
            return
        payload = message["payload"]
        if namespace == protocol.NS_ALL:
            result = self._all()
        elif namespace == protocol.NS_ABILITY:
            result = {"ability": self.ability}
        elif namespace == protocol.NS_ELECTRICITY:
            result = {"electricity": {"channel": 0, "current": 450, "voltage": 2301, "power": 51000}}
        elif namespace == protocol.NS_TOGGLEX:
            self.on[payload["togglex"]["channel"]] = payload["togglex"]["onoff"] == 1
            result = {}
        elif namespace == protocol.NS_TOGGLE:
            self.on[payload["channel"]] = payload["toggle"]["onoff"] == 1
            result = {}
        elif namespace == protocol.NS_LIGHT:
            self.light = {**self.light, **payload["light"]}
            result = {}
        else:
            await self._reply(header, protocol.ERROR, {"error": {"code": 5000}})
            return
        await self._reply(header, protocol.GETACK if header["method"] == protocol.GET else protocol.SETACK, result)

    async def _reply(self, request: dict, method: str, payload: dict) -> None:
        reply = protocol.build(request["namespace"], method, payload, self.key, protocol.response_topic(self.uuid), request["messageId"])
        await self.link.deliver(request["from"], json.dumps(reply))


class MerossLink(FakeLink):
    def __init__(self):
        super().__init__()
        self.meross: list[FakeMeross] = []
        self.registered: list[tuple[str, str, str]] = []
        self.released_appliances: list[str] = []

    async def publish(self, topic: str, payload: str) -> None:
        assert topic.startswith("/appliance/")
        self.published.append((topic, payload))
        for device in self.meross:
            asyncio.get_running_loop().create_task(device.handle(topic, payload))

    async def device_server(self) -> str:
        return "mqtt-cube.example.com:8885"

    async def register_appliance(self, uuid: str, mac: str, password: str) -> None:
        self.registered.append((uuid, mac, password))

    async def release_appliance(self, uuid: str) -> None:
        self.released_appliances.append(uuid)


async def _adapter(settings, **device) -> tuple[MerossCloudAdapter, MerossLink, FakeMeross]:
    ctx = AdapterContext(settings)
    link = MerossLink()
    ctx.cloud = link
    adapter = MerossCloudAdapter(ctx)
    await adapter.start()
    adapter.expect(UUID, KEY)
    fake = FakeMeross(link, **device)
    link.meross.append(fake)
    return adapter, link, fake


async def _approval(_: str) -> None: ...


def _stored(params: dict | None = None, key: str = KEY) -> StoredDevice:
    return StoredDevice(id="d", adapter_id="meross_cloud", brand="meross", unique_id=UUID, name="x", category=Category.PLUG, params={"uuid": UUID, "togglex": True, "electricity": True, **(params or {})}, credentials={"key": key})


# ---- the protocol ------------------------------------------------------------------------------


def test_the_broker_password_matches_the_firmware_formula():
    # Computed outside Python, with Node's md5 of the MAC then the key.
    assert protocol.device_password("00:11:22:33:44:55", "sharedkey", 42) == "42_633c19ff58934b53fcb0df92222b73c8"
    password = protocol.device_password(MAC, KEY, 42)
    assert password.startswith("42_") and len(password) == 35
    # The firmware hashes the MAC as it spells it, so spelling matters.
    assert protocol.device_password(MAC.upper(), KEY, 42) != password


def test_messages_are_signed_and_answer_on_the_devices_topic():
    message = protocol.build(protocol.NS_ALL, protocol.GET, {}, KEY, protocol.response_topic(UUID))
    header = message["header"]
    assert header["sign"] == protocol.signature(header["messageId"], KEY, header["timestamp"]) and header["from"] == f"/appliance/{UUID}/publish"
    assert protocol.uuid_of(f"/appliance/{UUID}/publish") == UUID
    assert protocol.uuid_of(f"/appliance/{UUID}/subscribe") is None and protocol.uuid_of("/appliance/short/publish") is None


def test_white_temperature_round_trips():
    assert protocol.kelvin_to_meross(2700) == 1 and protocol.kelvin_to_meross(6500) == 100
    assert abs(protocol.meross_to_kelvin(protocol.kelvin_to_meross(4000)) - 4000) < 40


# ---- the adapter -------------------------------------------------------------------------------


async def test_answers_what_a_device_expects_on_connecting(settings):
    _, link, fake = await _adapter(settings)
    await fake.connect()
    await asyncio.sleep(0.01)
    answers = {m["header"]["namespace"]: m for m in fake.answered}
    bind = answers[protocol.NS_BIND]["header"]
    assert bind["method"] == protocol.SETACK and bind["sign"] == protocol.signature(bind["messageId"], KEY, bind["timestamp"])
    clock = answers[protocol.NS_CLOCK]
    assert clock["header"]["method"] == protocol.PUSH and abs(clock["payload"]["clock"]["timestamp"] - time.time()) < 5


async def test_consumption_config_is_echoed(settings):
    adapter, link, fake = await _adapter(settings)
    message = protocol.build(protocol.NS_CONSUMPTION_CONFIG, protocol.PUSH, {"config": {"voltageRatio": 188}}, KEY, protocol.response_topic(UUID))
    await link.deliver(protocol.response_topic(UUID), json.dumps(message))
    await asyncio.sleep(0.01)
    assert fake.answered[0]["payload"] == {"config": {"voltageRatio": 188}}


async def test_discover_pair_and_control_a_plug(settings):
    adapter, link, fake = await _adapter(settings)
    await fake.connect()
    found: list = []
    scan = ScanContext(timeout=3, subnets=[], report=found.append)
    await adapter.discover(scan)
    candidate = found[0]
    assert candidate.unique_id == UUID and candidate.model == "mss310r" and candidate.mac == MAC and candidate.ip is None
    result = await adapter.pair(candidate, {"key": KEY}, _approval)
    assert result.credentials == {"key": KEY} and result.params["togglex"] and result.params["electricity"] and result.category == Category.PLUG
    stored = StoredDevice(id="d", adapter_id="meross_cloud", brand="meross", unique_id=result.unique_id, name="x", category=result.category, params=result.params, credentials=result.credentials)

    outcome = await adapter.execute_command(stored, "turn_on", {})
    assert fake.on[0] is True and outcome.result.status == "confirmed"
    assert next(c for c in outcome.state.capabilities if c.type == "power").value == "on"
    assert {r.key: r.value for r in outcome.state.readings} == {"power_w": 51.0, "voltage": 230.1, "current": 0.45}
    await adapter.execute_command(stored, "toggle", {})
    assert fake.on[0] is False


async def test_devices_are_only_listed_once_they_have_connected(settings):
    adapter, _, fake = await _adapter(settings)
    found: list = []
    await adapter.discover(ScanContext(timeout=3, subnets=[], report=found.append))
    assert found == []


async def test_a_wrong_key_is_refused_not_ignored(settings):
    adapter, _, _ = await _adapter(settings)
    with pytest.raises(AdapterError, match="refused"):
        await adapter.get_state(_stored(key="wrong"))


async def test_old_firmware_uses_toggle(settings):
    adapter, _, fake = await _adapter(settings, togglex=False, ability={protocol.NS_TOGGLE: {}})
    stored = _stored({"togglex": False, "electricity": False})
    await adapter.execute_command(stored, "turn_on", {})
    assert fake.on[0] is True
    sent = next(r for r in fake.requests if r["header"]["namespace"] == protocol.NS_TOGGLE)
    assert sent["payload"] == {"channel": 0, "toggle": {"onoff": 1}}


async def test_power_strip_addresses_each_outlet(settings):
    adapter, _, fake = await _adapter(settings, kind="mss425f", channels=3)
    stored = _stored({"electricity": False})
    state = await adapter.get_state(stored)
    assert [(c.key, c.label) for c in state.capabilities] == [("power:0", "All outlets"), ("power:1", "Outlet 1"), ("power:2", "Outlet 2")]
    await adapter.execute_command(stored, "turn_on", {"key": "power:2"})
    assert fake.on == {0: False, 1: False, 2: True}
    with pytest.raises(UnsupportedCommand):
        await adapter.execute_command(stored, "turn_on", {"channel": 9})


async def test_bulb_brightness_colour_and_temperature(settings):
    ability = {protocol.NS_TOGGLEX: {}, protocol.NS_LIGHT: {"capacity": 7}}
    adapter, _, fake = await _adapter(settings, kind="msl120", ability=ability)
    stored = _stored({"electricity": False, "light_capacity": 7})
    state = await adapter.get_state(stored)
    assert {"power", "brightness", "color", "color_temp"} <= {c.type for c in state.capabilities}
    await adapter.execute_command(stored, "set_brightness", {"brightness": 80})
    assert fake.light["luminance"] == 80 and fake.light["capacity"] == protocol.LIGHT_LUMINANCE
    await adapter.execute_command(stored, "set_color", {"h": 240, "s": 100})
    assert fake.light["rgb"] == 0x0000FF
    await adapter.execute_command(stored, "set_color_temp", {"kelvin": 6500})
    assert fake.light["temperature"] == 100


async def test_a_plug_has_no_brightness(settings):
    adapter, _, _ = await _adapter(settings)
    with pytest.raises(UnsupportedCommand):
        await adapter.execute_command(_stored(), "set_brightness", {"brightness": 10})


async def test_pushes_read_the_state_again(settings):
    adapter, link, fake = await _adapter(settings)
    states: list = []

    async def on_state(state) -> None:
        states.append(state)

    unsubscribe = await adapter.subscribe_to_events(_stored(), on_state)
    fake.on[0] = True
    await link.deliver(protocol.response_topic(UUID), json.dumps(fake._message(protocol.NS_TOGGLEX, protocol.PUSH, {"togglex": [{"channel": 0, "onoff": 1}]})))
    await asyncio.sleep(0.45)
    assert states and states[-1].capabilities[0].value == "on"
    await unsubscribe()
    assert UUID not in adapter._listeners


async def test_silence_means_unreachable(settings, monkeypatch):
    monkeypatch.setattr("cube_gateway.adapters.meross_cloud.RPC_TIMEOUT", 0.05)
    adapter, link, _ = await _adapter(settings)
    link.meross.clear()
    with pytest.raises(AdapterError, match="did not answer"):
        await adapter.get_state(_stored())
    assert adapter._pending == {}


def test_the_gateway_only_publishes_to_its_own_devices(settings):
    class Db:
        async def get_meta(self, _):
            return None

    class Sec:
        gateway_id = GW

    class Gw:
        db = Db()
        security = Sec()

    class Client:
        published: list = []

        async def publish(self, topic, payload):
            self.published.append(topic)

    link = CloudLink(Gw())
    link.connected, link._client = True, Client()
    link._appliances = {UUID}

    async def run() -> None:
        await link.publish(protocol.request_topic(UUID), "{}")
        with pytest.raises(CloudError):
            await link.publish(protocol.request_topic("f" * 32), "{}")

    asyncio.run(run())


# ---- setup -------------------------------------------------------------------------------------


@pytest.fixture
def hosted(settings):
    return replace(settings, server_hosted=True, allow_remote_claim=True, rethink_only_provisioned=True, rethink_mqtt_url="mqtt://127.0.0.1:9")


def _harness(hosted) -> tuple[Harness, MerossLink]:
    h = Harness(hosted)
    link = MerossLink()
    h.ctx.cloud = link
    h.gateway.cloud = link  # type: ignore[assignment]
    h.gateway.provisioning.cloud = link
    h.registry = AdapterRegistry(h.ctx, modules=[("cube_gateway.adapters.meross_cloud", "MerossCloudAdapter")])
    for owner in (h.gateway, h.gateway.devices, h.gateway.discovery, h.gateway.pairings, h.gateway.provisioning):
        owner.registry = h.registry
    return h, link


def test_setup_from_pairing_mode_to_control(hosted):
    h, link = _harness(hosted)
    with h:
        h.claim()
        session = h.post("/provisioning/sessions", json={"plugin_id": "meross_cloud_softap"}).json()["data"]
        assert session["transport"] == "phone" and session["hotspot"]["device_ip"] == "10.10.10.1" and session["experimental"]
        setup = session["setup"]
        key, user_id = setup["meross_key"], setup["meross_user_id"]
        assert setup["mqtt_server"] == "mqtt-cube.example.com:8885" and len(key) == 32
        with sqlite3.connect(hosted.db_path) as conn:
            assert key not in "\n".join(conn.iterdump())

        def event(name, **data):
            response = h.post(f"/provisioning/sessions/{session['id']}/events", json={"event": name, "data": data})
            assert response.status_code == 200, response.text

        event("device_ap_joined", ssid="Meross_SW_A1B2")
        event("device_info", uuid=UUID, mac=MAC, model="mss310r")
        # The login exists as soon as the MAC is known, with the password the firmware will derive.
        assert link.registered == [(UUID, MAC, protocol.device_password(MAC, key, user_id))]
        event("wifi_config_sent")
        event("phone_returned")
        fake = FakeMeross(link, key=key)
        link.meross.append(fake)
        h.client.portal.call(fake.connect)
        done = h.wait(lambda: (s := h.get(f"/provisioning/sessions/{session['id']}").json()["data"])["state"] in {"connected", "pairing_failed"} and s, timeout=20)
        assert done["state"] == "connected", done
        device = h.get(f"/devices/{done['device_id']}").json()["data"]
        assert device["adapter_id"] == "meross_cloud" and device["experimental"] and device["model"] == "mss310r"
        with sqlite3.connect(hosted.db_path) as conn:
            assert key not in "\n".join(conn.iterdump())  # sealed, with the device's other credentials
        reply = h.post(f"/devices/{device['id']}/commands", json={"command": "turn_on", "params": {}}).json()["data"]
        assert reply["result"]["status"] == "confirmed" and fake.on[0] is True


def test_events_never_carry_the_setup_secrets(hosted):
    h, _ = _harness(hosted)
    with h:
        h.claim()
        sub = h.gateway.bus.subscribe("watcher")
        session = h.post("/provisioning/sessions", json={"plugin_id": "meross_cloud_softap"}).json()["data"]
        assert session["setup"]["meross_key"]  # the owner's own answer has it
        event = sub.queue.get_nowait()
        assert event.type == "provisioning.updated" and "meross_key" not in event.data["session"]["setup"]
        assert event.data["session"]["setup"]["mqtt_server"]


def test_removing_a_device_removes_its_broker_login(hosted):
    h, link = _harness(hosted)
    with h:
        h.claim()
        session = h.post("/provisioning/sessions", json={"plugin_id": "meross_cloud_softap"}).json()["data"]
        path = f"/provisioning/sessions/{session['id']}/events"
        h.post(path, json={"event": "device_info", "data": {"uuid": UUID, "mac": MAC}})
        h.post(path, json={"event": "wifi_config_sent"})
        h.post(path, json={"event": "phone_returned"})
        fake = FakeMeross(link, key=session["setup"]["meross_key"])
        link.meross.append(fake)
        h.client.portal.call(fake.connect)
        done = h.wait(lambda: (s := h.get(f"/provisioning/sessions/{session['id']}").json()["data"])["state"] in {"connected", "pairing_failed"} and s, timeout=20)
        assert done["state"] == "connected", done
        assert h.delete(f"/devices/{done['device_id']}").status_code == 200
        h.wait(lambda: link.released_appliances == [UUID])
        assert UUID not in h.registry.adapters["meross_cloud"].keys


def test_a_foreign_setup_network_is_refused(hosted):
    h, _ = _harness(hosted)
    with h:
        h.claim()
        session = h.post("/provisioning/sessions", json={"plugin_id": "meross_cloud_softap"}).json()["data"]
        h.post(f"/provisioning/sessions/{session['id']}/events", json={"event": "device_ap_joined", "data": {"ssid": "TP-LINK_1234"}})
        assert h.get(f"/provisioning/sessions/{session['id']}").json()["data"]["state"] == "pairing_failed"


@pytest.mark.parametrize("info", [{"uuid": "nope", "mac": MAC}, {"uuid": UUID, "mac": "nope"}, {}])
def test_bad_device_info_ends_the_setup(hosted, info):
    h, link = _harness(hosted)
    with h:
        h.claim()
        session = h.post("/provisioning/sessions", json={"plugin_id": "meross_cloud_softap"}).json()["data"]
        h.post(f"/provisioning/sessions/{session['id']}/events", json={"event": "device_info", "data": info})
        assert h.get(f"/provisioning/sessions/{session['id']}").json()["data"]["state"] == "pairing_failed"
        assert link.registered == []


def test_a_failed_setup_removes_the_login(hosted):
    h, link = _harness(hosted)
    with h:
        h.claim()
        session = h.post("/provisioning/sessions", json={"plugin_id": "meross_cloud_softap"}).json()["data"]
        path = f"/provisioning/sessions/{session['id']}/events"
        h.post(path, json={"event": "device_info", "data": {"uuid": UUID, "mac": MAC}})
        h.post(path, json={"event": "failed", "data": {"code": "wifi_rejected"}})
        h.wait(lambda: link.released_appliances == [UUID])


def test_catalog_offers_meross_only_where_it_can_work(settings, hosted):
    h, _ = _harness(hosted)
    brand = {b.id: b for b in build_brands(h.registry, hosted)}["meross"]
    assert {m.id for m in brand.methods} == {"find:meross_cloud", "setup:meross_cloud_softap"}
    assert all(m.available for m in brand.methods) and brand.status == "experimental" and brand.account_free and not brand.needs_home_gateway
    with Harness(settings, real=True) as home:
        local = {b.id: b for b in build_brands(home.gateway.registry, settings)}["meross"]
    assert [m.id for m in local.methods] == ["setup:none"] and local.methods[0].available is False and "CUBE's server" in local.methods[0].unavailable_reason


# ---- the relay ---------------------------------------------------------------------------------


def test_broker_logins_for_fixed_topics_stay_on_those_topics():
    fake = FakeDynsec()
    asyncio.run(fake.appliance_login(GW, UUID, MAC, "1_" + "a" * 32))
    role = next(c for c in fake.commands if c["command"] == "createRole")
    assert all(a["topic"] == f"/appliance/{UUID}/#" for a in role["acls"]) and role["rolename"] == f"a-{UUID}"
    client = next(c for c in fake.commands if c["command"] == "createClient")
    assert client["username"] == MAC and client["password"] == "1_" + "a" * 32
    grants = [c for c in fake.commands if c["command"] == "addRoleACL"]
    assert {c["rolename"] for c in grants} == {f"gw-{GW}"} and {c["topic"] for c in grants} == {f"/appliance/{UUID}/#"}
    with pytest.raises(Exception, match="device id"):
        asyncio.run(fake.appliance_login(GW, "../evil", MAC, "x"))
    fake.commands.clear()
    asyncio.run(fake.remove_appliance(GW, UUID, MAC))
    assert [c["command"] for c in fake.commands] == ["deleteClient", "deleteRole", "removeRoleACL", "removeRoleACL", "removeRoleACL"]


async def test_relay_keeps_each_device_with_one_gateway(settings, tmp_path):
    from cube_gateway.relay.server import create_relay_app

    relay_settings = replace(
        settings, data_dir=tmp_path / "relay", mqtt_admin_url="mqtt://127.0.0.1:1", mqtt_admin_user="admin", mqtt_admin_password="x",
        mqtt_public_server="mqtt-cube.example.com:8885", mqtt_gateway_url="mqtts://mqtt-cube.example.com:8885",
        relay_enroll_token="enrol-secret",
    )
    other = "22222222-3333-4444-5555-666666666666"
    app = create_relay_app(relay_settings)
    async with app.router.lifespan_context(app):
        app.state.relay.broker = FakeDynsec()
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://relay") as client:
            mine = (await client.post("/relay/v1/gateways", json={"gateway_id": GW}, headers={"Authorization": "Bearer enrol-secret"})).json()["data"]
            theirs = (await client.post("/relay/v1/gateways", json={"gateway_id": other}, headers={"Authorization": "Bearer enrol-secret"})).json()["data"]
            auth = {"Authorization": f"Bearer {GW}.{mine['secret']}"}
            intruder = {"Authorization": f"Bearer {other}.{theirs['secret']}"}
            body = {"uuid": UUID, "mac": MAC, "password": "7_" + "b" * 32}

            assert (await client.get("/relay/v1/mqtt/server")).status_code == 401
            assert (await client.get("/relay/v1/mqtt/server", headers=auth)).json()["data"] == {"server": "mqtt-cube.example.com:8885"}
            assert (await client.post("/relay/v1/mqtt/appliances", json=body)).status_code == 401
            assert (await client.post("/relay/v1/mqtt/appliances", json=body, headers=auth)).status_code == 201
            assert (await client.post("/relay/v1/mqtt/appliances", json=body, headers=intruder)).status_code == 409
            assert (await client.delete(f"/relay/v1/mqtt/appliances/{UUID}", headers=intruder)).status_code == 404
            for bad in ({**body, "uuid": "x"}, {**body, "mac": "x"}, {**body, "password": "x"}):
                assert (await client.post("/relay/v1/mqtt/appliances", json=bad, headers=auth)).status_code == 400
            assert (await client.delete(f"/relay/v1/mqtt/appliances/{UUID}", headers=auth)).status_code == 200
            assert (await client.post("/relay/v1/mqtt/appliances", json=body, headers=intruder)).status_code == 201
