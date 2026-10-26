# Parklane device backend

A small Node service between the Parklane app and the smart-home platform. It runs EMS user accounts (SQLite in `DATA_DIR/ems.db`), gives every apartment its own Home Assistant (see `../IOT`), and pushes realtime updates to the app over WebSocket.

```
App ──HTTPS / WS──▶ backend ──private Docker network──▶ Home Assistant (one container per unit) ──▶ Tuya, SmartThings, … clouds
```

Residents install nothing at home. Their devices come in through the makers' clouds, which each unit's Home Assistant reaches from this server. The app never talks to Home Assistant itself: the backend holds each hub's token and only runs the commands in `src/ha/commands.ts`.

It has no dependencies. Node ≥ 22.18 runs the TypeScript directly.

## Run it

```bash
cd server
cp .env.example .env      # then fill it in
npm start                 # node src/index.ts
npm test                  # accounts, realtime, device mapping, the home facade, linking brands, provisioning
npm run typecheck         # uses the app's TypeScript (../node_modules)
```

In the app's `.env.local`, set `EXPO_PUBLIC_DEVICE_BACKEND_URL=http://<this machine>:8787`.

### On the server

- The backend needs the Docker socket (`DOCKER_SOCKET`) to create the units' containers. Access to that socket is root on the host: run the backend as a dedicated user and never expose the socket elsewhere.
- Run the backend on the `HA_NETWORK` Docker network, so it reaches each container as `http://parklane-ha-<unit>:8123`. Containers publish no ports.
- Each unit's `/config` lives in `HA_CONFIG_ROOT` (default `DATA_DIR/ha`). When the backend itself runs in a container, mount that folder and set `HA_CONFIG_HOST_ROOT` to the same folder as the host sees it.
- Budget about 300–500 MB of RAM per unit (`HA_MEMORY_MB` caps it). Pin `HA_IMAGE` to a release.
- For development on a machine where the backend is not on the Docker network, set `HA_PUBLISH_LOCAL_PORTS=1`: each container is then published on a random `127.0.0.1` port.

### Setting up a unit

```bash
# 1. Create the unit; its Home Assistant is provisioned in the background (a minute or two).
curl -X POST $API/api/admin/units -H "Authorization: Bearer $ADMIN_API_KEY" \
  -H 'Content-Type: application/json' -d '{"name": "Tower A · 1203", "building": "Tower A"}'

# 2. Once the resident has signed up in the app, add them to it.
curl -X POST $API/api/admin/units/<unitId>/members -H "Authorization: Bearer $ADMIN_API_KEY" \
  -H 'Content-Type: application/json' -d '{"email": "resident@example.com"}'

# 3. Watch it come up: status provisioning → online (or failed, with last_error).
curl $API/api/admin/hubs -H "Authorization: Bearer $ADMIN_API_KEY"
```

`POST /api/admin/units/<unitId>/provision` retries a failed setup. `DELETE /api/admin/units/<unitId>` removes the unit and its container. Its `/config` folder, which holds the resident's linked accounts, is kept until an operator deletes it.

### Brands that sign in through a browser

SmartThings, Google Nest, Netatmo, August, Yale, Miele and Home Connect sign residents in on their own page (OAuth). For each one you want to offer:

1. Register an app with the brand and set its redirect URI to `PUBLIC_URL/api/accounts/oauth/auth/external/callback` (one address for every unit).
2. Add its client id and secret to `HA_OAUTH_CREDENTIALS`. New units get them when they are provisioned.

Until both `PUBLIC_URL` and the brand's credentials are set, the app lists the brand as not available. The callback carries the hub's own signed `state`; the backend only reads the flow id from it to forward the callback to the right unit's hub, which checks the signature.

A unit that later wants Zigbee or local devices can run Home Assistant on a box at home instead: `POST /api/admin/hubs { unitId, baseUrl, token }` attaches it. The address must be inside `HA_ALLOWED_NETWORKS` (e.g. a WireGuard range).

## API

Every answer is `{ "ok": true, "data": … }` or `{ "ok": false, "error": { "code", "message" } }`.

### Residents (EMS session token)

| Method & path | What it does |
| --- | --- |
| `POST /api/auth/register` `{ email, password, name? }` | Creates an EMS account. Returns `{ user, token }`. |
| `POST /api/auth/login` `{ email, password }` | Returns `{ user, token }`. Rate limited per client. |
| `POST /api/auth/logout` | Revokes the session token. |
| `GET /api/auth/me` | The signed-in user. |
| `GET /api/home` | `{ unit, hub: { status, haVersion, lastSeen }, rooms, deviceCount }`. `404 no_home` until the resident is in a unit. |
| `GET /api/devices` | The unit's devices (`Device` in `src/ha/types.ts`): kind, room, capabilities with their current values, sensors, pending command, last error. |
| `GET /api/devices/:id` | One of them. Another unit's device is `404`. |
| `POST /api/devices/:id/commands` `{ capability, action, value?, entityId? }` | Runs one allowlisted command and returns the device as the hub then reports it. See below. |
| `PATCH /api/devices/:id` `{ name?, roomId? }` | Renames a device or moves it to a room (stored in Home Assistant). |
| `GET /api/rooms` · `POST /api/rooms` `{ name }` | The unit's rooms (Home Assistant areas). |
| `GET /api/accounts/integrations` | The brands a resident can link (`src/ha/integrations.ts`), each with `method` (`credentials`, `qr`, `oauth`) and `available`. |
| `GET /api/accounts` | The linked accounts: brand, title, state, `needsReconnect`, device count. |
| `POST /api/accounts/flows` `{ integration }` | Starts linking a brand. Returns a `FlowStep` (`src/ha/flows.ts`): `form` (typed, labelled fields), `menu`, `external` (open `url` in a browser), `progress`, `done` or `abort`. |
| `GET` · `POST { data }` · `DELETE /api/accounts/flows/:id` | Reads, answers or cancels the resident's own flow. `410 flow_expired` after 30 minutes or for anyone else. |
| `POST /api/accounts/:id/reconnect` | Continues the brand's "sign in again" flow, or reloads the account when there is none. |
| `POST /api/accounts/:id/reload` · `DELETE /api/accounts/:id` | Reloads or unlinks an account; its devices leave the home with it. |
| `GET /api/events` (WebSocket) | Send `{ type: 'auth', token }` first; the server answers `{ type: 'ready' }`, then pushes `device`, `device_removed`, `rooms`, `hub_status` and `accounts`. |

Commands, by capability:

| Capability | Actions (value) |
| --- | --- |
| `power` | `on`, `off`, `toggle` |
| `brightness` | `set` (0–100; 0 turns off) |
| `color_temp` | `set` (kelvin, clamped to the light's range) |
| `color` | `set` (`{ h: 0–360, s: 0–100 }`) |
| `climate` | `set_temperature` (clamped), `set_mode`, `set_fan_mode` (one of the device's) |
| `cover` | `open`, `close`, `stop`, `set_position` (0–100) |
| `lock` | `lock`, `unlock` (audited) |
| `fan` | `set_percentage` (0–100), `set_preset` |
| `media` | `play`, `pause`, `next`, `previous`, `set_volume` (0–1), `mute` (boolean), `select_source` |
| `press` | `press` |

A command is pushed as `pending` to every open app, then the device's reported state. `ha_rejected` (502) means the device or its cloud refused; `hub_offline` (503) means the unit's hub is unreachable, while reads keep serving the last known state.

### Operations and admin (`ADMIN_API_KEY`)

| Method & path | What it does |
| --- | --- |
| `GET /api/health` | Liveness check. |
| `GET /api/admin/units` · `POST /api/admin/units` `{ name, building?, provision? }` | Units and their hubs; creating one provisions its container unless `provision: false`. |
| `DELETE /api/admin/units/:id` | Removes the unit and its container. |
| `POST /api/admin/units/:id/provision` | Starts or retries provisioning. |
| `POST /api/admin/units/:id/members` `{ email, role? }` | Puts an existing EMS account in the unit (`owner` or `member`). |
| `GET /api/admin/hubs` · `POST /api/admin/hubs` `{ unitId, baseUrl, token }` | All hubs; attach a separately run hub. |

The admin routes refuse every request until `ADMIN_API_KEY` is set.

## Secrets

- `.env` and `data/` are git-ignored.
- EMS tokens are stored as SHA-256 hashes. Hub tokens and the facade user's password are sealed with `EMS_ENCRYPTION_KEY`.
- Each unit's `/config` holds its linked accounts' tokens; the folders are created owner-only.
- Logs never include request bodies, query strings or fields whose names look secret.
