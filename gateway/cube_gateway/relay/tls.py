"""The relay's half of gateway HTTPS: certificates for gateways, and the pass-through listener.

Each enrolled gateway may hold a Let's Encrypt certificate for two names:
- `<gateway id>.<lan zone>`, pointed at its private home address, so the app reaches it at home by HTTPS;
- `<gateway id>.<remote zone>`, covered by one wildcard record pointing at this relay.

The gateway makes its own key and sends only a CSR (`POST /relay/v1/tls/certificate`); the relay checks the CSR
names exactly those two (or only the remote one for a gateway with no home network), publishes the DNS-01 proof
and returns the chain. The key never leaves the gateway.

The pass-through listener takes TLS connections for `*.<remote zone>`, reads only the server name from the
ClientHello (relay/sni.py) and forwards the encrypted bytes through that gateway's tunnel unchanged, so the relay
can't read the requests, tokens or answers. It still runs the zone and the ACME account, so a dishonest operator
could have a second certificate issued; Certificate Transparency logs would show it (crt.sh).
"""

from __future__ import annotations

import asyncio
import base64
import contextlib
import hashlib
import ipaddress
import logging
import secrets
import time
from typing import TYPE_CHECKING, Any

from cryptography import x509
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec, rsa

from ..db import Database
from . import sni

if TYPE_CHECKING:
    from .server import Relay

log = logging.getLogger("cube.relay.tls")
#: A cached certificate is handed out again while it has at least this long left.
REUSE_MIN_REMAINING = 30 * 86400
#: Let's Encrypt allows 5 certificates per exact set of names per week; stay under it.
MAX_ISSUES_PER_WEEK = 4
CHUNK = 16 * 1024
MAX_STREAMS_PER_GATEWAY = 64
HELLO_TIMEOUT = 10.0
TLS_SCHEMA = [
    "CREATE TABLE IF NOT EXISTS relay_certs (gateway_id TEXT PRIMARY KEY, key_sha256 TEXT NOT NULL, names TEXT NOT NULL, not_after REAL NOT NULL, chain TEXT NOT NULL, issued_at REAL NOT NULL)",
    "CREATE TABLE IF NOT EXISTS relay_cert_issues (gateway_id TEXT NOT NULL, at REAL NOT NULL)",
    "CREATE TABLE IF NOT EXISTS relay_lan_addresses (gateway_id TEXT PRIMARY KEY, address TEXT NOT NULL, updated_at REAL NOT NULL)",
]


class TlsRefused(Exception):
    def __init__(self, code: str, message: str, status: int):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status


def _zone(value: str) -> str:
    return value.strip().strip(".").lower()


def _private_ipv4(value: Any) -> str | None:
    try:
        address = ipaddress.ip_address(str(value or ""))
    except ValueError:
        return None
    return str(address) if address.version == 4 and address.is_private and not address.is_loopback and not address.is_link_local else None


class TlsIssuer:
    """Certificates and home-address records for enrolled gateways. `dns` and `acme` are replaceable (tests)."""

    def __init__(self, db: Database, *, lan_zone: str, remote_zone: str, dns: Any, acme: Any):
        self.db = db
        self.lan_zone = _zone(lan_zone)
        self.remote_zone = _zone(remote_zone)
        self.dns = dns
        self.acme = acme
        self._locks: dict[str, asyncio.Lock] = {}

    def names(self, gateway_id: str, *, with_lan: bool) -> dict[str, str | None]:
        return {"lan": f"{gateway_id}.{self.lan_zone}" if with_lan and self.lan_zone else None, "remote": f"{gateway_id}.{self.remote_zone}"}

    async def address(self, gateway_id: str, lan_ip: Any) -> str:
        """Points the gateway's home name at its current private address."""
        name = self.names(gateway_id, with_lan=True)["lan"]
        address = _private_ipv4(lan_ip)
        if name is None:
            raise TlsRefused("not_configured", "This relay has no home-network zone.", 501)
        if address is None:
            raise TlsRefused("bad_request", "lan_ip must be a private IPv4 address on the home network.", 400)
        row = await self.db.fetchone("SELECT address FROM relay_lan_addresses WHERE gateway_id = ?", (gateway_id,))
        if not row or row["address"] != address:
            await self.dns.upsert_a(name, address)
            await self.db.execute(
                "INSERT INTO relay_lan_addresses (gateway_id, address, updated_at) VALUES (?, ?, ?) "
                "ON CONFLICT(gateway_id) DO UPDATE SET address = excluded.address, updated_at = excluded.updated_at",
                (gateway_id, address, time.time()),
            )
        return name

    async def certificate(self, gateway_id: str, csr_pem: str, lan_ip: Any) -> dict[str, Any]:
        with_lan = _private_ipv4(lan_ip) is not None and bool(self.lan_zone)
        names = self.names(gateway_id, with_lan=with_lan)
        wanted = sorted(n for n in names.values() if n)
        csr, key_sha = _check_csr(csr_pem, wanted)
        lock = self._locks.setdefault(gateway_id, asyncio.Lock())
        async with lock:
            cached = await self.db.fetchone("SELECT * FROM relay_certs WHERE gateway_id = ?", (gateway_id,))
            if cached and cached["key_sha256"] == key_sha and cached["names"] == ",".join(wanted) and cached["not_after"] - time.time() > REUSE_MIN_REMAINING:
                return {"certificate": cached["chain"], "names": names, "not_after": cached["not_after"], "reused": True}
            week_ago = time.time() - 7 * 86400
            issued = await self.db.fetchone("SELECT COUNT(*) AS n FROM relay_cert_issues WHERE gateway_id = ? AND at > ?", (gateway_id, week_ago))
            if issued and issued["n"] >= MAX_ISSUES_PER_WEEK:
                raise TlsRefused("rate_limited", "This gateway has had several certificates this week; the relay waits before asking for more.", 429)
            if names["lan"]:
                await self.address(gateway_id, lan_ip)
            await self.db.execute("INSERT INTO relay_cert_issues (gateway_id, at) VALUES (?, ?)", (gateway_id, time.time()))
            chain = await self.acme.issue(csr.public_bytes(serialization.Encoding.DER), wanted, self.dns)
            leaf = x509.load_pem_x509_certificate(chain.encode())
            not_after = leaf.not_valid_after_utc.timestamp()
            await self.db.execute(
                "INSERT INTO relay_certs (gateway_id, key_sha256, names, not_after, chain, issued_at) VALUES (?, ?, ?, ?, ?, ?) "
                "ON CONFLICT(gateway_id) DO UPDATE SET key_sha256 = excluded.key_sha256, names = excluded.names, not_after = excluded.not_after, "
                "chain = excluded.chain, issued_at = excluded.issued_at",
                (gateway_id, key_sha, ",".join(wanted), not_after, chain, time.time()),
            )
            log.info("certificate issued", extra={"gateway_id": gateway_id, "names": wanted, "not_after": not_after})
            return {"certificate": chain, "names": names, "not_after": not_after, "reused": False}


def _check_csr(csr_pem: str, wanted: list[str]) -> tuple[x509.CertificateSigningRequest, str]:
    try:
        csr = x509.load_pem_x509_csr(str(csr_pem).encode())
    except ValueError as error:
        raise TlsRefused("bad_request", "csr must be a PEM certificate request.", 400) from error
    if not csr.is_signature_valid:
        raise TlsRefused("bad_request", "The CSR's signature doesn't match its key.", 400)
    key = csr.public_key()
    if not ((isinstance(key, ec.EllipticCurvePublicKey) and key.curve.name in {"secp256r1", "secp384r1"}) or (isinstance(key, rsa.RSAPublicKey) and key.key_size >= 2048)):
        raise TlsRefused("bad_request", "Use an EC P-256/P-384 or RSA 2048+ key.", 400)
    try:
        san = csr.extensions.get_extension_for_class(x509.SubjectAlternativeName).value.get_values_for_type(x509.DNSName)
    except x509.ExtensionNotFound as error:
        raise TlsRefused("bad_request", "The CSR names no DNS names.", 400) from error
    if sorted({name.lower() for name in san}) != wanted:
        raise TlsRefused("forbidden", f"A certificate here can only name {', '.join(wanted)}.", 403)
    spki = key.public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)
    return csr, hashlib.sha256(spki).hexdigest()


# ---- pass-through listener ---------------------------------------------------------------------------


class Stream:
    """One client connection carried through a tunnel: bytes from the gateway, written to the client in order."""

    def __init__(self, writer: asyncio.StreamWriter):
        self.writer = writer
        self.queue: asyncio.Queue[bytes | None] = asyncio.Queue(maxsize=256)
        self.task: asyncio.Task | None = None

    def feed(self, data: bytes) -> None:
        try:
            self.queue.put_nowait(data)
        except asyncio.QueueFull:
            self.close()  # the client stopped reading: drop it rather than buffer without end

    def close(self) -> None:
        with contextlib.suppress(asyncio.QueueFull):
            self.queue.put_nowait(None)

    async def pump(self) -> None:
        try:
            while (data := await self.queue.get()) is not None:
                self.writer.write(data)
                await self.writer.drain()
        except (ConnectionError, OSError):
            pass
        finally:
            with contextlib.suppress(Exception):
                self.writer.close()


class PassThrough:
    def __init__(self, relay: Relay, *, remote_zone: str, host: str, port: int, trusted_proxy: Any):
        self.relay = relay
        self.suffix = "." + _zone(remote_zone)
        self.host = host
        self.port = port
        self.trusted_proxy = trusted_proxy
        self.server: asyncio.Server | None = None

    async def start(self) -> None:
        self.server = await asyncio.start_server(self._connection, self.host, self.port)
        log.info("pass-through TLS listener ready", extra={"port": self.port, "zone": self.suffix[1:]})

    async def stop(self) -> None:
        if self.server:
            self.server.close()
            with contextlib.suppress(Exception):
                await asyncio.wait_for(self.server.wait_closed(), 5)

    async def _hello(self, reader: asyncio.StreamReader, peer: str) -> tuple[bytes, str, str | None]:
        """Reads up to the end of the ClientHello: (bytes read, caller address, server name)."""
        data = b""
        caller = peer
        while True:
            chunk = await reader.read(4096)
            if not chunk:
                raise ValueError("closed before the ClientHello")
            data += chunk
            # nginx's stream proxy can prepend a PROXY protocol v1 line with the real caller (`proxy_protocol on`).
            if self.trusted_proxy(peer) and data.startswith(b"PROXY "):
                if b"\r\n" not in data:
                    if len(data) > 108:
                        raise ValueError("PROXY line too long")
                    continue
                line, data = data.split(b"\r\n", 1)
                parts = line.split(b" ")
                if len(parts) >= 3 and parts[1] in {b"TCP4", b"TCP6"}:
                    caller = parts[2].decode("ascii", "replace")
                if not data:
                    continue
            try:
                return data, caller, sni.server_name(data)
            except sni.NeedMore:
                if len(data) > sni.MAX_HELLO:
                    raise ValueError("ClientHello too large") from None

    async def _connection(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        peername = writer.get_extra_info("peername")
        peer = peername[0] if peername else "unknown"
        try:
            data, caller, name = await asyncio.wait_for(self._hello(reader, peer), HELLO_TIMEOUT)
        except (TimeoutError, ValueError, ConnectionError, OSError):
            writer.close()
            return
        gateway_id = name[: -len(self.suffix)] if name and name.endswith(self.suffix) else ""
        tunnel = self.relay.tunnels.get(gateway_id) if gateway_id and "." not in gateway_id else None
        if tunnel is None or len(tunnel.tcp) >= MAX_STREAMS_PER_GATEWAY or not self.relay.ip_limiter.check(caller):
            writer.close()
            return
        sid = secrets.token_hex(8)
        stream = Stream(writer)
        tunnel.tcp[sid] = stream
        stream.task = asyncio.create_task(stream.pump())
        try:
            await tunnel.send({"t": "tcp_open", "sid": sid, "client": caller})
            await tunnel.send({"t": "tcp_data", "sid": sid, "data": base64.b64encode(data).decode()})
            while chunk := await reader.read(CHUNK):
                await tunnel.send({"t": "tcp_data", "sid": sid, "data": base64.b64encode(chunk).decode()})
        except (ConnectionError, OSError, RuntimeError):
            pass
        finally:
            if tunnel.tcp.pop(sid, None) is not None:
                with contextlib.suppress(Exception):
                    await tunnel.send({"t": "tcp_close", "sid": sid})
            stream.close()
