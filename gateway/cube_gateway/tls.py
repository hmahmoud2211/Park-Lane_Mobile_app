"""The gateway's HTTPS: its key, its certificate from the relay, and the listener that serves the API over TLS.

- The key (EC P-256) is made once in DATA_DIR/tls/key.pem (0600) and never leaves the gateway.
- The relay issues the certificate (relay/tls.py). The gateway asks `GET /relay/v1/tls` for its names, sends a CSR
  and its home address to `POST /relay/v1/tls/certificate`, and keeps DATA_DIR/tls/cert.pem. It renews when a third
  of the certificate's life is left, and tells the relay when its home address changes (`POST /relay/v1/tls/address`)
  so the home name keeps pointing at it.
- The listener is a second uvicorn server for the same app, on CUBE_TLS_PORT (8688), opened once a certificate
  exists. A renewed certificate is loaded into it in place: new connections get it straight away.
- Through the relay, encrypted connections arrive from the tunnel on a local socket (relay/client.py). It records
  each one's local address with the real caller, so the API rate-limits them and refuses claims for them like any
  other request through the relay (api.client_ip).

Without a relay that issues certificates the gateway keeps plain HTTP only, as before.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import os
import socket
import time
from typing import TYPE_CHECKING, Any

import httpx
import uvicorn
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization

from .relay.acme import load_or_create_key

if TYPE_CHECKING:
    from .gateway import Gateway

log = logging.getLogger("cube.tls")
#: How often the gateway checks its certificate and home address.
CHECK_EVERY = 300.0
#: How often it asks the relay for its names again.
NAMES_EVERY = 6 * 3600.0
#: After a failure, wait this long before the next certificate attempt (the relay rate-limits issuance too).
RETRY_AFTER_FAILURE = 1800.0


class _QuietServer(uvicorn.Server):
    """A second uvicorn server in the same process: it must not take SIGINT/SIGTERM away from the main one."""

    @contextlib.contextmanager
    def capture_signals(self):  # type: ignore[override]
        yield


class TlsManager:
    def __init__(self, gateway: Gateway):
        self.gateway = gateway
        self.dir = gateway.settings.data_dir / "tls"
        self.key_path = self.dir / "key.pem"
        self.cert_path = self.dir / "cert.pem"
        #: {"lan": name or None, "remote": name or None, "remote_port": int}, as the relay last gave them.
        self.names: dict[str, Any] = {}
        self.not_after: float | None = None
        self.not_before: float | None = None
        self.cert_names: list[str] = []
        self.port: int | None = None
        self.bind_host: str | None = None
        self.last_error: str | None = None
        self._server: _QuietServer | None = None
        self._server_task: asyncio.Task | None = None
        self._loop_task: asyncio.Task | None = None
        self._names_at = 0.0
        self._next_issue = 0.0
        self._reported_address: str | None = None

    # ---- lifecycle ----

    async def load(self) -> None:
        stored = await self.gateway.db.get_meta("tls_names")
        self.names = json.loads(stored) if stored else {}
        if self.cert_path.exists() and self.key_path.exists():
            self._read_certificate()
            if self.not_after and self.not_after > time.time():
                await self._listen()

    def start(self) -> None:
        if self._loop_task is None:
            self._loop_task = asyncio.create_task(self._loop(), name="tls-renewal")

    async def stop(self) -> None:
        if self._loop_task:
            self._loop_task.cancel()
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await self._loop_task
            self._loop_task = None
        if self._server is not None:
            self._server.should_exit = True
            if self._server_task:
                with contextlib.suppress(asyncio.CancelledError, Exception):
                    await asyncio.wait_for(self._server_task, 10)
            self._server = None
            self.port = None

    def public(self) -> dict[str, Any] | None:
        """What /health tells the app: the HTTPS addresses this gateway can be reached at, if any."""
        if self.port is None or not (self.names.get("lan") or self.names.get("remote")):
            return None
        lan = self.names.get("lan") if self.names.get("lan") in self.cert_names and self._lan_listener() else None
        remote = self.names.get("remote") if self.names.get("remote") in self.cert_names else None
        if not lan and not remote:
            return None
        port = int(self.names.get("remote_port") or 443)
        remote_url = (f"https://{remote}" if port == 443 else f"https://{remote}:{port}") if remote else None
        return {"lan_url": f"https://{lan}:{self.port}" if lan else None, "remote_url": remote_url, "expires_at": self.not_after}

    def local_address(self) -> tuple[str, int] | None:
        """Where the relay tunnel connects to reach the listener on this machine."""
        if self.port is None or self.bind_host is None:
            return None
        host = {"0.0.0.0": "127.0.0.1", "::": "::1", "": "127.0.0.1"}.get(self.bind_host, self.bind_host)
        return host, self.port

    def _lan_listener(self) -> bool:
        settings = self.gateway.settings
        return not settings.server_hosted and self.bind_host not in {"127.0.0.1", "::1", "localhost"}

    # ---- the listener ----

    async def _listen(self) -> None:
        settings = self.gateway.settings
        bind = "127.0.0.1" if settings.server_hosted or settings.tls_port == 0 else (settings.host or "0.0.0.0")
        family = socket.AF_INET6 if ":" in bind else socket.AF_INET
        sock = socket.socket(family, socket.SOCK_STREAM)
        try:
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            sock.bind((bind, settings.tls_port))
        except OSError as error:
            sock.close()
            self.last_error = f"HTTPS port {settings.tls_port} is in use: {error}"
            log.warning("could not open the HTTPS listener; serving plain HTTP only", extra={"port": settings.tls_port, "reason": str(error)})
            return
        config = uvicorn.Config(
            self.gateway.app, host=bind, port=sock.getsockname()[1], ssl_keyfile=str(self.key_path), ssl_certfile=str(self.cert_path),
            lifespan="off", log_config=None, access_log=False, ws="websockets-sansio", proxy_headers=False, timeout_graceful_shutdown=5,
        )
        config.load()  # here rather than inside serve(), so a bad certificate raises in this task
        server = _QuietServer(config)
        self._server = server
        self._server_task = asyncio.create_task(server.serve(sockets=[sock]), name="https")
        for _ in range(100):
            if server.started or self._server_task.done():
                break
            await asyncio.sleep(0.05)
        self.port = sock.getsockname()[1]
        self.bind_host = bind
        log.info("HTTPS listener ready", extra={"port": self.port, "names": self.cert_names})

    def _reload(self) -> None:
        """New connections get the renewed certificate; open ones keep theirs."""
        if self._server is not None and self._server.config.ssl is not None:
            self._server.config.ssl.load_cert_chain(str(self.cert_path), str(self.key_path))
            log.info("HTTPS certificate reloaded", extra={"not_after": self.not_after})

    # ---- the certificate ----

    def _read_certificate(self) -> None:
        try:
            leaf = x509.load_pem_x509_certificate(self.cert_path.read_bytes())
        except (OSError, ValueError):
            self.not_after = self.not_before = None
            self.cert_names = []
            return
        self.not_after = leaf.not_valid_after_utc.timestamp()
        self.not_before = leaf.not_valid_before_utc.timestamp()
        try:
            self.cert_names = sorted(leaf.extensions.get_extension_for_class(x509.SubjectAlternativeName).value.get_values_for_type(x509.DNSName))
        except x509.ExtensionNotFound:
            self.cert_names = []
        key = load_or_create_key(self.key_path)
        spki = serialization.PublicFormat.SubjectPublicKeyInfo
        if leaf.public_key().public_bytes(serialization.Encoding.DER, spki) != key.public_key().public_bytes(serialization.Encoding.DER, spki):
            self.not_after = None  # a certificate for another key is worthless: ask again

    def needs_certificate(self, wanted: list[str]) -> bool:
        if not wanted:
            return False
        # A certificate naming more than needed is fine (a home address that briefly can't be read mustn't cost an issue).
        if self.not_after is None or self.not_before is None or not set(wanted) <= set(self.cert_names):
            return True
        lifetime = max(self.not_after - self.not_before, 86400)
        return self.not_after - time.time() < lifetime / 3

    def csr(self, names: list[str]) -> str:
        key = load_or_create_key(self.key_path)
        request = (
            x509.CertificateSigningRequestBuilder()
            .subject_name(x509.Name([]))
            .add_extension(x509.SubjectAlternativeName([x509.DNSName(n) for n in names]), critical=False)
            .sign(key, hashes.SHA256())
        )
        return request.public_bytes(serialization.Encoding.PEM).decode()

    def _install(self, chain: str) -> None:
        self.dir.mkdir(parents=True, exist_ok=True)
        temporary = self.cert_path.with_suffix(".tmp")
        temporary.write_text(chain)
        os.replace(temporary, self.cert_path)
        self._read_certificate()

    # ---- talking to the relay ----

    async def _loop(self) -> None:
        await asyncio.sleep(3)  # let the relay tunnel connect first
        while True:
            try:
                await self.refresh()
            except asyncio.CancelledError:
                raise
            except Exception as error:  # noqa: BLE001 - plain HTTP keeps working; try again later
                self.last_error = getattr(error, "message", None) or str(error) or type(error).__name__
                self._next_issue = time.time() + RETRY_AFTER_FAILURE
                log.warning("HTTPS certificate check failed", extra={"reason": self.last_error})
            await asyncio.sleep(CHECK_EVERY)

    async def refresh(self) -> None:
        """One check: names from the relay, a certificate when one is due, and the home address."""
        relay = self.gateway.relay
        if relay is None or not relay.connected:
            return
        auth = {"Authorization": f"Bearer {self.gateway.security.gateway_id}.{relay.secret}"}
        lan_ip = None if self.gateway.settings.server_hosted else self.gateway.address()
        async with httpx.AsyncClient(timeout=30) as http:
            if not self.names or time.time() - self._names_at > NAMES_EVERY:
                response = await http.get(f"{relay.url}/relay/v1/tls", headers=auth)
                if response.status_code in {404, 501}:
                    self._names_at = time.time()  # this relay doesn't issue certificates; ask again later
                    self.last_error = "The relay doesn't issue gateway certificates."
                    return
                response.raise_for_status()
                names = response.json()["data"]
                self.names = {"lan": names.get("lan"), "remote": names.get("remote"), "remote_port": int(names.get("remote_port") or 443)}
                self._names_at = time.time()
                await self.gateway.db.set_meta("tls_names", json.dumps(self.names))
            wanted = sorted(n for n in (self.names.get("lan") if lan_ip else None, self.names.get("remote")) if n)
            if self.needs_certificate(wanted) and time.time() >= self._next_issue:
                response = await http.post(f"{relay.url}/relay/v1/tls/certificate", json={"csr": self.csr(wanted), "lan_ip": lan_ip}, headers=auth, timeout=300)
                body = response.json()
                if not body.get("ok"):
                    raise RuntimeError((body.get("error") or {}).get("message") or f"HTTP {response.status_code}")
                self._install(body["data"]["certificate"])
                self._reported_address = lan_ip
                self.last_error = None
                if self._server is None:
                    await self._listen()
                else:
                    self._reload()
                log.info("HTTPS certificate installed", extra={"names": self.cert_names, "not_after": self.not_after})
            elif lan_ip and self.names.get("lan") and lan_ip != self._reported_address:
                response = await http.post(f"{relay.url}/relay/v1/tls/address", json={"lan_ip": lan_ip}, headers=auth)
                if response.status_code < 400:
                    self._reported_address = lan_ip
