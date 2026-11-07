"""The versioned REST API and WebSocket events (see API.md). Every answer is an `{ok, data | error}` envelope."""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from starlette.exceptions import HTTPException as StarletteHTTPException

from . import API_VERSION, __version__, tunnel
from .adapters.base import AdapterError, AuthRequired, LocalKeyRequired, NotSupported, PairingRejected, UnsupportedCommand
from .catalog import build_brands
from .config import Settings
from .devices import DeviceError
from .gateway import Gateway
from .models import CommandRequest, GatewayProvisionRequest, PairingRequest, ProvisioningEvent
from .netutil import is_private_host, tailscale_addresses
from .provisioning.plugins import PLUGINS
from .relay.client import RELAY_CALLER
from .security import AuthError, Client, RateLimiter

log = logging.getLogger("cube.api")


def ok(data: Any, status: int = 200) -> JSONResponse:
    return JSONResponse({"ok": True, "data": data}, status_code=status)


def fail(code: str, message: str, status: int, recovery: str | None = None) -> JSONResponse:
    error: dict[str, Any] = {"code": code, "message": message}
    if recovery:
        error["recovery"] = recovery
    return JSONResponse({"ok": False, "error": error}, status_code=status)


def _adapter_status(error: AdapterError) -> int:
    if isinstance(error, AuthRequired | LocalKeyRequired | PairingRejected):
        return 409
    if isinstance(error, UnsupportedCommand | NotSupported) or error.code in {"adapter_unavailable", "unsupported_device"}:
        return 422
    if error.code in {"bad_params"}:
        return 400
    if error.code in {"device_unreachable", "adapter_timeout", "rethink_unreachable"}:
        return 504
    return 502


def dump(model: Any) -> Any:
    if isinstance(model, list):
        return [dump(m) for m in model]
    return json.loads(model.model_dump_json()) if hasattr(model, "model_dump_json") else model


# ---- request bodies ----


class ClaimBody(BaseModel):
    setup_code: str = Field(min_length=4, max_length=16)
    client_name: str = Field(default="Phone", max_length=64)


class JoinBody(BaseModel):
    invite_code: str = Field(min_length=4, max_length=16)
    client_name: str = Field(default="Phone", max_length=64)


class InviteBody(BaseModel):
    role: Literal["owner", "member"] = "member"


class ChallengeBody(BaseModel):
    client_id: str = Field(min_length=3, max_length=40)
    nonce: str = Field(min_length=16, max_length=128, pattern=r"^[A-Za-z0-9_-]+$")


class GatewayPatch(BaseModel):
    name: str = Field(min_length=1, max_length=48)


class DiscoveryBody(BaseModel):
    brand_id: str | None = Field(default=None, max_length=32)
    adapter_ids: list[str] | None = Field(default=None, max_length=20)
    timeout: float = Field(default=12, ge=3, le=60)
    subnet_scan: bool = True


class ProbeBody(BaseModel):
    host: str = Field(min_length=7, max_length=15)
    adapter_id: str | None = Field(default=None, max_length=40)


class SessionBody(BaseModel):
    plugin_id: str = Field(min_length=1, max_length=40)
    model: str | None = Field(default=None, max_length=40)


class DevicePatch(BaseModel):
    name: str | None = Field(default=None, max_length=64)
    room_id: str | None = Field(default=None, max_length=40)
    dashboard: bool | None = None
    model_config = {"extra": "forbid"}


class RoomBody(BaseModel):
    name: str = Field(min_length=1, max_length=40)


class RelayBody(BaseModel):
    url: str = Field(min_length=8, max_length=200, pattern=r"^https://")
    enroll_token: str | None = Field(default=None, max_length=200)


# ---- auth dependencies ----


def gw(request: Request) -> Gateway:
    return request.app.state.gw


def client_ip(request: Request) -> str:
    """The rate-limit key: the caller's address, or `relay:<caller's address>` for a request through the relay.

    Encrypted connections through the relay reach the HTTPS listener from a local socket; the relay client records
    which local address carries which caller (relay/client.py), so they count as relayed too."""
    if not request.client:
        return "unknown"
    relay = getattr(request.app.state.gw, "relay", None) if hasattr(request.app.state, "gw") else None
    caller = relay.callers.get((request.client.host, request.client.port)) if relay is not None else None
    return caller or request.client.host


def is_relayed(request: Request) -> bool:
    """True for requests the relay tunnel delivered. Only the tunnel sets this client host; a socket peer can't."""
    host = client_ip(request)
    return host == RELAY_CALLER or host.startswith(f"{RELAY_CALLER}:")


async def current_client(request: Request) -> Client:
    header = request.headers.get("authorization", "")
    token = header[7:].strip() if header.lower().startswith("bearer ") else None
    client = await gw(request).security.authenticate(token)
    request.state.client = client
    return client


async def owner(client: Annotated[Client, Depends(current_client)]) -> Client:
    if client.role != "owner":
        raise AuthError("forbidden", "Only the gateway's owner can do that.", 403)
    return client


AnyClient = Annotated[Client, Depends(current_client)]
Owner = Annotated[Client, Depends(owner)]


def limit(request: Request, limiter: RateLimiter, key: str) -> None:
    if not limiter.check(key):
        raise AuthError("rate_limited", "Too many attempts. Wait a minute and try again.", 429)


# ---- the app ----


def create_app(settings: Settings, gateway: Gateway | None = None) -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        instance = gateway or Gateway(settings)
        instance.app = app
        app.state.gw = instance
        await instance.start()
        try:
            yield
        finally:
            await instance.stop()

    app = FastAPI(title="CUBE Gateway", version=__version__, lifespan=lifespan, docs_url="/api/v1/docs", openapi_url="/api/v1/openapi.json", redoc_url=None)
    app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins, allow_credentials=False, allow_methods=["*"], allow_headers=["Authorization", "Content-Type"])
    command_limiter = RateLimiter(limit=40, window=10)

    @app.exception_handler(AuthError)
    async def _auth(_: Request, error: AuthError) -> JSONResponse:
        return fail(error.code, error.message, error.status)

    @app.exception_handler(DeviceError)
    async def _device(_: Request, error: DeviceError) -> JSONResponse:
        return fail(error.code, error.message, error.status, error.recovery)

    @app.exception_handler(AdapterError)
    async def _adapter(_: Request, error: AdapterError) -> JSONResponse:
        return fail(error.code, error.message, _adapter_status(error), error.recovery)

    @app.exception_handler(RequestValidationError)
    async def _validation(_: Request, error: RequestValidationError) -> JSONResponse:
        first = error.errors()[0] if error.errors() else {}
        where = ".".join(str(p) for p in first.get("loc", []) if p != "body")
        return fail("bad_request", f"{where or 'Request'}: {first.get('msg', 'invalid')}", 400)

    @app.exception_handler(StarletteHTTPException)
    async def _http(_: Request, error: StarletteHTTPException) -> JSONResponse:
        return fail("not_found" if error.status_code == 404 else "bad_request", str(error.detail), error.status_code)

    @app.exception_handler(Exception)
    async def _crash(request: Request, error: Exception) -> JSONResponse:
        log.exception("request failed", extra={"path": request.url.path})
        return fail("internal", "Something went wrong in the gateway. Its log has the details.", 500)

    v1 = APIRouter(prefix="/api/v1")

    # -- gateway and access --

    @v1.get("/health")
    async def health(request: Request) -> JSONResponse:
        g = gw(request)
        return ok(
            {
                "status": "ok",
                "version": __version__,
                "api_version": API_VERSION,
                "gateway_id": g.security.gateway_id,
                "name": g.security.name,
                "claimed": await g.security.is_claimed(),
                "uptime": round(time.time() - g.started_at),
                "adapters": {"loaded": len(g.registry.adapters), "failed": len(g.registry.failed)},
                # HTTPS addresses once the relay has issued a certificate (tls.py); the app prefers them.
                "tls": g.tls.public(),
            }
        )

    @v1.post("/identity/challenge")
    async def challenge(request: Request, body: ChallengeBody) -> JSONResponse:
        limit(request, gw(request).security.challenge_limiter, client_ip(request))
        g = gw(request)
        return ok({"gateway_id": g.security.gateway_id, "proof": await g.security.prove_identity(body.client_id, body.nonce)})

    def _session_payload(g: Gateway, client: Client, token: str, pin_key: str) -> dict[str, Any]:
        return {"client": {"id": client.id, "name": client.name, "role": client.role}, "token": token, "pin_key": pin_key, "gateway": {"id": g.security.gateway_id, "name": g.security.name}}

    @v1.post("/auth/claim")
    async def claim(request: Request, body: ClaimBody) -> JSONResponse:
        g = gw(request)
        # Checked here as well as in the relay client, so no spelling of the path can get round it.
        if is_relayed(request) and not g.settings.allow_remote_claim:
            raise AuthError("forbidden", "Not available through the relay. Pair the gateway on your home network first.", 403)
        limit(request, g.security.auth_limiter, client_ip(request))
        client, token, pin_key = await g.security.claim(body.setup_code, body.client_name)
        await g.advertise()
        return ok(_session_payload(g, client, token, pin_key), 201)

    @v1.post("/auth/join")
    async def join(request: Request, body: JoinBody) -> JSONResponse:
        g = gw(request)
        limit(request, g.security.auth_limiter, client_ip(request))
        client, token, pin_key = await g.security.join(body.invite_code, body.client_name)
        return ok(_session_payload(g, client, token, pin_key), 201)

    @v1.get("/auth/me")
    async def me(request: Request, client: AnyClient) -> JSONResponse:
        g = gw(request)
        return ok({"client": client.public(), "gateway": {"id": g.security.gateway_id, "name": g.security.name}})

    @v1.post("/auth/invites")
    async def invite(request: Request, body: InviteBody, client: Owner) -> JSONResponse:
        code, expires = await gw(request).security.create_invite(body.role, client.id)
        return ok({"code": code, "role": body.role, "expires_at": expires}, 201)

    @v1.get("/auth/clients")
    async def clients(request: Request, _: Owner) -> JSONResponse:
        return ok([c.public() for c in await gw(request).security.list_clients()])

    @v1.delete("/auth/clients/{client_id}")
    async def revoke(request: Request, client_id: str, client: Owner) -> JSONResponse:
        g = gw(request)
        if client_id == client.id:
            raise DeviceError("bad_request", "You cannot revoke the phone you are using; use another owner's phone.", 400)
        if not await g.security.revoke(client_id, client.id):
            raise DeviceError("not_found", "No such paired phone.", 404)
        g.bus.close_client(client_id)
        return ok({"revoked": client_id})

    @v1.patch("/gateway")
    async def rename_gateway(request: Request, body: GatewayPatch, _: Owner) -> JSONResponse:
        g = gw(request)
        await g.security.set_name(body.name.strip())
        await g.advertise()
        return ok({"id": g.security.gateway_id, "name": g.security.name})

    # -- catalog --

    @v1.get("/brands")
    async def brands(request: Request, _: AnyClient) -> JSONResponse:
        g = gw(request)
        return ok(dump(build_brands(g.registry, g.settings)))

    @v1.get("/adapters")
    async def adapters(request: Request, _: AnyClient) -> JSONResponse:
        return ok(dump(gw(request).registry.infos()))

    @v1.get("/provisioning/plugins")
    async def plugins(_: AnyClient) -> JSONResponse:
        return ok(
            [
                {
                    "id": p.id, "brand_id": p.brand_id, "adapter_id": p.adapter_id, "title": p.title, "description": p.description,
                    "transport": p.transport, "status": p.status, "supported_models": list(p.supported_models), "model_choices": list(p.model_choices),
                    "firmware": p.firmware, "auth_mechanisms": list(p.auth_mechanisms), "requirements": list(p.requirements),
                    "manufacturer_account": p.manufacturer_account, "hotspot_password": p.hotspot.kind, "user_approval": p.user_approval,
                    "local_control_after": p.local_control_after, "sources": list(p.sources),
                }
                for p in PLUGINS
            ]
        )

    # -- discovery --

    @v1.post("/discovery/jobs")
    async def start_job(request: Request, body: DiscoveryBody, _: Owner) -> JSONResponse:
        job = await gw(request).discovery.start(brand_id=body.brand_id, adapter_ids=body.adapter_ids, timeout=body.timeout, subnet_scan=body.subnet_scan)
        return ok(dump(job), 202)

    @v1.get("/discovery/jobs/{job_id}")
    async def get_job(request: Request, job_id: str, _: Owner) -> JSONResponse:
        job = gw(request).discovery.get(job_id)
        if not job:
            raise DeviceError("not_found", "No such scan.", 404)
        return ok(dump(job))

    @v1.delete("/discovery/jobs/{job_id}")
    async def cancel_job(request: Request, job_id: str, _: Owner) -> JSONResponse:
        job = await gw(request).discovery.cancel(job_id)
        if not job:
            raise DeviceError("not_found", "No such scan.", 404)
        return ok(dump(job))

    @v1.get("/discovery/candidates")
    async def candidates(request: Request, _: Owner, job_id: str | None = None, brand_id: str | None = None, adapter_id: str | None = None) -> JSONResponse:
        return ok(dump(gw(request).discovery.list(job_id=job_id, brand_id=brand_id, adapter_id=adapter_id)))

    @v1.post("/discovery/probe")
    async def probe(request: Request, body: ProbeBody, _: Owner) -> JSONResponse:
        if not is_private_host(body.host):
            raise DeviceError("bad_params", "Enter a private IPv4 address on your home network, e.g. 192.168.1.40.", 400)
        candidate = await gw(request).discovery.probe(body.host, body.adapter_id)
        if not candidate:
            raise DeviceError("not_found", f"No supported device answered at {body.host}.", 404, "Check the address in your router's device list and that the device is on.")
        return ok(dump(candidate))

    # -- pairing --

    @v1.post("/pairings")
    async def pair(request: Request, body: PairingRequest, _: Owner) -> JSONResponse:
        return ok(dump(await gw(request).pairings.start(body)), 202)

    @v1.get("/pairings/{pairing_id}")
    async def get_pairing(request: Request, pairing_id: str, _: Owner) -> JSONResponse:
        pairing = gw(request).pairings.get(pairing_id)
        if not pairing:
            raise DeviceError("not_found", "No such pairing.", 404)
        return ok(dump(pairing))

    # -- provisioning --

    @v1.post("/provisioning/sessions")
    async def new_session(request: Request, body: SessionBody, client: Owner) -> JSONResponse:
        session = await gw(request).provisioning.create(body.plugin_id, body.model)
        await gw(request).db.audit("provisioning.started", client.id, target=session.id, plugin=body.plugin_id)
        return ok(dump(session), 201)

    @v1.get("/provisioning/sessions/{session_id}")
    async def get_session(request: Request, session_id: str, _: Owner) -> JSONResponse:
        return ok(dump(gw(request).provisioning.get(session_id)))

    @v1.post("/provisioning/sessions/{session_id}/events")
    async def session_event(request: Request, session_id: str, body: ProvisioningEvent, _: Owner) -> JSONResponse:
        return ok(dump(await gw(request).provisioning.event(session_id, body)))

    @v1.post("/provisioning/sessions/{session_id}/run")
    async def session_run(request: Request, session_id: str, body: GatewayProvisionRequest, _: Owner) -> JSONResponse:
        return ok(dump(await gw(request).provisioning.run_on_gateway(session_id, body)), 202)

    @v1.delete("/provisioning/sessions/{session_id}")
    async def session_cancel(request: Request, session_id: str, _: Owner) -> JSONResponse:
        return ok(dump(await gw(request).provisioning.cancel(session_id)))

    # -- devices and rooms --

    @v1.get("/devices")
    async def devices(request: Request, _: AnyClient) -> JSONResponse:
        return ok(dump(gw(request).devices.list()))

    @v1.get("/devices/{device_id}")
    async def device(request: Request, device_id: str, _: AnyClient) -> JSONResponse:
        return ok(dump(gw(request).devices.get(device_id)))

    @v1.patch("/devices/{device_id}")
    async def patch_device(request: Request, device_id: str, body: DevicePatch, _: Owner) -> JSONResponse:
        fields = body.model_dump(exclude_unset=True)
        clear_room = "room_id" in fields and fields["room_id"] is None
        updated = await gw(request).devices.update(device_id, name=fields.get("name"), room_id=fields.get("room_id"), dashboard=fields.get("dashboard"), clear_room=clear_room)
        return ok(dump(updated))

    @v1.delete("/devices/{device_id}")
    async def delete_device(request: Request, device_id: str, _: Owner) -> JSONResponse:
        await gw(request).devices.remove(device_id)
        return ok({"removed": device_id})

    @v1.post("/devices/{device_id}/commands")
    async def command(request: Request, device_id: str, body: CommandRequest, client: AnyClient) -> JSONResponse:
        limit(request, command_limiter, client.id)
        updated, result = await gw(request).devices.command(device_id, body, client.id)
        return ok({"device": dump(updated), "result": dump(result)})

    @v1.post("/devices/{device_id}/refresh")
    async def refresh(request: Request, device_id: str, _: AnyClient) -> JSONResponse:
        return ok(dump(await gw(request).devices.refresh(device_id)))

    @v1.get("/rooms")
    async def rooms(request: Request, _: AnyClient) -> JSONResponse:
        return ok(dump(gw(request).devices.room_list()))

    @v1.post("/rooms")
    async def create_room(request: Request, body: RoomBody, _: Owner) -> JSONResponse:
        return ok(dump(await gw(request).devices.create_room(body.name)), 201)

    @v1.patch("/rooms/{room_id}")
    async def rename_room(request: Request, room_id: str, body: RoomBody, _: Owner) -> JSONResponse:
        return ok(dump(await gw(request).devices.rename_room(room_id, body.name)))

    @v1.delete("/rooms/{room_id}")
    async def delete_room(request: Request, room_id: str, _: Owner) -> JSONResponse:
        await gw(request).devices.delete_room(room_id)
        return ok({"removed": room_id})

    # -- remote access --

    @v1.get("/remote")
    async def remote(request: Request, _: Owner) -> JSONResponse:
        g = gw(request)
        relay = g.relay
        return ok(
            {
                "tunnel": tunnel.status(g.settings),
                "tailscale": {"detected": bool(tailscale_addresses()), "addresses": tailscale_addresses(), "port": g.settings.port},
                "relay": {
                    "configured": relay is not None,
                    "url": relay.url if relay else None,
                    "connected": bool(relay and relay.connected),
                    "public_url": relay.public_url if relay else None,
                    "last_error": relay.last_error if relay else None,
                },
            }
        )

    @v1.put("/remote/relay")
    async def set_relay(request: Request, body: RelayBody, client: Owner) -> JSONResponse:
        from .relay.client import enroll

        g = gw(request)
        await enroll(g, body.url.rstrip("/"), body.enroll_token)
        await g.db.audit("remote.relay_enabled", client.id, url=body.url)
        return await remote(request, client)

    @v1.delete("/remote/relay")
    async def clear_relay(request: Request, client: Owner) -> JSONResponse:
        g = gw(request)
        if g.relay:
            await g.relay.stop()
            g.relay = None
        await g.db.delete_meta("relay_url")
        await g.db.delete_meta("relay_secret")
        await g.db.audit("remote.relay_disabled", client.id)
        return await remote(request, client)

    app.include_router(v1)

    # -- events --

    @app.websocket("/api/v1/events")
    async def events(socket: WebSocket) -> None:
        await socket.accept()
        g: Gateway = socket.app.state.gw
        try:
            first = await asyncio.wait_for(socket.receive_json(), timeout=10)
            token = first.get("token") if isinstance(first, dict) and first.get("type") == "auth" else None
            client = await g.security.authenticate(token if isinstance(token, str) else None)
        except (AuthError, TimeoutError, ValueError, WebSocketDisconnect):
            with contextlib.suppress(Exception):
                await socket.send_json({"type": "error", "code": "unauthorized"})
                await socket.close(code=4401)
            return
        await serve_events(g, client, socket.send_json, socket.receive_text)
        with contextlib.suppress(Exception):
            await socket.close()

    return app


async def serve_events(g: Gateway, client: Client, send, receive) -> None:
    """Pushes the event stream to one authenticated client until it disconnects or is revoked.
    Shared by the local WebSocket and the relay tunnel."""
    sub = g.bus.subscribe(client.id)
    try:
        await send({"type": "ready", "data": {"gateway_id": g.security.gateway_id, "role": client.role}, "at": time.time()})

        async def reader() -> None:
            while True:
                await receive()  # pings and anything else from the client are ignored

        reading = asyncio.create_task(reader())
        try:
            while True:
                upcoming = asyncio.ensure_future(sub.next())
                done, _ = await asyncio.wait({upcoming, reading}, return_when=asyncio.FIRST_COMPLETED)
                if reading in done:
                    upcoming.cancel()
                    break
                event = upcoming.result()
                if event is None:
                    break
                await send(json.loads(event.model_dump_json()))
                if event.type == "client.revoked":
                    break
        finally:
            reading.cancel()
    except (WebSocketDisconnect, RuntimeError, ConnectionError):
        pass
    finally:
        sub.close()
