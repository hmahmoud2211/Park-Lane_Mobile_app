"""Gateway access through EMS accounts: passes checked offline with the backend's key, single use, for this gateway
only; phones tagged with the account; member sync that removes phones of residents who left and follows roles.
Passes here are made exactly as backend/src/ems/gatewayAccess.ts makes them."""

from __future__ import annotations

import base64
import json
import time
import uuid
from dataclasses import replace

import httpx
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from cube_gateway.accounts import AccountAccess
from cube_gateway.relay.client import RelayClient
from cube_gateway.security import announce_setup_code
from tests.conftest import Harness

BACKEND = Ed25519PrivateKey.generate()


def _b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


PUBLIC = _b64(BACKEND.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw))


def make_pass(gateway_id: str, *, sub: str = "user-owner", role: str = "owner", key: Ed25519PrivateKey = BACKEND, **changes) -> str:
    now = int(time.time())
    claims = {"v": 1, "sub": sub, "name": "Hazem", "unit": "unit-1203", "gw": gateway_id, "role": role, "iat": now, "exp": now + 300, "jti": str(uuid.uuid4())}
    claims.update(changes)
    body = _b64(json.dumps(claims).encode())
    return f"{body}.{_b64(key.sign(body.encode()))}"


@pytest.fixture
def linked(settings):
    return replace(settings, ems_key=PUBLIC)


def _login(h: Harness, token: str, name: str = "Hazem's phone"):
    return h.client.post("/api/v1/auth/account", json={"pass": token, "client_name": name})


def test_a_resident_signs_in_with_a_pass(linked):
    with Harness(linked) as h:
        gid = h.gateway.security.gateway_id
        assert h.client.get("/api/v1/health").json()["data"]["account_login"] is True
        response = _login(h, make_pass(gid))
        assert response.status_code == 201
        data = response.json()["data"]
        assert data["client"]["role"] == "owner" and data["gateway"]["id"] == gid and data["token"] and data["pin_key"]
        clients = h.client.get("/api/v1/auth/clients", headers={"Authorization": f"Bearer {data['token']}"}).json()["data"]
        assert clients[0]["account_id"] == "user-owner" and clients[0]["name"] == "Hazem's phone"
        member = _login(h, make_pass(gid, sub="user-family", role="member")).json()["data"]
        assert member["client"]["role"] == "member"
        # A member controls devices but can't manage the gateway.
        assert h.client.get("/api/v1/devices", headers={"Authorization": f"Bearer {member['token']}"}).status_code == 200
        assert h.client.post("/api/v1/auth/invites", json={}, headers={"Authorization": f"Bearer {member['token']}"}).status_code == 403


@pytest.mark.parametrize(
    "case",
    ["replayed", "expired", "from_the_future", "other_gateway", "forged", "bad_role", "garbled"],
)
def test_invalid_passes_are_refused(linked, case):
    with Harness(linked) as h:
        gid = h.gateway.security.gateway_id
        now = int(time.time())
        token = {
            "replayed": make_pass(gid, jti="same"),
            "expired": make_pass(gid, iat=now - 1000, exp=now - 600),
            "from_the_future": make_pass(gid, iat=now + 3600, exp=now + 3900),
            "other_gateway": make_pass("11111111-2222-4333-8444-555555555555"),
            "forged": make_pass(gid, key=Ed25519PrivateKey.generate()),
            "bad_role": make_pass(gid, role="admin"),
            "garbled": "x" * 40 + "." + "y" * 40,
        }[case]
        if case == "replayed":
            assert _login(h, token).status_code == 201
        response = _login(h, token)
        assert response.status_code == 401 and response.json()["error"]["code"] == "invalid_pass", response.text


def test_a_gateway_not_linked_to_ems_says_so(settings):
    with Harness(settings) as h:
        assert h.client.get("/api/v1/health").json()["data"]["account_login"] is False
        response = _login(h, make_pass(h.gateway.security.gateway_id))
        assert response.status_code == 404 and response.json()["error"]["code"] == "account_login_off"


def test_residents_sign_in_through_the_relay_but_claiming_stays_blocked(linked):
    with Harness(linked) as h:
        relay = RelayClient(h.gateway, "https://relay.example.com", "secret")

        def frame(path: str, body: dict) -> dict:
            return {"t": "req", "id": 1, "method": "POST", "path": path, "query": "", "client": "93.184.216.7",
                    "headers": {"content-type": "application/json"}, "body": base64.b64encode(json.dumps(body).encode()).decode()}

        signed_in = h.client.portal.call(relay.forward, frame("/api/v1/auth/account", {"pass": make_pass(h.gateway.security.gateway_id), "client_name": "away"}))
        assert signed_in["status"] == 201
        claimed = h.client.portal.call(relay.forward, frame("/api/v1/auth/claim", {"setup_code": h.gateway.security.setup_code or "AAAA-BBBB"}))
        assert claimed["status"] == 403


def test_the_key_is_fetched_once_and_pinned(settings):
    calls: list[str] = []

    def backend(request: httpx.Request) -> httpx.Response:
        calls.append(request.url.path)
        return httpx.Response(200, json={"ok": True, "data": {"alg": "Ed25519", "key": PUBLIC}})

    with Harness(replace(settings, ems_url="https://ems.test")) as h:
        h.gateway.accounts.client = lambda: httpx.AsyncClient(transport=httpx.MockTransport(backend))
        gid = h.gateway.security.gateway_id
        assert _login(h, make_pass(gid)).status_code == 201
        assert _login(h, make_pass(gid)).status_code == 201
        assert calls == ["/api/gateway/key"]
        assert h.client.portal.call(h.gateway.db.get_meta, "ems_key") == PUBLIC


def test_member_sync_removes_leavers_and_follows_roles(settings, monkeypatch):
    monkeypatch.setattr(AccountAccess, "start", lambda self: None)  # driven by hand here, not every five minutes
    linked = replace(settings, ems_key=PUBLIC, ems_url="https://ems.test", ems_secret="s" * 64)
    seen: list[str] = []
    members = [{"userId": "user-owner", "role": "member"}]

    def backend(request: httpx.Request) -> httpx.Response:
        seen.append(request.headers["authorization"])
        return httpx.Response(200, json={"ok": True, "data": {"gatewayId": "x", "unitId": "u", "members": members}})

    with Harness(linked) as h:
        h.gateway.accounts.client = lambda: httpx.AsyncClient(transport=httpx.MockTransport(backend))
        gid = h.gateway.security.gateway_id
        installer = h.claim("Installer laptop")["token"]  # paired with the setup code: the sync never touches it
        owner = _login(h, make_pass(gid, sub="user-owner", role="owner")).json()["data"]["token"]
        leaver = _login(h, make_pass(gid, sub="user-leaver", role="member")).json()["data"]["token"]
        result = h.client.portal.call(h.gateway.accounts.sync)
        assert result == {"removed": 1, "changed": 1}
        assert seen == [f"Bearer {gid}.{'s' * 64}"]
        auth = lambda token: {"Authorization": f"Bearer {token}"}  # noqa: E731
        assert h.client.get("/api/v1/devices", headers=auth(leaver)).status_code == 401
        assert h.client.get("/api/v1/auth/me", headers=auth(owner)).json()["data"]["client"]["role"] == "member"
        assert h.client.get("/api/v1/auth/clients", headers=auth(installer)).status_code == 200
        # The backend down: nothing changes, the error is raised for the loop to log.
        members.clear()
        h.gateway.accounts.client = lambda: httpx.AsyncClient(transport=httpx.MockTransport(lambda r: httpx.Response(503, json={})))
        with pytest.raises(httpx.HTTPStatusError):
            h.client.portal.call(h.gateway.accounts.sync)
        assert h.client.get("/api/v1/devices", headers=auth(owner)).status_code == 200


def test_a_phone_signs_itself_out(linked):
    with Harness(linked) as h:
        token = _login(h, make_pass(h.gateway.security.gateway_id)).json()["data"]["token"]
        response = h.client.delete("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
        assert response.status_code == 200 and response.json()["data"]["revoked"].startswith("cl_")
        assert h.client.get("/api/v1/devices", headers={"Authorization": f"Bearer {token}"}).status_code == 401


def test_the_setup_code_is_announced_for_installers_when_linked(linked, capsys):
    with Harness(linked) as h:
        capsys.readouterr()
        announce_setup_code(h.gateway.security)
        assert "Residents connect with their EMS account" in capsys.readouterr().out


class Backend:
    """Stands in for the EMS backend's gateway routes: members (with their sessions) and session revocation."""

    def __init__(self, members: list[dict]):
        self.members = members
        self.revoked: list[list[str]] = []
        self.down = False

    def __call__(self, request: httpx.Request) -> httpx.Response:
        if self.down:
            return httpx.Response(503, json={})
        if request.url.path == "/api/gateway/sessions/revoke":
            self.revoked.append(json.loads(request.content)["sessions"])
            return httpx.Response(200, json={"ok": True, "data": {"revoked": 1}})
        return httpx.Response(200, json={"ok": True, "data": {"gatewayId": "x", "unitId": "u", "members": self.members}})


@pytest.fixture
def synced(settings, monkeypatch):
    monkeypatch.setattr(AccountAccess, "start", lambda self: None)
    return replace(settings, ems_key=PUBLIC, ems_url="https://ems.test", ems_secret="s" * 64)


def test_a_lost_phone_is_removed_from_another_phone_and_cant_get_back_in(synced):
    backend = Backend([{"userId": "user-owner", "role": "owner", "sessions": ["sid-new"]}])
    with Harness(synced) as h:
        h.gateway.accounts.client = lambda: httpx.AsyncClient(transport=httpx.MockTransport(backend))
        gid = h.gateway.security.gateway_id
        lost = _login(h, make_pass(gid, sid="sid-lost"), "Old iPhone").json()["data"]
        new = _login(h, make_pass(gid, sid="sid-new"), "New phone").json()["data"]
        auth = lambda token: {"Authorization": f"Bearer {token}"}  # noqa: E731
        phones = h.client.get("/api/v1/auth/clients", headers=auth(new["token"])).json()["data"]
        assert {p["name"] for p in phones} == {"Old iPhone", "New phone"}
        # From the new phone, the owner removes the lost one.
        assert h.client.delete(f"/api/v1/auth/clients/{lost['client']['id']}", headers=auth(new["token"])).status_code == 200
        assert h.client.get("/api/v1/devices", headers=auth(lost["token"])).status_code == 401
        assert backend.revoked == [["sid-lost"]]  # the backend is told to end that phone's EMS session
        # Even a fresh pass from the lost phone's session is refused.
        again = _login(h, make_pass(gid, sid="sid-lost"))
        assert again.status_code == 401 and again.json()["error"]["code"] == "invalid_pass"
        assert h.client.get("/api/v1/devices", headers=auth(new["token"])).status_code == 200


def test_a_removal_while_offline_is_reported_later(synced):
    backend = Backend([{"userId": "user-owner", "role": "owner", "sessions": ["sid-new"]}])
    with Harness(synced) as h:
        h.gateway.accounts.client = lambda: httpx.AsyncClient(transport=httpx.MockTransport(backend))
        gid = h.gateway.security.gateway_id
        lost = _login(h, make_pass(gid, sid="sid-lost")).json()["data"]
        new = _login(h, make_pass(gid, sid="sid-new")).json()["data"]
        backend.down = True
        removed = h.client.delete(f"/api/v1/auth/clients/{lost['client']['id']}", headers={"Authorization": f"Bearer {new['token']}"})
        assert removed.status_code == 200 and backend.revoked == []
        assert _login(h, make_pass(gid, sid="sid-lost")).status_code == 401  # refused locally meanwhile
        backend.down = False
        h.client.portal.call(h.gateway.accounts.sync)
        assert backend.revoked == [["sid-lost"]]
        h.client.portal.call(h.gateway.accounts.sync)
        assert backend.revoked == [["sid-lost"]], "reported once"


def test_a_phone_whose_session_ended_is_dropped(synced):
    backend = Backend([{"userId": "user-owner", "role": "owner", "sessions": ["sid-a", "sid-b"]}])
    with Harness(synced) as h:
        h.gateway.accounts.client = lambda: httpx.AsyncClient(transport=httpx.MockTransport(backend))
        gid = h.gateway.security.gateway_id
        a = _login(h, make_pass(gid, sid="sid-a")).json()["data"]["token"]
        b = _login(h, make_pass(gid, sid="sid-b")).json()["data"]["token"]
        no_sid = _login(h, make_pass(gid)).json()["data"]["token"]  # a pass from a backend that doesn't send sid
        assert h.client.portal.call(h.gateway.accounts.sync) == {"removed": 0, "changed": 0}
        backend.members[0]["sessions"] = ["sid-b"]  # "sign out my other phones" from b, or a changed password
        assert h.client.portal.call(h.gateway.accounts.sync) == {"removed": 1, "changed": 0}
        statuses = [h.client.get("/api/v1/devices", headers={"Authorization": f"Bearer {t}"}).status_code for t in (a, b, no_sid)]
        assert statuses == [401, 200, 200]
        # An older backend that lists no sessions: membership and roles only.
        del backend.members[0]["sessions"]
        assert h.client.portal.call(h.gateway.accounts.sync) == {"removed": 0, "changed": 0}


def test_signing_itself_out_doesnt_lock_the_session_out(synced):
    backend = Backend([{"userId": "user-owner", "role": "owner", "sessions": ["sid-a"]}])
    with Harness(synced) as h:
        h.gateway.accounts.client = lambda: httpx.AsyncClient(transport=httpx.MockTransport(backend))
        gid = h.gateway.security.gateway_id
        token = _login(h, make_pass(gid, sid="sid-a")).json()["data"]["token"]
        assert h.client.delete("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"}).status_code == 200
        assert backend.revoked == []  # forgetting the gateway on this phone isn't reporting it lost
        assert _login(h, make_pass(gid, sid="sid-a")).status_code == 201


def test_residents_invite_family_from_the_app_not_with_gateway_codes(linked):
    with Harness(linked) as h:
        installer = h.claim("Installer laptop")["token"]  # the setup code works until the gateway has an owner
        resident = _login(h, make_pass(h.gateway.security.gateway_id)).json()["data"]["token"]
        refused = h.client.post("/api/v1/auth/invites", json={"role": "member"}, headers={"Authorization": f"Bearer {resident}"})
        assert refused.status_code == 403 and refused.json()["error"]["code"] == "installers_only"
        assert h.client.post("/api/v1/auth/invites", json={"role": "member"}, headers={"Authorization": f"Bearer {installer}"}).status_code == 201


def test_a_new_gateway_takes_the_id_it_was_started_with(settings):
    """The backend that starts an apartment's gateway picks its id, so it can attach it before it runs."""
    preset = str(uuid.uuid4())
    with Harness(replace(settings, gateway_id=preset)) as h:
        assert h.gateway.security.gateway_id == preset
        assert h.client.get("/api/v1/health").json()["data"]["gateway_id"] == preset
    # Once stored, the id stays, even if a later start names another.
    with Harness(replace(settings, gateway_id=str(uuid.uuid4()))) as h:
        assert h.gateway.security.gateway_id == preset


def test_the_preset_gateway_id_must_be_a_uuid(settings, monkeypatch):
    from cube_gateway.config import load_settings

    monkeypatch.setenv("CUBE_GATEWAY_ID", "not-a-uuid")
    with pytest.raises(SystemExit, match="CUBE_GATEWAY_ID must be a UUID"):
        load_settings()
    monkeypatch.setenv("CUBE_GATEWAY_ID", "0F8E7C1A-3B2D-4C5E-9F60-718293A4B5C6")
    assert load_settings().gateway_id == "0f8e7c1a-3b2d-4c5e-9f60-718293a4b5c6"
