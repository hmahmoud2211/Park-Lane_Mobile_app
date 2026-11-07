"""The gateway's side of the optional remote relay.

The gateway opens one outbound WebSocket to the relay and keeps it open; no port on the home router is
opened. The relay forwards app requests addressed to this gateway through that tunnel, and the gateway runs
them against its own API, so its own authentication decides everything: the relay never holds client
tokens' meaning or device credentials. Ownership is only ever claimed on the home network: /auth/claim is
refused through the relay.

Frames (JSON): relay->gateway `req` {id, method, path, query, headers, body(b64)}, `ws_open` {sid},
`ws_msg` {sid, data}, `ws_close` {sid}; gateway->relay `res` {id, status, headers, body}, `ws_msg`, `ws_close`.

This HTTP route ends TLS at the relay, so the relay operator could read it in transit. The tcp_* frames carry the
end-to-end route instead: TLS connections the relay passes through unread to the gateway's HTTPS listener
(relay/tls.py, tls.py). Older apps keep using the HTTP route.
"""

from __future__ import annotations

import asyncio
import base64
import contextlib
import ipaddress
import json
import logging
import re
from typing import TYPE_CHECKING, Any

import httpx

from ..tasks import spawn

if TYPE_CHECKING:
    from ..gateway import Gateway

log = logging.getLogger("cube.relay.client")
FORWARD_HEADERS = {"authorization", "content-type", "accept"}
BLOCKED_PATHS = {"/api/v1/auth/claim"}
#: Every API path is plain segments of these characters (ids are prefix_hex). Anything else (percent escapes,
#: `?`, `#`, `.`/`..` segments, empty segments, a trailing slash) is refused, so the path checked here is exactly
#: the path the gateway's router will run: nothing can be decoded or normalised into a blocked one.
SAFE_PATH = re.compile(r"^/api/v1(?:/[A-Za-z0-9_-][A-Za-z0-9_.-]*)+$")
#: Pass-through TLS connections one gateway carries at once.
MAX_TCP_STREAMS = 64
#: The ASGI client host of a relayed request: `relay:<caller ip>` when the relay names the caller, else `relay`.
RELAY_CALLER = "relay"


def relay_caller(frame: dict[str, Any]) -> str:
    """Who a relayed request comes from, so rate limits apply per caller rather than to the relay as a whole."""
    try:
        return f"{RELAY_CALLER}:{ipaddress.ip_address(str(frame.get('client') or ''))}"
    except ValueError:
        return RELAY_CALLER


def _close_queue(queue: asyncio.Queue[Any]) -> None:
    """Ends a stream's queue even when it is full (the reader then stops at the None)."""
    while True:
        try:
            queue.put_nowait(None)
            return
        except asyncio.QueueFull:
            with contextlib.suppress(asyncio.QueueEmpty):
                queue.get_nowait()


def _response(request_id: Any, status: int, code: str, message: str) -> dict[str, Any]:
    body = {"ok": False, "error": {"code": code, "message": message}}
    return {"t": "res", "id": request_id, "status": status, "headers": {"content-type": "application/json"}, "body": base64.b64encode(json.dumps(body).encode()).decode()}


def gateway_url(relay_url: str, gateway_id: str) -> str:
    """Where apps reach a gateway through the relay."""
    return f"{relay_url}/relay/v1/g/{gateway_id}"


async def enroll(gateway: Gateway, url: str, enroll_token: str | None) -> None:
    """Registers this gateway with a relay and starts the tunnel. The relay's secret is stored sealed."""
    from ..devices import DeviceError

    headers = {"Authorization": f"Bearer {enroll_token}"} if enroll_token else {}
    existing = await gateway.db.get_meta("relay_secret")
    body: dict[str, Any] = {"gateway_id": gateway.security.gateway_id}
    if existing and (await gateway.db.get_meta("relay_url")) == url:
        body["secret"] = gateway.sealer.unseal(existing, "relay")
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            response = await client.post(f"{url}/relay/v1/gateways", json=body, headers=headers)
    except httpx.HTTPError as error:
        raise DeviceError("relay_unreachable", "The relay could not be reached.", 502, "Check the relay URL and that it is online.") from error
    try:
        payload = response.json()
    except ValueError as error:
        raise DeviceError("relay_rejected", f"The relay answered {response.status_code}.", 502) from error
    if not payload.get("ok"):
        message = (payload.get("error") or {}).get("message") or "The relay refused to enrol this gateway."
        raise DeviceError("relay_rejected", message, 502)
    secret = payload["data"]["secret"]
    await gateway.db.set_meta("relay_url", url)
    await gateway.db.set_meta("relay_secret", gateway.sealer.seal(secret, "relay"))
    if gateway.relay:
        await gateway.relay.stop()
    gateway.relay = RelayClient(gateway, url, secret)
    gateway.relay.start()
    if getattr(gateway, "cloud", None) is not None:
        gateway.cloud.wake()


class RelayClient:
    def __init__(self, gateway: Gateway, url: str, secret: str):
        self.gateway = gateway
        self.url = url.rstrip("/")
        self.secret = secret
        self.connected = False
        self.last_error: str | None = None
        self._task: asyncio.Task | None = None
        self._streams: dict[str, asyncio.Queue[str | None]] = {}
        #: Pass-through TLS connections (tcp_* frames): bytes from the relay for each stream, in order.
        self._tcp: dict[str, asyncio.Queue[bytes | None]] = {}
        #: Local socket address of each pass-through connection -> its caller (`relay:<ip>`), for api.client_ip.
        self.callers: dict[tuple[str, int], str] = {}
        self._send_lock = asyncio.Lock()
        self._socket: Any = None

    @property
    def public_url(self) -> str:
        return gateway_url(self.url, self.gateway.security.gateway_id)

    def start(self) -> None:
        if self._task is None:
            self._task = asyncio.create_task(self._run())

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await self._task
            self._task = None
        self.connected = False

    async def _run(self) -> None:
        from websockets.asyncio.client import connect

        backoff = 2.0
        tunnel = self.url.replace("https://", "wss://", 1).replace("http://", "ws://", 1) + "/relay/v1/tunnel"
        while True:
            try:
                async with connect(
                    tunnel,
                    additional_headers={"Authorization": f"Bearer {self.gateway.security.gateway_id}.{self.secret}"},
                    max_size=2 * 1024 * 1024,
                    ping_interval=20,
                    ping_timeout=20,
                ) as socket:
                    self._socket = socket
                    self.connected = True
                    self.last_error = None
                    backoff = 2.0
                    log.info("relay tunnel open", extra={"relay": self.url})
                    async for raw in socket:
                        try:
                            frame = json.loads(raw)
                        except ValueError:
                            continue
                        if str(frame.get("t", "")).startswith("tcp_"):
                            self._tcp_frame(frame)  # in arrival order: these carry a byte stream
                        else:
                            spawn(self._handle(frame), name="relay-frame")
            except asyncio.CancelledError:
                raise
            except Exception as error:  # noqa: BLE001
                self.last_error = str(error) or type(error).__name__
                log.warning("relay tunnel closed; retrying", extra={"reason": self.last_error, "retry_in": backoff})
            finally:
                self.connected = False
                self._socket = None
                for queue in self._streams.values():
                    queue.put_nowait(None)
                self._streams.clear()
                for tcp in self._tcp.values():
                    _close_queue(tcp)
                self._tcp.clear()
            await asyncio.sleep(backoff)
            backoff = min(120.0, backoff * 2)

    async def _send(self, frame: dict[str, Any]) -> None:
        socket = self._socket
        if socket is None:
            return
        async with self._send_lock:
            await socket.send(json.dumps(frame))

    async def _handle(self, frame: dict[str, Any]) -> None:
        kind = frame.get("t")
        if kind == "req":
            try:
                reply = await self.forward(frame)
            except Exception:  # noqa: BLE001 - the relay must always get an answer, not wait out its timeout
                log.exception("relayed request failed", extra={"path": str(frame.get("path") or "")[:120]})
                reply = _response(frame.get("id"), 502, "internal", "The gateway could not handle this request. Its log has the details.")
            await self._send(reply)
        elif kind == "ws_open":
            sid = str(frame.get("sid"))
            self._streams[sid] = asyncio.Queue(maxsize=64)
            spawn(self._serve_stream(sid), name="relay-stream")
        elif kind == "ws_msg":
            queue = self._streams.get(str(frame.get("sid")))
            if queue and not queue.full():
                queue.put_nowait(str(frame.get("data", ""))[:4096])
        elif kind == "ws_close":
            queue = self._streams.pop(str(frame.get("sid")), None)
            if queue:
                queue.put_nowait(None)
        elif kind == "ping":
            await self._send({"t": "pong"})

    async def forward(self, frame: dict[str, Any]) -> dict[str, Any]:
        """Runs one relayed request against the gateway's own API (public for tests)."""
        request_id = frame.get("id")
        path = str(frame.get("path") or "")
        if not SAFE_PATH.match(path):
            return _response(request_id, 400, "bad_request", "That is not a gateway API address.")
        blocked = set() if self.gateway.settings.allow_remote_claim else BLOCKED_PATHS
        if path in blocked or path == "/api/v1/events":
            return _response(request_id, 403, "forbidden", "Not available through the relay. Pair the gateway on your home network first.")
        headers = {k.lower(): str(v) for k, v in (frame.get("headers") or {}).items() if k.lower() in FORWARD_HEADERS}
        content = base64.b64decode(frame.get("body") or "") if frame.get("body") else None
        # A crash inside a route becomes the gateway's own 500 answer instead of an exception here.
        transport = httpx.ASGITransport(app=self.gateway.app, client=(relay_caller(frame), 0), raise_app_exceptions=False)
        async with httpx.AsyncClient(transport=transport, base_url="http://gateway") as client:
            response = await client.request(str(frame.get("method") or "GET"), path, params=str(frame.get("query") or ""), headers=headers, content=content, timeout=60)
        return {
            "t": "res",
            "id": request_id,
            "status": response.status_code,
            "headers": {"content-type": response.headers.get("content-type", "application/json")},
            "body": base64.b64encode(response.content).decode(),
        }

    # ---- pass-through TLS (relay/tls.py): bytes the relay can't read, to and from the HTTPS listener ----

    def _tcp_frame(self, frame: dict[str, Any]) -> None:
        sid, kind = str(frame.get("sid")), frame.get("t")
        if kind == "tcp_open":
            tls = getattr(self.gateway, "tls", None)
            target = tls.local_address() if tls is not None else None
            if target is None or len(self._tcp) >= MAX_TCP_STREAMS:
                spawn(self._send({"t": "tcp_close", "sid": sid}), name="relay-tcp-refuse")
                return
            queue: asyncio.Queue[bytes | None] = asyncio.Queue(maxsize=256)
            self._tcp[sid] = queue
            spawn(self._serve_tcp(sid, queue, target, relay_caller(frame)), name="relay-tcp")
        elif kind == "tcp_data":
            queue = self._tcp.get(sid)
            if queue is None:
                return
            try:
                queue.put_nowait(base64.b64decode(frame.get("data") or ""))
            except (ValueError, asyncio.QueueFull):
                self._tcp.pop(sid, None)
                _close_queue(queue)
        elif kind == "tcp_close":
            queue = self._tcp.pop(sid, None)
            if queue is not None:
                _close_queue(queue)

    async def _serve_tcp(self, sid: str, queue: asyncio.Queue[bytes | None], target: tuple[str, int], caller: str) -> None:
        try:
            reader, writer = await asyncio.wait_for(asyncio.open_connection(*target), 5)
        except (OSError, TimeoutError):
            if self._tcp.pop(sid, None) is not None:
                await self._send({"t": "tcp_close", "sid": sid})
            return
        local = writer.get_extra_info("sockname")
        key = (str(local[0]), int(local[1]))
        self.callers[key] = caller  # before any byte reaches the listener

        async def upstream() -> None:
            try:
                while (data := await queue.get()) is not None:
                    writer.write(data)
                    await writer.drain()
            except (ConnectionError, OSError):
                pass
            finally:
                writer.close()

        sending = asyncio.create_task(upstream())
        try:
            while chunk := await reader.read(16 * 1024):
                await self._send({"t": "tcp_data", "sid": sid, "data": base64.b64encode(chunk).decode()})
        except (ConnectionError, OSError):
            pass
        finally:
            sending.cancel()
            with contextlib.suppress(Exception):
                writer.close()
            self.callers.pop(key, None)
            if self._tcp.pop(sid, None) is not None:
                with contextlib.suppress(Exception):
                    await self._send({"t": "tcp_close", "sid": sid})

    async def _serve_stream(self, sid: str) -> None:
        from ..api import serve_events
        from ..security import AuthError

        queue = self._streams[sid]
        try:
            first = await asyncio.wait_for(queue.get(), timeout=10)
            message = json.loads(first or "{}")
            client = await self.gateway.security.authenticate(message.get("token") if message.get("type") == "auth" else None)
        except (AuthError, TimeoutError, ValueError, AttributeError):
            await self._send({"t": "ws_msg", "sid": sid, "data": json.dumps({"type": "error", "code": "unauthorized"})})
            await self._send({"t": "ws_close", "sid": sid, "code": 4401})
            self._streams.pop(sid, None)
            return

        async def send(obj: dict[str, Any]) -> None:
            await self._send({"t": "ws_msg", "sid": sid, "data": json.dumps(obj)})

        async def receive() -> str:
            item = await queue.get()
            if item is None:
                raise ConnectionError("stream closed")
            return item

        await serve_events(self.gateway, client, send, receive)
        self._streams.pop(sid, None)
        await self._send({"t": "ws_close", "sid": sid})
