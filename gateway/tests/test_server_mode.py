"""Server-hosted mode: devices that connect out to the company server, with no home network.

Covers the cloud Shelly adapter (Shelly RPC over MQTT through a simulated broker), cloud Shelly provisioning (a
per-device broker login that never reaches the database), LG privacy on a shared ReThink, the relay's broker
control plane, the server-mode catalog, and claiming a server-hosted gateway through the relay.
"""

from __future__ import annotations

import asyncio
import json
import re
import sqlite3
from dataclasses import replace
from pathlib import Path

import httpx
import pytest

from cube_gateway.adapters.base import AdapterContext, DeviceUnreachable, ScanContext, StoredDevice
from cube_gateway.adapters.lg_rethink import LgRethinkAdapter
from cube_gateway.adapters.registry import SERVER_HOSTED_ADAPTERS, AdapterRegistry
from cube_gateway.adapters.shelly_cloud import ShellyCloudAdapter
from cube_gateway.catalog import BRANDS, build_brands
from cube_gateway.cloud.broker import DynsecAdmin, _acls
from cube_gateway.models import Category
from tests.conftest import Harness

GW = "11111111-2222-3333-4444-555555555555"


class FakeShellyDevice:
    """A Shelly Plus 1PM on the broker: answers RPC requests on <prefix>/rpc with replies to <src>/rpc."""

    def __init__(self, link: FakeLink, slot: str, mac: str = "A8032AB1C2D3"):
        self.link = link
        self.slot = slot
        self.mac = mac
        self.output = False
        self.answer = True

    async def handle(self, topic: str, payload: str) -> None:
        if topic != f"{self.link.prefix}/{self.slot}/rpc" or not self.answer:
            return
        request = json.loads(payload)
        method = request["method"]
        if method == "Shelly.GetDeviceInfo":
            result = {"id": f"shellyplus1pm-{self.mac.lower()}", "mac": self.mac, "model": "SNSW-001P16EU", "gen": 2, "app": "Plus1PM", "fw_id": "1.4.4"}
        elif method == "Shelly.GetStatus":
            result = {"switch:0": {"id": 0, "output": self.output, "apower": 5.0, "aenergy": {"total": 10.0}}}
        elif method == "Switch.Set":
            self.output = request["params"]["on"]
            result = {"was_on": not self.output}
        else:
            reply = {"id": request["id"], "error": {"code": 404, "message": "No handler"}}
            await self.link.deliver(f"{request['src']}/rpc", json.dumps(reply))
            return
        await self.link.deliver(f"{request['src']}/rpc", json.dumps({"id": request["id"], "src": "shelly", "result": result}))


class FakeLink:
    """Stands in for CloudLink: routes published messages to simulated devices and back to the adapter."""

    def __init__(self, gateway_id: str = GW):
        self.prefix = f"cube/{gateway_id}"
        self.devices: list[FakeShellyDevice] = []
        self.handlers = []
        self.published: list[tuple[str, str]] = []
        self.allocated: list[str] = []
        self.released: list[str] = []

    def on_message(self, handler) -> None:
        self.handlers.append(handler)

    async def publish(self, topic: str, payload: str) -> None:
        assert topic.startswith(self.prefix + "/")
        self.published.append((topic, payload))
        for device in self.devices:
            asyncio.get_running_loop().create_task(device.handle(topic, payload))

    async def deliver(self, topic: str, payload: str) -> None:
        for handler in self.handlers:
            await handler(topic, payload.encode())

    async def allocate_device(self) -> dict:
        slot = f"slot{len(self.allocated) + 1:04d}"
        self.allocated.append(slot)
        return {"slot": slot, "server": "mqtt-cube.example.com:8885", "username": f"d-{GW}-{slot}", "password": "device-secret-pw", "topic_prefix": f"{self.prefix}/{slot}", "ca_pem": "-----BEGIN CERTIFICATE-----\nTEST\n-----END CERTIFICATE-----\n"}

    async def release_device(self, slot: str) -> None:
        self.released.append(slot)

    def start(self) -> None: ...

    async def stop(self) -> None: ...


def _scan(found: list) -> ScanContext:
    scan = ScanContext(timeout=3, subnets=[], report=found.append)
    scan.passive_done.set()
    return scan


async def _adapter(settings) -> tuple[ShellyCloudAdapter, FakeLink, FakeShellyDevice]:
    ctx = AdapterContext(settings)
    link = FakeLink()
    ctx.cloud = link
    adapter = ShellyCloudAdapter(ctx)
    await adapter.start()
    device = FakeShellyDevice(link, "slot0001")
    link.devices.append(device)
    await link.deliver(f"{link.prefix}/slot0001/online", "true")
    return adapter, link, device


# ---- the cloud Shelly adapter ---------------------------------------------------------------------


async def test_cloud_shelly_discover_pair_and_control(settings):
    adapter, link, device = await _adapter(settings)
    found: list = []
    await adapter.discover(_scan(found))
    assert len(found) == 1
    candidate = found[0]
    assert candidate.unique_id == "a8032ab1c2d3" and candidate.details["slot"] == "slot0001" and candidate.ip is None
    result = await adapter.pair(candidate, {}, lambda message: asyncio.sleep(0))
    assert result.params["slot"] == "slot0001" and result.category in {Category.SWITCH, Category.PLUG}
    stored = StoredDevice(id="d", adapter_id="shelly_cloud", brand="shelly", unique_id=result.unique_id, name="x", category=result.category, params=result.params)
    outcome = await adapter.execute_command(stored, "turn_on", {})
    assert device.output is True and outcome.result.status == "confirmed"
    request = json.loads(next(p for t, p in link.published if json.loads(p)["method"] == "Switch.Set"))
    assert request["src"] == f"{link.prefix}/slot0001/gw" and request["params"] == {"id": 0, "on": True}


async def test_cloud_shelly_pushes_and_offline(settings):
    adapter, link, device = await _adapter(settings)
    stored = StoredDevice(id="d", adapter_id="shelly_cloud", brand="shelly", unique_id="a8032ab1c2d3", name="x", category=Category.PLUG, params={"slot": "slot0001"})
    pushed: list = []

    async def on_state(state) -> None:
        pushed.append(state)

    await adapter.subscribe_to_events(stored, on_state)
    device.output = True
    await link.deliver(f"{link.prefix}/slot0001/events/rpc", json.dumps({"method": "NotifyStatus", "params": {"switch:0": {"output": True}}}))
    for _ in range(50):
        if pushed:
            break
        await asyncio.sleep(0.05)
    assert pushed and pushed[0].capabilities[0].value == "on"
    await link.deliver(f"{link.prefix}/slot0001/online", "false")
    with pytest.raises(DeviceUnreachable):
        await adapter.get_state(stored)


async def test_cloud_shelly_silent_device_times_out(settings, monkeypatch):
    import cube_gateway.adapters.shelly_cloud as module

    monkeypatch.setattr(module, "RPC_TIMEOUT", 0.2)
    adapter, link, device = await _adapter(settings)
    device.answer = False
    stored = StoredDevice(id="d", adapter_id="shelly_cloud", brand="shelly", unique_id="x", name="x", category=Category.PLUG, params={"slot": "slot0001"})
    with pytest.raises(DeviceUnreachable, match="did not answer"):
        await adapter.get_state(stored)


async def test_messages_for_other_gateways_are_ignored(settings):
    adapter, link, _ = await _adapter(settings)
    await adapter.handle_message("cube/99999999-0000-0000-0000-000000000000/slotX/online", b"true")
    assert "slotX" not in adapter.online


def test_cloud_shelly_needs_the_broker(settings):
    adapter = ShellyCloudAdapter(AdapterContext(settings))
    ok, reason = adapter.available()
    assert not ok and "device broker" in reason


# ---- server-hosted gateway: catalog, provisioning, claim ------------------------------------------


@pytest.fixture
def hosted(settings):
    return replace(settings, server_hosted=True, allow_remote_claim=True, rethink_only_provisioned=True, rethink_mqtt_url="mqtt://127.0.0.1:9")  # unreachable on purpose: tests never touch a live broker


def _hosted_harness(hosted) -> tuple[Harness, FakeLink]:
    h = Harness(hosted)
    link = FakeLink()
    h.ctx.cloud = link
    h.gateway.cloud = link  # type: ignore[assignment]
    h.gateway.provisioning.cloud = link
    h.registry = AdapterRegistry(h.ctx, modules=SERVER_HOSTED_ADAPTERS)
    h.gateway.registry = h.registry
    h.gateway.devices.registry = h.registry
    h.gateway.discovery.registry = h.registry
    h.gateway.pairings.registry = h.registry
    h.gateway.provisioning.registry = h.registry
    return h, link


def test_server_mode_lists_every_brand_with_its_real_route(hosted):
    h, _ = _hosted_harness(hosted)
    listed = build_brands(h.registry, hosted)
    brands = {b.id: b for b in listed}
    assert set(brands) == {b.id for b in BRANDS}

    # Devices that reach the server themselves.
    shelly = {m.id: m for m in brands["shelly"].methods}
    assert "setup:shelly_cloud_softap" in shelly and "setup:shelly_softap" not in shelly and "find:shelly" not in shelly
    assert shelly["find:shelly_cloud"].available
    lg = {m.id for m in brands["lg"].methods}
    assert "find:lg_webos" not in lg and "setup:lg_thinq_softap" in lg

    # Brands linked through their cloud: nothing local to offer, and no text about the home network.
    sonoff = brands["sonoff"]
    assert sonoff.hub_integrations == ["sonoff"] and sonoff.methods == [] and not sonoff.needs_home_gateway
    assert sonoff.status == "supported" and "eWeLink" in sonoff.summary and "DIY" not in " ".join(sonoff.notes)
    assert brands["tuya"].methods == [] and brands["switchbot"].hub_integrations == ["switchbot_cloud"]

    # Brands that only work on the home network stay listed, last, and can't be started.
    home_only = {"tplink", "xiaomi", "wiz", "lifx", "wled", "daikin", "midea", "tasmota", "gree", "esphome", "matter", "other"}
    assert {b.id for b in listed if b.needs_home_gateway} == home_only
    assert all(b.needs_home_gateway for b in listed[-len(home_only) :])
    for brand_id in home_only:
        methods = brands[brand_id].methods
        assert [m.id for m in methods] == ["setup:none"] and methods[0].available is False
        assert "home" in (methods[0].unavailable_reason or "") and brands[brand_id].notes == []

    # A device's address means nothing from the server.
    assert not [m.id for b in listed for m in b.methods if m.id.startswith("manual:")]


def test_home_gateways_keep_their_local_routes_and_can_link_cloud_brands(settings):
    with Harness(settings, real=True) as h:
        brands = {b.id: b for b in build_brands(h.gateway.registry, settings)}
    sonoff = brands["sonoff"]
    assert "find:sonoff_lan" in {m.id for m in sonoff.methods} and sonoff.hub_integrations == ["sonoff"]
    assert not any(b.needs_home_gateway for b in brands.values())
    assert brands["ring"].methods == [] and brands["ring"].status == "supported"
    assert any(m.id.startswith("manual:") for m in brands["shelly"].methods)


def test_a_local_extra_stays_out_of_sight_until_it_is_set_up(settings):
    """Nest reads as it always did on a gateway without a NoLongerEvil server, with no route the resident can't use."""
    with Harness(settings, real=True) as h:
        plain = {b.id: b for b in build_brands(h.gateway.registry, settings)}["nest"]
    assert plain.methods == [] and plain.adapters == [] and plain.notes == []
    assert plain.status == "supported" and plain.account_free is False and plain.hub_integrations == ["nest"]

    configured = replace(settings, nle_url="http://192.168.1.10:8082")
    with Harness(configured, real=True) as h:
        nest = {b.id: b for b in build_brands(h.gateway.registry, configured)}["nest"]
    assert [m.id for m in nest.methods if m.available] == ["find:nolongerevil"] and nest.hub_integrations == ["nest"]
    assert nest.notes and nest.status == "experimental"


def test_each_way_to_add_a_daikin_reads_differently(settings):
    with Harness(settings, real=True) as h:
        daikin = {b.id: b for b in build_brands(h.gateway.registry, settings)}["daikin"]
    titles = [m.title for m in daikin.methods]
    assert len(titles) == len(set(titles))
    assert {"find:daikin", "find:faikout", "manual:daikin", "manual:faikout"} <= {m.id for m in daikin.methods}


def test_hub_integrations_match_the_backend():
    """Every brand the backend can link has a place in Add Device, and the catalog names only real integrations."""
    source = Path(__file__).resolve().parents[2] / "backend" / "src" / "ha" / "integrations.ts"
    if not source.exists():
        pytest.skip("the backend is not next to the gateway here")
    offered = set(re.findall(r"\{ id: '([a-z_]+)', name:", source.read_text(encoding="utf-8")))
    assert len(offered) >= 19
    assert offered == {integration for brand in BRANDS for integration in brand.hub}


def test_cloud_shelly_setup_keeps_the_device_password_off_disk(hosted):
    h, link = _hosted_harness(hosted)
    with h:
        h.claim()
        session = h.post("/provisioning/sessions", json={"plugin_id": "shelly_cloud_softap"}).json()["data"]
        assert session["transport"] == "phone" and session["expect"] == {"slot": "slot0001"}
        assert session["setup"]["mqtt_password"] == "device-secret-pw"
        assert session["setup"]["mqtt_topic_prefix"].endswith("/slot0001") and "BEGIN CERTIFICATE" in session["setup"]["mqtt_ca_pem"]
        with sqlite3.connect(hosted.db_path) as conn:
            dump = "\n".join(conn.iterdump())
        assert "device-secret-pw" not in dump and "mqtt_topic_prefix" in dump

        def event(name, **data):
            response = h.post(f"/provisioning/sessions/{session['id']}/events", json={"event": name, "data": data})
            assert response.status_code == 200, response.text

        event("device_ap_joined", ssid="shellyplus1pm-a8032ab1c2d3")
        event("wifi_config_sent")
        event("phone_returned")
        device = FakeShellyDevice(link, "slot0001")
        link.devices.append(device)
        h.client.portal.call(link.deliver, f"{link.prefix}/slot0001/online", "true")
        done = h.wait(lambda: (s := h.get(f"/provisioning/sessions/{session['id']}").json()["data"])["state"] in {"connected", "pairing_failed"} and s, timeout=20)
        assert done["state"] == "connected", done
        paired = h.get(f"/devices/{done['device_id']}").json()["data"]
        assert paired["adapter_id"] == "shelly_cloud" and paired["ip"] is None
        assert link.released == []


def test_failed_cloud_setup_releases_the_login(hosted):
    h, link = _hosted_harness(hosted)
    with h:
        h.claim()
        session = h.post("/provisioning/sessions", json={"plugin_id": "shelly_cloud_softap"}).json()["data"]
        h.post(f"/provisioning/sessions/{session['id']}/events", json={"event": "failed", "data": {"code": "wifi_rejected"}})
        h.wait(lambda: link.released == ["slot0001"])


def test_lg_appliances_stay_private_to_the_gateway_that_set_them_up(hosted):
    h, _ = _hosted_harness(hosted)
    with h:
        h.claim()
        lg: LgRethinkAdapter = h.registry.adapters["lg_thinq_rethink"]  # type: ignore[assignment]
        lg.connected = True
        for device_id in ("neighbours-ac", "another-ac"):
            lg.handle_message(f"rethink/{device_id}/climate-mode", b"off")
        assert lg.device_ids() == []  # other apartments' appliances are invisible
        session = h.post("/provisioning/sessions", json={"plugin_id": "lg_thinq_softap"}).json()["data"]
        assert set(session["expect"]["exclude"].split(",")) == {"neighbours-ac", "another-ac"}
        for name in ("device_ap_joined", "wifi_config_sent", "phone_returned"):
            data = {"ssid": "LGE_AC2_1234"} if name == "device_ap_joined" else {}
            h.post(f"/provisioning/sessions/{session['id']}/events", json={"event": name, "data": data})
        h.client.portal.call(lambda: asyncio.sleep(0))
        lg.handle_message("rethink/my-new-ac/climate-mode", b"off")
        lg.handle_message("rethink/my-new-ac/availability", b"online")
        done = h.wait(lambda: (s := h.get(f"/provisioning/sessions/{session['id']}").json()["data"])["state"] in {"connected", "pairing_failed"} and s, timeout=20)
        assert done["state"] == "connected", done
        assert lg.device_ids() == ["my-new-ac"] and lg.windows == {}
        with sqlite3.connect(hosted.db_path) as conn:
            assert json.loads(conn.execute("SELECT value FROM meta WHERE key='rethink_owned'").fetchone()[0]) == ["my-new-ac"]


def test_two_new_lg_appliances_at_once_are_not_guessed(hosted):
    h, _ = _hosted_harness(hosted)
    with h:
        h.claim()
        lg: LgRethinkAdapter = h.registry.adapters["lg_thinq_rethink"]  # type: ignore[assignment]
        lg.connected = True
        session = h.post("/provisioning/sessions", json={"plugin_id": "lg_thinq_softap"}).json()["data"]
        for name in ("device_ap_joined", "wifi_config_sent", "phone_returned"):
            data = {"ssid": "LGE_AC2_1234"} if name == "device_ap_joined" else {}
            h.post(f"/provisioning/sessions/{session['id']}/events", json={"event": name, "data": data})
        lg.handle_message("rethink/ac-one/climate-mode", b"off")
        lg.handle_message("rethink/ac-two/climate-mode", b"off")
        done = h.wait(lambda: (s := h.get(f"/provisioning/sessions/{session['id']}").json()["data"])["state"] in {"connected", "pairing_failed"} and s, timeout=20)
        assert done["state"] == "pairing_failed" and done["error"]["code"] == "several_new_appliances"
        assert lg.device_ids() == []


# ---- the relay's broker control plane -------------------------------------------------------------


class FakeDynsec(DynsecAdmin):
    def __init__(self):
        super().__init__("mqtt://127.0.0.1:1", "admin", "x")
        self.commands: list[dict] = []

    async def run(self, commands):
        self.commands += commands
        return [{"command": c["command"]} for c in commands]


def test_broker_logins_are_limited_to_their_own_topics():
    acl_topics = {a["topic"] for a in _acls(f"cube/{GW}/abc123def456")}
    assert acl_topics == {f"cube/{GW}/abc123def456/#"}
    fake = FakeDynsec()
    username, password, prefix = asyncio.run(fake.device_login(GW, "abc123def456"))
    assert username == f"d-{GW}-abc123def456" and prefix == f"cube/{GW}/abc123def456" and len(password) >= 24
    role = next(c for c in fake.commands if c["command"] == "createRole")
    assert all(a["topic"] == f"cube/{GW}/abc123def456/#" for a in role["acls"])
    with pytest.raises(Exception, match="slot"):
        asyncio.run(fake.device_login(GW, "../../evil"))


async def test_relay_issues_logins_only_to_enrolled_gateways(settings, tmp_path):
    from cube_gateway.relay.server import create_relay_app

    ca = tmp_path / "ca.pem"
    ca.write_text("-----BEGIN CERTIFICATE-----\nCA\n-----END CERTIFICATE-----\n")
    relay_settings = replace(
        settings, data_dir=tmp_path / "relay", mqtt_admin_url="mqtt://127.0.0.1:1", mqtt_admin_user="admin", mqtt_admin_password="x",
        mqtt_public_server="mqtt-cube.example.com:8885", mqtt_gateway_url="mqtts://mqtt-cube.example.com:8885", mqtt_ca_file=str(ca),
        relay_enroll_token="enrol-secret",
    )
    app = create_relay_app(relay_settings)
    async with app.router.lifespan_context(app):
        app.state.relay.broker = FakeDynsec()
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://relay") as client:
            enrolled = (await client.post("/relay/v1/gateways", json={"gateway_id": GW}, headers={"Authorization": "Bearer enrol-secret"})).json()["data"]
            assert enrolled["device_broker"] is True
            auth = {"Authorization": f"Bearer {GW}.{enrolled['secret']}"}
            assert (await client.post("/relay/v1/mqtt/devices")).status_code == 401
            assert (await client.post("/relay/v1/mqtt/devices", headers={"Authorization": f"Bearer {GW}.wrong"})).status_code == 401
            device = (await client.post("/relay/v1/mqtt/devices", headers=auth)).json()["data"]
            assert device["server"] == "mqtt-cube.example.com:8885" and device["topic_prefix"].startswith(f"cube/{GW}/") and "CA" in device["ca_pem"]
            gateway = (await client.post("/relay/v1/mqtt/gateway", headers=auth)).json()["data"]
            assert gateway["url"] == "mqtts://mqtt-cube.example.com:8885" and gateway["prefix"] == f"cube/{GW}"
            removed = await client.delete(f"/relay/v1/mqtt/devices/{device['slot']}", headers=auth)
            assert removed.status_code == 200


def test_server_hosted_gateway_can_be_claimed_through_the_relay(hosted):
    from cube_gateway.relay.client import RelayClient

    h, _ = _hosted_harness(hosted)
    with h:
        relay = RelayClient(h.gateway, "https://relay.example.com", "secret")
        code = h.gateway.security.setup_code
        frame = {"id": 1, "method": "POST", "path": "/api/v1/auth/claim", "headers": {"content-type": "application/json"}, "body": __import__("base64").b64encode(json.dumps({"setup_code": code}).encode()).decode()}
        reply = h.client.portal.call(relay.forward, frame)
        assert reply["status"] == 201
    home = replace(hosted, allow_remote_claim=False)
    with Harness(home) as h2:
        relay = RelayClient(h2.gateway, "https://relay.example.com", "secret")
        frame = {"id": 1, "method": "POST", "path": "/api/v1/auth/claim", "headers": {}, "body": ""}
        assert h2.client.portal.call(relay.forward, frame)["status"] == 403
