"""Server-hosted apartments with a tunnel box: settings, keys, the box's config, wg0 setup, privilege drop, and the
adapters and catalog a tunnelled gateway offers. Bringing a real wg0 up needs Linux and root, so the commands are
checked as data here."""

from __future__ import annotations

import base64
import ipaddress
import stat
import types
from dataclasses import replace

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.x25519 import X25519PrivateKey

from cube_gateway import tunnel
from cube_gateway.adapters.base import AdapterContext
from cube_gateway.adapters.registry import ADAPTERS, AdapterRegistry, modules_for
from cube_gateway.catalog import build_brands
from cube_gateway.config import load_settings
from tests.conftest import Harness

HOME = ipaddress.ip_network("192.168.1.0/24")


@pytest.fixture
def tunnelled(settings):
    return replace(settings, server_hosted=True, allow_remote_claim=True, tunnel_subnets=[HOME], tunnel_endpoint="vpn.example.com:51821")


def test_settings_read_the_home_subnet_and_scan_it(monkeypatch, tmp_path):
    monkeypatch.setenv("CUBE_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("CUBE_TUNNEL_SUBNETS", "192.168.1.0/24")
    monkeypatch.setenv("CUBE_TUNNEL_ENDPOINT", "vpn.example.com:51821")
    settings = load_settings()
    assert settings.tunnel_subnets == [HOME] and settings.scan_subnets == [HOME] and settings.tunnel_port == 51820
    monkeypatch.setenv("CUBE_SCAN_SUBNETS", "192.168.1.0/25")
    assert load_settings().scan_subnets == [ipaddress.ip_network("192.168.1.0/25")]
    monkeypatch.setenv("CUBE_TUNNEL_SUBNETS", "8.8.8.0/24")
    with pytest.raises(SystemExit, match="private"):
        load_settings()


def test_keys_are_made_once_private_and_valid(tunnelled):
    first = tunnel.keys(tunnelled.data_dir)
    assert tunnel.keys(tunnelled.data_dir) == first
    for name in ("server.key", "box.key"):
        path = tunnelled.data_dir / "tunnel" / name
        assert stat.S_IMODE(path.stat().st_mode) == 0o600
        raw = base64.b64decode(path.read_text().strip())
        assert len(raw) == 32 and raw[0] & 7 == 0 and raw[31] & 0xC0 == 0x40  # clamped like `wg genkey`
    box = X25519PrivateKey.from_private_bytes(base64.b64decode(first.box_private))
    assert base64.b64encode(box.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)).decode() == first.box_public


def test_the_box_config_points_at_this_apartment_only(tunnelled):
    keys = tunnel.keys(tunnelled.data_dir)
    config = tunnel.box_config(tunnelled, keys)
    lines = dict(line.split(" = ", 1) for line in config.splitlines() if " = " in line)
    assert lines["PrivateKey"] == keys.box_private and lines["Address"] == "10.200.0.2/30"
    assert lines["PublicKey"] == keys.server_public and lines["Endpoint"] == "vpn.example.com:51821"
    # The box accepts only the gateway's tunnel address, and forwards only it onto the home network.
    assert lines["AllowedIPs"] == "10.200.0.1/32" and lines["PersistentKeepalive"] == "25"
    assert "-s 10.200.0.1/32" in lines["PostUp"] and "MASQUERADE" in lines["PostUp"] and "-D POSTROUTING" in lines["PostDown"]
    assert keys.server_private_file.read_text().strip() not in config  # the server's key never leaves it


class Runner:
    def __init__(self, fail: dict[str, tuple[int, str]] | None = None):
        self.calls: list[list[str]] = []
        self.fail = fail or {}

    def __call__(self, command, **kwargs):
        self.calls.append(command)
        code, stderr = self.fail.get(" ".join(command[:3]), (0, ""))
        return types.SimpleNamespace(returncode=code, stderr=stderr, stdout="")


def test_up_creates_wg0_with_a_route_home(tunnelled):
    runner = Runner(fail={"ip link add": (2, "RTNETLINK answers: File exists")})  # left from an earlier start: fine
    assert tunnel.up(tunnelled, run=runner)
    keys = tunnel.keys(tunnelled.data_dir)
    assert runner.calls == [
        ["ip", "link", "add", "wg0", "type", "wireguard"],
        ["wg", "set", "wg0", "listen-port", "51820", "private-key", str(keys.server_private_file), "peer", keys.box_public, "allowed-ips", "10.200.0.2/32,192.168.1.0/24"],
        ["ip", "address", "replace", "10.200.0.1/30", "dev", "wg0"],
        ["ip", "link", "set", "wg0", "up"],
        ["ip", "route", "replace", "192.168.1.0/24", "dev", "wg0"],
    ]


def test_up_explains_a_container_that_cant_make_wg0(tunnelled, caplog):
    runner = Runner(fail={"ip link add": (2, "RTNETLINK answers: Operation not permitted")})
    assert not tunnel.up(tunnelled, run=runner)
    assert len(runner.calls) == 1 and "NET_ADMIN" in caplog.text
    assert not tunnel.up(replace(tunnelled, tunnel_subnets=[]), run=Runner())


def test_status_reads_the_interface_counters(tunnelled, tmp_path):
    stats = tmp_path / "wg0" / "statistics"
    stats.mkdir(parents=True)
    (stats / "rx_bytes").write_text("1234\n")
    (stats / "tx_bytes").write_text("99\n")
    assert tunnel.status(tunnelled, sysfs=tmp_path) == {
        "configured": True, "up": True, "subnets": ["192.168.1.0/24"], "endpoint": "vpn.example.com:51821", "received_bytes": 1234, "sent_bytes": 99,
    }
    assert tunnel.status(tunnelled, sysfs=tmp_path / "nothing")["up"] is False


def test_root_is_given_up_after_setup(tunnelled, monkeypatch):
    tunnel.keys(tunnelled.data_dir)
    calls: list[tuple] = []
    monkeypatch.setattr(tunnel.os, "geteuid", lambda: 0)
    monkeypatch.setattr(tunnel.pwd, "getpwnam", lambda name: types.SimpleNamespace(pw_uid=10001, pw_gid=10001))
    monkeypatch.setattr(tunnel.os, "chown", lambda path, uid, gid: calls.append(("chown", path.name, uid)))
    monkeypatch.setattr(tunnel.os, "setgroups", lambda groups: calls.append(("setgroups", tuple(groups))))
    monkeypatch.setattr(tunnel.os, "setgid", lambda gid: calls.append(("setgid", gid)))
    monkeypatch.setattr(tunnel.os, "setuid", lambda uid: calls.append(("setuid", uid)))
    tunnel.drop_privileges(tunnelled.data_dir)
    assert {c[1] for c in calls if c[0] == "chown"} == {"tunnel", "server.key", "box.key"}
    assert [c[0] for c in calls if c[0] != "chown"] == ["setgroups", "setgid", "setuid"] and ("setuid", 10001) in calls
    calls.clear()
    monkeypatch.setattr(tunnel.os, "geteuid", lambda: 10001)
    tunnel.drop_privileges(tunnelled.data_dir)
    assert calls == []


def test_serve_sets_the_tunnel_up_as_root_then_drops(monkeypatch, tmp_path):
    import uvicorn

    from cube_gateway import cli

    events: list[str] = []
    monkeypatch.setenv("CUBE_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("CUBE_TUNNEL_SUBNETS", "192.168.1.0/24")
    monkeypatch.setattr(cli.os, "geteuid", lambda: 0)
    monkeypatch.setattr(tunnel, "up", lambda settings: events.append("up") or True)
    monkeypatch.setattr(tunnel, "drop_privileges", lambda data_dir: events.append("drop"))
    monkeypatch.setattr(uvicorn, "run", lambda *a, **k: events.append("serve"))
    cli._serve()
    assert events == ["up", "drop", "serve"]


def test_tunnel_config_command(monkeypatch, tmp_path, capsys):
    from cube_gateway import cli

    monkeypatch.setenv("CUBE_DATA_DIR", str(tmp_path))
    with pytest.raises(SystemExit) as no_tunnel:
        cli.main(["tunnel-config"])
    assert no_tunnel.value.code == 1
    monkeypatch.setenv("CUBE_TUNNEL_SUBNETS", "192.168.1.0/24")
    monkeypatch.setenv("CUBE_TUNNEL_ENDPOINT", "vpn.example.com:51821")
    with pytest.raises(SystemExit) as printed:
        cli.main(["tunnel-config"])
    assert printed.value.code == 0 and "Endpoint = vpn.example.com:51821" in capsys.readouterr().out


def test_a_tunnelled_apartment_offers_every_home_brand(tunnelled, settings):
    modules = modules_for(tunnelled)
    assert len(modules) == len(set(modules))
    names = {module.rsplit(".", 1)[1] for module, _ in modules}
    assert {"tplink", "gree", "wiz", "shelly", "shelly_cloud", "meross_cloud", "lg_rethink"} <= names
    assert modules_for(replace(tunnelled, tunnel_subnets=[])) != modules and modules_for(settings) == ADAPTERS
    registry = AdapterRegistry(AdapterContext(tunnelled), modules)
    brands = {b.id: b for b in build_brands(registry, tunnelled)}
    assert not [b.id for b in brands.values() if b.needs_home_gateway]
    assert "manual:tplink" in {m.id for m in brands["tplink"].methods}  # added by address through the tunnel


def test_remote_status_includes_the_tunnel(tunnelled, monkeypatch, tmp_path):
    monkeypatch.setattr(tunnel, "SYSFS", tmp_path)
    with Harness(tunnelled) as h:
        h.claim()
        remote = h.get("/remote").json()["data"]
    assert remote["tunnel"]["configured"] is True and remote["tunnel"]["up"] is False and remote["tunnel"]["subnets"] == ["192.168.1.0/24"]
