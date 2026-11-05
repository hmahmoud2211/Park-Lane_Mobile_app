# API documentation

This covers the **EMS device backend** (`backend/`), which the app calls at `EXPO_PUBLIC_DEVICE_BACKEND_URL` (production: `https://api-iot-2.ems-iot.com`). The CUBE Gateway has its own API, documented in [gateway/API.md](../gateway/API.md). The Parklane Assistant is an external service.

Health Passport (`/health/...`, plain JSON without the envelope below) is in [HEALTH_PASSPORT.md](HEALTH_PASSPORT.md#the-api-it-expects), and the clinic (`/api/clinic/...`) in [CLINIC.md](CLINIC.md).

The types named below are in [`shared/contracts`](../shared/contracts), which the app and the backend both import.

## Conventions

**Envelope.** Every JSON answer is one of:

```json
{ "ok": true, "data": … }
{ "ok": false, "error": { "code": "hub_offline", "message": "Your home hub is not available right now." } }
```

`ApiEnvelope<T>` and `ApiErrorCode` in `shared/contracts/envelope.ts` and `errors.ts`. Messages are written for residents and may be shown as they are.

**Errors.**

| Code | HTTP | Meaning |
|---|---|---|
| `bad_request` | 400 | The body or a field is wrong (also: a body that is not a JSON object, over 16 KB) |
| `unauthorized` | 401 | No token, a wrong one, an expired one, or a token of a kind this route does not take |
| `forbidden` | 403 | Allowed caller, refused action (an assistant token unlocking a door) |
| `not_found` / `no_home` | 404 | No such route, record or device; `no_home`: the account is not in a unit yet |
| `conflict` / `not_available` | 409 | Already exists, a device still busy, a brand not enabled on this hub |
| `flow_expired` | 410 | A linking flow older than 30 minutes, or someone else's |
| `rate_limited` | 429 | Too many requests (limits below) |
| `internal` | 500 | Anything unexpected; details stay in the server log |
| `hub_auth` / `ha_rejected` | 502 | The unit's Home Assistant refused the backend / a device or its cloud refused a command |
| `provisioning` / `hub_offline` / `not_configured` | 503 | The unit's hub is being set up / unreachable / a server setting is missing |

**Routing rules** (pinned by `backend/test/routing.test.ts`):
- A path with a method it does not take answers **404**, like an unknown path. There is no 405.
- Routes check the caller first: a protected path answers **401** without a valid token, whatever the method.
- Every answer, errors included, carries CORS headers (`Access-Control-Allow-Origin: CORS_ORIGIN`, default `*`) and `Cache-Control: no-store`. `OPTIONS` on any path answers **204**.
- The access log prints method, path, status and time, never the query string or bodies.

**Authentication.** `Authorization: Bearer <token>`. There are three kinds:

| Token | From | Accepted by |
|---|---|---|
| Session | `POST /api/auth/login` or `/register`; 30 days, 12 hours for doctors and desk staff | every resident route; the clinic's doctor and desk routes also check the role |
| Assistant | `POST /api/auth/assistant-token`; ≤ 12 hours, never longer than its session | `GET /api/home`, `GET /api/devices`, `GET /api/devices/:id`, `GET /api/rooms`, `POST /api/devices/:id/commands` only; every command audited, `lock.unlock` refused |
| Admin key | `ADMIN_API_KEY` | `/api/health` (open while no key is set) and `/api/admin/*` (off until a key is set) |

**Rate limits** (per IP before sign-in, per user after; one-minute windows, `backend/src/http/rateLimits.ts`): register and login 10, assistant token 20, device commands 60, starting a link flow 20, answering a flow step 60, refreshing accounts 6, creating rooms 20.

## Accounts — `routes/auth.ts`

| Method & path | Body | Answer |
|---|---|---|
| `POST /api/auth/register` | `{ email, password, name? }` (password 8–128 characters) | `SignedIn`: `{ user, token }`; `409 conflict` if the email is taken |
| `POST /api/auth/login` | `{ email, password }` | `SignedIn`; `401` for a wrong email or password (same timing either way) |
| `POST /api/auth/logout` | — | `{ signedOut: true }`; revokes the session and its assistant tokens |
| `GET /api/auth/me` | — | `{ user }` (`User`, with `role`: `resident`, `doctor` or `clinic_staff`) |
| `POST /api/auth/assistant-token` | — | `AssistantToken`: `{ token, expiresAt }` |

## The home — `routes/home.ts`

| Method & path | Body | Answer |
|---|---|---|
| `GET /api/home` | — | `Home`: `{ unit, hub: { status, haVersion, lastSeen }, rooms, deviceCount }`. A failed setup shows as `provisioning`. `404 no_home` until the resident is in a unit |
| `GET /api/devices` | — | `Device[]`: kind, room, capabilities with their values, sensors, pending command, last error |
| `GET /api/devices/:id` | — | `Device`; another unit's device is `404` |
| `POST /api/devices/:id/commands` | `CommandRequest`: `{ capability, action, value?, entityId? }` | the `Device` as the hub then reports it |
| `PATCH /api/devices/:id` | `{ name?, roomId? }` | the renamed or moved `Device` (session only) |
| `GET /api/rooms` | — | `Room[]` |
| `POST /api/rooms` | `{ name }` | the new `Room` (session only) |

Commands, by capability (checked against `backend/src/ha/commands.ts`):

| Capability | Actions (value) |
|---|---|
| `power` | `on`, `off`, `toggle` |
| `brightness` | `set` (0–100; 0 turns off) |
| `color_temp` | `set` (kelvin, clamped to the light's range) |
| `color` | `set` (`{ h: 0–360, s: 0–100 }`) |
| `climate` | `set_temperature` (clamped), `set_mode`, `set_fan_mode` |
| `cover` | `open`, `close`, `stop`, `set_position` (0–100) |
| `lock` | `lock`, `unlock` (audited; refused for assistant tokens) |
| `fan` | `set_percentage` (0–100), `set_preset` |
| `media` | `play`, `pause`, `next`, `previous`, `set_volume` (0–1), `mute` (boolean), `select_source` |
| `press` | `press` |

A command is pushed as `pending` to every open app, then the device's reported state follows. Reads keep serving the last known state while the hub is offline.

## Linking brand accounts — `routes/accounts.ts`

All need the session token.

| Method & path | Body | Answer |
|---|---|---|
| `GET /api/accounts/integrations` | — | `IntegrationOption[]`: `id`, `name`, `method` (`credentials`, `qr`, `oauth`), `hint`, `available` |
| `GET /api/accounts` | — | `LinkedAccount[]` |
| `POST /api/accounts/flows` | `{ integration }` | `FlowStep`: `form` (typed, labelled fields), `menu`, `external` (open `url`), `progress`, `done` or `abort` |
| `GET /api/accounts/flows/:id` | — | the current `FlowStep` |
| `POST /api/accounts/flows/:id` | `{ data }` | the next `FlowStep` |
| `DELETE /api/accounts/flows/:id` | — | `{ cancelled: true }` |
| `POST /api/accounts/refresh` | — | `{ refreshed, failed: [{ id, brand, message }] }`: reloads every account, picking up devices added in brand apps |
| `POST /api/accounts/:id/reconnect` | — | `{ step }`: the brand's "sign in again" flow, or `null` when a reload was enough |
| `POST /api/accounts/:id/reload` | — | `{ reloaded: true }` |
| `DELETE /api/accounts/:id` | — | `{ removed: true }`; its devices leave the home |
| `GET /api/accounts/oauth/auth/external/callback` | (browser redirect from a brand) | `302` to `APP_RETURN_URL?result=ok|error|expired&flow=…`; carries no EMS token |

## Operations — `routes/ops.ts`

All need `Authorization: Bearer <ADMIN_API_KEY>`.

| Method & path | Body | Answer |
|---|---|---|
| `GET /api/health` | — | `{ status: 'ok' }` |
| `GET /api/admin/units` | — | units, each with its `hub` |
| `POST /api/admin/units` | `{ name, building?, provision? }` | the unit and its hub; provisions a Home Assistant container unless `provision: false` |
| `DELETE /api/admin/units/:id` | — | `{ deleted: true }`; removes the container, keeps its `/config` folder |
| `POST /api/admin/units/:id/provision` | — | the hub; starts or retries provisioning |
| `POST /api/admin/units/:id/members` | `{ email, role? }` | `{ unitId, user, role }`; puts an existing account in the unit (`owner` or `member`) |
| `GET /api/admin/hubs` | — | all hubs |
| `POST /api/admin/hubs` | `{ unitId, baseUrl, token }` | attaches a separately run Home Assistant (address inside `HA_ALLOWED_NETWORKS`) |

## Realtime — `GET /api/events` (WebSocket)

1. Connect to `wss://<backend>/api/events`.
2. Within 10 seconds, send `{ "type": "auth", "token": "<session token>" }`. Assistant tokens are refused.
3. The server answers `{ "type": "ready" }` or `{ "type": "error", "code": "unauthorized" }` and closes.
4. Then it pushes `RealtimeEvent`s (`shared/contracts/events.ts`) for the resident's home:

| Event | Payload | When |
|---|---|---|
| `device` | `{ device: Device }` | a device changed (state, name, room, a pending command) |
| `device_removed` | `{ id }` | a device left the home |
| `rooms` | `{ rooms: Room[] }` | rooms changed |
| `hub_status` | `{ status, haVersion }` | the hub went online, offline or lost its token |
| `accounts` | — | linked accounts changed; re-read `GET /api/accounts` |

The server pings every 25 seconds. Client frames are capped at 4 KB.

## The app's other connections

- **CUBE Gateway**: REST under `/api/v1` plus a WebSocket at `/api/v1/events`, on the LAN (port 8686), over Tailscale, or through the relay at `https://cube-relay.ems-iot.com/relay/v1/g/<id>`. See [gateway/API.md](../gateway/API.md).
- **Parklane Assistant**: `POST /api/v1/chat`, `GET /api/v1/residents`, `GET /api/v1/health`, and a realtime voice WebSocket, at `EXPO_PUBLIC_ASSISTANT_URL`. The app's client is `frontend/src/features/assistant/services`.
- **Devices on their setup hotspots**: Shelly (`192.168.33.1`), SONOFF (`10.10.7.1`) and LG (`192.168.120.254` / `192.168.1.1`, TLS on 5500 and 9000). The addresses are in `frontend/src/config/vendorDevices.ts` and `config/lg.ts`.
