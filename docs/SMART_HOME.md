# Smart Home: Handover and Run Guide

Residents control their smart devices (lights, plugs, AC, curtains, locks, TVs and more) from the Parklane app, and add new ones by linking the brand app they already use (Smart Life, SONOFF/eWeLink, SwitchBot, SmartThings, …). Nothing is installed in the apartments: each apartment gets its own Home Assistant on the company server, and the app only ever talks to the EMS backend.

All work is on the branch `feature/home-assistant-integration`.

- [How it works](#how-it-works)
- [What was built](#what-was-built)
- [The three ways to run it](#the-three-ways-to-run-it)
  - [Mode 1: Fake hub (no devices, 5 minutes)](#mode-1-fake-hub)
  - [Mode 2: Real Home Assistant on your PC](#mode-2-real-home-assistant-on-your-pc)
  - [Mode 3: Production on the company server](#mode-3-production-on-the-company-server)
- [Using the app](#using-the-app)
- [Configuration reference](#configuration-reference)
- [Troubleshooting](#troubleshooting)
- [Known limits and next steps](#known-limits-and-next-steps)

---

## How it works

```
 ① Parklane app (phone or web)
        │  HTTPS + live updates (WebSocket)
        ▼
 ② EMS backend  (server/ in this repo, Node)
        │  one Home Assistant per apartment
        ▼
 ③ Home Assistant  (the IOT project: IOT/core)
        │  each brand's own integration
        ▼
 ④ Brand clouds  (Tuya / Smart Life, eWeLink, SwitchBot, SmartThings, …)
        │
        ▼
 ⑤ The resident's devices
```

| Part | What it does |
| --- | --- |
| ① App | Shows the resident's rooms and devices, sends commands, and walks them through linking a brand. Never sees Home Assistant addresses or tokens. |
| ② Backend | Signs residents in, knows which apartment each resident belongs to, and which Home Assistant serves it. Translates devices into a simple model, only lets residents run safe, allowlisted commands on their own devices, and pushes changes to the app live. |
| ③ Home Assistant | The "brain" that speaks to around 2,000 device types. In production every apartment has its own copy, in its own Docker container, on the company server. |
| ④ Brand clouds | Where the devices are already registered by the brand's own app. Home Assistant reaches them over the internet. |
| ⑤ Devices | Keep working with their own app. Parklane is an extra way to control them. |

**Adding a device = linking an account.** Residents do not pair devices one by one. They link the brand account their devices already live in (for example their Smart Life account), and every device in that account appears in Parklane.

**Why one Home Assistant per apartment, in Docker?** Each apartment's linked accounts and devices stay separate, one apartment's problem never affects another, and the backend can create, restart, cap and upgrade each one automatically. Docker is only needed on the server (Mode 3). For testing on a PC you can run one Home Assistant yourself (Mode 2), or none at all (Mode 1).

**What needs a box in the apartment?** Nothing, for devices that use a brand cloud (most Wi-Fi devices). Zigbee, Z-Wave, Thread and local-only devices can't be reached from a server. For those, an apartment can later get its own Home Assistant box, and the backend attaches it the same way (`POST /api/admin/hubs`).

---

## What was built

### Removed

The old device paths were replaced by Home Assistant:

- **CUBE hub:** direct calls and the `/cube` proxy (`metro.config.js`, `vercel.json`), Zigbee and camera pairing from the app.
- **SONOFF hotspot pairing:** the wizard screen, `react-native-wifi-reborn`, `patch-package`, and the location / nearby-Wi-Fi permissions.
- **Custom Alexa skill:** account linking, the OAuth server and the voice API. Voice can come later from Home Assistant's own Alexa and Google support.
- On the backend: the CUBE client, the SONOFF LAN bridge, the device adapters and their database tables (migration 2).

### Backend (`server/`)

| Path | Responsibility |
| --- | --- |
| `src/app.ts` | All routes: accounts, home, devices, rooms, linking, admin, health |
| `src/ha/provisioner.ts` | Creates each apartment's Home Assistant container through the Docker Engine API: network, image, container, `configuration.yaml`, first-user onboarding, long-lived token, shared OAuth app credentials, community integrations |
| `src/ha/hubs.ts` | One live connection per hub. Keeps its devices, rooms and states in memory from Home Assistant's own pushes, and sends `device`, `rooms`, `hub_status` and `accounts` events to the residents' apps |
| `src/ha/haClient.ts` | Home Assistant WebSocket client: login, commands, subscriptions, keep-alive, reconnecting |
| `src/ha/mapping.ts` | Turns Home Assistant devices and entities into the app's device model (kind, room, capabilities, sensors) |
| `src/ha/commands.ts` | The allowlist: which capability and action becomes which Home Assistant service, with values checked and clamped |
| `src/ha/integrations.ts` | The brands residents can link |
| `src/ha/flows.ts` | Turns Home Assistant's setup steps into simple, labelled steps for the app (forms, QR codes, menus, brand sign-in, waiting, done) |
| `src/ha/accounts.ts` | Runs and secures linking flows; lists, reconnects, reloads and unlinks accounts; routes brand sign-in callbacks to the right hub |
| `src/ha/admin.ts` | Attaches a separately run hub, with a network allowlist |
| `src/ha/units.ts` | Apartments and their residents |
| `src/ems/db.ts` | SQLite storage (migrations 3 and 4 add units, members, hubs, audit log, linking sessions) |
| `scripts/fake-hub.ts` | `npm run fake-hub`: the backend with a pretend Home Assistant (Mode 1) |
| `scripts/attach-hub.ts` | `npm run attach-hub`: connects a Home Assistant you run yourself to an apartment (Mode 2) |
| `test/` | 49 tests, including a fake Home Assistant and a fake Docker |

### App (`src/`)

| Screen | What it shows |
| --- | --- |
| **My Devices** (`EmsDevices`) | Live devices with on/off switches, live and hub status, **Add**, and the **Linked accounts** list (sign in again, unlink) |
| **Device** (`DeviceDetail`, new) | Every control the device has, sensor readings, rename and move to a room |
| **Connect Devices** (`ConnectAccount`, new) | The brand list, then each step the brand asks for, until "Account linked" |
| **Smart Home** (updated) | For a signed-in resident: their rooms and devices, with the Lighting, AC, Curtains and TV cards bound to real devices; "+" and the menu open Connect Devices. Visitors and signed-out users still see the designed sample home. Scenes, energy and automations are still sample data |

Supporting code: `src/services/home/` (API calls, device helpers), `src/hooks/useHomeDevices.ts`, `useAccountLink.ts` and `useLinkedAccounts.ts`, `src/components/home/` (device card, controls, slider), `src/context/EmsContext.tsx` (session, home, live device list) and `src/types/home.types.ts`.

**Controls supported:** power, brightness, colour, colour temperature, AC (temperature, mode, fan), curtains and blinds (open, stop, close, position), locks (unlock asks for a second tap and is audited), fans (speed, preset), TVs and speakers (play, pause, volume, mute, source), buttons, and sensor readings.

**Brands residents can link:** Tuya / Smart Life (QR), SONOFF / eWeLink, SwitchBot, LG ThinQ, Ring, ecobee, tado°, Sensibo, Blink, EZVIZ, Ecovacs. Also SmartThings, Google Nest, Netatmo, August, Yale, Miele and Home Connect, which sign in on the brand's own page and need company setup first (see [Mode 3](#3d-brands-that-sign-in-on-their-own-page)).

---

## The three ways to run it

| | Mode 1: Fake hub | Mode 2: Real Home Assistant on your PC | Mode 3: Production |
| --- | --- | --- | --- |
| **Proves** | The screens and the whole flow work | Real devices switch from the app | Every apartment gets its own hub automatically |
| **Real devices** | No (pretend ones) | Yes | Yes |
| **Needs** | Node only | Node + WSL (Ubuntu) or Docker Desktop | A Linux server with Docker, a domain with HTTPS |
| **Time** | 5 minutes | About 1 hour the first time | Half a day |

**Every mode needs:**
- **Node.js 22.18 or newer**, and `npm install` run once in the project folder.
- **Two logins in the app.** The first login screen is still a demo and accepts anything. The **real** account is the **EMS account** on **Settings → My Devices**. That account is what belongs to an apartment.

Run **only one backend at a time**. `npm run fake-hub` and `npm start` both use port 8787.

### One command: `scripts/dev.sh`

From **Git Bash** in the project folder (or bash on Linux/macOS), one script starts everything for a mode, in the right order. It waits for each part to be ready, points the app at this PC's current network address (no `.env.local` edit needed), and stops what it started when you press `Ctrl + C`:

```bash
./scripts/dev.sh fake            # Mode 1: fake hub + app
./scripts/dev.sh local           # Mode 2: Home Assistant (WSL) + backend + app
./scripts/dev.sh attach --email you@example.com --token <token>   # Mode 2, once: attach Home Assistant to your account
./scripts/dev.sh check           # all checks: app types and lint, backend types and tests
./scripts/dev.sh server          # Mode 3, on the Linux server: Docker network + backend container
```

Add `--web` to open the app in the browser straight away, `--no-app` to start everything but the app, or `--host <IP>` to choose the address the app uses. A Home Assistant or backend that is already running is reused and left running. Logs are in `.dev-logs/`. The sections below describe the same steps by hand, plus the one-time setup the script can't do for you (installing Home Assistant, creating your accounts).

---

### Mode 1: Fake hub

The backend runs with a pretend Home Assistant inside it, preloaded with an apartment, a resident and some devices. Nothing is saved when it stops.

**1. Point the app at your PC.** In `.env.local` in the project folder:
```
EXPO_PUBLIC_DEVICE_BACKEND_URL=http://127.0.0.1:8787
```
Use your PC's Wi-Fi address instead (for example `http://192.168.1.7:8787`) if you test on a phone. Find it with `ipconfig`, under the Wi-Fi adapter's IPv4 address.

**2. Start the fake hub.** Open a terminal:
```bash
cd server
npm run fake-hub
```
✅ It prints `Fake hub ready: backend on http://0.0.0.0:8787, sign in as demo@parklane.test / correct horse battery`. Leave it open.

**3. Start the app.** Open a second terminal in the project folder:
```bash
npx expo start -c
```
Press `w` for the web browser, or scan the QR code with your phone.

**4. Try it:**
1. Slide **Get Started**, then sign in with anything on the first login screen.
2. Go to **Settings → My Devices** and sign in as `demo@parklane.test` / `correct horse battery`.
   ✅ You see **Home hub online** and devices (Bedroom AC, Smart Plug, Ceiling Light…).
3. Flip a switch, or tap a device for its full controls.
4. Tap **Add → SwitchBot**, enter any token and secret, and tap **Continue → Done**.
   ✅ A **SwitchBot Plug** appears. Using `bad` as the token shows the brand's error message instead.
5. **Tuya / Smart Life** also works: enter any user code, then tap Continue on the QR step.

Stop with `Ctrl + C`.

---

### Mode 2: Real Home Assistant on your PC

You run one Home Assistant yourself and attach it to a test apartment. This is the same path a Home Assistant box in an apartment would use.

**You need:**
- **Linux inside Windows (WSL with Ubuntu)** or **Docker Desktop**. Home Assistant doesn't run directly on Windows.
- A real device that **already works in its own app**, and its login details. For example:
  - **Smart Life / Tuya:** the **User Code** (Smart Life app → Me → ⚙ Settings → Account and Security → User Code).
  - **SONOFF / eWeLink:** your eWeLink app email or phone and password.
  - **SwitchBot:** **Token** and **Secret** (SwitchBot app → Profile → Preferences → tap "App Version" 10 times → Developer Options).

#### 2a. Install Ubuntu (once)

In **PowerShell as Administrator**:
```powershell
wsl --install -d Ubuntu-24.04
```
Restart if asked, then choose a Linux username and password when Ubuntu opens.

#### 2b. Install Home Assistant from the IOT project (once)

In the **Ubuntu** window, one line at a time:
```bash
cd ~
sudo apt update
sudo apt install -y build-essential libffi-dev libssl-dev libjpeg-dev zlib1g-dev autoconf ffmpeg libpcap-dev

# uv: installs Python 3.14 and packages quickly
curl -LsSf https://astral.sh/uv/install.sh | sh
source ~/.local/bin/env

# Home Assistant's own Python space; the prompt then starts with (ha-venv)
uv venv --python 3.14 ~/ha-venv
source ~/ha-venv/bin/activate

# Copy the IOT project into Ubuntu's disk, without its 940 MB .git history.
# Installing straight from /mnt/d fails with "Operation not permitted".
tar -C /mnt/d/EMS/AL-Atal/Park-Lane_Mobile_app/IOT -cf - --exclude=core/.git core | tar -C ~ -xf -
mv ~/core ~/ha-core

uv pip install -e ~/ha-core

# English labels for brand setup screens (a developer copy doesn't include them)
cd ~/ha-core
python -m script.translations develop --all
cd ~

mkdir -p ~/ha-config
```

**Optional: SONOFF / eWeLink support.** Home Assistant has no eWeLink integration of its own, so install the community SonoffLAN integration:
```bash
cd /tmp
curl -fsSL https://github.com/AlexxIT/SonoffLAN/archive/refs/tags/v3.13.2.tar.gz | tar xz
mkdir -p ~/ha-config/custom_components
cp -r /tmp/SonoffLAN-3.13.2/custom_components/sonoff ~/ha-config/custom_components/
cd ~
```

> **Easier alternative: Docker Desktop.** Install it from docker.com, then this one command replaces 2b (put SonoffLAN in `C:\ha-config\custom_components\sonoff` if you want SONOFF):
> ```powershell
> docker run -d --name ha -p 8123:8123 -v C:\ha-config:/config ghcr.io/home-assistant/home-assistant:stable
> ```

#### 2c. Start Home Assistant

```bash
source ~/ha-venv/bin/activate
hass -c ~/ha-config
```
The first start takes 5 to 10 minutes. Leave the window open; closing it stops Home Assistant. A warning that the `sonoff` custom integration isn't tested by Home Assistant is normal.

#### 2d. Create the owner account and a token (once)

1. Open `http://localhost:8123` in your Windows browser and click **Create my smart home**. Create the owner account and finish the welcome steps.
2. Click your **name** (bottom left) → **Security** → **Long-lived access tokens** → **Create token** → name it `parklane`.
3. **Copy it right away**; it's shown only once. Treat it like a password.

#### 2e. Configure and start the backend

In `server/.env`, set:
```
ADMIN_API_KEY=<any long random secret>
HA_ALLOWED_NETWORKS=127.0.0.0/8,172.16.0.0/12,192.168.0.0/16
APP_RETURN_URL=parklane://accounts
```
In `.env.local` (the app), set your PC's Wi-Fi address:
```
EXPO_PUBLIC_DEVICE_BACKEND_URL=http://192.168.1.7:8787
```
Then start the backend in a terminal and leave it open:
```bash
cd server
npm start
```
✅ `Parklane device backend on http://0.0.0.0:8787 {"auth":"api key"}`. If Windows Firewall asks about Node.js, allow **private networks**.

#### 2f. Create your EMS account in the app (once)

Start the app (`npx expo start -c`), go to **Settings → My Devices**, and use the **Create account** tab. The local backend starts empty, so "Sign in" won't work until you create the account.
✅ You see **Not linked to a unit yet**.

#### 2g. Attach Home Assistant to your account (once)

In a **new** terminal. Put the `cd` and the `npm` command on separate lines:
```bash
cd server
npm run attach-hub -- --email you@example.com --url http://127.0.0.1:8123 --token <your token>
```
✅
```
Unit: Test unit
Resident: you@example.com
Hub attached: http://127.0.0.1:8123 (Home Assistant 2026.11.0.dev0). Open My Devices in the app.
```

#### 2h. Link your brand

In the app: **My Devices** → pull to refresh → **Home hub online** → **Add** → your brand. See [Linking a brand](#linking-a-brand).

#### Every time after that

Keep three windows open:

| Window | Command |
| --- | --- |
| Ubuntu | `source ~/ha-venv/bin/activate` then `hass -c ~/ha-config` |
| Terminal 1 | `cd server` then `npm start` |
| Terminal 2 | `npx expo start` |

The apartment, hub and linked accounts are remembered. If your PC's Wi-Fi address changes, update `.env.local` and restart Expo with `-c`.

---

### Mode 3: Production on the company server

The backend creates a Home Assistant container for each apartment by itself. Residents need nothing but the app.

> The provisioning code is covered by tests against a fake Docker and a fake Home Assistant, but hasn't run on the real server yet. Do the first apartment as a pilot and watch `GET /api/admin/hubs`.

#### 3a. Server requirements

- A Linux server (Ubuntu 24.04 or similar) with **Docker** installed and internet access.
- About **300–500 MB of RAM per apartment**, plus disk for each apartment's history (a few hundred MB).
- The domain `api-iot.ems-iot.com` pointing at the server, with HTTPS (Caddy or nginx in front).
- Node.js 22.18+ only if you run the backend outside Docker.

#### 3b. Configure `server/.env`

```
HOST=0.0.0.0
PORT=8787
ADMIN_API_KEY=<long random secret>                 # openssl rand -base64 32
EMS_ENCRYPTION_KEY=<32 random bytes, base64>       # openssl rand -base64 32; back it up, it seals every hub token
PUBLIC_URL=https://api-iot.ems-iot.com
APP_RETURN_URL=parklane://accounts
DATA_DIR=/srv/parklane/data

HA_IMAGE=ghcr.io/home-assistant/home-assistant:2026.11.0   # pin a release
HA_NETWORK=parklane-ha
HA_CONFIG_ROOT=/srv/parklane/ha
HA_CONFIG_HOST_ROOT=/srv/parklane/ha
HA_MEMORY_MB=512
HA_TIME_ZONE=Africa/Cairo
HA_CUSTOM_COMPONENTS=/srv/parklane/custom_components      # holds sonoff/ from SonoffLAN
# HA_OAUTH_CREDENTIALS={"smartthings":{"clientId":"…","clientSecret":"…"}}
```

Put SonoffLAN in `/srv/parklane/custom_components/sonoff` (same download as Mode 2). Every new apartment gets a copy.

#### 3c. Run the backend on the Docker network

The backend must reach each container as `http://parklane-ha-<unit>:8123`, so it runs on the same Docker network, with the Docker socket mounted:

```bash
docker network create parklane-ha
docker run -d --name parklane-backend --restart unless-stopped \
  --network parklane-ha \
  --env-file /opt/parklane/server/.env \
  -v /opt/parklane/server:/app -w /app \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v /srv/parklane:/srv/parklane \
  -p 127.0.0.1:8787:8787 \
  node:22 node src/index.ts
```
- `/opt/parklane/server` is this repo's `server/` folder, copied to the server.
- Paths under `/srv/parklane` are the same inside and outside the container, which is why `HA_CONFIG_ROOT` and `HA_CONFIG_HOST_ROOT` match.
- **The Docker socket gives root access to the host.** Only the backend gets it; never expose port 8787 or the socket publicly.

Put HTTPS in front with a reverse proxy that also passes WebSockets (`/api/events`). With Caddy:
```
api-iot.ems-iot.com {
    reverse_proxy 127.0.0.1:8787
}
```

The app builds already point at `https://api-iot.ems-iot.com` (`eas.json`).

#### 3d. Brands that sign in on their own page

SmartThings, Google Nest, Netatmo, August, Yale, Miele and Home Connect show as "Not available yet" until, for each brand:
1. You register an app with the brand, with redirect URI `https://api-iot.ems-iot.com/api/accounts/oauth/auth/external/callback` (one address for every apartment).
2. You add its client ID and secret to `HA_OAUTH_CREDENTIALS`, and restart the backend.

New apartments get the credentials when they're created.

#### 3e. Set up an apartment

```bash
API=https://api-iot.ems-iot.com
KEY=<ADMIN_API_KEY>

# 1. Create the apartment; its Home Assistant starts being created in the background (a minute or two)
curl -X POST $API/api/admin/units -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' \
  -d '{"name": "Tower A · 1203", "building": "Tower A"}'

# 2. After the resident signs up in the app (My Devices → Create account), add them
curl -X POST $API/api/admin/units/<unitId>/members -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' \
  -d '{"email": "resident@example.com"}'

# 3. Watch it come up: provisioning → online (or failed, with last_error)
curl $API/api/admin/hubs -H "Authorization: Bearer $KEY"
```

| Task | Call |
| --- | --- |
| List apartments and their hubs | `GET /api/admin/units` |
| Retry a failed setup | `POST /api/admin/units/<id>/provision` |
| Remove an apartment and its container | `DELETE /api/admin/units/<id>` (its config folder is kept; it holds the resident's linked accounts) |
| Attach a Home Assistant box instead | `POST /api/admin/hubs {unitId, baseUrl, token}` (address must be inside `HA_ALLOWED_NETWORKS`) |

---

## Using the app

### Controlling devices

- **My Devices** lists every device with its room, state and an on/off switch. Tap a device for all its controls.
- **Smart Home** shows the resident's rooms. Pick a room, and the Lighting, AC, Curtains and TV cards control that room's devices; cards with no matching device are hidden.
- Changes show at once and settle on what the device reports. If the device refuses, the screen goes back and says why. Changes made in the brand's own app appear in Parklane by themselves.

### Linking a brand

1. **My Devices → Add**, the Smart Home **"+"**, or the Smart Home menu → **Connect devices**.
2. Pick the brand and follow its steps:
   - **Smart Life / Tuya:** enter the User Code, scan the QR code with the Smart Life app on a phone, then tap Continue.
   - **SONOFF / eWeLink:** eWeLink email or phone and password. Leave the country empty unless sign-in fails.
   - **SwitchBot:** token and secret.
   - **SmartThings and the other sign-in brands:** tap "Sign in with …", sign in on the brand's page, and return to the app.
3. **Account linked → Done.** The devices appear within seconds.

**Linked accounts** (bottom of My Devices) shows each account and its device count. Use **Sign in again** when a brand asks for it, and **Unlink** (tap twice) to remove the account and its devices.

---

## Configuration reference

### `server/.env` (backend)

| Setting | Meaning | Mode |
| --- | --- | --- |
| `PORT` | Backend port (default 8787) | All |
| `ADMIN_API_KEY` | Protects the admin API; required for `attach-hub` and apartment setup | 2, 3 |
| `EMS_ENCRYPTION_KEY` | Encrypts stored hub tokens. Generated into `DATA_DIR/ems.key` if empty; set and back up in production | 3 |
| `DATA_DIR` | Where the database lives | All |
| `PUBLIC_URL` | Public HTTPS address; needed for brands that sign in on their own page | 3 |
| `APP_RETURN_URL` | Where the browser returns after a brand sign-in (`parklane://accounts`) | 2, 3 |
| `HA_ALLOWED_NETWORKS` | Where a separately run Home Assistant may be (safety check) | 2, 3 |
| `HA_IMAGE`, `HA_NETWORK`, `HA_CONFIG_ROOT`, `HA_CONFIG_HOST_ROOT`, `HA_MEMORY_MB`, `HA_TIME_ZONE` | Per-apartment containers | 3 |
| `HA_CUSTOM_COMPONENTS` | Community integrations (SonoffLAN) copied into new apartments | 3 |
| `HA_OAUTH_CREDENTIALS` | Company apps for sign-in brands | 3 |
| `HA_PUBLISH_LOCAL_PORTS` | Development only: publish containers on `127.0.0.1` for a backend not on the Docker network | — |
| `CUBE_*`, `ALEXA_*`, `BACKEND_API_KEY`, `EMS_PUBLIC_URL` | Old settings; nothing reads them, safe to delete | — |

Full list with comments: `server/.env.example`.

### `.env.local` (app)

| Setting | Mode 1 | Mode 2 | Mode 3 |
| --- | --- | --- | --- |
| `EXPO_PUBLIC_DEVICE_BACKEND_URL` | `http://127.0.0.1:8787` (web) or `http://<PC Wi-Fi IP>:8787` (phone) | `http://<PC Wi-Fi IP>:8787` | `https://api-iot.ems-iot.com` (already in `eas.json`) |

Restart Expo with `npx expo start -c` after changing it.

---

## Troubleshooting

| What you see | Why | Fix |
| --- | --- | --- |
| "Your smart home could not be reached" / "not available on this EMS server yet" | The app reaches a backend without the smart-home code, or none at all | Start `npm start` (or `fake-hub`); check `.env.local`; restart Expo with `-c`. The deployed server needs this branch's `server/` |
| "Could not reach the EMS backend" on sign-in | Backend not running, wrong address, or firewall | Start the backend; use the PC's current Wi-Fi IP; allow Node.js on private networks |
| "Not linked to a unit yet" | The account isn't in an apartment | Mode 2: run `attach-hub` with the same email. Mode 3: `POST /api/admin/units/<id>/members` |
| `attach-hub`: "No EMS account with that email" | The account doesn't exist on this backend | Create it in the app (My Devices → **Create account**) first |
| `attach-hub`: "Could not sign in to that hub" | Wrong token, or Home Assistant isn't running | Open `localhost:8123`; create a new token and copy all of it |
| `attach-hub`: "outside HA_ALLOWED_NETWORKS" | Unexpected hub address | Use `http://127.0.0.1:8123`, or add the network to `HA_ALLOWED_NETWORKS` |
| "The filename, directory name, or volume label syntax is incorrect." | Two commands pasted on one line | Run `cd server` and the `npm` command on separate lines |
| "Home hub offline" | Home Assistant stopped | Start `hass -c ~/ha-config` again (Mode 2), or check `GET /api/admin/hubs` (Mode 3) |
| A brand is missing from Add, or "not available on your home hub" | Sign-in brands need company setup; SONOFF needs SonoffLAN on the hub | See [3d](#3d-brands-that-sign-in-on-their-own-page), or install SonoffLAN and restart Home Assistant |
| Linking SONOFF signs the eWeLink app out on the phone | eWeLink allows one session per app type | Sign in again on the phone, or use a second eWeLink account with the devices shared to it |
| Devices don't appear after linking | The brand is still loading them | Wait 10–20 seconds and pull to refresh; check they work in the brand's app |
| WSL: `Unable to locate package libturbojpeg0` | Not in Ubuntu 24.04; `apt` then installs nothing | Run the install line without it |
| WSL: "No virtual environment found" / `hass: command not found` | The Python space isn't active | `source ~/ha-venv/bin/activate` (the prompt shows `(ha-venv)`) |
| WSL: "Operation not permitted" during install | Installing from `/mnt/d` | Copy the project to `~/ha-core` first (2b) |
| WSL: "configuration directory … does not exist" | The config folder wasn't created | `mkdir -p ~/ha-config` |
| Port 8787 already in use | Another backend (often `fake-hub`) is running | Stop it with `Ctrl + C` |

---

## Known limits and next steps

- **Cloud brands only, without a box.** Zigbee, Z-Wave, Thread and local-only devices need a Home Assistant box in the apartment.
- **Tuya's QR code** must be scanned from a second device (a phone can't scan its own screen).
- **Not yet tested for real:** Mode 3 provisioning on the company server, and the sign-in brands' browser hand-off on a phone.
- **Still sample data on Smart Home:** scenes, energy and automations.
- **Next (Phase 5):** live scenes, automations and energy; the optional Zigbee/Matter box per apartment; voice through Home Assistant's Alexa and Google support; member roles (for example, guests without lock control).

### Checks

```bash
npx tsc --noEmit          # app types
npx expo lint             # app lint
cd server
npm run typecheck         # backend types
npm test                  # 49 backend tests: accounts, realtime, mapping, commands, home facade, linking, provisioning
```
