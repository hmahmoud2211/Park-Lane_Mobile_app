# CUBE Gateway: install, connect, compatibility and limits

CUBE OS adds and controls smart devices through the **CUBE Gateway**, a Linux service in one Docker image that
sits on the home network. It finds devices, sets up new ones on Wi-Fi, pairs them locally and keeps them
under control, without manufacturer accounts wherever the device allows it. The phone app is a separate
install (EAS build); Docker only packages the gateway.

- [How it fits together](#how-it-fits-together)
- [Install the gateway](#install-the-gateway)
- [Connect the app](#connect-the-app)
- [Add a device](#add-a-device)
- [Compatibility](#compatibility)
- [LG ThinQ appliances via ReThink](#lg-thinq-appliances-via-rethink)
- [SONOFF and the S26R2TPF](#sonoff-and-the-s26r2tpf)
- [Remote access](#remote-access)
- [Configuration](#configuration)
- [Security model](#security-model)
- [Operations](#operations)
- [Test results](#test-results)
- [Not supported, and why](#not-supported-and-why)

---

## How it fits together

```
 CUBE OS app (phone)
   │  home Wi-Fi: http://<gateway>:8686        away: Tailscale, or https://<relay>/relay/v1/g/<id>
   ▼
 CUBE Gateway  (Docker, --network host, volume /data)
   ├─ discovery: mDNS, SSDP, vendor UDP, authorized subnet probe
   ├─ adapters: Shelly, WLED, SONOFF, Kasa/Tapo, Tuya, LG webOS, Samsung TV, Yeelight, WiZ, LIFX, Daikin, Midea, LG ThinQ (ReThink)
   ├─ provisioning sessions (SoftAP state machine) and pairing
   └─ SQLite registry with sealed credentials, live state, WebSocket events
   │  local protocols only (no manufacturer cloud)
   ▼
 Devices on the home network
```

**Relation to the existing smart home (Home Assistant per unit, `server/`).** That system links brand
*cloud accounts*. It stays in place because the Parklane Assistant and the deployed `api-iot-2.ems-iot.com`
backend use it, and because some brands have no local protocol. In the app, **Add Device is now the only way
to onboard a device**. Linking a brand account appears there only as a clearly labelled fallback,
"Link manufacturer account (cloud)", for brands that have one. Devices already linked through Home
Assistant keep working and still show in My Devices. Cloud-linked devices can't be moved onto the gateway
automatically: the gateway controls devices over the LAN, the hub through a brand's cloud.

## Install the gateway

You need a Linux machine on the same network as the devices (a mini PC, a Raspberry Pi 4/5 with a 64-bit OS, a
NAS or a server), with Docker installed: `curl -fsSL https://get.docker.com | sudo sh`.

```bash
docker run -d --name cube-os-gateway --network host --restart unless-stopped \
  -v cube-os-data:/data ghcr.io/hmahmoud2211/cube-os-gateway:latest
docker logs cube-os-gateway
```

The log shows the gateway's name, a **setup code** such as `76GH-RAZE`, and a QR code. That's all: the first
start creates the database and encryption key in the `cube-os-data` volume, and the container restarts by
itself and keeps its paired devices across restarts and upgrades. Docker reports it `healthy` once the API
answers.

- **The image is published by GitHub Actions** (`.github/workflows/cube-gateway.yml`): every push to `Master`
  updates `:latest` and `:sha-<commit>`, and a tag `gateway-v1.2.3` publishes `:1.2.3` and `:1.2`. It runs
  on `linux/amd64` and `linux/arm64`. Until the workflow has run once on `Master`, nothing is published; build
  locally instead with `docker build -t cube-os-gateway gateway/` and use `cube-os-gateway` as the image.
- **If the repository is private, the package is private too.** Either make it public (GitHub → Packages →
  cube-os-gateway → Package settings → Change visibility) so `docker pull` works on a clean server, or log in
  first: `echo <token with read:packages> | docker login ghcr.io -u <user> --password-stdin`.
- **Why host networking:** mDNS, SSDP and the vendors' UDP broadcasts don't cross Docker's bridge network.
  The gateway listens on port 8686 only. It opens no other ports and exposes no device ports.

Upgrade: `docker pull ghcr.io/hmahmoud2211/cube-os-gateway:latest && docker rm -f cube-os-gateway`, then run
the same `docker run` command again. The volume keeps everything.

## Connect the app

1. In CUBE OS: **My Devices → Add**, or Smart Home's **+**. With no gateway yet, the app opens **Connect
   gateway**.
2. The app looks for gateways on the phone's Wi-Fi network. It probes the phone's own /24 for port 8686,
   private addresses only. You can also type the address or scan the QR code from the log.
3. Enter the setup code. That phone becomes the **owner**. The code is single-use. A lost code can be shown
   again with `docker exec cube-os-gateway cube-gateway setup-code`.
4. Other phones: the owner creates an invite code (Connect gateway → Invite). Invites last 10 minutes, are
   single-use, and give the **member** role (control devices, nothing else) or **owner**.

The app remembers the gateway. If the gateway's IP changes, the app rescans and recognises it by its ID.
**Before the app sends its token to an address it hasn't used before, the gateway must prove its identity**
with an HMAC over a fresh nonce, keyed with a secret only that phone and the gateway share. A device that
merely advertises the same name or ID gets nothing.

Lost the owner phone? `docker exec cube-os-gateway cube-gateway reset-owner` unpairs every phone (devices
and rooms are kept) and prints a new setup code. Then `docker restart cube-os-gateway`.

## Add a device

**Add Device → choose the brand → choose how:**

| Option | When | What happens |
| --- | --- | --- |
| **Find existing device** | The device is already on your Wi-Fi | The gateway scans (mDNS, SSDP, vendor UDP, subnet probe) and lists what it finds: name, model, IP, protocol, whether it needs an account, and what pairing needs. Pick one to pair. |
| **Connect new device** | Factory-new or reset | A guided setup through the device's own setup hotspot (below). Shown only for brands with a supported procedure. |
| **Advanced** | Special cases | Add by IP address (when the router blocks mDNS); gateway-side Wi-Fi setup (Kasa, LG via ReThink) on gateways with a spare Wi-Fi radio; the cloud-account fallback. |

Pairing asks only for what the device needs: nothing (Shelly, WLED, Yeelight, WiZ, LIFX, Kasa legacy), an
**Allow** on the TV (LG webOS, Samsung), a **local key** (Tuya, SONOFF eWeLink LAN mode, Midea V3) or
**credentials** (Tapo: TP-Link account; a Shelly with a password). Then choose a room, rename it, see its
controls and **test control**. The app reports "Working" only when the device confirmed the change. Devices
that don't report back (TV keys) show "Sent, this device doesn't report back".

### Connect new device (SoftAP)

1. Put the device in setup mode. The app shows the brand's steps.
2. The phone joins the device's setup network. On Android 10+ the system asks to connect and keeps the app's
   traffic on that network. On iOS you confirm "Join". In Expo Go, or if the system join fails, the app sends
   you to Wi-Fi settings and detects when you're connected.
3. **Setup network password:** filled in only when a published default exists for that exact model (see
   below). Otherwise you type it. Nothing is guessed.
4. The Wi-Fi details go from the phone **straight to the device** (Shelly: documented RPC), or you enter them
   on the device's own setup page (WLED, SONOFF DIY). The gateway never receives your Wi-Fi password, except
   in the gateway-side setup, where it is used in memory and never stored.
5. The phone returns to your Wi-Fi. The gateway looks for the device for up to 3 minutes, matching it by what
   it learned (the MAC in a Shelly's hotspot name, the SONOFF device ID), pairs it and reads its state. Only
   then does the app say **Connected**. Otherwise it gives the reason and what to do: wrong setup-network
   password, Wi-Fi rejected (2.4 GHz?), device not found (router client isolation?), local key needed,
   permission missing, session expired.

| Plugin | Brand | How | Setup network | Status |
| --- | --- | --- | --- | --- |
| `shelly_softap` | Shelly | Phone sends Wi-Fi with the documented API (Gen1 `/settings/sta`, Gen2+ `WiFi.SetConfig`) | `shelly…-XXXXXX`, open, 192.168.33.1 | Supported |
| `wled_softap` | WLED | You enter Wi-Fi on WLED's page | `WLED-AP`, password `wled1234` (WLED's published default) | Supported |
| `sonoff_diy_softap` | SONOFF | DIY mode: you enter Wi-Fi on the device's page; the phone also reads the device key from `/device` | `ITEAD-XXXXXXXX`, password `12345678` (ITEAD DIY doc) for BASICR3, RFR3, MINI, and S26R2TPF | Supported for BASICR3/RFR3/MINI; **experimental** for S26R2TPF and others |
| `kasa_softap` | TP-Link Kasa | Gateway joins with its own radio, python-kasa `wifi join` | `TP-LINK_…_XXXX`, open | Experimental; needs `CUBE_SOFTAP_INTERFACE` |
| `lg_thinq_softap` | LG ThinQ | The phone joins the appliance's network and runs ReThink's setup protocol (ThinQ1, ThinQ2, Whisen) itself | `LGE_…` or `[LG_…]`; you type the password (the app suggests ReThink's documented default for that name, editable) | Experimental; needs ReThink |
| `lg_thinq_softap_gateway` | LG ThinQ | Gateway joins with its own radio and runs ReThink's `rethink-setup` | Same | Experimental; needs ReThink, `CUBE_SOFTAP_INTERFACE` and `CUBE_RETHINK_SETUP_CMD` |

Tuya/Smart Life, Yeelight, WiZ, LIFX, Midea and Daikin join Wi-Fi only through their own apps. TVs join from
their own settings. For these brands, "Connect new device" is shown greyed out with that explanation; once
the device is on Wi-Fi, use Find existing device.

## Compatibility

"Tested on hardware" means tested in this project against a real device. Everything else is tested against
protocol mocks (see [Test results](#test-results)) and must be confirmed per model before you promise it to
residents.

| Brand | Adapter | Protocol | Status | Account needed | Pairing | Tested on hardware |
| --- | --- | --- | --- | --- | --- | --- |
| LG webOS TVs | `lg_webos` | aiowebostv (local WebSocket) | Supported | No | Allow on TV | No |
| LG ThinQ ACs & appliances | `lg_thinq_rethink` | ReThink MQTT | **Experimental**, model-dependent | No (ReThink replaces LG's cloud) | None | **Yes, read-only:** an RAC_056905_WW AC on this server's ReThink (state, model, 12 sensors; no commands sent) |
| Samsung Smart TVs (2016+) | `samsung_tv` | samsungtvws (WebSocket 8001/8002) | Supported | No | Allow on TV | No |
| SONOFF DIY mode | `sonoff_lan` | ITEAD DIY API v2 (HTTP 8081) | Supported | No | None | No |
| SONOFF eWeLink LAN mode | `sonoff_lan` | AES LAN protocol (SonoffLAN-compatible) | **Experimental** | No, but needs the device key | Device key | No |
| Tuya / Smart Life | `tuya_local` | tinytuya (3.1–3.5) | Limited | No for control; the key is obtained once with a Tuya IoT developer account | Local key | No |
| TP-Link Kasa (legacy firmware) | `tplink` | python-kasa (XOR, port 9999) | Supported | No | None | No |
| TP-Link Tapo / newer Kasa | `tplink` | python-kasa (KLAP/AES) | Supported | TP-Link account email and password, used locally only | Credentials | No |
| Xiaomi Yeelight | `yeelight` | Yeelight Inter-Operation Spec | Supported | No (turn on LAN Control once) | None | No |
| Shelly Gen1 / Gen2+ | `shelly` | Documented HTTP / RPC | Supported | No | None (or device password) | No |
| Philips WiZ | `wiz` | UDP 38899 (community-documented) | Supported | No | None | No |
| LIFX | `lifx` | LIFX LAN protocol | Supported | No | None | No |
| WLED | `wled` | JSON API | Supported | No | None | No |
| Daikin (BRP069) | `daikin` | Unofficial local HTTP | **Experimental** | No | None (BRP072C: adapter key, untested) | No |
| Midea ACs | `midea` | msmart-ng, no cloud calls | Limited | V3 token and key, obtained once | Token + key | No |
| Other / unknown | `generic` | mDNS / SSDP | Detection only | — | Cannot be paired | — |

## LG ThinQ appliances via ReThink

ReThink (github.com/anszom/rethink) replaces LG's cloud. The appliance is set up to talk to ReThink, and ReThink
republishes it as Home Assistant-style MQTT. The gateway is an MQTT client of that.

1. **ReThink running.** On this server it already runs: `/home/ems-server/EMS/repo/rethink`, management UI at
   `https://rethink.ems-iot.com` (password-protected), appliances connect to `lg.ems-iot.com`, and its
   Mosquitto broker listens on `127.0.0.1:1885`.
2. **Point new appliances at ReThink.** ThinQ2 appliances (most current ACs) can be given ReThink's address during
   setup: set `CUBE_RETHINK_API_SERVER` and `CUBE_RETHINK_MQTT_SERVER` to ReThink's `advertise` values (on this
   server: `https://lg.ems-iot.com:4443` and `ssl://lg.ems-iot.com:8884`). Then no DNS change is needed.
   ThinQ1 and Whisen appliances always need DNS redirection: the home router must resolve `lgthinq.com` and
   `*.lgthinq.com` to the ReThink server (DNS override, Pi-hole, AdGuard Home, or the `dns` service in
   [`docker/rethink/`](../docker/rethink/)). This server's nginx already forwards `*.lgthinq.com` to ReThink.
3. **Point the gateway at the broker:** `-e CUBE_RETHINK_MQTT_URL=mqtt://<host>:<port>` (credentials as
   `mqtt://user:pass@host:port`; `mqtts://` for TLS). The broker must be reachable from the gateway. The
   broker here is bound to `127.0.0.1`, so only a gateway on this same server can use it as configured.
4. **Set the appliance up for ReThink**, if it's new or still on LG's cloud. In the app: **Add Device → LG →
   Set up an LG ThinQ appliance for ReThink**. The phone joins the appliance's `LGE_…` network and sends your
   Wi-Fi itself. This needs the app build, not Expo Go, because it uses raw TLS sockets. Alternatives: run
   ReThink's `rethink-setup` from a laptop (`npx tsx rethink-setup.ts 192.168.120.254 <ssid> <password>`), or
   let a gateway with a spare Wi-Fi radio do it (`CUBE_SOFTAP_INTERFACE` plus
   `CUBE_RETHINK_SETUP_CMD="npx tsx /opt/rethink/rethink-setup.ts"`). The gateway recognises the new
   appliance as the one ReThink didn't know before setup started.
5. Already on ReThink: **Add Device → LG → Find an appliance on ReThink**.
6. **AC settings:** Device → **All AC settings** shows everything ReThink exposes for the model: mode, set point,
   fan speed, both swings, Jet, Air purify, Energy saving, timers, filter hours and reset, and diagnostics.
   Each setting says when it isn't available and what it needs (e.g. Jet: "AC on, in Cooling or Heating").
   Settings the unit doesn't echo back are shown as not confirmed until it reports.

Notes:
- ReThink is GPL-2.0. The gateway doesn't include ReThink code: it talks MQTT to it and can start its setup
  tool as a separate program. **The app's** `src/services/lg/lgSetupProtocol.ts` (from Master) re-implements
  `rethink-setup.ts` in TypeScript. Have it reviewed for GPL obligations before publishing the app to the
  stores.
- Only models in ReThink's support table are translated. Others appear as unsupported.
- On connect the gateway sends Home Assistant's birth message (`homeassistant/status` = `online`), which makes
  ReThink re-announce its devices. If Home Assistant shares the broker this is harmless; it sends the same.
- Exposed: climate (mode, target temperature, fan, power through ReThink's power topic), every extra ReThink
  announces (switches, numbers, selects, buttons, sensors) as settings with availability, and readings.

## SONOFF and the S26R2TPF

- **DIY mode** (ITEAD's documented API) is local and account-free. ITEAD lists BASICR3, RFR3 and MINI.
  Put a device in Compatible Pairing Mode (hold the button 5 s, then 5 s again until the LED blinks
  continuously), join `ITEAD-XXXXXXXX` with password `12345678`, open `http://10.10.7.1/` and enter your
  2.4 GHz Wi-Fi.
- **S26R2TPF:** this project's earlier SONOFF work confirmed the `ITEAD-` network with `12345678` and
  `GET http://10.10.7.1/device` (returns `deviceid` and `apikey`) on this model. A `POST /ap` request timed
  out, so the gateway doesn't use it. Whether the S26R2TPF's setup page accepts DIY-mode Wi-Fi isn't verified.
  The flow is therefore marked **experimental**. During setup the phone reads `/device` and hands the
  `apikey` to the gateway as the device key. That way, if the plug ends up in eWeLink LAN mode instead of DIY
  mode, pairing can still finish with the encrypted LAN protocol (also experimental).
- **Devices set up with the eWeLink app** encrypt their LAN traffic. They are found but need their device key.
  Pairing checks the key against the device's announcement before accepting it.

## Remote access

Local control works without internet. Away from home you need a route to the gateway. There are two, and
neither exposes the gateway or any device port to the internet.

### Tailscale / WireGuard (development, and end-to-end encrypted)

1. Install Tailscale on the gateway host and on the phone, both signed in to the same tailnet.
2. The gateway's Tailscale address (`100.x.y.z`, or its MagicDNS name) appears in the app's Connect gateway →
   Remote access (`GET /api/v1/remote` lists it). Add `http://100.x.y.z:8686` as the remote address.
3. The app uses the home address when it answers and the Tailscale address otherwise, verifying the gateway's
   identity the first time it uses each address.

Traffic is WireGuard-encrypted end to end. Any WireGuard setup works the same way: give the phone a route to
the gateway's address.

### The CUBE relay (production)

The same image runs a relay: `cube-gateway relay`. Gateways keep an outbound WebSocket to it, so no router
ports are opened. The app calls `https://<relay>/relay/v1/g/<gateway_id>/api/v1/...` with the same token it
uses at home. **The gateway checks every request itself.** The relay only routes. It stores gateway IDs and
hashed tunnel secrets, never client tokens or device credentials. Owners can't be claimed through the relay.

Run it on a public server, behind HTTPS:

```bash
docker run -d --name cube-relay --restart unless-stopped -p 127.0.0.1:8687:8687 \
  -e CUBE_RELAY_ENROLL_TOKEN="$(openssl rand -base64 32)" -v cube-relay-data:/data \
  ghcr.io/hmahmoud2211/cube-os-gateway:latest relay
```

nginx (WebSockets must pass through):

```nginx
server {
    listen 443 ssl;
    server_name cube-relay.ems-iot.com;
    ssl_certificate     /etc/nginx/ssl/cube/cert.pem;      # Cloudflare origin certificate for *.ems-iot.com
    ssl_certificate_key /etc/nginx/ssl/cube/key.pem;
    location /relay/ {
        proxy_pass http://127.0.0.1:8687;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
}
```

Then, in the app (owner): Connect gateway → Remote access → relay URL `https://cube-relay.ems-iot.com` and the
enrolment token. The gateway enrols and keeps the tunnel open (`PUT /api/v1/remote/relay`). Revoking a phone
on the gateway (`DELETE /api/v1/auth/clients/{id}`) cuts it off through the relay at once.

**Deployed on the EMS server (2026-11-04):**

| Item | Value |
| --- | --- |
| Public URL | `https://cube-relay.ems-iot.com` (Cloudflare proxied → 102.43.60.185) |
| Container | `cube-relay` (image `cube-os-gateway:1.0.0`, `relay` mode, host network, `127.0.0.1:8687`, `--restart unless-stopped`) |
| Settings and enrolment token | `/home/ems-server/EMS/cube-relay/relay.env` (0600). Show the token with `grep TOKEN /home/ems-server/EMS/cube-relay/relay.env` |
| Data | Docker volume `cube-relay-data` (`relay.db`: gateway IDs and hashed tunnel secrets) |
| nginx | `/etc/nginx/conf.d/cube-relay.conf`: only `/relay/` is proxied; rate limits use Cloudflare's `CF-Connecting-IP` |
| Logs and health | `docker logs -f cube-relay`; `curl https://cube-relay.ems-iot.com/relay/v1/health` |

To restart or upgrade it: `docker rm -f cube-relay`, then
`docker run -d --name cube-relay --network host --restart unless-stopped --env-file /home/ems-server/EMS/cube-relay/relay.env -v cube-relay-data:/data <image> relay`.

**Limitation:** TLS ends at the relay, so whoever operates the relay could read traffic in transit. Use
Tailscale when that matters. End-to-end encryption through the relay is not implemented.

## Configuration

All optional, as `-e NAME=value` on `docker run`.

| Variable | Default | Meaning |
| --- | --- | --- |
| `CUBE_PORT` | `8686` | API port |
| `CUBE_HOST` | `0.0.0.0` | Bind address. Set an IP to listen on one interface only |
| `CUBE_GATEWAY_NAME` | `CUBE Gateway XXXX` | Name shown in the app (also settable from the app) |
| `CUBE_DATA_DIR` | `/data` | Database, key and setup code |
| `CUBE_LOG_LEVEL` / `CUBE_LOG_FORMAT` | `INFO` / `json` | `text` for human-readable logs |
| `CUBE_MDNS_ADVERTISE` | `1` | Advertise `_cube-gw._tcp` on the LAN |
| `CUBE_SUBNET_SCAN` | `1` | Allow the TCP probe of the local /24 during scans |
| `CUBE_SCAN_SUBNETS` | (auto) | Comma-separated private networks to scan, each /22 or smaller |
| `CUBE_POLL_INTERVAL` | `30` | Seconds between state reads for devices without push updates |
| `CUBE_PROVISIONING_TTL` | `900` | Seconds a setup session stays open |
| `CUBE_CORS_ORIGINS` | `*` | Allowed web origins (tokens are bearer headers, no cookies) |
| `CUBE_RETHINK_MQTT_URL` | — | ReThink's MQTT broker; enables LG ThinQ |
| `CUBE_RETHINK_DISCOVERY_PREFIX` / `CUBE_RETHINK_PREFIX` | `homeassistant` / `rethink` | ReThink topic prefixes |
| `CUBE_RETHINK_API_SERVER` / `CUBE_RETHINK_MQTT_SERVER` | — | ReThink's public addresses, handed to ThinQ2 appliances during phone setup so they need no DNS override (set both) |
| `CUBE_RETHINK_SETUP_CMD` | — | Command that runs ReThink's `rethink-setup` (gateway-side LG setup) |
| `CUBE_SOFTAP_INTERFACE` | — | Spare Wi-Fi interface for gateway-side setup. Also needs `-v /run/dbus:/run/dbus:ro --user 0` and NetworkManager on the host |
| `CUBE_RELAY_URL` | — | Relay to connect to at start (normally set from the app instead) |
| `CUBE_RELAY_ENROLL_TOKEN` / `CUBE_RELAY_PORT` | — / `8687` | Relay mode only |

## Security model

- **Ownership:** proven by reading the setup code from the gateway's log or with `docker exec`, both of which
  need access to the server. 10 wrong codes rotate it, claims are rate-limited, and claiming is refused
  through the relay.
- **Clients:** random 256-bit bearer tokens, stored as SHA-256 hashes, revocable at once (WebSocket closed
  too). Roles are owner and member; members can't pair, remove, rename or manage access.
- **Gateway identity:** an HMAC challenge before a phone sends its token to a new address.
- **Credentials at rest:** local keys, TV tokens, device keys and Tapo logins are sealed with AES-256-GCM.
  The key is in `/data/secret.key` (0600), and each blob is bound to its device ID. They are never returned
  by the API and never logged. Logs redact any field or `key=value` that looks secret.
- **Wi-Fi passwords:** go phone → device. With gateway-side setup they're used in memory only.
- **Network scope:** scans only private networks of the gateway's own interfaces (at most a /24 each, or
  `CUBE_SCAN_SUBNETS`). Manual probes accept private IPv4 only. Every name, model and header from the network
  is size-limited and stripped of control characters.
- **Fault isolation:** every adapter call runs with a timeout and an exception guard. A failing adapter fails
  its own operation and is logged; a broken adapter module is listed as not loaded and the rest load.
- **No silent cloud uploads:** the gateway contacts no manufacturer cloud. msmart-ng runs with
  `auto_connect=False`, and Tapo credentials are used for local authentication only.
- **LAN transport:** on the home network the API is plain HTTP, like most home hubs; React Native can't pin a
  self-signed certificate without extra native code. Use Tailscale (WireGuard) if the LAN isn't trusted.

## Operations

| Task | How |
| --- | --- |
| Logs | `docker logs -f cube-os-gateway` (JSON lines; `-e CUBE_LOG_FORMAT=text` for plain text) |
| Setup code again | `docker exec cube-os-gateway cube-gateway setup-code` |
| Unpair all phones | `docker exec cube-os-gateway cube-gateway reset-owner`, then `docker restart cube-os-gateway` |
| Back up | Copy the volume while running or stopped: `docker run --rm -v cube-os-data:/data -v "$PWD":/b alpine tar czf /b/cube-backup.tgz -C /data .`. It contains `secret.key`: without it, stored device credentials can't be read |
| Health | `docker inspect --format '{{.State.Health.Status}}' cube-os-gateway`, or `GET /api/v1/health` |
| API explorer | `http://<gateway>:8686/api/v1/docs` (protected routes still need a token) |

## Test results

Run on 2026-11-04 on the development server (Ubuntu, x86_64, Docker 29.8, Python 3.14.4, Node 22.23).

| Check | Result |
| --- | --- |
| Gateway tests: `cd gateway && .venv/bin/pytest -q` | **134 passed**: API and auth, ownership, invites, revocation, identity proof, rate limits, WebSocket events, discovery (dedupe, scope, cancellation, crash isolation), pairing (local key, approval, detection-only), registry persistence and restart, commands (confirmed / assumed / pending / unsupported / offline back-off), the SoftAP state machine (happy path, wrong network, Wi-Fi rejected, device not found, expiry, cancel, restart recovery, gateway transport), hotspot password rules, relay end to end over real sockets, every adapter against protocol mocks, and the LG settings mapping against the real discovery message of an RAC_056905_WW |
| `ruff check cube_gateway tests` | Clean |
| `docker build gateway/` (amd64) | Builds; image 321 MB |
| Container first start → setup code via `docker exec` → claim → data → `docker restart` | Data and token survive; Docker health `healthy` |
| Real LG AC (RAC_056905_WW) on this server's ReThink, read-only | Found, paired, state read (mode, target 24 °C, room 26 °C, fan), model and 12 sensors after restart. **No commands were sent to the appliance** |
| Relay on `cube-relay.ems-iot.com` (nginx + Cloudflare) | A gateway enrolled with the token and opened its tunnel. Through the public URL: health answered, `/devices` 401 without a token and 200 with one, claiming refused (403), a room created, and the events WebSocket got `ready` and then a live `rooms.updated`. Without the token, enrolment is refused. The test gateway and its enrolment were then removed |
| ARM64 | Every dependency resolves to an aarch64 wheel for CPython 3.14. The arm64 image build itself runs in CI (QEMU); it was not run on this server |
| App: `npx tsc --noEmit`, `npx expo lint` | Both pass |
| App: `npx expo export` (Android, web) | Builds |

**Still to test on real hardware:** every adapter other than the read-only LG check above; commands to the
LG AC; Wi-Fi provisioning for Shelly, WLED and SONOFF (especially the S26R2TPF) from a phone; the Android and
iOS hotspot join with `react-native-wifi-reborn` in a development build (it isn't in Expo Go); gateway-side
setup over NetworkManager; the relay from a phone on mobile data; the arm64 image on a Raspberry Pi.

## Not supported, and why

| Not supported | Why |
| --- | --- |
| Universal compatibility | Each brand speaks its own protocol, and many have no local one. Only the brands above have adapters |
| Tuya Wi-Fi setup in the app; reading Tuya local keys | Tuya's pairing protocol needs its cloud. Keys come only from Tuya's cloud API (`tinytuya wizard`). The gateway doesn't bypass this |
| Samsung appliances (SmartThings), LG appliances outside ReThink's list | No local API; cloud only (available through the Home Assistant cloud fallback where linked) |
| Other Xiaomi / Mi Home devices | They need a per-device token from Xiaomi's cloud; not implemented |
| SONOFF `POST /ap` (eWeLink app-style setup) | Undocumented. It timed out on the S26R2TPF and would register the device with eWeLink's cloud |
| Guessed or brute-forced hotspot passwords | Only published, model-specific defaults are filled in |
| BLE provisioning | No verified BLE protocol for the target devices yet, and the hardware is Wi-Fi focused. The provisioning engine has a transport slot for it |
| Zigbee, Z-Wave, Thread/Matter | Need radios and stacks the gateway doesn't include. Matter devices are detected only |
| Native mDNS in the app | React Native has no mDNS without another native module. The app probes the /24 instead, and the gateway still advertises `_cube-gw._tcp` |
| HTTPS on the LAN | See the security model; use Tailscale |
| Parklane Assistant controlling gateway devices | The assistant service talks to the EMS backend in the cloud, which can't reach a home LAN. It would need the relay plus a backend change |
| Scenes, automations, energy history | Not in this release |
| The Alexa skill, SONOFF cloud and the old CUBE/SONOFF pairing from Master | Built on the server modules the Home Assistant rewrite replaced. Kept on branch `archive/master-2026-11-04` |
