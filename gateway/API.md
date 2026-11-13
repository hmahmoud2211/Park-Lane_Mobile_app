# CUBE Gateway API (v1)

Base URL: `http://<gateway>:8686` on the home network, a Tailscale address, or a relay URL
(`https://<relay>/relay/v1/g/<gateway_id>`) from outside. Everything below is under `/api/v1`.

Every JSON answer is an envelope:

```json
{ "ok": true, "data": ... }
{ "ok": false, "error": { "code": "device_unreachable", "message": "The Shelly at 192.168.1.40 did not answer.", "recovery": "Check the device has power..." } }
```

Authentication: `Authorization: Bearer <client token>` on every route except those marked **public**.
`GET /devices`, `GET /devices/{id}` and `POST /devices/{id}/commands` also take a **device call** from the EMS backend
(`Authorization: Bearer emscall.<body>.<signature>`), on a gateway linked to EMS. The backend sends these for the
Parklane Assistant, which can't reach the gateway itself. A device call is signed with the backend's pinned key and
names this gateway, the resident (`sub`), and the exact method and path (`m`, `p`). It is valid for at most two minutes
and works once. It acts as a member, and the audit log names it `ems:<account>`. Every other route refuses it
(`cube_gateway/accounts.py` `device_call`). A gateway not linked to EMS answers `404 account_login_off`.
Roles: `owner` (everything) and `member` (view and control devices; cannot pair, remove, rename or manage
access). Data models are in `cube_gateway/models.py` (mirrored in the app's `frontend/src/types/gateway.types.ts`).

## Gateway, ownership and access

| Method & path | Auth | What it does |
| --- | --- | --- |
| `GET /health` | public | `{status, version, api_version, gateway_id, name, claimed, uptime, adapters: {loaded, failed}}` |
| `POST /identity/challenge` `{client_id, nonce}` | public | `{gateway_id, proof}`: `proof = hex(HMAC-SHA256(pin_key, "cube-gw-v1|" + gateway_id + "|" + nonce))`. The app checks it before sending its token to an address it has not used before. Rate limited. |
| `POST /auth/claim` `{setup_code, client_name}` | public | First owner only, with the setup code printed in the gateway's logs. Returns `{client: {id, name, role}, token, pin_key, gateway: {id, name}}`. `409 already_claimed` after the first claim. Rate limited; 10 wrong codes rotate the code. |
| `POST /auth/join` `{invite_code, client_name}` | public | Another phone joins with an owner's invite. Same answer as claim (role from the invite). |
| `GET /auth/me` | any | `{client, gateway}` |
| `POST /auth/invites` `{role: "member" | "owner"}` | owner | `{code, expires_at}` (10 minutes, single use) |
| `GET /auth/clients` | owner | Every client: id, name, role, created_at, last_seen, revoked |
| `DELETE /auth/clients/{id}` | owner | Revokes a client's token at once (its WebSocket is closed). |
| `PATCH /gateway` `{name}` | owner | Renames the gateway. |

## Catalog

| Method & path | Auth | What it does |
| --- | --- | --- |
| `GET /brands` | any | `Brand[]`: id, name, aliases, logo key, status, summary, account_free, categories, `hub_integrations` (integrations on the building's hub that link this brand), `needs_home_gateway` (on a gateway on CUBE's server: the brand only works on the home network), `methods: ConnectionMethod[]` (group `existing`/`new`/`advanced`, transport `lan`/`phone`/`guided`/`gateway`, requirements, `available` + `unavailable_reason`), notes |
| `GET /adapters` | any | `AdapterInfo[]` including adapters that failed to load (`loaded: false`, `load_error`) |
| `GET /provisioning/plugins` | any | Every provisioning plugin with its declared models, firmware, auth, requirements and sources |

## Discovery

| Method & path | Auth | What it does |
| --- | --- | --- |
| `POST /discovery/jobs` `{brand_id?, adapter_ids?, timeout? (3-60 s, default 12), subnet_scan? (default true)}` | owner | Starts a scan. `DiscoveryJob` with `status: running`. One job runs at a time; starting another returns the running one. |
| `GET /discovery/jobs/{id}` | owner | Progress (`progress` 0..1, `phase`), `candidate_ids`, `errors` |
| `DELETE /discovery/jobs/{id}` | owner | Cancels it. |
| `GET /discovery/candidates?job_id=&brand_id=&adapter_id=` | owner | `Candidate[]`, newest first. `control` is `supported`, `experimental` or `detection_only`. `pairing` says what pairing needs (`auth`, `fields`, `instructions`). `paired_device_id` is set once paired. |
| `POST /discovery/probe` `{host, adapter_id?}` | owner | Checks one private IP address the user typed; returns the `Candidate` or `404 not_found`. |

## Pairing

| Method & path | Auth | What it does |
| --- | --- | --- |
| `POST /pairings` `{candidate_id, credentials?, name?, room_id?}` | owner | Starts pairing in the background; returns `Pairing`. |
| `GET /pairings/{id}` | owner | `status`: `running` → `awaiting_approval` (accept on the device; `message` says what to do) → `paired` (`device_id`) or `needs_input` (`fields` to fill, then POST again with credentials) or `failed` (`error_code`, `message`). |

Credentials are sealed with the gateway's key and never returned.

## Provisioning (factory-new devices)

| Method & path | Auth | What it does |
| --- | --- | --- |
| `POST /provisioning/sessions` `{plugin_id, model?}` | owner | Opens a 15-minute session: `ProvisioningSession` with `transport`, `steps`, `hotspot` (`ssid_pattern`, `ssid_prefixes`, `password_rule`: `none` / `verified_rule` (then `password` is set) / `user`, `device_ip`), `experimental`, and `setup` (values the phone needs, e.g. `rethink_api_server` and `rethink_mqtt_server` for LG ThinQ2 setup). Secrets in `setup` (`mqtt_password`, `meross_key`) appear only in answers to the owner's requests: never on disk, and never in `provisioning.updated` events. |
| `GET /provisioning/sessions/{id}` | owner | Current state, `error` (`code`, `message`, `recovery`), `device_id` when done. |
| `POST /provisioning/sessions/{id}/events` `{event, data}` | owner | The phone reports progress (`phone` and `guided` transports): `pairing_mode_confirmed`, `joining_device_ap`, `device_ap_joined` (`data.ssid`), `hotspot_password_needed`, `device_info` (`data` from the device's setup network, e.g. SONOFF `deviceid`, `apikey`; Meross `uuid`, `mac`), `wifi_config_sent`, `phone_returned`, `failed` (`data.code`, `data.message`), `cancel`. |
| `POST /provisioning/sessions/{id}/run` `{home_ssid, home_password, hotspot_ssid, hotspot_password?}` | owner | `gateway` transport: the gateway joins the hotspot and runs the setup itself. Passwords are used in memory only. |
| `DELETE /provisioning/sessions/{id}` | owner | Cancels. |

States follow `ConnectionStatus`: `pairing_mode_required` → `connecting_device_ap` → (`hotspot_password_required`) →
`sending_wifi_config` → `connecting_home_network` → `waiting_for_device` → (`local_authorization_required`) →
`connected`, or `pairing_failed` with an error. After `phone_returned` (or the gateway run) the gateway scans for
the device for up to 3 minutes, matching it by the identifiers in `expect`, then pairs it. `connected` is only
reached after the device's state was read.

## Devices and rooms

| Method & path | Auth | What it does |
| --- | --- | --- |
| `GET /devices` | any | `Device[]` with `connection` (`status`, `last_seen`, `last_error`, `retry_at`), `capabilities` (each with `confirmed`), `readings`, `settings` (see below), `commands`, `pending` |
| `GET /devices/{id}` | any | One device. |
| `PATCH /devices/{id}` `{name?, room_id?, dashboard?}` | owner | Rename, move, show/hide on the dashboard. |
| `DELETE /devices/{id}` | owner | Removes it and its stored credentials. |
| `POST /devices/{id}/commands` `{command, params}` | any | Runs one normalized command (see `COMMANDS` in models.py; only those in `device.commands` are accepted). Returns `{device, result: {status: confirmed | assumed | pending, message}}`. `409 device_busy` if another command is running for 10 s. Settings: `set_setting` `{key, value}`, `press` `{key}`; `422 setting_unavailable` says what the setting needs (e.g. "AC on, in Cooling"). |
| `POST /devices/{id}/refresh` | any | Reads the state now. |
| `GET /rooms` · `POST /rooms` `{name}` | any · owner | Rooms with device counts. |
| `PATCH /rooms/{id}` `{name}` · `DELETE /rooms/{id}` | owner | |

### Settings

Devices with more than the basic capabilities (today: LG appliances through ReThink) list `settings`: `{key, kind:
select | number | switch | button | sensor, name, value, options, min, max, step, unit, available, requires, description,
diagnostic, confirmed}`. A setting the appliance does not echo back is shown with `confirmed: false` after it is changed,
until the appliance reports.

## Remote access

| Method & path | Auth | What it does |
| --- | --- | --- |
| `GET /remote` | owner | `{tailscale: {detected, addresses}, relay: {configured, url, connected, public_url, last_error}}` |
| `PUT /remote/relay` `{url, enroll_token?}` | owner | Enrols with a relay and keeps an outbound tunnel open. |
| `DELETE /remote/relay` | owner | Stops it. |

## Events (WebSocket `GET /events`)

Send `{"type": "auth", "token": "<client token>"}` first. The gateway answers `{"type": "ready"}` and then pushes
`{type, data, at}`:

| type | data |
| --- | --- |
| `device.updated` | `{device}` |
| `device.removed` | `{id}` |
| `rooms.updated` | `{rooms}` |
| `discovery.progress` | `{job}` |
| `discovery.candidate` | `{candidate}` |
| `pairing.updated` | `{pairing}` |
| `provisioning.updated` | `{session}` |
| `client.revoked` | `{id}` (then the socket closes for that client) |

A wrong token gets `{"type": "error", "code": "unauthorized"}` and the socket closes. Clients should reconnect with
back-off and re-read `/devices` after `ready`.

## Error codes

`unauthorized` 401 · `forbidden` 403 · `not_found` 404 · `already_claimed` / `conflict` / `device_busy` 409 ·
`bad_request` / `bad_params` 400 · `rate_limited` 429 · `adapter_unavailable` / `not_supported` 422 ·
`device_unreachable` / `adapter_timeout` 504 · `auth_required` / `local_key_required` / `pairing_rejected` /
`device_auth_failed` 401-like but sent as 409 (they need user input, not a new session) · `device_rejected` /
`adapter_crashed` / `adapter_error` 502 · `internal` 500.

## Relay control plane (relay mode)

Called by gateways with their tunnel secret (`Authorization: Bearer <gateway_id>.<secret>`), only when the relay has a
device broker configured (`GET /relay/v1/health` → `device_broker: true`):

| Method & path | What it does |
| --- | --- |
| `POST /relay/v1/mqtt/gateway` | The gateway's own broker login: `{url, username, password, prefix: "cube/<gateway_id>", ca_pem}` (re-issued on each call) |
| `POST /relay/v1/mqtt/devices` | A login for one new device: `{slot, server, username, password, topic_prefix: "cube/<gateway_id>/<slot>", ca_pem}` |
| `DELETE /relay/v1/mqtt/devices/{slot}` | Removes that device's login |
| `GET /relay/v1/mqtt/server` | The broker's address as devices reach it: `{server: "host:port"}` |
| `POST /relay/v1/mqtt/appliances` `{uuid, mac, password}` | A login for a device with fixed topics (Meross), limited to `/appliance/<uuid>/#`; the calling gateway gets the same topics. `409 conflict` if another gateway owns that device |
| `DELETE /relay/v1/mqtt/appliances/{uuid}` | Removes that device's login and the gateway's access to its topics |
