"""Ownership, tokens, invites, revocation, identity proofs, rate limits and the public surface of the API."""

from __future__ import annotations

import base64
import sqlite3

from cube_gateway.crypto import identity_proof, token_hash
from tests.conftest import Harness


def test_health_is_public_and_minimal(harness: Harness):
    response = harness.client.get("/api/v1/health")
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["status"] == "ok" and data["claimed"] is False and data["api_version"] == 1
    assert set(data) == {"status", "version", "api_version", "gateway_id", "name", "claimed", "uptime", "adapters", "tls", "account_login"}
    assert data["tls"] is None  # no certificate yet: HTTP only


def test_everything_else_needs_a_token(harness: Harness):
    for path in ["/brands", "/adapters", "/devices", "/rooms", "/discovery/candidates", "/remote", "/auth/me"]:
        response = harness.client.get(f"/api/v1{path}")
        assert response.status_code == 401, path
        assert response.json()["error"]["code"] == "unauthorized"
    assert harness.client.get("/api/v1/devices", headers={"Authorization": "Bearer cgw_wrong"}).status_code == 401


def test_claim_once_with_the_setup_code(harness: Harness):
    assert harness.client.post("/api/v1/auth/claim", json={"setup_code": "AAAA-BBBB"}).json()["error"]["code"] == "invalid_code"
    data = harness.claim()
    assert data["client"]["role"] == "owner" and data["token"].startswith("cgw_") and data["pin_key"]
    assert harness.client.get("/api/v1/health").json()["data"]["claimed"] is True
    again = harness.client.post("/api/v1/auth/claim", json={"setup_code": "AAAA-BBBB"})
    assert again.status_code == 409 and again.json()["error"]["code"] == "already_claimed"
    assert harness.get("/auth/me").json()["data"]["client"]["role"] == "owner"


def test_setup_code_is_case_and_dash_insensitive(harness: Harness):
    code = harness.gateway.security.setup_code.replace("-", "").lower()
    assert harness.client.post("/api/v1/auth/claim", json={"setup_code": code}).status_code == 201


def test_tokens_are_stored_hashed(harness: Harness):
    data = harness.claim()
    with sqlite3.connect(harness.settings.db_path) as conn:
        rows = conn.execute("SELECT token_hash, pin_key_sealed FROM clients").fetchall()
    assert rows[0][0] == token_hash(data["token"])
    assert data["token"] not in str(rows) and data["pin_key"] not in str(rows)


def test_claim_is_rate_limited(harness: Harness):
    statuses = [harness.client.post("/api/v1/auth/claim", json={"setup_code": "WXYZ-WXYZ"}).status_code for _ in range(12)]
    assert 429 in statuses


def test_repeated_wrong_codes_rotate_the_code(harness: Harness):
    security = harness.gateway.security
    first = security.setup_code
    security.auth_limiter.limit = 100
    for _ in range(10):
        harness.client.post("/api/v1/auth/claim", json={"setup_code": "WXYZ-WXYZ"})
    assert security.setup_code != first
    assert harness.client.post("/api/v1/auth/claim", json={"setup_code": first}).status_code == 401


def test_identity_proof_matches_the_shared_formula(harness: Harness):
    data = harness.claim()
    nonce = "n0nce-abcdefghijklmnop"
    response = harness.client.post("/api/v1/identity/challenge", json={"client_id": data["client"]["id"], "nonce": nonce})
    proof = response.json()["data"]["proof"]
    pin_key = base64.urlsafe_b64decode(data["pin_key"] + "=" * (-len(data["pin_key"]) % 4))
    assert proof == identity_proof(pin_key, data["gateway"]["id"], nonce)
    # The app's HMAC (frontend/src/features/gateway/services/hmac.ts) uses this exact message layout.
    import hashlib
    import hmac

    assert proof == hmac.new(pin_key, f"cube-gw-v1|{data['gateway']['id']}|{nonce}".encode(), hashlib.sha256).hexdigest()
    unknown = harness.client.post("/api/v1/identity/challenge", json={"client_id": "cl_nobody", "nonce": nonce})
    assert unknown.status_code == 404


def test_invites_roles_and_revocation(harness: Harness):
    harness.claim()
    invite = harness.post("/auth/invites", json={"role": "member"}).json()["data"]
    joined = harness.client.post("/api/v1/auth/join", json={"invite_code": invite["code"], "client_name": "Guest"}).json()["data"]
    member = joined["token"]
    assert joined["client"]["role"] == "member"
    # Single use.
    assert harness.client.post("/api/v1/auth/join", json={"invite_code": invite["code"]}).status_code == 401
    # Members control and view, but cannot manage.
    assert harness.get("/devices", headers=harness.headers(member)).status_code == 200
    forbidden = harness.post("/discovery/jobs", json={}, headers=harness.headers(member))
    assert forbidden.status_code == 403 and forbidden.json()["error"]["code"] == "forbidden"
    assert harness.post("/auth/invites", json={}, headers=harness.headers(member)).status_code == 403
    # Revocation takes effect at once.
    assert harness.delete(f"/auth/clients/{joined['client']['id']}").status_code == 200
    assert harness.get("/devices", headers=harness.headers(member)).status_code == 401
    clients = harness.get("/auth/clients").json()["data"]
    assert [c["revoked"] for c in clients] == [False, True]


def test_owner_cannot_revoke_itself(harness: Harness):
    data = harness.claim()
    assert harness.delete(f"/auth/clients/{data['client']['id']}").status_code == 400


def test_websocket_requires_auth_and_streams_events(harness: Harness):
    harness.claim()
    with harness.client.websocket_connect("/api/v1/events") as socket:
        socket.send_json({"type": "auth", "token": "cgw_nope"})
        assert socket.receive_json() == {"type": "error", "code": "unauthorized"}
    with harness.client.websocket_connect("/api/v1/events") as socket:
        socket.send_json({"type": "auth", "token": harness.token})
        assert socket.receive_json()["type"] == "ready"
        harness.post("/rooms", json={"name": "Kitchen"})
        event = socket.receive_json()
        assert event["type"] == "rooms.updated" and event["data"]["rooms"][0]["name"] == "Kitchen"


def test_revoked_client_websocket_is_closed(harness: Harness):
    harness.claim()
    invite = harness.post("/auth/invites", json={"role": "member"}).json()["data"]
    member = harness.client.post("/api/v1/auth/join", json={"invite_code": invite["code"]}).json()["data"]
    with harness.client.websocket_connect("/api/v1/events") as socket:
        socket.send_json({"type": "auth", "token": member["token"]})
        assert socket.receive_json()["type"] == "ready"
        harness.delete(f"/auth/clients/{member['client']['id']}")
        assert socket.receive_json()["type"] == "client.revoked"


def test_validation_errors_use_the_envelope(harness: Harness):
    harness.claim()
    response = harness.post("/rooms", json={"name": ""})
    assert response.status_code == 400 and response.json()["ok"] is False and response.json()["error"]["code"] == "bad_request"
    assert harness.post("/discovery/probe", json={"host": "8.8.8.8"}).json()["error"]["code"] == "bad_params"


def test_cli_reset_owner_and_setup_code(settings, capsys):
    from cube_gateway import cli

    with Harness(settings) as h:
        token = h.claim()["token"]
    assert cli._setup_code() == 1  # claimed: no code to show
    assert cli._reset_owner() == 0
    out = capsys.readouterr().out
    assert "New setup code:" in out
    assert cli._setup_code() == 0
    with Harness(settings) as h:
        # The old phone is unpaired; a new claim with the printed code works.
        assert h.get("/devices", headers=h.headers(token)).status_code == 401
        code = out.split("New setup code:")[1].split()[0]
        assert h.client.post("/api/v1/auth/claim", json={"setup_code": code}).status_code == 201
