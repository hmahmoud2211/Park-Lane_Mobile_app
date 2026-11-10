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

The server uses the official Home Assistant image; no Home Assistant source is needed there.

## 4. Create `backend/.env`

```bash
cd /opt/parklane/backend
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

# Every new apartment gets its CUBE gateway: the relay's enrol token
GATEWAY_RELAY_ENROLL_TOKEN=<CUBE_RELAY_ENROLL_TOKEN from /home/ems-server/EMS/cube-relay/relay.env>

# The CUBE relay starts with the backend (see "The relay" below)
COMPOSE_PROFILES=relay
RELAY_ENV_FILE=/home/ems-server/EMS/cube-relay/relay.env
RELAY_IMAGE=<the gateway image, pinned: a version tag or …@sha256:…>
# Only when the relay manages the device broker (gateway/deploy/server-mode, setup-broker.sh)
RELAY_CA_FILE=/home/ems-server/EMS/cube-mqtt/certs/ca.crt

# Shown on the public privacy policy (/privacy) and account deletion page (/account/delete),
# which the App Store and Google Play listings link to. Both must be set before you submit.
LEGAL_OPERATOR_NAME=<the company responsible for the app, as registered>
LEGAL_CONTACT_EMAIL=<a mailbox someone reads, for privacy and deletion requests>
PRIVACY_POLICY_DATE=<YYYY-MM-DD, the day the policy text was approved>
```

`GATEWAY_RELAY_ENROLL_TOKEN` turns on the gateway per apartment. To copy it:
`grep '^CUBE_RELAY_ENROLL_TOKEN=' /home/ems-server/EMS/cube-relay/relay.env`. Leave it empty and apartments get no
gateway by themselves (`new-apartment.sh` still works). Other `GATEWAY_*` settings are in `backend/.env.example`.
Their defaults match `new-apartment.sh`. Each new gateway gets the newest build of `GATEWAY_IMAGE` (it is pulled
every time). Existing gateways move to it with **Update** on their apartment's page.

> 🔑 **Keep a copy of `EMS_ENCRYPTION_KEY` somewhere safe.** It encrypts every apartment's Home Assistant token. If it's lost, every apartment has to be set up again.

`HA_IMAGE` is pinned to one release, not `stable`, so every apartment runs the same tested version. Change it only on purpose (see "Upgrade Home Assistant" below).

### The relay

The CUBE relay lets phones reach the apartments' gateways from anywhere ([CUBE_GATEWAY.md](CUBE_GATEWAY.md)). It is
its own image, the gateway's, in `relay` mode, so it stays a separate container: it never gets the Docker socket or
the backend's data. `COMPOSE_PROFILES=relay` only makes `backend/compose.yaml` start it together with the backend.
Without `COMPOSE_PROFILES=relay`, compose and `dev.sh server` leave the relay alone.

- **`RELAY_IMAGE`**: pin it. With `:latest`, a gateway update that pulls the same image also moves the relay at its
  next start.
- **`RELAY_CA_FILE`**: needed once the relay manages the device broker (`relay.env` then has `CUBE_MQTT_CA_FILE`).
  `dev.sh server` stops and says so if it's missing.
- **Data**: the Docker volume `cube-relay-data`, the same one the relay used before compose. `dev.sh server` creates
  it on a new server. `docker compose down -v` never deletes it.

**Moving a relay started with `docker run` (once).** Add the lines above to `backend/.env` and run
`./scripts/dev.sh server`. If `RELAY_IMAGE` is empty, it stops and prints the exact build `cube-relay` runs now:
copy that line into `.env` and run it again. It builds the backend first, then replaces `cube-relay` with the same
image, settings and volume. Remote access pauses for a few seconds and the enrolled gateways stay enrolled. Check with
`docker ps --filter name=cube-relay` (`(healthy)`) and the health URL in the table below.

## 5. Start the backend

```bash
cd /opt/parklane
./scripts/dev.sh server --pull <commit>   # the image from Docker Hub (see "Images on Docker Hub" below)
./scripts/dev.sh server                   # or: build it here from this checkout
```
This creates the private Docker network, gets the backend image (`hmahmoud2211/parklane-backend`, tagged with the git commit, e.g. `:117a038`) and starts it with `backend/compose.yaml`. With `COMPOSE_PROFILES=relay` it starts the CUBE relay (`cube-relay`) next to it. Both restart by themselves after a reboot, and `docker ps` shows them as `(healthy)` once they answer.

### Images on Docker Hub

The backend image is built and pushed from a developer machine, so the server only downloads it. No GitHub
Actions are involved.

1. **On the Mac** (signed in with `docker login` as `hmahmoud2211`), with everything in `backend/` and `shared/`
   committed:
   ```bash
   ./scripts/dev.sh push
   ```
   It runs the backend's typecheck and tests, builds the image for `linux/amd64` (the server) and `linux/arm64`, and
   pushes `hmahmoud2211/parklane-backend:<commit>` and `:latest`. It refuses to push uncommitted code, because the tag
   must name exactly the code inside. At the end it prints the command for the server.
2. **On the server:**
   ```bash
   cd /opt/parklane && git pull && ./scripts/dev.sh server --pull <commit>
   ```
   `git pull` still brings `compose.yaml` and `dev.sh`; only the build moves off the server. `--pull` alone takes
   `:latest`. If the pull fails, nothing is stopped.

- **Private repository:** run `docker login` once on the server with a Docker Hub access token (read-only is
  enough). A public one needs nothing.
- **Which code is running:** `docker inspect -f '{{index .Config.Labels "org.opencontainers.image.revision"}}' parklane-backend`
- **Builds from before Docker Hub** are named `parklane-backend:<commit>`. To start one again:
  `docker tag parklane-backend:<commit> hmahmoud2211/parklane-backend:<commit>`, then
  `./scripts/dev.sh server --pull <commit>`.
- **Another registry or name:** set `BACKEND_IMAGE` (without a tag) in `backend/.env`, and in the shell on the Mac
  for `push`.

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

**With the admin dashboard** (easiest): open `https://api-iot-2.ems-iot.com/admin`.
1. **First sign-in.** On its first start the backend created an admin account. Sign in with username `admin` and
   the temporary password it printed once: `docker logs parklane-backend 2>&1 | grep -A2 "EMS admin account created"` (or the
   `EMS_ADMIN_PASSWORD` you set in `backend/.env`). The dashboard then asks you to choose your own password.
2. **Apartments → New apartment.** Its Home Assistant and its CUBE gateway are made automatically. The apartment's
   page shows the gateway as **Setting up**, then **Connected** (up to 3 minutes the first time). There is nothing
   to run on the server. **Setup failed** shows the reason and a **Try again** button.
3. **Create an account for this apartment.** Enter the owner's email and name. The dashboard shows a temporary
   password once: give it to the owner with their email. At their first sign-in in the app they choose their own.
4. **Home-only devices** (Tasmota, ESPHome, TP-Link…) also need a tunnel box at home: see the
   [server-mode README](../gateway/deploy/server-mode/README.md#apartments-with-home-only-devices-the-tunnel-box).
   An apartment with its own gateway box at home: **Remove** the server's gateway on its page, then link the box
   there.
5. **More admins:** Accounts → New account → Admin. They also get a temporary password to replace.

Lost admin password? Another admin resets it (Accounts → Reset password). If no admin can sign in, the shared key
still works: `curl -X POST $API/api/admin/users/<id>/reset-password -H "Authorization: Bearer $KEY"`.

**With the API** (scripts, or without the dashboard):

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

The app builds already point at `https://api-iot-2.ems-iot.com` (`eas.json`). From your PC, logged in to an Expo account with access to the `emscompany2016s-team` project (`npx eas-cli@latest whoami`):
```bash
cd frontend
npx eas-cli@latest build --profile preview --platform android     # an APK to test and share
npx eas-cli@latest build --profile production --platform all      # store builds
```

---

## The building services release (real backend, November 2026)

What this release changes on a server, and what to do before it goes live:

1. **Back up `DATA_DIR` first.** Migrations 14 to 20 run by themselves at start: compounds and their rules,
   the inbox, My Unit's records and bills, visitor passes and parcels, service requests, community, amenities,
   parking, the quarter-hour series, and shared reference counters. They add tables and columns; they don't
   delete data.
2. **Fill in the compound's rules** in the dashboard (Compound rules): the emergency number (the app's emergency
   button stays hidden until it is set), the management phone and email, visiting hours, visit windows.
3. **Gate staff** get accounts with the `security` role in the dashboard (Accounts); they use the Gate and
   Parking pages.
4. **Parking:** the bays, gates and roads are the design's sample layout, and the gates' map points are not
   surveyed. Building management must confirm or replace the layout before residents rely on it; the store
   build leaves Parking out until the app is built with `EXPO_PUBLIC_PARKING=1`.
5. **Weather** stays off until you set `WEATHER_CONTACT` (an email or web address MET Norway can reach you at)
   in `backend/.env`; optionally `WEATHER_LAT` and `WEATHER_LON` for the compound's own point.
6. **Never run the generator or the development seed on this server.** `scripts/generate-series.ts` and
   `scripts/seed-dev.ts` write only to demo compounds and refuse a database with real residents unless told
   otherwise; they are for development and demos. If you ever run a script on a server, run it with the same
   environment as the backend (the same `EMS_ENCRYPTION_KEY`), or what it writes can't be read back.
7. **The store build** now includes My Unit and Bills, Visitor Access and Deliveries, Maintenance (with
   Housekeeping and Moving), Community, Amenities and the inbox. The privacy policy (`/privacy`) and the
   deletion page list the new data; update the store's privacy answers to match
   (`docs/store-release/PRIVACY_AND_DATA_DECLARATIONS.md`).

## Day-to-day operations

| Task | How |
|---|---|
| **Update the backend** | On the Mac: `./scripts/dev.sh push`. On the server: `cd /opt/parklane && git pull && ./scripts/dev.sh server --pull <commit>` (or without `--pull` to build there) |
| **Go back to an earlier version** | `./scripts/dev.sh server --pull <commit>`. It uses the copy already on the server when there is one (`docker images hmahmoud2211/parklane-backend` lists them), else downloads it |
| **Backend logs** | `docker logs -f parklane-backend` |
| **Relay logs and health** | `docker logs -f cube-relay`; `curl https://cube-relay.ems-iot.com/relay/v1/health` |
| **Upgrade the relay** | Set `RELAY_IMAGE` in `backend/.env` to the new version, then `cd /opt/parklane/backend && docker compose pull relay && docker compose up -d relay`. Its data (the enrolled gateways) is kept |
| **Restart the relay** (after editing `relay.env`) | `cd /opt/parklane/backend && docker compose up -d --force-recreate relay` |
| **One apartment's logs** | `docker ps` (find `parklane-ha-…`), then `docker logs -f parklane-ha-…` |
| **Retry a failed apartment** | `curl -X POST $API/api/admin/units/<id>/provision -H "Authorization: Bearer $KEY"` |
| **Update an apartment's gateway** | Its page in the dashboard → **Update**: pulls the newest `GATEWAY_IMAGE` and restarts it with the same settings and devices (a tunnel box's included) |
| **One apartment's gateway logs** | The container name is on its page: `docker logs -f cube-gw-…` |
| **A removed gateway's data** | **Remove** keeps its devices in the volume of the same name, so **Start the gateway again** brings it back. To delete them for good: `docker volume rm cube-gw-…` |
| **Upgrade Home Assistant** | Change `HA_IMAGE`, then per apartment `docker rm -f parklane-ha-…` and call `/provision` for it. Its data and linked accounts are kept |
| **Set up the clinic** | Doctors and desk accounts come from the CLI: `docker exec parklane-backend npm run clinic -- …`, see [CLINIC.md](CLINIC.md#setting-up-real-doctors). Add the AI and ElevenLabs keys to `backend/.env` before Health Passport can read documents or make summaries, and read its [production checklist](CLINIC.md#production-checklist) first |
| **Back up** | Copy `/srv/parklane` (database, the clinic's sealed files and every apartment's data) plus your `EMS_ENCRYPTION_KEY`, for example nightly |

### Updating a server set up before `server/` became `backend/`

The backend folder used to be called `server/`. `git pull` moves the code, but your `.env` is not in git, so it stays behind in `server/.env`. The first `./scripts/dev.sh server` after the pull stops and prints the command to run; it is:

```bash
cd /opt/parklane
mv server/.env backend/.env
rmdir server            # only if nothing else is left in it
./scripts/dev.sh server
```

The database and the apartments live in `PARKLANE_DATA` (`/srv/parklane`), outside the repo, so nothing else moves. The running container keeps serving until the new build replaces it, and the compose project and container names stay `parklane` and `parklane-backend`.

### Accounts building management creates

An admin creates residents' (and other admins') accounts with a temporary password, shown once. Until its owner
signs in and chooses their own (at least 10 characters), the account can do nothing else: every call answers
`password_change_required`. A password reset from the dashboard does the same and also signs the person out
everywhere. Admins sign in with their own accounts, so each change in the log names who made it; the shared
`ADMIN_API_KEY` stays for scripts and emergencies.

### The default account

The backend creates one ready-made sign-in when it starts: username `ems`, password `5002`. It is an ordinary resident account, made once and never overwritten.

Nobody can change its password, sign out its other sessions or delete it (the API answers 403), so one person cannot lock out the next.

**That password is short and known, and the login route allows 10 tries a minute from each address, so treat this account as public.** Never link it to a real resident's apartment, because anyone could then control that home's devices, and keep no real medical records in it. To change it before the first start, set `EMS_DEFAULT_USERNAME` and `EMS_DEFAULT_PASSWORD` in `backend/.env`; to turn it off, set both empty. Once the account exists, those settings no longer change it.

**Security:** the backend container has access to Docker, which means full control of the server. Keep `ADMIN_API_KEY` and `.env` private, never open port 8787 to the internet (the script binds it to the server itself only), and keep SSH key-only.

> **Before rolling out to everyone:** this production path has been tested against a fake Docker and a fake Home Assistant, but not yet on your real server. Treat the first apartment as a pilot: create it, link a real device, control it from the app, then open it up to others.

I can turn this into a single `setup-server.sh` that runs steps 2–6 and asks only for the values it can't guess, and add it to `docs/SMART_HOME.md`.