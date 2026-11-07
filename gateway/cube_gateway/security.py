"""Gateway ownership, client tokens and rate limits.

First run: the gateway has no owner and prints a one-time setup code (and a QR payload) to its log. Reading
the log needs access to the server, which is the proof of ownership. The first phone that presents the code
becomes the owner; the code is then gone. Further phones join with short-lived invite codes made by an owner.

Each client gets:
- a bearer token (stored as a SHA-256 hash; revocable), and
- a pin_key, sealed at rest, with which the gateway answers identity challenges. The app checks that proof
  before it sends its token to an address it has not used before, so a device on the LAN that merely
  advertises the gateway's name or id cannot collect tokens.

`docker exec cube-os-gateway cube-gateway reset-owner` (server access again) removes every client and prints
a new setup code.
"""

from __future__ import annotations

import base64
import logging
import os
import secrets
import time
import uuid
from collections import defaultdict, deque
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING

from .crypto import Sealer, constant_time_equal, identity_proof, new_token, token_hash
from .db import Database
from .netutil import phone_address
from .relay.client import gateway_url

if TYPE_CHECKING:
    from .config import Settings

log = logging.getLogger("cube.security")

SETUP_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"  # no 0/O, 1/I
SETUP_CODE_LENGTH = 8
INVITE_TTL = 600
MAX_SETUP_FAILURES = 10


def _code(length: int) -> str:
    raw = "".join(secrets.choice(SETUP_ALPHABET) for _ in range(length))
    return f"{raw[:4]}-{raw[4:]}" if length == 8 else raw


def normalize_code(code: str) -> str:
    cleaned = "".join(ch for ch in code.upper() if ch.isalnum())
    return f"{cleaned[:4]}-{cleaned[4:]}" if len(cleaned) == 8 else cleaned


def encode_key(raw: bytes) -> str:
    """pin_key on the wire: base64url without padding (the app decodes it in frontend/src/features/gateway/services/hmac.ts)."""
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


@dataclass
class Client:
    id: str
    name: str
    role: str
    created_at: float
    last_seen: float | None
    revoked: bool
    #: The EMS account this phone signed in with (accounts.py), or None for a phone paired with a code.
    account_id: str | None = None
    #: The EMS session that asked for its pass: the phone lasts as long as that session (accounts.py).
    session_id: str | None = None

    def public(self) -> dict:
        return {
            "id": self.id, "name": self.name, "role": self.role, "created_at": self.created_at, "last_seen": self.last_seen,
            "revoked": self.revoked, "account_id": self.account_id,
        }


class AuthError(Exception):
    def __init__(self, code: str, message: str, status: int = 401):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status


class RateLimiter:
    """Sliding-window limiter per key (client IP or token)."""

    def __init__(self, limit: int, window: float):
        self.limit = limit
        self.window = window
        self._hits: dict[str, deque[float]] = defaultdict(deque)

    def check(self, key: str) -> bool:
        now = time.monotonic()
        hits = self._hits[key]
        while hits and now - hits[0] > self.window:
            hits.popleft()
        if len(hits) >= self.limit:
            return False
        hits.append(now)
        if len(self._hits) > 10_000:
            self._hits = defaultdict(deque, {k: v for k, v in self._hits.items() if v})
        return True


class Security:
    def __init__(self, db: Database, sealer: Sealer, code_file: Path | None = None):
        self.db = db
        self.sealer = sealer
        #: The current setup code, readable by `cube-gateway setup-code` (docker exec) while unclaimed. Mode 0600.
        self.code_file = code_file
        #: Where a pairing QR code sends a phone: see pairing_target. A rotated code needs it too.
        self.pair_target = ""
        self.gateway_id = ""
        self.name = "CUBE Gateway"
        self._setup_code: str | None = None
        self._setup_failures = 0
        self._token_cache: dict[str, tuple[Client, float]] = {}
        self.auth_limiter = RateLimiter(limit=10, window=60)
        #: Set when the gateway is linked to an EMS apartment: residents use their account, setup codes are for installers.
        self.account_login = False
        self.challenge_limiter = RateLimiter(limit=30, window=60)

    async def load(self, configured_name: str | None, preset_id: str = "") -> None:
        gateway_id = await self.db.get_meta("gateway_id")
        if not gateway_id:
            gateway_id = preset_id or str(uuid.uuid4())
            await self.db.set_meta("gateway_id", gateway_id)
        elif preset_id and preset_id != gateway_id:
            log.warning("CUBE_GATEWAY_ID differs from this gateway's stored id; keeping the stored one", extra={"gateway_id": gateway_id})
        self.gateway_id = gateway_id
        stored_name = await self.db.get_meta("gateway_name")
        self.name = configured_name or stored_name or f"CUBE Gateway {gateway_id[:4].upper()}"
        if not await self.is_claimed():
            # Keep an unclaimed code across restarts (and the one `reset-owner` printed); otherwise make one.
            existing = self._read_code_file()
            if existing and len(existing) == SETUP_CODE_LENGTH + 1:
                self._setup_code = existing
            else:
                self.rotate_setup_code()

    async def set_name(self, name: str) -> None:
        self.name = name
        await self.db.set_meta("gateway_name", name)

    async def is_claimed(self) -> bool:
        row = await self.db.fetchone("SELECT 1 FROM clients WHERE role = 'owner' AND revoked_at IS NULL LIMIT 1")
        return row is not None

    # ---- setup code ----

    def rotate_setup_code(self) -> str:
        self._setup_code = _code(SETUP_CODE_LENGTH)
        self._setup_failures = 0
        self._write_code_file(self._setup_code)
        return self._setup_code

    def _write_code_file(self, code: str | None) -> None:
        if self.code_file is None:
            return
        try:
            if code is None:
                self.code_file.unlink(missing_ok=True)
                return
            fd = os.open(self.code_file, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
            with os.fdopen(fd, "w") as handle:
                handle.write(code + "\n")
        except OSError:
            log.warning("could not write the setup code file", extra={"path": str(self.code_file)})

    def _read_code_file(self) -> str | None:
        """A code written by `cube-gateway reset-owner` from another process."""
        try:
            return normalize_code(self.code_file.read_text().strip()) if self.code_file else None
        except OSError:
            return None

    @property
    def setup_code(self) -> str | None:
        return self._setup_code

    async def claim(self, code: str, client_name: str) -> tuple[Client, str, str]:
        if await self.is_claimed():
            raise AuthError("already_claimed", "This gateway already has an owner. Ask them for an invite code.", 409)
        on_disk = self._read_code_file()
        if on_disk and on_disk != self._setup_code:
            self._setup_code = on_disk
        expected = self._setup_code
        if not expected or not constant_time_equal(normalize_code(code), expected):
            self._setup_failures += 1
            if self._setup_failures >= MAX_SETUP_FAILURES:
                self.rotate_setup_code()
                log.warning("setup code rotated after repeated wrong attempts; see the new code below")
                announce_setup_code(self)
            raise AuthError("invalid_code", "That setup code is not right. It is printed in the gateway's log.", 401)
        client, token, pin_key = await self._create_client(client_name, "owner")
        self._setup_code = None
        self._write_code_file(None)
        await self.db.audit("gateway.claimed", client.id)
        log.info("gateway claimed", extra={"client_id": client.id})
        return client, token, pin_key

    # ---- invites ----

    async def create_invite(self, role: str, created_by: str) -> tuple[str, float]:
        code = _code(SETUP_CODE_LENGTH)
        expires = time.time() + INVITE_TTL
        await self.db.execute(
            "INSERT INTO invites (code_hash, role, created_by, expires_at) VALUES (?, ?, ?, ?)",
            (token_hash(code), role, created_by, expires),
        )
        await self.db.audit("invite.created", created_by, role=role)
        return code, expires

    async def join(self, code: str, client_name: str) -> tuple[Client, str, str]:
        digest = token_hash(normalize_code(code))

        def take(conn) -> str | None:
            row = conn.execute(
                "SELECT role FROM invites WHERE code_hash = ? AND used_at IS NULL AND expires_at > ?", (digest, time.time())
            ).fetchone()
            if not row:
                return None
            conn.execute("UPDATE invites SET used_at = ? WHERE code_hash = ?", (time.time(), digest))
            return row["role"]

        role = await self.db.transaction(take)
        if not role:
            raise AuthError("invalid_code", "That invite code is wrong, used or expired. Ask for a new one.", 401)
        client, token, pin_key = await self._create_client(client_name, role)
        await self.db.audit("client.joined", client.id, role=role)
        return client, token, pin_key

    # ---- clients ----

    async def _create_client(self, name: str, role: str, account_id: str | None = None, session_id: str | None = None) -> tuple[Client, str, str]:
        client_id = "cl_" + secrets.token_hex(8)
        token = new_token("cgw")
        pin_key = secrets.token_bytes(32)
        now = time.time()
        await self.db.execute(
            "INSERT INTO clients (id, name, role, token_hash, pin_key_sealed, created_at, account_id, session_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (client_id, name[:64] or "Phone", role, token_hash(token), self.sealer.seal(encode_key(pin_key), client_id), now, account_id, session_id),
        )
        return Client(client_id, name[:64] or "Phone", role, now, None, False, account_id, session_id), token, encode_key(pin_key)

    async def authenticate(self, token: str | None) -> Client:
        if not token:
            raise AuthError("unauthorized", "Pair this phone with the gateway first.")
        digest = token_hash(token)
        cached = self._token_cache.get(digest)
        if cached and time.monotonic() - cached[1] < 30:
            return cached[0]
        row = await self.db.fetchone("SELECT * FROM clients WHERE token_hash = ? AND revoked_at IS NULL", (digest,))
        if not row:
            self._token_cache.pop(digest, None)
            raise AuthError("unauthorized", "This phone is no longer paired with the gateway. Pair it again.")
        now = time.time()
        if not row["last_seen"] or now - row["last_seen"] > 60:
            await self.db.execute("UPDATE clients SET last_seen = ? WHERE id = ?", (now, row["id"]))
        client = Client(row["id"], row["name"], row["role"], row["created_at"], now, False, row["account_id"], row["session_id"])
        self._token_cache[digest] = (client, time.monotonic())
        return client

    async def list_clients(self) -> list[Client]:
        rows = await self.db.fetchall("SELECT * FROM clients ORDER BY created_at")
        return [
            Client(r["id"], r["name"], r["role"], r["created_at"], r["last_seen"], r["revoked_at"] is not None, r["account_id"], r["session_id"])
            for r in rows
        ]

    async def set_role(self, client_id: str, role: str, by: str | None = None) -> bool:
        """An account phone's role follows the resident's role in the unit (accounts.py)."""
        changed = await self.db.execute("UPDATE clients SET role = ? WHERE id = ? AND revoked_at IS NULL AND role != ?", (role, client_id, role))
        self._token_cache.clear()
        if changed:
            await self.db.audit("client.role_changed", by, target=client_id, role=role)
        return changed > 0

    async def revoke(self, client_id: str, by: str) -> bool:
        changed = await self.db.execute("UPDATE clients SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL", (time.time(), client_id))
        self._token_cache.clear()
        if changed:
            await self.db.audit("client.revoked", by, target=client_id)
        return changed > 0

    async def reset_owner(self) -> str:
        await self.db.execute("DELETE FROM clients")
        await self.db.execute("DELETE FROM invites")
        self._token_cache.clear()
        await self.db.audit("gateway.reset_owner")
        return self.rotate_setup_code()

    async def prove_identity(self, client_id: str, nonce: str) -> str:
        row = await self.db.fetchone("SELECT pin_key_sealed FROM clients WHERE id = ? AND revoked_at IS NULL", (client_id,))
        if not row:
            raise AuthError("unknown_client", "This gateway does not know that phone.", 404)
        pin_key = base64.urlsafe_b64decode(self.sealer.unseal(row["pin_key_sealed"], client_id) + "==")
        return identity_proof(pin_key, self.gateway_id, nonce)


def pairing_target(settings: Settings, gateway_id: str) -> str:
    """The part of a pairing QR code that says where a phone finds this gateway; empty when it can't tell, and the
    app then asks for the address. The relay goes first only where the first phone may claim through it: a home
    gateway with a relay is still claimed on the home network.
    """
    if settings.relay_url and settings.allow_remote_claim:
        return f"url={gateway_url(settings.relay_url, gateway_id)}"
    host = phone_address(settings.host)
    return f"host={host}:{settings.port}" if host else ""


def setup_payload(gateway_id: str, code: str, target: str = "") -> str:
    return "cubegw://pair?" + "&".join(part for part in (target, f"id={gateway_id}", f"code={code}") if part)


def render_qr(payload: str) -> str:
    """The QR code as text for a terminal. Empty if it can't be drawn: the code on its own is enough."""
    try:
        import io

        import qrcode

        qr = qrcode.QRCode(border=1)
        qr.add_data(payload)
        buffer = io.StringIO()
        qr.print_ascii(out=buffer, invert=True)
        return buffer.getvalue()
    except Exception:  # noqa: BLE001 - see above
        return ""


def announce_setup_code(security: Security) -> None:
    """Prints the setup code in a block that stands out in `docker logs`, with a scannable QR code."""
    code = security.setup_code
    if not code:
        return
    payload = setup_payload(security.gateway_id, code, security.pair_target)
    lines = [
        "",
        "=" * 64,
        "  CUBE Gateway is not paired yet." if not security.account_login else "  Residents connect with their EMS account. Installer setup code:",
        f"  Gateway: {security.name}  ({security.gateway_id})",
        f"  Setup code: {code}",
        "  In CUBE OS: Add Device -> Connect gateway, then enter this code",
        "  or scan the QR code below.",
        "=" * 64,
        render_qr(payload),
    ]
    # Printed rather than logged so the QR stays intact; the code is single-use and only for the owner.
    print("\n".join(lines), flush=True)  # noqa: T201
    log.info("waiting for the owner to pair", extra={"gateway_id": security.gateway_id, "setup_url": payload.split("&code=")[0]})
