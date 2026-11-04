"""The gateway's side of the optional remote relay.

The gateway opens one outbound WebSocket to the relay and keeps it open; no port on the home router is
opened. The relay forwards app requests addressed to this gateway through that tunnel, and the gateway runs
them against its own API, so its own authentication decides everything: the relay never holds client
tokens' meaning or device credentials. Ownership is only ever claimed on the home network: /auth/claim is
refused through the relay.

Frames (JSON): relay->gateway `req` {id, method, path, query, headers, body(b64)}, `ws_open` {sid},
`ws_msg` {sid, data}, `ws_close` {sid}; gateway->relay `res` {id, status, headers, body}, `ws_msg`, `ws_close`.

Limitation: TLS ends at the relay, so the relay operator could read traffic in transit. For end-to-end
encryption use Tailscale/WireGuard instead (docs/CUBE_GATEWAY.md, Remote access).
"""

from __future__ import annotations

import asyncio
import base64
import contextlib
import json
import logging
from typing import TYPE_CHECKING, Any

import httpx

if TYPE_CHECKING:
    from ..gateway import Gateway

log = logging.getLogger("cube.relay.client")
FORWARD_HEADERS = {"authorization", "content-type", "accept"}
BLOCKED_PATHS = {"/api/v1/auth/claim"}


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


class RelayClient:
    def __init__(self, gateway: Gateway, url: str, secret: str):
        self.gateway = gateway
        self.url = url.rstrip("/")
        self.secret = secret
        self.connected = False
        self.last_error: str | None = None
        self._task: asyncio.Task | None = None
        self._streams: dict[str, asyncio.Queue[str | None]] = {}
        self._send_lock = asyncio.Lock()
        self._socket: Any = None

    @property
    def public_url(self) -> str:
        return f"{self.url}/relay/v1/g/{self.gateway.security.gateway_id}"

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
                        asyncio.create_task(self._handle(frame))
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
            await self._send(await self.forward(frame))
        elif kind == "ws_open":
            sid = str(frame.get("sid"))
            self._streams[sid] = asyncio.Queue(maxsize=64)
            asyncio.create_task(self._serve_stream(sid))
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
        if not path.startswith("/api/v1/") or path in BLOCKED_PATHS or path == "/api/v1/events":
            body = {"ok": False, "error": {"code": "forbidden", "message": "Not available through the relay. Pair the gateway on your home network first."}}
            return {"t": "res", "id": request_id, "status": 403, "headers": {"content-type": "application/json"}, "body": base64.b64encode(json.dumps(body).encode()).decode()}
        headers = {k.lower(): str(v) for k, v in (frame.get("headers") or {}).items() if k.lower() in FORWARD_HEADERS}
        content = base64.b64decode(frame.get("body") or "") if frame.get("body") else None
        transport = httpx.ASGITransport(app=self.gateway.app, client=("relay", 0))
        async with httpx.AsyncClient(transport=transport, base_url="http://gateway") as client:
            response = await client.request(str(frame.get("method") or "GET"), path, params=str(frame.get("query") or ""), headers=headers, content=content, timeout=60)
        return {
            "t": "res",
            "id": request_id,
            "status": response.status_code,
            "headers": {"content-type": response.headers.get("content-type", "application/json")},
            "body": base64.b64encode(response.content).decode(),
        }

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
