"""Settings, all optional, read from CUBE_* environment variables.

A first start needs none of them: the defaults fit `docker run --network host -v cube-os-data:/data`.
"""

from __future__ import annotations

import ipaddress
import os
from dataclasses import dataclass, field
from pathlib import Path


def _bool(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None or raw.strip() == "":
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _int(name: str, default: int, low: int, high: int) -> int:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    try:
        value = int(raw)
    except ValueError as error:
        raise SystemExit(f"{name} must be a whole number, got {raw!r}") from error
    if not low <= value <= high:
        raise SystemExit(f"{name} must be between {low} and {high}, got {value}")
    return value


def _list(name: str) -> list[str]:
    return [item.strip() for item in os.environ.get(name, "").split(",") if item.strip()]


def _ws_url(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if value and not value.startswith(("ws://", "wss://")):
        raise SystemExit(f"{name} must be a WebSocket address such as ws://127.0.0.1:5580/ws, got {value!r}")
    return value


def _networks(name: str) -> list[ipaddress.IPv4Network]:
    networks = []
    for item in _list(name):
        try:
            network = ipaddress.ip_network(item, strict=False)
        except ValueError as error:
            raise SystemExit(f"{name}: {item!r} is not a network such as 192.168.1.0/24") from error
        if not isinstance(network, ipaddress.IPv4Network) or not network.is_private:
            raise SystemExit(f"{name}: {item} is not a private IPv4 network; the gateway only scans home networks")
        if network.prefixlen < 22:
            raise SystemExit(f"{name}: {item} is larger than a /22; split it so scans stay small")
        networks.append(network)
    return networks


@dataclass(frozen=True)
class Settings:
    data_dir: Path
    host: str
    port: int
    log_level: str
    log_format: str
    name: str | None
    mdns_advertise: bool
    #: Extra networks the subnet scan may probe. Empty: the /24 of each private interface address.
    scan_subnets: list[ipaddress.IPv4Network]
    subnet_scan: bool
    cors_origins: list[str]
    #: Seconds a provisioning session stays open.
    provisioning_ttl: int
    #: ReThink (LG ThinQ local cloud) MQTT broker, e.g. mqtt://192.168.1.10:1883. Empty: LG adapter idle.
    rethink_mqtt_url: str
    rethink_discovery_prefix: str
    rethink_prefix: str
    #: ReThink's public addresses (its config.json `advertise` values). Given to ThinQ2 appliances during phone
    #: setup so they reach ReThink from any network without a DNS override. Set both or neither.
    rethink_api_server: str
    rethink_mqtt_server: str
    #: Wi-Fi interface the gateway may use to join a device's setup hotspot. Empty: phone-side setup only.
    softap_interface: str
    #: Device poll interval in seconds, for adapters without push updates.
    poll_interval: int
    relay_url: str
    #: Relay mode: who may enrol. Gateway mode: the token used to enrol automatically at start (with relay_url).
    relay_enroll_token: str
    relay_port: int
    #: Runs on a company server for one apartment, with no home network: only adapters whose devices connect
    #: out to the server are loaded, the owner may be claimed through the relay (with the setup code), and LG
    #: appliances on a shared ReThink are only visible to the gateway that set them up.
    server_hosted: bool
    allow_remote_claim: bool
    rethink_only_provisioned: bool
    #: How this gateway reaches the device MQTT broker (overrides the address the relay hands out), e.g.
    #: mqtt://127.0.0.1:1886 for a gateway on the broker's own server.
    cloud_mqtt_url: str
    #: Relay mode: the device broker the relay manages (dynamic security admin) and what it tells devices.
    mqtt_admin_url: str
    mqtt_admin_user: str
    mqtt_admin_password: str
    #: host:port devices connect to over TLS, e.g. mqtt-cube.ems-iot.com:8885
    mqtt_public_server: str
    #: URL gateways connect to, e.g. mqtts://mqtt-cube.ems-iot.com:8885
    mqtt_gateway_url: str
    #: The CA certificate (PEM file) that signed the broker's certificate; given to devices and gateways.
    mqtt_ca_file: str
    #: NoLongerEvil self-hosted control API (Nest Learning gen 1-2), e.g. http://192.168.1.10:8082. Empty: adapter idle.
    nle_url: str = ""
    #: The Matter Server's WebSocket (matter.js server or python-matter-server), e.g. ws://127.0.0.1:5580/ws. Empty: no Matter.
    matter_url: str = ""
    #: Gateway: HTTPS port, opened once the relay has issued a certificate. 0: any free port on 127.0.0.1, reachable
    #: only through the relay (the default in server-hosted mode, where many gateways share one host).
    tls_port: int = 8688
    #: Relay: zones for gateway certificates. <gateway id>.<lan zone> points at the gateway's home address,
    #: <gateway id>.<remote zone> at this relay (one wildcard record). Without a remote zone, no certificates.
    relay_tls_lan_zone: str = ""
    relay_tls_remote_zone: str = ""
    #: Relay: raw TCP port of the pass-through TLS listener (nginx's stream proxy sends *.<remote zone> to it). 0: off.
    relay_tls_port: int = 0
    #: Relay: the port apps reach the pass-through on from the internet (443 behind nginx, or CUBE_RELAY_TLS_PORT if exposed directly).
    relay_tls_public_port: int = 443
    acme_directory: str = "https://acme-v02.api.letsencrypt.org/directory"
    acme_email: str = ""
    #: A CA bundle the ACME server's own HTTPS is checked against; only for testing against Pebble.
    acme_ca_file: str = ""
    #: Cloudflare API token with DNS edit on the zone(s); the zone id is looked up when not given.
    cloudflare_api_token: str = ""
    cloudflare_zone_id: str = ""
    dns_propagation_wait: int = 20
    #: Server-hosted apartment with a tunnel box (tunnel.py): its home network(s), e.g. 192.168.1.0/24. Set, every
    #: home-network adapter loads too and these subnets are scanned through the tunnel.
    tunnel_subnets: list[ipaddress.IPv4Network] = field(default_factory=list)
    #: UDP port WireGuard listens on inside the container (published as a per-apartment port on the server).
    tunnel_port: int = 51820
    #: host:port the box reaches this apartment's tunnel at from the internet; written into the box's config.
    tunnel_endpoint: str = ""
    extra: dict[str, str] = field(default_factory=dict)

    @property
    def db_path(self) -> Path:
        return self.data_dir / "gateway.db"

    @property
    def key_path(self) -> Path:
        return self.data_dir / "secret.key"


def load_settings() -> Settings:
    data_dir = Path(os.environ.get("CUBE_DATA_DIR", "/data")).expanduser()
    log_format = os.environ.get("CUBE_LOG_FORMAT", "json").strip().lower()
    if log_format not in {"json", "text"}:
        raise SystemExit("CUBE_LOG_FORMAT must be json or text")
    cors = _list("CUBE_CORS_ORIGINS") or ["*"]
    hosted = _bool("CUBE_SERVER_HOSTED", False)
    tunnel_subnets = _networks("CUBE_TUNNEL_SUBNETS")
    return Settings(
        data_dir=data_dir,
        host=os.environ.get("CUBE_HOST", "0.0.0.0").strip(),
        port=_int("CUBE_PORT", 8686, 1, 65535),
        log_level=os.environ.get("CUBE_LOG_LEVEL", "INFO").strip().upper(),
        log_format=log_format,
        name=os.environ.get("CUBE_GATEWAY_NAME", "").strip() or None,
        mdns_advertise=_bool("CUBE_MDNS_ADVERTISE", True),
        scan_subnets=_networks("CUBE_SCAN_SUBNETS") or tunnel_subnets,
        subnet_scan=_bool("CUBE_SUBNET_SCAN", True),
        cors_origins=cors,
        provisioning_ttl=_int("CUBE_PROVISIONING_TTL", 900, 120, 3600),
        rethink_mqtt_url=os.environ.get("CUBE_RETHINK_MQTT_URL", "").strip(),
        rethink_discovery_prefix=os.environ.get("CUBE_RETHINK_DISCOVERY_PREFIX", "homeassistant").strip(),
        rethink_prefix=os.environ.get("CUBE_RETHINK_PREFIX", "rethink").strip(),
        rethink_api_server=os.environ.get("CUBE_RETHINK_API_SERVER", "").strip(),
        rethink_mqtt_server=os.environ.get("CUBE_RETHINK_MQTT_SERVER", "").strip(),
        softap_interface=os.environ.get("CUBE_SOFTAP_INTERFACE", "").strip(),
        poll_interval=_int("CUBE_POLL_INTERVAL", 30, 5, 3600),
        relay_url=os.environ.get("CUBE_RELAY_URL", "").strip().rstrip("/"),
        relay_enroll_token=os.environ.get("CUBE_RELAY_ENROLL_TOKEN", "").strip(),
        relay_port=_int("CUBE_RELAY_PORT", 8687, 1, 65535),
        server_hosted=_bool("CUBE_SERVER_HOSTED", False),
        allow_remote_claim=_bool("CUBE_ALLOW_REMOTE_CLAIM", _bool("CUBE_SERVER_HOSTED", False)),
        rethink_only_provisioned=_bool("CUBE_RETHINK_ONLY_PROVISIONED", _bool("CUBE_SERVER_HOSTED", False)),
        cloud_mqtt_url=os.environ.get("CUBE_CLOUD_MQTT_URL", "").strip(),
        mqtt_admin_url=os.environ.get("CUBE_MQTT_ADMIN_URL", "").strip(),
        mqtt_admin_user=os.environ.get("CUBE_MQTT_ADMIN_USER", "").strip(),
        mqtt_admin_password=os.environ.get("CUBE_MQTT_ADMIN_PASSWORD", "").strip(),
        mqtt_public_server=os.environ.get("CUBE_MQTT_PUBLIC_SERVER", "").strip(),
        mqtt_gateway_url=os.environ.get("CUBE_MQTT_GATEWAY_URL", "").strip(),
        mqtt_ca_file=os.environ.get("CUBE_MQTT_CA_FILE", "").strip(),
        nle_url=os.environ.get("CUBE_NLE_URL", "").strip().rstrip("/"),
        matter_url=_ws_url("CUBE_MATTER_URL"),
        tls_port=_int("CUBE_TLS_PORT", 0 if hosted else 8688, 0, 65535),
        relay_tls_lan_zone=os.environ.get("CUBE_RELAY_TLS_LAN_ZONE", "").strip().strip(".").lower(),
        relay_tls_remote_zone=os.environ.get("CUBE_RELAY_TLS_REMOTE_ZONE", "").strip().strip(".").lower(),
        relay_tls_port=_int("CUBE_RELAY_TLS_PORT", 0, 0, 65535),
        relay_tls_public_port=_int("CUBE_RELAY_TLS_PUBLIC_PORT", 443, 1, 65535),
        acme_directory=os.environ.get("CUBE_ACME_DIRECTORY", "https://acme-v02.api.letsencrypt.org/directory").strip(),
        acme_email=os.environ.get("CUBE_ACME_EMAIL", "").strip(),
        acme_ca_file=os.environ.get("CUBE_ACME_CA_FILE", "").strip(),
        cloudflare_api_token=os.environ.get("CUBE_CLOUDFLARE_API_TOKEN", "").strip(),
        cloudflare_zone_id=os.environ.get("CUBE_CLOUDFLARE_ZONE_ID", "").strip(),
        dns_propagation_wait=_int("CUBE_DNS_PROPAGATION_WAIT", 20, 0, 300),
        tunnel_subnets=tunnel_subnets,
        tunnel_port=_int("CUBE_TUNNEL_PORT", 51820, 1, 65535),
        tunnel_endpoint=os.environ.get("CUBE_TUNNEL_ENDPOINT", "").strip(),
    )
