"""The optional remote relay: `cube-gateway relay`, run on a public server behind HTTPS (nginx/Caddy).

It only routes. Gateways enrol (optionally gated by CUBE_RELAY_ENROLL_TOKEN) and keep an outbound tunnel
open; apps reach a gateway at /relay/v1/g/<gateway_id>/api/v1/... with the same bearer token they use at
home, and the gateway itself authenticates them. The relay stores only gateway ids and hashed tunnel secrets.

Exposes no device ports and no unauthenticated gateway API: an unknown or offline gateway answers 404/503,
and every forwarded request still needs a client token the gateway accepts.
"""

from __future__ import annotations

import asyncio
import base64
import contextlib
import hashlib
import itertools
import json
import logging
import re
import secrets
import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse, Response

from .. import __version__
from ..config import Settings
from ..crypto import constant_time_equal
from ..db import Database
from ..security import RateLimiter

log = logging.getLogger("cube.relay")
GATEWAY_ID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
MAX_BODY = 1024 * 1024
REQUEST_TIMEOUT = 45.0
RELAY_SCHEMA = [
    "CREATE TABLE IF NOT EXISTS relay_gateways (id TEXT PRIMARY KEY, secret_hash TEXT NOT NULL, created_at REAL NOT NULL, last_seen REAL)",
]


def _hash(secret: str) -> str:
    return hashlib.sha256(secret.encode()).hexdigest()


def _error(code: str, message: str, status: int) -> JSONResponse:
    return JSONResponse({"ok": False, "error": {"code": code, "message": message}}, status_code=status)


class Tunnel:
    def __init__(self, gateway_id: str, socket: WebSocket):
        self.gateway_id = gateway_id
        self.socket = socket
        self.pending: dict[int, asyncio.Future] = {}
        self.streams: dict[str, WebSocket] = {}
        self.lock = asyncio.Lock()
        self.ids = itertools.count(1)

    async def send(self, frame: dict[str, Any]) -> None:
        async with self.lock:
            await self.socket.send_text(json.dumps(frame))


class Relay:
    def __init__(self, db: Database, enroll_token: str):
        self.db = db
        self.enroll_token = enroll_token
        self.tunnels: dict[str, Tunnel] = {}
        self.ip_limiter = RateLimiter(limit=240, window=60)
        self.enroll_limiter = RateLimiter(limit=10, window=60)


def create_relay_app(settings: Settings) -> FastAPI:
    db = Database(settings.data_dir / "relay.db")
    relay = Relay(db, settings.relay_enroll_token)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        settings.data_dir.mkdir(parents=True, exist_ok=True)
        await db.open()
        for statement in RELAY_SCHEMA:
            await db.execute(statement)
        log.info("relay ready", extra={"port": settings.relay_port, "enrollment": "token" if relay.enroll_token else "open"})
        try:
            yield
        finally:
            await db.close()

    app = FastAPI(title="CUBE Relay", version=__version__, lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
    app.state.relay = relay

    def ip_of(request: Request | WebSocket) -> str:
        # X-Real-IP is set by the reverse proxy (overwriting anything the client sent); the first X-Forwarded-For
        # entry is client-controlled, so it is only a fallback for proxies that do not set X-Real-IP.
        real = request.headers.get("x-real-ip", "").strip()
        if real:
            return real
        forwarded = request.headers.get("x-forwarded-for", "")
        return forwarded.split(",")[0].strip() if forwarded else (request.client.host if request.client else "unknown")

    @app.get("/relay/v1/health")
    async def health() -> JSONResponse:
        return JSONResponse({"ok": True, "data": {"status": "ok", "version": __version__, "gateways_online": len(relay.tunnels)}})

    @app.post("/relay/v1/gateways")
    async def enroll(request: Request) -> JSONResponse:
        if not relay.enroll_limiter.check(ip_of(request)):
            return _error("rate_limited", "Too many enrolments; wait a minute.", 429)
        if relay.enroll_token:
            header = request.headers.get("authorization", "")
            if not constant_time_equal(header, f"Bearer {relay.enroll_token}"):
                return _error("unauthorized", "This relay needs an enrolment token.", 401)
        try:
            body = await request.json()
        except ValueError:
            return _error("bad_request", "Send JSON.", 400)
        gateway_id = str(body.get("gateway_id") or "")
        if not GATEWAY_ID.match(gateway_id):
            return _error("bad_request", "gateway_id must be the gateway's UUID.", 400)
        existing = await db.fetchone("SELECT secret_hash FROM relay_gateways WHERE id = ?", (gateway_id,))
        if existing and not constant_time_equal(_hash(str(body.get("secret") or "")), existing["secret_hash"]):
            return _error("conflict", "That gateway is already enrolled; re-enrolment needs its current secret.", 409)
        secret = secrets.token_urlsafe(32)
        await db.execute(
            "INSERT INTO relay_gateways (id, secret_hash, created_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET secret_hash = excluded.secret_hash",
            (gateway_id, _hash(secret), time.time()),
        )
        base = str(request.base_url).rstrip("/")
        if request.headers.get("x-forwarded-proto") == "https":
            base = base.replace("http://", "https://", 1)
        return JSONResponse({"ok": True, "data": {"gateway_id": gateway_id, "secret": secret, "public_url": f"{base}/relay/v1/g/{gateway_id}"}}, status_code=201)

    @app.websocket("/relay/v1/tunnel")
    async def tunnel(socket: WebSocket) -> None:
        header = socket.headers.get("authorization", "")
        gateway_id, _, secret = header[7:].partition(".") if header.lower().startswith("bearer ") else ("", "", "")
        row = await db.fetchone("SELECT secret_hash FROM relay_gateways WHERE id = ?", (gateway_id,)) if GATEWAY_ID.match(gateway_id) else None
        if not row or not constant_time_equal(_hash(secret), row["secret_hash"]):
            await socket.close(code=4401)
            return
        await socket.accept()
        old = relay.tunnels.get(gateway_id)
        if old:
            with contextlib.suppress(Exception):
                await old.socket.close(code=4409)
        current = Tunnel(gateway_id, socket)
        relay.tunnels[gateway_id] = current
        await db.execute("UPDATE relay_gateways SET last_seen = ? WHERE id = ?", (time.time(), gateway_id))
        log.info("gateway connected", extra={"gateway_id": gateway_id})
        try:
            while True:
                frame = json.loads(await socket.receive_text())
                kind = frame.get("t")
                if kind == "res":
                    future = current.pending.pop(int(frame.get("id", 0)), None)
                    if future and not future.done():
                        future.set_result(frame)
                elif kind == "ws_msg":
                    client = current.streams.get(str(frame.get("sid")))
                    if client:
                        with contextlib.suppress(Exception):
                            await client.send_text(str(frame.get("data", "")))
                elif kind == "ws_close":
                    client = current.streams.pop(str(frame.get("sid")), None)
                    if client:
                        with contextlib.suppress(Exception):
                            await client.close(code=int(frame.get("code") or 1000))
        except (WebSocketDisconnect, ValueError, RuntimeError):
            pass
        finally:
            if relay.tunnels.get(gateway_id) is current:
                relay.tunnels.pop(gateway_id, None)
            for future in current.pending.values():
                if not future.done():
                    future.set_exception(ConnectionError("gateway disconnected"))
            for client in current.streams.values():
                with contextlib.suppress(Exception):
                    await client.close(code=1012)
            log.info("gateway disconnected", extra={"gateway_id": gateway_id})

    @app.api_route("/relay/v1/g/{gateway_id}/api/v1/{path:path}", methods=["GET", "POST", "PATCH", "PUT", "DELETE"])
    async def forward(request: Request, gateway_id: str, path: str) -> Response:
        if not relay.ip_limiter.check(ip_of(request)):
            return _error("rate_limited", "Too many requests; slow down.", 429)
        current = relay.tunnels.get(gateway_id)
        if current is None:
            known = GATEWAY_ID.match(gateway_id) and await db.fetchone("SELECT 1 FROM relay_gateways WHERE id = ?", (gateway_id,))
            return _error("gateway_offline", "The gateway is not connected to the relay.", 503) if known else _error("not_found", "Unknown gateway.", 404)
        body = await request.body()
        if len(body) > MAX_BODY:
            return _error("bad_request", "Request too large.", 413)
        request_id = next(current.ids)
        future: asyncio.Future = asyncio.get_running_loop().create_future()
        current.pending[request_id] = future
        await current.send(
            {
                "t": "req",
                "id": request_id,
                "method": request.method,
                "path": f"/api/v1/{path}",
                "query": request.url.query,
                "headers": {k: v for k, v in request.headers.items() if k.lower() in {"authorization", "content-type", "accept"}},
                "body": base64.b64encode(body).decode() if body else "",
            }
        )
        try:
            frame = await asyncio.wait_for(future, timeout=REQUEST_TIMEOUT)
        except (TimeoutError, ConnectionError):
            current.pending.pop(request_id, None)
            return _error("gateway_timeout", "The gateway did not answer in time.", 504)
        return Response(
            content=base64.b64decode(frame.get("body") or ""),
            status_code=int(frame.get("status") or 502),
            media_type=(frame.get("headers") or {}).get("content-type", "application/json"),
        )

    @app.websocket("/relay/v1/g/{gateway_id}/api/v1/events")
    async def events(socket: WebSocket, gateway_id: str) -> None:
        current = relay.tunnels.get(gateway_id)
        await socket.accept()
        if current is None:
            await socket.send_text(json.dumps({"type": "error", "code": "gateway_offline"}))
            await socket.close(code=1013)
            return
        sid = secrets.token_hex(8)
        current.streams[sid] = socket
        await current.send({"t": "ws_open", "sid": sid})
        try:
            while True:
                data = await socket.receive_text()
                await current.send({"t": "ws_msg", "sid": sid, "data": data[:4096]})
        except (WebSocketDisconnect, RuntimeError):
            pass
        finally:
            if current.streams.pop(sid, None) is not None:
                with contextlib.suppress(Exception):
                    await current.send({"t": "ws_close", "sid": sid})

    return app
