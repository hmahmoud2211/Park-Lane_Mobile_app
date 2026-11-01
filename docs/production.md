Here's the full production setup. A summary first: the **server** runs one thing you install, the **backend** (in Docker). The backend then creates a **Home Assistant container for each apartment** by itself. The **mobile app** isn't installed on the server: you build it with EAS, and it already points at `https://api-iot-2.ems-iot.com`.

```
 Phones (Parklane app)
        │ HTTPS
        ▼
 Server ── Caddy (HTTPS, port 443)
        └─ parklane-backend (Docker)  ── creates ──▶ parklane-ha-<apartment> (Docker, one per apartment)
                                                      └─ talks to Tuya / eWeLink / SwitchBot clouds
```

---

## 1. What you need

- **A Linux server:** Ubuntu 24.04 recommended, with SSH access.
- **Memory:** about **0.5 GB of RAM per apartment**, plus 1–2 GB for the system (for example, 16 GB for about 25 apartments). Disk: roughly 0.5 GB per apartment.
- **Your domain:** the DNS record for **`api-iot-2.ems-iot.com`** points at the server's public IP.
- **Firewall:** ports **22** (SSH), **80** and **443** open to the internet.
- **Code access:** permission to clone the GitHub repository, via a deploy key or access token.

> ⚠️ The **old** backend keeps running at `api-iot.ems-iot.com`; this one is new, at `api-iot-2.ems-iot.com`, so nothing has to be stopped. It starts with an empty database. To bring the old EMS accounts over, stop nothing: copy the old `ems.db` with `sqlite3 ems.db ".backup <DATA_DIR>/ems.db"` and set the old backend's `EMS_ENCRYPTION_KEY`. The new backend upgrades that copy and drops only the CUBE and Alexa tables.

## 2. Install Docker and Caddy

```bash
# Docker
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER      # then log out and back in

# Caddy (automatic HTTPS)
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy
```

## 3. Get the code and create the folders

```bash
sudo mkdir -p /opt/parklane /srv/parklane/{data,ha,custom_components}
sudo chown -R $USER /opt/parklane /srv/parklane
git clone -b feature/home-assistant-integration https://github.com/hmahmoud2211/Park-Lane_Mobile_app.git /opt/parklane

# SONOFF support (copied into every new apartment automatically)
cd /tmp && curl -fsSL https://github.com/AlexxIT/SonoffLAN/archive/refs/tags/v3.13.2.tar.gz | tar xz
cp -r /tmp/SonoffLAN-3.13.2/custom_components/sonoff /srv/parklane/custom_components/
```

The `IOT/` folder isn't needed on the server; the official Home Assistant image is used instead.

## 4. Create `server/.env`

```bash
cd /opt/parklane/server
cp .env.example .env
chmod 600 .env
openssl rand -base64 32     # run twice: one for ADMIN_API_KEY, one for EMS_ENCRYPTION_KEY
nano .env
```

Set these values:
```
HOST=0.0.0.0
PORT=8787
ADMIN_API_KEY=<first random value>
EMS_ENCRYPTION_KEY=<second random value>
PUBLIC_URL=https://api-iot-2.ems-iot.com
APP_RETURN_URL=parklane://accounts
DATA_DIR=/srv/parklane/data
TRUST_PROXY=1

# The backend's own container: the folder above data/, ha/ and custom_components/
PARKLANE_DATA=/srv/parklane

HA_IMAGE=ghcr.io/home-assistant/home-assistant:2026.10.4
HA_NETWORK=parklane-ha
HA_CONFIG_ROOT=/srv/parklane/ha
HA_CONFIG_HOST_ROOT=/srv/parklane/ha
HA_CUSTOM_COMPONENTS=/srv/parklane/custom_components
HA_MEMORY_MB=512
HA_TIME_ZONE=Africa/Cairo
```

> 🔑 **Keep a copy of `EMS_ENCRYPTION_KEY` somewhere safe.** It encrypts every apartment's Home Assistant token. If it's lost, every apartment has to be set up again.

`HA_IMAGE` is pinned to one release, not `stable`, so every apartment runs the same tested version. Change it only on purpose (see "Upgrade Home Assistant" below).

## 5. Start the backend

```bash
cd /opt/parklane
./scripts/dev.sh server
```
This creates the private Docker network, builds the backend image (Node and the code in `server/`, tagged with the git commit, e.g. `parklane-backend:117a038`) and starts it with `server/compose.yaml`. The container restarts by itself after a reboot, and `docker ps` shows it as `(healthy)` once it answers.

Check that it's up:
```bash
curl http://127.0.0.1:8787/api/health -H "Authorization: Bearer <ADMIN_API_KEY>"
# {"ok":true,"data":{"status":"ok"}}
```

## 6. Turn on HTTPS

```bash
sudo tee /etc/caddy/Caddyfile >/dev/null <<'EOF'
api-iot-2.ems-iot.com {
    reverse_proxy 127.0.0.1:8787
}
EOF
sudo systemctl reload caddy
```
Caddy gets the certificate automatically. Live updates in the app (WebSockets) work with no extra settings.

Check from your PC: open `https://api-iot-2.ems-iot.com/api/home`. It should answer `{"ok":false,"error":{"code":"unauthorized"…}}`. That error means the new backend is live.

## 7. Create your first apartment (a pilot)

```bash
API=https://api-iot-2.ems-iot.com
KEY=<ADMIN_API_KEY>

# Create the apartment; its Home Assistant is built automatically (1–3 minutes the first time)
curl -X POST $API/api/admin/units -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' \
  -d '{"name": "Tower A · 1203", "building": "Tower A"}'

# Watch it: "provisioning" → "online"
curl $API/api/admin/hubs -H "Authorization: Bearer $KEY"

# After the resident creates their account in the app, add them (unitId comes from the first answer)
curl -X POST $API/api/admin/units/<unitId>/members -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' \
  -d '{"email": "resident@example.com"}'
```
The resident then opens My Devices, sees **Home hub online**, and taps **Add** to link their brands.

## 8. Build the mobile app

The app builds already point at `https://api-iot-2.ems-iot.com` (`eas.json`). From your PC:
```bash
npx eas-cli@latest build --profile preview --platform android     # an APK to test and share
npx eas-cli@latest build --profile production --platform all      # store builds
```

---

## Day-to-day operations

| Task | How |
|---|---|
| **Update the backend** | `cd /opt/parklane && git pull && ./scripts/dev.sh server` |
| **Go back to an earlier build** | `docker images parklane-backend` lists them; then `cd /opt/parklane/server && PARKLANE_VERSION=<commit> docker compose up -d --no-build` |
| **Backend logs** | `docker logs -f parklane-backend` |
| **One apartment's logs** | `docker ps` (find `parklane-ha-…`), then `docker logs -f parklane-ha-…` |
| **Retry a failed apartment** | `curl -X POST $API/api/admin/units/<id>/provision -H "Authorization: Bearer $KEY"` |
| **Upgrade Home Assistant** | Change `HA_IMAGE`, then per apartment `docker rm -f parklane-ha-…` and call `/provision` for it. Its data and linked accounts are kept |
| **Back up** | Copy `/srv/parklane` (database and every apartment's data) plus your `EMS_ENCRYPTION_KEY`, for example nightly |

**Security:** the backend container has access to Docker, which means full control of the server. Keep `ADMIN_API_KEY` and `.env` private, never open port 8787 to the internet (the script binds it to the server itself only), and keep SSH key-only.

> **Before rolling out to everyone:** this production path has been tested against a fake Docker and a fake Home Assistant, but not yet on your real server. Treat the first apartment as a pilot: create it, link a real device, control it from the app, then open it up to others.

I can turn this into a single `setup-server.sh` that runs steps 2–6 and asks only for the values it can't guess, and add it to `docs/SMART_HOME.md`.