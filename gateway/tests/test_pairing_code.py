"""Where a pairing QR code sends a phone, from every place the gateway prints one."""

from __future__ import annotations

from dataclasses import replace

import pytest

from cube_gateway import cli
from cube_gateway.netutil import phone_address
from cube_gateway.security import pairing_target, setup_payload
from tests.conftest import Harness

GATEWAY = "ad568c58"


@pytest.fixture
def printed(monkeypatch) -> list[str]:
    """Each payload drawn as a QR code."""
    payloads: list[str] = []

    def draw(payload: str) -> str:
        payloads.append(payload)
        return ""

    monkeypatch.setattr("cube_gateway.security.render_qr", draw)
    return payloads


def test_a_home_gateway_names_its_lan_address(settings, monkeypatch):
    monkeypatch.setattr("cube_gateway.netutil.primary_address", lambda: "192.168.1.20")
    assert pairing_target(replace(settings, host="0.0.0.0", port=8686), GATEWAY) == "host=192.168.1.20:8686"


def test_cube_host_wins_over_the_detected_address(settings, monkeypatch):
    monkeypatch.setattr("cube_gateway.netutil.primary_address", lambda: "192.168.1.20")
    assert pairing_target(replace(settings, host="10.0.0.5", port=9000), GATEWAY) == "host=10.0.0.5:9000"


@pytest.mark.parametrize("host", ["127.0.0.1", "127.1.2.3", "::1", "localhost"])
def test_loopback_is_no_address_for_a_phone(settings, host):
    assert phone_address(host) is None
    assert pairing_target(replace(settings, host=host), GATEWAY) == ""


def test_a_gateway_without_an_address_leaves_the_field_out(settings, monkeypatch):
    monkeypatch.setattr("cube_gateway.netutil.primary_address", lambda: None)
    target = pairing_target(replace(settings, host="0.0.0.0"), GATEWAY)
    assert setup_payload(GATEWAY, "W4AT-GBXP", target) == f"cubegw://pair?id={GATEWAY}&code=W4AT-GBXP"


def test_a_gateway_on_the_server_names_the_relay(settings):
    hosted = replace(settings, host="127.0.0.1", relay_url="https://relay.test", server_hosted=True, allow_remote_claim=True)
    assert pairing_target(hosted, GATEWAY) == f"url=https://relay.test/relay/v1/g/{GATEWAY}"


def test_a_home_gateway_with_a_relay_is_still_claimed_at_home(settings, monkeypatch):
    monkeypatch.setattr("cube_gateway.netutil.primary_address", lambda: "192.168.1.20")
    home = replace(settings, host="0.0.0.0", port=8686, relay_url="https://relay.test", allow_remote_claim=False)
    assert pairing_target(home, GATEWAY) == "host=192.168.1.20:8686"


def test_the_log_and_a_rotated_code_both_name_the_gateway(settings, printed):
    with Harness(replace(settings, host="192.168.1.20", port=8686)) as harness:
        security = harness.gateway.security
        first = security.setup_code
        assert printed == [f"cubegw://pair?host=192.168.1.20:8686&id={security.gateway_id}&code={first}"]
        security.auth_limiter.limit = 100
        for _ in range(10):
            harness.client.post("/api/v1/auth/claim", json={"setup_code": "WXYZ-WXYZ"})
        assert security.setup_code != first
        assert printed[-1] == f"cubegw://pair?host=192.168.1.20:8686&id={security.gateway_id}&code={security.setup_code}"


def test_setup_code_and_reset_owner_print_the_relay_for_a_server_gateway(settings, printed, monkeypatch, capsys):
    with Harness(settings) as harness:
        gateway_id = harness.gateway.security.gateway_id
        code = harness.gateway.security.setup_code
    printed.clear()
    capsys.readouterr()
    monkeypatch.setenv("CUBE_SERVER_HOSTED", "1")
    monkeypatch.setenv("CUBE_HOST", "127.0.0.1")
    monkeypatch.setenv("CUBE_RELAY_URL", "https://relay.test/")
    relay = f"cubegw://pair?url=https://relay.test/relay/v1/g/{gateway_id}&id={gateway_id}"

    with pytest.raises(SystemExit) as finished:
        cli.main(["setup-code"])
    assert finished.value.code == 0
    assert printed == [f"{relay}&code={code}"]
    assert capsys.readouterr().out.startswith(f"Setup code: {code}")

    with pytest.raises(SystemExit) as finished:
        cli.main(["reset-owner"])
    assert finished.value.code == 0
    new_code = next(line for line in capsys.readouterr().out.splitlines() if line.startswith("New setup code: ")).split()[-1]
    assert new_code != code
    assert printed[-1] == f"{relay}&code={new_code}"
