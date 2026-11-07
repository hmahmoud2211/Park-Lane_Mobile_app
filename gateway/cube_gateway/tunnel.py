"""A WireGuard tunnel from a server-hosted gateway to a small box in its apartment, so the gateway on the company
server can reach devices that only talk on the home network.

    gateway container on the server (10.200.0.1)  <── WireGuard over UDP, opened by the box ──>  box at home (10.200.0.2)
                                                                                                    │ forwards, masqueraded
                                                                                                home network devices

- **One per apartment.** Each apartment's gateway runs in its own container, so it has its own network namespace,
  its own wg0 and its own route to its home subnet. Two apartments can both use 192.168.1.0/24 without clashing,
  and the same tunnel addresses serve every apartment.
- **Nothing to open at home.** The box connects out to the server and keeps the tunnel alive. The server publishes
  one UDP port per apartment.
- **Root only for setup.** Creating wg0 needs root and CAP_NET_ADMIN in the container. `cube-gateway serve` started
  as root brings the tunnel up, then drops to the `cube` user before it opens the database or the API.

What works through it: devices reached by address. The subnet scan finds Shelly, Daikin, SONOFF, Tasmota and
Samsung TVs; Kasa/Tapo, Yeelight, ESPHome, WLED, WiZ, LIFX, Gree, Midea and LG TVs are added by IP. What doesn't:
discovery by broadcast or mDNS (they don't cross a routed tunnel), so not Tuya; Matter (needs IPv6 link-local and
multicast on the home network); and anything while the apartment's internet is down.
"""

from __future__ import annotations

import base64
import logging
import os
import pwd
import subprocess
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Any

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.x25519 import X25519PrivateKey

if TYPE_CHECKING:
    from .config import Settings

log = logging.getLogger("cube.tunnel")
INTERFACE = "wg0"
SERVER_ADDRESS = "10.200.0.1"
BOX_ADDRESS = "10.200.0.2"
PREFIX = 30
KEEPALIVE = 25
SYSFS = Path("/sys/class/net")
SERVICE_USER = "cube"


@dataclass(frozen=True)
class TunnelKeys:
    server_private_file: Path
    server_public: str
    box_private: str
    box_public: str


def _public(private_b64: str) -> str:
    key = X25519PrivateKey.from_private_bytes(base64.b64decode(private_b64))
    return base64.b64encode(key.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)).decode()


def _private_key_file(path: Path) -> str:
    """A WireGuard private key (base64 of 32 raw X25519 bytes, as `wg genkey` writes), made once, mode 0600."""
    if path.exists():
        return path.read_text().strip()
    path.parent.mkdir(parents=True, exist_ok=True)
    raw = bytearray(X25519PrivateKey.generate().private_bytes(serialization.Encoding.Raw, serialization.PrivateFormat.Raw, serialization.NoEncryption()))
    raw[0] &= 248  # clamped, exactly as `wg genkey` writes it
    raw[31] = (raw[31] & 127) | 64
    value = base64.b64encode(bytes(raw)).decode()
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w") as handle:
        handle.write(value + "\n")
    return value


def keys(data_dir: Path) -> TunnelKeys:
    """The apartment's key pair and its box's, in DATA_DIR/tunnel. The box's private key goes into its config."""
    folder = data_dir / "tunnel"
    server = _private_key_file(folder / "server.key")
    box = _private_key_file(folder / "box.key")
    return TunnelKeys(folder / "server.key", _public(server), box, _public(box))


def box_config(settings: Settings, tunnel_keys: TunnelKeys) -> str:
    """The wg-quick config for the box at home (tunnel-box.sh installs it as /etc/wireguard/cube.conf)."""
    endpoint = settings.tunnel_endpoint or "<this server's public address>:<the UDP port published for this apartment>"
    # PostUp runs in bash: forward only what comes from this apartment's gateway, onto the home network, as the box.
    lan = "$(ip -4 route show default | awk '{print $5; exit}')"
    post_up = (
        f"sysctl -qw net.ipv4.ip_forward=1; iptables -t nat -A POSTROUTING -s {SERVER_ADDRESS}/32 -o {lan} -j MASQUERADE; "
        f"iptables -A FORWARD -i %i -s {SERVER_ADDRESS}/32 -j ACCEPT; iptables -A FORWARD -o %i -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT"
    )
    post_down = (
        f"iptables -t nat -D POSTROUTING -s {SERVER_ADDRESS}/32 -o {lan} -j MASQUERADE; "
        f"iptables -D FORWARD -i %i -s {SERVER_ADDRESS}/32 -j ACCEPT; iptables -D FORWARD -o %i -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT"
    )
    return "\n".join(
        [
            "# CUBE tunnel box: connects out to this apartment's gateway on the company server and passes its",
            "# traffic onto the home network. Keep it private: it holds the box's key.",
            "[Interface]",
            f"PrivateKey = {tunnel_keys.box_private}",
            f"Address = {BOX_ADDRESS}/{PREFIX}",
            f"PostUp = {post_up}",
            f"PostDown = {post_down}",
            "",
            "[Peer]",
            f"PublicKey = {tunnel_keys.server_public}",
            f"Endpoint = {endpoint}",
            f"AllowedIPs = {SERVER_ADDRESS}/32",
            f"PersistentKeepalive = {KEEPALIVE}",
            "",
        ]
    )


def commands(settings: Settings, tunnel_keys: TunnelKeys) -> list[list[str]]:
    """What `up` runs, in order (kept separate so it can be checked without root)."""
    subnets = [str(s) for s in settings.tunnel_subnets]
    return [
        ["ip", "link", "add", INTERFACE, "type", "wireguard"],
        ["wg", "set", INTERFACE, "listen-port", str(settings.tunnel_port), "private-key", str(tunnel_keys.server_private_file),
         "peer", tunnel_keys.box_public, "allowed-ips", ",".join([f"{BOX_ADDRESS}/32", *subnets])],
        ["ip", "address", "replace", f"{SERVER_ADDRESS}/{PREFIX}", "dev", INTERFACE],
        ["ip", "link", "set", INTERFACE, "up"],
        *[["ip", "route", "replace", subnet, "dev", INTERFACE] for subnet in subnets],
    ]


Runner = Callable[..., Any]


def up(settings: Settings, run: Runner = subprocess.run) -> bool:
    """Brings wg0 up with routes to the home subnets. Needs root and CAP_NET_ADMIN; False (logged) when it can't."""
    if not settings.tunnel_subnets:
        return False
    tunnel_keys = keys(settings.data_dir)
    for command in commands(settings, tunnel_keys):
        try:
            result = run(command, capture_output=True, text=True, timeout=15)
        except (OSError, subprocess.TimeoutExpired) as error:
            log.error("tunnel setup failed", extra={"command": command[:3], "reason": str(error)})
            return False
        if result.returncode != 0:
            if command[:3] == ["ip", "link", "add"] and "exists" in (result.stderr or ""):
                continue  # still there from a previous start in this namespace
            log.error(
                "tunnel setup failed, so this home's devices stay unreachable. The container needs --user 0 and "
                "--cap-add NET_ADMIN, on a Linux kernel with WireGuard (5.6 or later)",
                extra={"command": " ".join(command[:3]), "reason": (result.stderr or "").strip()[:300]},
            )
            return False
    log.info("tunnel up", extra={"interface": INTERFACE, "subnets": [str(s) for s in settings.tunnel_subnets], "listen_port": settings.tunnel_port})
    return True


def status(settings: Settings, sysfs: Path | None = None) -> dict[str, Any]:
    """Readable without root: whether wg0 exists and how much has crossed it (bytes received means the box connected)."""
    device = (sysfs or SYSFS) / INTERFACE

    def counter(name: str) -> int:
        try:
            return int((device / "statistics" / name).read_text().strip())
        except (OSError, ValueError):
            return 0

    return {
        "configured": bool(settings.tunnel_subnets),
        "up": device.exists(),
        "subnets": [str(s) for s in settings.tunnel_subnets],
        "endpoint": settings.tunnel_endpoint or None,
        "received_bytes": counter("rx_bytes"),
        "sent_bytes": counter("tx_bytes"),
    }


def drop_privileges(data_dir: Path, user: str = SERVICE_USER) -> None:
    """When started as root (to set up the tunnel), continue as the image's unprivileged user."""
    if os.geteuid() != 0:
        return
    try:
        account = pwd.getpwnam(user)
    except KeyError:
        log.warning("running as root: there is no user to switch to", extra={"user": user})
        return
    tunnel_dir = data_dir / "tunnel"
    if tunnel_dir.exists():
        for path in [tunnel_dir, *tunnel_dir.iterdir()]:
            os.chown(path, account.pw_uid, account.pw_gid)
    os.setgroups([])
    os.setgid(account.pw_gid)
    os.setuid(account.pw_uid)
