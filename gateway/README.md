# CUBE Gateway

The Linux side of CUBE OS: finds smart devices on the home network, sets up factory-new ones on Wi-Fi,
pairs them locally and keeps them under control, with no manufacturer account wherever the device allows.
It ships as one Docker image. The phone app talks to it over the LAN, over Tailscale, or through the
optional relay.

- Operator guide (install, pairing, compatibility, remote access, limits): [../docs/CUBE_GATEWAY.md](../docs/CUBE_GATEWAY.md)
- API reference: [API.md](API.md)

## Run it

```bash
docker run -d --name cube-os-gateway --network host --restart unless-stopped \
  -v cube-os-data:/data ghcr.io/hmahmoud2211/cube-os-gateway:latest

docker logs cube-os-gateway          # shows the setup code and a QR code for the app
```

No `.env` file is needed. The first start creates `/data/gateway.db` and `/data/secret.key`. Host
networking is what lets mDNS, SSDP and the vendors' UDP broadcasts reach your devices.

Build the image yourself instead of pulling it:

```bash
docker build -t cube-os-gateway:local gateway/
```

## Develop

Python 3.12 or newer (the image uses 3.14).

```bash
cd gateway
uv sync --locked --extra test             # .venv with exactly the versions in uv.lock
.venv/bin/pytest -q                      # protocol mocks, no network beyond localhost
.venv/bin/ruff check cube_gateway tests
CUBE_DATA_DIR=./data CUBE_LOG_FORMAT=text .venv/bin/cube-gateway serve
```

Dependencies are pinned in `uv.lock`; the image and CI install from it and fail if it's stale. To change one, edit
`pyproject.toml`, run `uv lock` (or `uv lock --upgrade-package <name>`), and commit both. Dependabot opens weekly
update PRs.

`cube-gateway` commands: `serve` (default), `relay`, `setup-code`, `reset-owner`, `healthcheck`, `tunnel-config`.

## Layout

| Path | What it does |
| --- | --- |
| `cube_gateway/api.py` | REST API and WebSocket events under `/api/v1` |
| `cube_gateway/gateway.py` | Builds and starts every service; recovery after restart |
| `cube_gateway/security.py` | Setup code, owner claim, invites, hashed tokens, identity proofs, rate limits |
| `cube_gateway/adapters/` | One module per protocol, all implementing `adapters/base.py`; `registry.py` isolates failures |
| `cube_gateway/discovery/` | mDNS (browse + advertise), SSDP, authorized subnet probe, the job engine |
| `cube_gateway/provisioning/` | Plugins with verified hotspot rules, the session state machine, gateway-side Wi-Fi |
| `cube_gateway/devices.py` | Persistent registry, monitoring with back-off, commands, pairing jobs |
| `cube_gateway/relay/` | Optional remote relay: server (`cube-gateway relay`), the gateway's tunnel client, gateway certificates (ACME DNS-01) and the pass-through TLS listener |
| `cube_gateway/tunnel.py` | Server-hosted apartments with a tunnel box: WireGuard to the home network, set up as root then dropped |
| `cube_gateway/tls.py` | The gateway's HTTPS: its key, certificate renewal through the relay, the listener |
| `cube_gateway/catalog.py` | The brands the app lists, built from loaded adapters and plugins |
| `tests/` | Unit and integration tests with protocol mocks |

## Licences

Check a new dependency's licence before adding it.
To list what the image ships (runtime packages only, then put the test tools back):

```bash
uv sync --locked && uvx pip-licenses --python .venv/bin/python --from=mixed --format=markdown
uv sync --locked --extra test
```

## Adding an adapter

1. Create `cube_gateway/adapters/<name>.py` with a `DeviceAdapter` subclass. Give it an honest `AdapterInfo`
   (`status`, `auth`, `account_free`, `verified_models` empty until tested on hardware).
2. Register it in `adapters/registry.py` and give it a brand in `catalog.py`.
3. If factory-new devices can be put on Wi-Fi with a documented protocol, add a plugin to
   `provisioning/plugins.py`, citing its source and listing the models any default password applies to.
4. Add tests under `tests/adapters/` with a protocol mock.
