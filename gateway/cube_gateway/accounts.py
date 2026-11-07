"""Gateway access through EMS accounts: residents sign in to EMS instead of pairing with setup codes.

- **The pass.** The app asks the EMS backend for a pass (POST /api/gateway/pass) and hands it to this gateway
  (POST /api/v1/auth/account). The pass names the resident, their unit, their role there and this gateway's id, lasts
  five minutes and is signed with the backend's Ed25519 key. The gateway checks it offline against the key it
  pinned (CUBE_EMS_KEY, or fetched once from CUBE_EMS_URL), uses each pass once, and gives that phone its own token,
  tagged with the account. Format: base64url(JSON payload) "." base64url(signature over the first part).
- **Members.** Every few minutes the gateway asks the backend who still lives in its unit (GET /api/gateway/members,
  with the sync secret it was attached with, CUBE_EMS_SECRET). Phones of anyone who left are removed, and roles
  follow the unit's. When the backend can't be reached, nothing changes: control at home keeps working.
- **A phone lasts as long as its EMS session.** The pass carries the session's id (`sid`). The members list says
  which sessions still work, so a phone whose session ended (signed out, "sign out my other phones", password changed)
  is removed. The other way round, when an owner removes a lost phone here, its session id is refused from then on
  and reported to the backend (POST /api/gateway/sessions/revoke), which ends that session, so the lost phone can't
  just ask for a new pass.
- **Installers.** Setup codes still work, for whoever installs the gateway; phones paired that way aren't touched by
  the sync.
"""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import time
from typing import TYPE_CHECKING, Any

import httpx
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

from .security import AuthError, Client

if TYPE_CHECKING:
    from .gateway import Gateway

log = logging.getLogger("cube.accounts")
SYNC_EVERY = 300.0
#: Allowed difference between the backend's clock and the gateway's.
CLOCK_SKEW = 120
ROLES = {"owner", "member"}


def _b64d(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


class AccountAccess:
    def __init__(self, gateway: Gateway):
        self.gateway = gateway
        self.settings = gateway.settings
        self._key: Ed25519PublicKey | None = None
        self._task: asyncio.Task | None = None
        self.last_sync: float | None = None
        self.last_error: str | None = None
        #: Makes the HTTP client for talking to the backend (tests swap in a fake one).
        self.client = lambda: httpx.AsyncClient(timeout=15)

    @property
    def enabled(self) -> bool:
        return bool(self.settings.ems_url or self.settings.ems_key)

    # ---- the backend's key ----

    async def public_key(self) -> Ed25519PublicKey:
        if self._key is None:
            encoded = self.settings.ems_key or await self.gateway.db.get_meta("ems_key")
            if not encoded and self.settings.ems_url:
                async with self.client() as http:
                    response = await http.get(f"{self.settings.ems_url}/api/gateway/key")
                response.raise_for_status()
                encoded = str(response.json()["data"]["key"])
                await self.gateway.db.set_meta("ems_key", encoded)  # pinned: later answers can't swap it
                log.info("pinned the EMS backend's pass key", extra={"ems": self.settings.ems_url})
            if not encoded:
                raise AuthError("account_login_off", "This gateway isn't linked to EMS accounts.", 404)
            self._key = Ed25519PublicKey.from_public_bytes(_b64d(encoded))
        return self._key

    # ---- signing in with a pass ----

    async def verify(self, token: str, now: float | None = None) -> dict[str, Any]:
        """The pass's claims if it is genuine, for this gateway, current and unused; else AuthError (401)."""
        now = time.time() if now is None else now
        invalid = AuthError("invalid_pass", "That sign-in pass isn't valid any more. Try connecting again.", 401)
        body, _, signature = str(token or "").partition(".")
        if not body or not signature or len(token) > 4096:
            raise invalid
        try:
            (await self.public_key()).verify(_b64d(signature), body.encode())
            claims = json.loads(_b64d(body))
        except (InvalidSignature, ValueError, TypeError) as error:
            raise invalid from error
        if not isinstance(claims, dict) or claims.get("v") != 1 or str(claims.get("gw", "")).lower() != self.gateway.security.gateway_id:
            raise invalid
        if not claims.get("sub") or claims.get("role") not in ROLES or not claims.get("jti"):
            raise invalid
        if not (float(claims.get("iat", 0)) <= now + CLOCK_SKEW and float(claims.get("exp", 0)) > now - CLOCK_SKEW):
            raise invalid
        db = self.gateway.db
        await db.execute("DELETE FROM used_passes WHERE expires_at < ?", (now - CLOCK_SKEW,))
        if await db.fetchone("SELECT 1 FROM used_passes WHERE jti = ?", (str(claims["jti"]),)):
            raise invalid  # each pass works once
        if claims.get("sid") and await db.fetchone("SELECT 1 FROM ended_sessions WHERE session_id = ?", (str(claims["sid"]),)):
            raise invalid  # a phone removed here: its session may not get back in
        await db.execute("INSERT INTO used_passes (jti, expires_at) VALUES (?, ?)", (str(claims["jti"]), float(claims["exp"])))
        return claims

    async def login(self, token: str, client_name: str) -> tuple[Client, str, str]:
        claims = await self.verify(token)
        name = client_name.strip() or str(claims.get("name") or "Phone")
        session = str(claims["sid"]) if claims.get("sid") else None
        client, issued, pin_key = await self.gateway.security._create_client(name, str(claims["role"]), str(claims["sub"]), session)
        await self.gateway.db.audit("client.account_login", client.id, account=str(claims["sub"]), role=client.role)
        return client, issued, pin_key

    # ---- a removed phone ends its session ----

    async def phone_removed(self, client: Client) -> None:
        """Called after an owner removed another phone here (a lost one): refuse its session's passes from now on and
        have the backend end that session. Reported now, and again by the sync until it's acknowledged. Deliberately
        not called when a phone signs itself out (DELETE /auth/me): forgetting a gateway mustn't lock its own session out."""
        if not client.session_id:
            return
        await self.gateway.db.execute(
            "INSERT INTO ended_sessions (session_id, at) VALUES (?, ?) ON CONFLICT(session_id) DO NOTHING", (client.session_id, time.time())
        )
        try:
            await self.report()
        except Exception as error:  # noqa: BLE001 - offline: the sync reports it later; passes are refused meanwhile
            log.info("couldn't tell EMS about a removed phone yet; will retry", extra={"reason": str(error) or type(error).__name__})

    async def report(self) -> int:
        settings = self.settings
        if not (settings.ems_url and settings.ems_secret):
            return 0
        rows = await self.gateway.db.fetchall("SELECT session_id FROM ended_sessions WHERE reported = 0 LIMIT 100")
        if not rows:
            return 0
        sessions = [row["session_id"] for row in rows]
        auth = {"Authorization": f"Bearer {self.gateway.security.gateway_id}.{settings.ems_secret}"}
        async with self.client() as http:
            response = await http.post(f"{settings.ems_url}/api/gateway/sessions/revoke", json={"sessions": sessions}, headers=auth)
        response.raise_for_status()
        for session in sessions:
            await self.gateway.db.execute("UPDATE ended_sessions SET reported = 1 WHERE session_id = ?", (session,))
        return len(sessions)

    # ---- keeping in step with the unit ----

    async def sync(self) -> dict[str, int]:
        """Removes phones of residents who left the unit and updates roles. Raises if the backend can't be asked."""
        settings = self.settings
        if not (settings.ems_url and settings.ems_secret):
            return {"removed": 0, "changed": 0}
        await self.report()  # phones removed while the backend couldn't be reached
        auth = {"Authorization": f"Bearer {self.gateway.security.gateway_id}.{settings.ems_secret}"}
        async with self.client() as http:
            response = await http.get(f"{settings.ems_url}/api/gateway/members", headers=auth)
        response.raise_for_status()
        listed = [m for m in response.json()["data"]["members"] if str(m.get("role")) in ROLES]
        members = {str(m["userId"]): str(m["role"]) for m in listed}
        # Older backends don't list sessions: then only membership and roles are followed.
        sessions = {str(m["userId"]): {str(s) for s in m["sessions"]} for m in listed if isinstance(m.get("sessions"), list)}
        security = self.gateway.security
        removed = changed = 0
        for client in await security.list_clients():
            if client.revoked or not client.account_id:
                continue
            role = members.get(client.account_id)
            ended = client.session_id is not None and client.account_id in sessions and client.session_id not in sessions[client.account_id]
            if role is None or ended:
                if await security.revoke(client.id, "ems"):
                    self.gateway.bus.close_client(client.id)
                    removed += 1
            elif role != client.role and await security.set_role(client.id, role, "ems"):
                self.gateway.bus.close_client(client.id)  # its open event stream still carried the old role
                changed += 1
        self.last_sync, self.last_error = time.time(), None
        if removed or changed:
            log.info("account phones updated from EMS", extra={"removed": removed, "role_changes": changed})
        return {"removed": removed, "changed": changed}

    def start(self) -> None:
        if self.settings.ems_url and self.settings.ems_secret and self._task is None:
            self._task = asyncio.create_task(self._loop(), name="ems-members")

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except (asyncio.CancelledError, Exception):  # noqa: BLE001, S110 - stopping
                pass
            self._task = None

    async def _loop(self) -> None:
        while True:
            try:
                await self.sync()
            except asyncio.CancelledError:
                raise
            except Exception as error:  # noqa: BLE001 - offline or the backend is down: keep every phone working
                self.last_error = str(error) or type(error).__name__
                log.warning("couldn't check members with EMS; nothing changed", extra={"reason": self.last_error})
            await asyncio.sleep(SYNC_EVERY)
