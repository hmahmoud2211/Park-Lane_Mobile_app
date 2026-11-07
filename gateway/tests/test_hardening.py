"""Relay path checks, per-caller rate limits through the relay, and monitoring that survives unexpected errors."""

from __future__ import annotations

import base64
import json
from dataclasses import replace

import httpx
import pytest
from fastapi.testclient import TestClient

from cube_gateway import devices as devices_module
from cube_gateway.relay.client import RelayClient
from cube_gateway.relay.server import create_relay_app
from tests.conftest import Harness


def _frame(path: str, body: dict | None = None, client: str | None = None, method: str = "POST") -> dict:
    frame = {
        "t": "req",
        "id": 1,
        "method": method,
        "path": path,
        "query": "",
        "headers": {"content-type": "application/json"},
        "body": base64.b64encode(json.dumps(body).encode()).decode() if body is not None else "",
    }
    if client is not None:
        frame["client"] = client
    return frame


def _reply(frame: dict) -> dict:
    return json.loads(base64.b64decode(frame["body"]) or b"{}")


# ---- the claim block cannot be dodged by how the path is written ----


@pytest.mark.parametrize(
    "path",
    [
        "/api/v1/auth/%63laim",  # what a double-encoded %2563laim becomes after the relay decodes it once
        "/api/v1/auth/cl%61im",
        "/api/v1/auth/claim/",
        "/api/v1/auth/claim?x=1",
        "/api/v1/auth/claim#x",
        "/api/v1/devices/../auth/claim",
        "/api/v1/./auth/claim",
        "/api/v1//auth/claim",
        "/api/v1/events",
    ],
)
def test_relay_refuses_disguised_claim_paths(settings, path):
    with Harness(settings) as h:
        relay = RelayClient(h.gateway, "https://relay.example.com", "secret")
        code = h.gateway.security.setup_code
        reply = h.client.portal.call(relay.forward, _frame(path, {"setup_code": code, "client_name": "outsider"}))
        assert reply["status"] in {400, 403}, reply
        assert h.client.portal.call(h.gateway.security.is_claimed) is False


def test_relay_still_forwards_ordinary_paths(settings):
    with Harness(settings) as h:
        relay = RelayClient(h.gateway, "https://relay.example.com", "secret")
        reply = h.client.portal.call(relay.forward, _frame("/api/v1/health", method="GET"))
        assert reply["status"] == 200 and _reply(reply)["data"]["gateway_id"] == h.gateway.security.gateway_id


def test_claim_handler_itself_refuses_relayed_callers(settings):
    """Defence in depth: even a path the relay client let through can't claim a home gateway."""
    with Harness(settings) as h:
        code = h.gateway.security.setup_code

        async def call() -> httpx.Response:
            transport = httpx.ASGITransport(app=h.app, client=("relay:203.0.113.5", 0))
            async with httpx.AsyncClient(transport=transport, base_url="http://gateway") as client:
                return await client.post("/api/v1/auth/claim", json={"setup_code": code, "client_name": "outsider"})

        response = h.client.portal.call(call)
        assert response.status_code == 403 and response.json()["error"]["code"] == "forbidden"
        assert h.client.portal.call(h.gateway.security.is_claimed) is False


# ---- each caller behind the relay has its own rate limit ----


def test_relayed_callers_are_rate_limited_separately(settings):
    with Harness(settings) as h:
        relay = RelayClient(h.gateway, "https://relay.example.com", "secret")
        bad = {"invite_code": "AAAA-BBBB", "client_name": "x"}
        statuses = [h.client.portal.call(relay.forward, _frame("/api/v1/auth/join", bad, client="203.0.113.5"))["status"] for _ in range(11)]
        assert statuses[:10] == [401] * 10 and statuses[10] == 429
        # Someone else using the same relay is not locked out by the first caller.
        other = h.client.portal.call(relay.forward, _frame("/api/v1/auth/join", bad, client="198.51.100.7"))
        assert other["status"] == 401
        # A relay that names no caller (or names garbage) still gets limited, as one shared caller.
        for value in (None, "not an address"):
            frame = _frame("/api/v1/auth/join", bad, client=value)
            assert h.client.portal.call(relay.forward, frame)["status"] == 401


def test_relay_server_trusts_client_ip_headers_only_from_a_proxy(settings, tmp_path):
    relay_settings = replace(settings, data_dir=tmp_path / "relay", relay_enroll_token="enrol-secret")
    app = create_relay_app(relay_settings)
    body = {"gateway_id": "00000000-0000-4000-8000-000000000001"}
    # Reached directly from the internet: a spoofed X-Real-IP per request must not buy fresh rate-limit buckets.
    with TestClient(app, client=("93.184.216.34", 50000)) as direct:
        statuses = [direct.post("/relay/v1/gateways", json=body, headers={"X-Real-IP": f"10.9.9.{i}"}).status_code for i in range(11)]
    assert statuses[:10] == [401] * 10 and statuses[10] == 429
    # Behind a proxy on the same host, or reached through Docker's bridge, X-Real-IP is the caller.
    for n, proxy in enumerate(("127.0.0.1", "172.17.0.1")):
        app = create_relay_app(replace(relay_settings, data_dir=tmp_path / f"relay{n}"))
        with TestClient(app, client=(proxy, 50000)) as proxied:
            statuses = [proxied.post("/relay/v1/gateways", json=body, headers={"X-Real-IP": f"93.184.216.{i}"}).status_code for i in range(11)]
        assert statuses == [401] * 11, proxy


def test_relay_with_a_device_broker_refuses_open_enrolment(settings, tmp_path):
    relay_settings = replace(
        settings, data_dir=tmp_path / "relay", relay_enroll_token="", mqtt_admin_url="mqtt://127.0.0.1:1", mqtt_admin_user="admin",
        mqtt_admin_password="x", mqtt_public_server="mqtt-cube.example.com:8885",
    )
    with pytest.raises(SystemExit, match="CUBE_RELAY_ENROLL_TOKEN"):
        create_relay_app(relay_settings)


# ---- failures inside the gateway still get an answer, and never end monitoring ----


def test_a_crashing_route_still_answers_through_the_relay(settings):
    with Harness(settings) as h:

        async def boom() -> None:
            raise RuntimeError("bug in a route")

        h.app.add_api_route("/api/v1/boom", boom, methods=["GET"])
        relay = RelayClient(h.gateway, "https://relay.example.com", "secret")
        reply = h.client.portal.call(relay.forward, _frame("/api/v1/boom", method="GET"))
        assert reply["status"] == 500 and _reply(reply)["error"]["code"] == "internal"


def test_relay_client_answers_even_when_forwarding_fails(settings):
    with Harness(settings) as h:
        relay = RelayClient(h.gateway, "https://relay.example.com", "secret")
        sent: list[dict] = []

        class Socket:
            async def send(self, raw: str) -> None:
                sent.append(json.loads(raw))

        async def broken(frame: dict) -> dict:
            raise RuntimeError("transport bug")

        relay._socket = Socket()
        relay.forward = broken  # type: ignore[method-assign]
        h.client.portal.call(relay._handle, _frame("/api/v1/health", method="GET") | {"id": 7})
        assert sent and sent[0]["t"] == "res" and sent[0]["id"] == 7 and sent[0]["status"] == 502


def test_monitoring_survives_an_unexpected_error(harness: Harness, monkeypatch):
    monkeypatch.setattr(devices_module, "BACKOFF_MIN", 0.2)
    harness.claim()
    harness.fake.devices["plug-1"] = {"name": "Desk plug", "ip": "192.168.50.20"}
    job = harness.scan(adapter_ids=["fake"])
    device_id = harness.pair(job["candidate_ids"][0])["device_id"]
    manager = harness.gateway.devices
    real_apply = manager._apply
    blown: list[str] = []

    async def flaky(dev_id, state):
        if not blown:
            blown.append(dev_id)
            raise OSError("disk I/O error")
        await real_apply(dev_id, state)

    manager._apply = flaky  # type: ignore[method-assign]
    manager.live[device_id].wake.set()
    offline = harness.wait(lambda: blown and (d := harness.get(f"/devices/{device_id}").json()["data"])["connection"]["status"] == "offline" and d)
    assert offline["connection"]["last_error"] and offline["connection"]["retry_at"]
    polls = harness.fake.calls.count("get_state")
    # The monitor keeps going and the device comes back once a pass succeeds.
    harness.wait(lambda: harness.fake.calls.count("get_state") > polls and harness.get(f"/devices/{device_id}").json()["data"]["connection"]["status"] == "connected", timeout=6)
    assert not manager.live[device_id].task.done()
