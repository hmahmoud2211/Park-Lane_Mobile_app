"""Discovery jobs, deduplication, pairing, the persistent registry, commands, failures and isolation."""

from __future__ import annotations

import sqlite3

from cube_gateway.models import AuthKind
from tests.conftest import Harness
from tests.fakes import BrokenAdapter, FakeAdapter, info


def _plug(h: Harness, unique_id: str = "plug1", ip: str = "192.168.50.10", **extra) -> None:
    h.fake.devices[unique_id] = {"name": "Desk plug", "model": "FP-1", "ip": ip, "mac": "AA:BB:CC:00:11:22", **extra}


def test_scan_finds_dedupes_and_streams(harness: Harness):
    harness.claim()
    _plug(harness)
    with harness.client.websocket_connect("/api/v1/events") as socket:
        socket.send_json({"type": "auth", "token": harness.token})
        socket.receive_json()
        job = harness.scan(adapter_ids=["fake"])
        types = set()
        for _ in range(30):
            event = socket.receive_json()
            types.add(event["type"])
            if "discovery.candidate" in types and event["type"] == "discovery.progress" and event["data"]["job"]["status"] == "completed":
                break
    assert job["status"] == "completed" and job["progress"] == 1.0
    assert {"discovery.progress", "discovery.candidate"} <= types
    # A second scan of the same device merges into one candidate.
    harness.scan(adapter_ids=["fake"])
    candidates = harness.get("/discovery/candidates?adapter_id=fake").json()["data"]
    assert len(candidates) == 1
    assert candidates[0]["mac"] == "aa:bb:cc:00:11:22" and candidates[0]["control"] == "supported"


def test_out_of_scope_addresses_are_ignored(harness: Harness):
    harness.claim()
    _plug(harness, "public", ip="8.8.8.8")
    _plug(harness, "otherlan", ip="10.9.9.9")
    harness.scan(adapter_ids=["fake"])
    assert harness.get("/discovery/candidates").json()["data"] == []


def test_untrusted_names_are_cleaned(harness: Harness):
    harness.claim()
    _plug(harness, name="Evil\x00\x1b[31mName" + "x" * 300)
    harness.scan(adapter_ids=["fake"])
    name = harness.get("/discovery/candidates").json()["data"][0]["name"]
    assert "\x00" not in name and "\x1b" not in name and len(name) <= 96


def test_one_scan_at_a_time_and_cancel(harness: Harness):
    harness.claim()
    harness.fake.discover_delay = 10
    first = harness.post("/discovery/jobs", json={"adapter_ids": ["fake"], "timeout": 30}).json()["data"]
    second = harness.post("/discovery/jobs", json={"adapter_ids": ["fake"]}).json()["data"]
    assert second["id"] == first["id"]
    cancelled = harness.delete(f"/discovery/jobs/{first['id']}").json()["data"]
    assert cancelled["status"] == "cancelled"
    harness.wait(lambda: harness.get(f"/discovery/jobs/{first['id']}").json()["data"]["status"] == "cancelled")


def test_failing_adapter_is_reported_not_fatal(settings):
    with Harness(settings, adapters=[BrokenAdapter]) as h:
        h.claim()
        _plug(h)
        job = h.scan(adapter_ids=["fake", "broken"])
        assert job["status"] == "completed"
        assert any("broken on purpose" in e for e in job["errors"])
        assert len(job["candidate_ids"]) == 1


def test_crashing_adapter_cannot_take_the_gateway_down(harness: Harness):
    harness.claim()
    harness.fake.crash_on = {"discover"}
    job = harness.scan(adapter_ids=["fake"])
    assert job["status"] == "completed" and job["errors"]
    assert harness.client.get("/api/v1/health").status_code == 200


def test_pair_persist_restart_and_control(settings):
    with Harness(settings) as h:
        token = h.claim()["token"]
        _plug(h)
        job = h.scan(adapter_ids=["fake"])
        room = h.post("/rooms", json={"name": "Office"}).json()["data"]
        pairing = h.pair(job["candidate_ids"][0], name="My plug", room_id=room["id"])
        assert pairing["status"] == "paired"
        device = h.get(f"/devices/{pairing['device_id']}").json()["data"]
        assert device["name"] == "My plug" and device["room"] == "Office" and device["category"] == "plug"
        assert device["connection"]["status"] == "connected"
        assert set(device["commands"]) >= {"turn_on", "turn_off", "toggle"}
        candidate = h.get("/discovery/candidates").json()["data"][0]
        assert candidate["paired_device_id"] == device["id"]

        result = h.post(f"/devices/{device['id']}/commands", json={"command": "turn_on"}).json()["data"]
        assert result["result"]["status"] == "confirmed"
        power = next(c for c in result["device"]["capabilities"] if c["type"] == "power")
        assert power["value"] == "on" and power["confirmed"] is True
        device_id = device["id"]

    # Restart: the device comes back from SQLite and is monitored again.
    with Harness(settings) as h:
        h.fake.power["plug1"] = True
        restored = h.get(f"/devices/{device_id}", headers=h.headers(token)).json()["data"]
        assert restored["name"] == "My plug" and restored["room"] == "Office"
        h.wait(lambda: h.get(f"/devices/{device_id}", headers=h.headers(token)).json()["data"]["connection"]["status"] == "connected")
        assert "get_state" in h.fake.calls


def test_repairing_updates_instead_of_duplicating(harness: Harness):
    harness.claim()
    _plug(harness)
    job = harness.scan(adapter_ids=["fake"])
    first = harness.pair(job["candidate_ids"][0])
    second = harness.pair(job["candidate_ids"][0])
    assert first["device_id"] == second["device_id"]
    assert len(harness.get("/devices").json()["data"]) == 1


def test_credentials_are_sealed_at_rest(settings):
    with Harness(settings) as h:
        h.claim()
        h.fake.required_key = "0123456789abcdef"
        _plug(h)
        job = h.scan(adapter_ids=["fake"])
        needs = h.pair(job["candidate_ids"][0])
        assert needs["status"] == "needs_input" and needs["error_code"] == "local_key_required"
        assert needs["fields"][0]["name"] == "local_key" and needs["fields"][0]["secret"] is True
        wrong = h.pair(job["candidate_ids"][0], credentials={"local_key": "nope"})
        assert wrong["status"] == "needs_input" and wrong["error_code"] == "local_key_invalid"
        ok = h.pair(job["candidate_ids"][0], credentials={"local_key": "0123456789abcdef"})
        assert ok["status"] == "paired"
        assert "local_key" not in str(h.get(f"/devices/{ok['device_id']}").json())
    with sqlite3.connect(settings.db_path) as conn:
        dump = "\n".join(conn.iterdump())
    assert "0123456789abcdef" not in dump
    assert "v1." in dump  # sealed blob


def test_unreachable_device_goes_offline_with_backoff(harness: Harness):
    harness.claim()
    _plug(harness)
    job = harness.scan(adapter_ids=["fake"])
    device_id = harness.pair(job["candidate_ids"][0])["device_id"]
    harness.fake.reachable = False
    response = harness.post(f"/devices/{device_id}/commands", json={"command": "turn_on"})
    assert response.status_code == 504 and response.json()["error"]["code"] == "device_unreachable"
    assert response.json()["error"]["recovery"]
    device = harness.get(f"/devices/{device_id}").json()["data"]
    assert device["connection"]["status"] == "offline"
    assert device["connection"]["retry_at"] is not None
    assert all(c["confirmed"] is False for c in device["capabilities"])
    assert device["pending"] is None
    harness.fake.reachable = True
    refreshed = harness.post(f"/devices/{device_id}/refresh").json()["data"]
    assert refreshed["connection"]["status"] == "connected"


def test_unsupported_and_assumed_commands(harness: Harness):
    harness.claim()
    _plug(harness)
    job = harness.scan(adapter_ids=["fake"])
    device_id = harness.pair(job["candidate_ids"][0])["device_id"]
    unsupported = harness.post(f"/devices/{device_id}/commands", json={"command": "set_volume", "params": {"volume": 5}})
    assert unsupported.status_code == 422 and unsupported.json()["error"]["code"] == "unsupported_command"
    harness.fake.assumed = True
    result = harness.post(f"/devices/{device_id}/commands", json={"command": "toggle"}).json()["data"]
    assert result["result"]["status"] == "assumed"
    assert next(c for c in result["device"]["capabilities"] if c["type"] == "power")["confirmed"] is False


def test_command_crash_is_isolated(harness: Harness):
    harness.claim()
    _plug(harness)
    job = harness.scan(adapter_ids=["fake"])
    device_id = harness.pair(job["candidate_ids"][0])["device_id"]
    harness.fake.crash_on = {"command"}
    response = harness.post(f"/devices/{device_id}/commands", json={"command": "turn_on"})
    assert response.status_code == 502 and response.json()["error"]["code"] == "adapter_crashed"
    assert harness.get(f"/devices/{device_id}").json()["data"]["pending"] is None


def test_detection_only_candidates_cannot_be_paired(harness: Harness):
    harness.claim()
    _plug(harness, control="detection_only")
    job = harness.scan(adapter_ids=["fake"])
    pairing = harness.pair(job["candidate_ids"][0])
    assert pairing["status"] == "failed" and pairing["error_code"] == "unsupported_device"
    assert harness.get("/devices").json()["data"] == []


def test_approval_on_device_is_reported(settings):
    with Harness(settings) as h:
        approve = FakeAdapter(h.ctx, adapter_info=info("tv", "tvbrand", auth=AuthKind.APPROVE_ON_DEVICE))
        approve.devices["tv1"] = {"name": "TV", "ip": "192.168.50.20"}
        h.registry.add(approve)
        h.claim()
        job = h.scan(adapter_ids=["tv"])
        pairing = h.post("/pairings", json={"candidate_id": job["candidate_ids"][0]}).json()["data"]
        seen = h.wait(lambda: (p := h.get(f"/pairings/{pairing['id']}").json()["data"])["status"] in {"awaiting_approval", "paired"} and p)
        assert seen["status"] in {"awaiting_approval", "paired"}
        final = h.wait(lambda: (p := h.get(f"/pairings/{pairing['id']}").json()["data"])["status"] == "paired" and p)
        assert final["device_id"]


def test_rooms_and_device_edits(harness: Harness):
    harness.claim()
    _plug(harness)
    job = harness.scan(adapter_ids=["fake"])
    device_id = harness.pair(job["candidate_ids"][0])["device_id"]
    room = harness.post("/rooms", json={"name": "Lounge"}).json()["data"]
    assert harness.post("/rooms", json={"name": "lounge"}).status_code == 409
    moved = harness.patch(f"/devices/{device_id}", json={"room_id": room["id"], "dashboard": False, "name": "  Lamp  "}).json()["data"]
    assert moved["room"] == "Lounge" and moved["dashboard"] is False and moved["name"] == "Lamp"
    assert harness.get("/rooms").json()["data"][0]["device_count"] == 1
    cleared = harness.patch(f"/devices/{device_id}", json={"room_id": None}).json()["data"]
    assert cleared["room_id"] is None
    assert harness.delete(f"/rooms/{room['id']}").status_code == 200
    assert harness.delete(f"/devices/{device_id}").status_code == 200
    assert harness.get(f"/devices/{device_id}").status_code == 404


def test_brands_come_from_the_loaded_adapters(settings):
    with Harness(settings, real=True) as h:
        h.claim()
        brands = {b["id"]: b for b in h.get("/brands").json()["data"]}
        assert list(brands) == ["lg", "samsung", "sonoff", "tuya", "tplink", "xiaomi", "shelly", "wiz", "lifx", "wled", "daikin", "midea", "other"]
        lg = brands["lg"]
        methods = {m["id"]: m for m in lg["methods"]}
        assert methods["find:lg_thinq_rethink"]["available"] is False  # no CUBE_RETHINK_MQTT_URL
        assert "CUBE_RETHINK_MQTT_URL" in methods["find:lg_thinq_rethink"]["unavailable_reason"]
        assert methods["setup:lg_thinq_softap"]["available"] is False
        shelly = {m["id"]: m for m in brands["shelly"]["methods"]}
        assert shelly["setup:shelly_softap"]["group"] == "new" and shelly["setup:shelly_softap"]["available"] is True
        tuya = {m["group"]: m for m in brands["tuya"]["methods"]}
        assert tuya["new"]["available"] is False and "Smart Life" in tuya["new"]["unavailable_reason"]
        assert brands["tuya"]["methods"][0]["local_key"] is True
        assert brands["other"]["status"] == "unsupported"
        assert all(a["loaded"] for a in h.get("/adapters").json()["data"])
