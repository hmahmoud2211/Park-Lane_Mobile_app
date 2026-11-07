"""Remote relay end to end (real HTTP and WebSockets on localhost), SSDP parsing, log redaction, subnets."""

from __future__ import annotations

import asyncio
import ipaddress
import json
import logging
import socket
from dataclasses import replace

import httpx
import pytest
import uvicorn

from cube_gateway.adapters.base import AdapterContext
from cube_gateway.adapters.registry import AdapterRegistry
from cube_gateway.api import create_app
from cube_gateway.discovery.ssdp import build_search, parse_reply
from cube_gateway.gateway import Gateway
from cube_gateway.logs import JsonFormatter, redact
from cube_gateway.netutil import scan_subnets
from cube_gateway.relay.client import enroll
from cube_gateway.relay.server import create_relay_app
from tests.fakes import FakeMdns


def _free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


async def _serve(app, port: int) -> uvicorn.Server:
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_config=None, ws="websockets-sansio", lifespan="on"))
    asyncio.create_task(server.serve())
    for _ in range(100):
        if server.started:
            return server
        await asyncio.sleep(0.05)
    raise RuntimeError("server did not start")


@pytest.fixture
async def relay_setup(settings, tmp_path):
    relay_port = _free_port()
    relay_settings = replace(settings, data_dir=tmp_path / "relay", relay_enroll_token="enrol-secret")
    relay_server = await _serve(create_relay_app(relay_settings), relay_port)
    ctx = AdapterContext(settings)
    gateway = Gateway(settings, registry=AdapterRegistry(ctx, modules=[]), mdns=FakeMdns())  # type: ignore[arg-type]
    app = create_app(settings, gateway)
    gateway.app = app
    app.state.gw = gateway
    await gateway.start()
    try:
        yield gateway, f"http://127.0.0.1:{relay_port}"
    finally:
        await gateway.stop()
        relay_server.should_exit = True
        await asyncio.sleep(0.2)


async def test_relay_end_to_end(relay_setup):
    gateway, relay_url = relay_setup
    from cube_gateway.devices import DeviceError

    with pytest.raises(DeviceError):
        await enroll(gateway, relay_url, "wrong-token")
    await enroll(gateway, relay_url, "enrol-secret")
    for _ in range(100):
        if gateway.relay and gateway.relay.connected:
            break
        await asyncio.sleep(0.05)
    assert gateway.relay.connected
    base = f"{relay_url}/relay/v1/g/{gateway.security.gateway_id}/api/v1"

    async with httpx.AsyncClient() as client:
        health = (await client.get(f"{base}/health")).json()
        assert health["data"]["gateway_id"] == gateway.security.gateway_id
        # Ownership can't be claimed from outside the home network.
        claim = await client.post(f"{base}/auth/claim", json={"setup_code": gateway.security.setup_code})
        assert claim.status_code == 403
        # Nor by spelling the path differently: the relay decodes %2563 once, the gateway would decode it again.
        for disguised in ("auth/%2563laim", "auth/cl%2561im", "auth/claim%253Fx"):
            sneaky = await client.post(f"{base}/{disguised}", json={"setup_code": gateway.security.setup_code})
            assert sneaky.status_code in {400, 403}, (disguised, sneaky.text)
        assert not await gateway.security.is_claimed()
        # The gateway, not the relay, decides authentication.
        assert (await client.get(f"{base}/devices")).status_code == 401
        # Claim locally, then use the same token through the relay.
        transport = httpx.ASGITransport(app=gateway.app)
        async with httpx.AsyncClient(transport=transport, base_url="http://gw") as local:
            token = (await local.post("/api/v1/auth/claim", json={"setup_code": gateway.security.setup_code})).json()["data"]["token"]
        headers = {"Authorization": f"Bearer {token}"}
        assert (await client.get(f"{base}/devices", headers=headers)).json() == {"ok": True, "data": []}
        room = await client.post(f"{base}/rooms", json={"name": "Remote room"}, headers=headers)
        assert room.status_code == 201
        unknown = await client.get(f"{relay_url}/relay/v1/g/00000000-0000-0000-0000-000000000000/api/v1/health")
        assert unknown.status_code == 404

    from websockets.asyncio.client import connect

    ws_url = base.replace("http://", "ws://") + "/events"
    async with connect(ws_url) as ws:
        await ws.send(json.dumps({"type": "auth", "token": "cgw_bad"}))
        assert json.loads(await ws.recv()) == {"type": "error", "code": "unauthorized"}
    async with connect(ws_url) as ws:
        await ws.send(json.dumps({"type": "auth", "token": token}))
        assert json.loads(await ws.recv())["type"] == "ready"
        gateway.bus.publish("rooms.updated", rooms=[])
        assert json.loads(await asyncio.wait_for(ws.recv(), 5))["type"] == "rooms.updated"


async def test_relay_offline_gateway(relay_setup):
    gateway, relay_url = relay_setup
    await enroll(gateway, relay_url, "enrol-secret")
    await gateway.relay.stop()
    async with httpx.AsyncClient() as client:
        for _ in range(50):
            response = await client.get(f"{relay_url}/relay/v1/g/{gateway.security.gateway_id}/api/v1/health")
            if response.status_code == 503:
                break
            await asyncio.sleep(0.05)
        assert response.status_code == 503 and response.json()["error"]["code"] == "gateway_offline"


def test_ssdp_parsing_is_defensive():
    reply = b"HTTP/1.1 200 OK\r\nST: urn:dial-multiscreen-org:service:dial:1\r\nUSN: uuid:1234::urn:dial\r\nLOCATION: http://192.168.50.80:8080/dd.xml\r\nSERVER: WebOS/4.1 UPnP/1.0\r\n\r\n"
    record = parse_reply(reply, "192.168.50.80")
    assert record and record.st.startswith("urn:dial") and record.server == "WebOS/4.1 UPnP/1.0"
    assert parse_reply(reply, "8.8.8.8") is None
    assert parse_reply(b"x" * 5000, "192.168.50.80") is None
    assert parse_reply(b"GET / HTTP/1.1\r\n\r\n", "192.168.50.80") is None
    assert b"ST: ssdp:all" in build_search("ssdp:all")


def test_log_redaction():
    assert redact({"password": "hunter2", "nested": {"local_key": "abc"}, "name": "Plug"}) == {"password": "[redacted]", "nested": {"local_key": "[redacted]"}, "name": "Plug"}
    assert "hunter2" not in redact("joining with password=hunter2 now")
    record = logging.makeLogRecord({"msg": "token: abc123", "levelname": "INFO", "name": "t", "device_key": "zzz"})
    line = json.loads(JsonFormatter().format(record))
    assert line["device_key"] == "[redacted]" and "abc123" not in line["msg"]


def test_scan_subnets_are_private_and_small():
    configured = [ipaddress.ip_network("192.168.1.0/24")]
    assert scan_subnets(configured) == configured
    for subnet in scan_subnets([]):
        assert subnet.is_private and subnet.prefixlen >= 24
