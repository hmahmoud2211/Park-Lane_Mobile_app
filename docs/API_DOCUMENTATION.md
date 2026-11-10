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

**Rate limits** (per IP before sign-in, per user after; one-minute windows, `backend/src/http/rateLimits.ts`): register and login 10, assistant token 20, device commands 60, starting a link flow 20, answering a flow step 60, refreshing accounts 6, creating rooms 20, gateway passes 20, gateway member checks 30 (per gateway), joining a unit 10 (per account and per IP); invites 20 an hour.

## Accounts — `routes/auth.ts`

| Method & path | Body | Answer |
|---|---|---|
| `POST /api/auth/register` | `{ email, password, name? }` (password 8–128 characters) | `SignedIn`: `{ user, token }`; `409 conflict` if the email is taken |
| `POST /api/auth/login` | `{ email, password }`; `email` is the account's email, or `ems` for the [default account](production.md#the-default-account) | `SignedIn`; `401` for a wrong email or password (same timing either way) |
| `POST /api/auth/logout` | — | `{ signedOut: true }`; revokes the session and its assistant tokens |
| `GET /api/auth/me` | — | `{ user }` (`User`, with `role`: `resident`, `doctor` or `clinic_staff`) |
| `POST /api/auth/assistant-token` | — | `AssistantToken`: `{ token, expiresAt }` |
| `POST /api/auth/logout-others` | — | `SignedOutOthers`: `{ revoked }`; every other session of the account ends (a lost phone), and their CUBE gateway access within five minutes |
| `POST /api/auth/change-password` | `ChangePassword`: `{ currentPassword, newPassword }` | `{ user }`; at least 10 characters, not the current one, not the email; the same session stays valid, the others end. 401 for a wrong current password |
| `POST /api/auth/delete-account` | `{ password }` | `{ deleted: true, clinicRecordsKept }`; deletes the signed-in resident's account and data (`ems/accountDeletion.ts`): sign-ins and live sockets, apartment membership, Health Passport data and files, invites; upcoming clinic visits are cancelled. Past clinic visits stay, and then the account row is kept with no name, email or usable password (`clinicRecordsKept: true`). 401 for a wrong password; 403 for staff accounts and the shared demo account |

**The shared demo account** (`EMS_DEFAULT_USERNAME`) cannot change its password, sign out its other sessions or be
deleted (403): everyone who tries the app signs in with it.

**Public pages** (no sign-in; strict CSP): `GET /privacy`, the privacy policy, and `GET /account/delete`, where an
account can be deleted without the app (Google Play asks for this address). The operator's name and contact come from
`LEGAL_OPERATOR_NAME` and `LEGAL_CONTACT_EMAIL` (`PRIVACY_POLICY_DATE` for the date); until both are set, `/privacy`
shows a draft notice. The texts are in `backend/src/public/`.

**Temporary passwords.** An account an admin created or reset has `user.mustChangePassword: true`. Until it changes
its password, every route except `GET /api/auth/me`, `POST /api/auth/logout` and `POST /api/auth/change-password`
answers 403 `password_change_required`.

## Sites and the inbox — `routes/sites.ts`, `routes/notifications.ts`

| Method & path | Who | Answer |
|---|---|---|
| `GET /api/sites/me` | resident in a unit | `{ site: SiteView, settings: SiteSettings }`; `404 no_home` without a unit |
| `GET /api/admin/sites` | admin | every site with its settings |
| `GET`, `PUT /api/admin/sites/:id/settings` | admin | `SiteSettings`; PUT takes any part (`SiteSettingsPatch`), `422 invalid` with `field` for a bad value |
| `GET /api/notifications?before=&limit=` | signed in | `NotificationPage`: newest first, `unread`, `next` for older ones |
| `POST /api/notifications/read` | signed in | `{ ids }` or `{ all: true }` → `{ unread }` |
| `GET`, `PUT /api/notifications/prefs` | signed in | `NotificationPrefs`; PUT `{ <kind>: boolean }`. A kind turned off is neither stored nor sent |

Realtime: `notification.new` `{ notification, unread }`. Errors may carry `field` (the input that was refused).
Notifications are kept 180 days.

## My Unit and Bills — `routes/unitFinance.ts`

Money is integer piastres (EGP × 100); dates are `YYYY-MM-DD` in the compound's zone. Finance is for the unit's owners.

| Method & path | Who | Answer |
|---|---|---|
| `GET /api/unit/overview` | resident in a unit | `UnitOverview`: details, `finance` (null for members), meters (this month vs last), documents with 2-hour signed URLs |
| `GET /api/unit/charges?group=bills\|installments` | owner | `Charge[]` with `paid`, `outstanding`, `status` (paid / partial / due / overdue / void) |
| `GET /api/unit/payments` | owner | `Payment[]` with server-issued `receiptNo` (`RCP-YYYY-NNNNN`) |
| `GET /api/unit/meters?months=12` | resident | readings, newest first |
| `GET /api/unit/documents/:id/file` | member, or a signed link | the file (`nosniff`) |
| `PUT /api/admin/units/:id/details` · `GET …/finance` | admin | details · everything plus the owner's summary |
| `POST /api/admin/units/:id/contracts` | admin | `{ kind, price, signedOn?, schedule?: { downPayment?, downPaymentDueOn?, installments, firstDueOn, everyMonths } }`: whole-pound installments, the last takes the remainder |
| `POST /api/admin/units/:id/charges` · `POST /api/admin/charges/:id/void` | admin | a bill (`INV-YYYY-NNNNN`) · cancel one with no payments |
| `POST /api/admin/units/:id/payments` | admin | `{ chargeId?, amount, paidOn, method, note? }`; never more than what is left on the charge |
| `PUT /api/admin/units/:id/meters` | admin | `{ readings: [{ meter, period, value, readOn? }] }` |
| `POST /api/admin/units/:id/documents?kind=&title=` · `DELETE /api/admin/documents/:id` | admin | the file as the body: PDF, PNG or JPEG, checked by its bytes, 10 MB |

## Visitors and parcels — `routes/visitors.ts`

| Method & path | Who | Answer |
|---|---|---|
| `GET`, `POST /api/visitors` · `POST /api/visitors/:id/revoke` | resident in a unit | the unit's passes; a new one follows the compound's rules (`422 invalid` with `field`) and holds a QR `code` (`PLV1.<id>.<token>`) |
| `GET /api/parcels` | resident | waiting parcels, then the last 30 days |
| `POST /api/security/visitors/check { code }` | `security` or admin | `GateCheck`: admit / exit / too_early / expired / revoked / used / unknown (records nothing) |
| `POST /api/security/visitors/:id/entry \| /exit { gate? }` | `security` or admin | only one gate can admit a pass; entry tells the unit |
| `GET /api/security/visitors/today` | `security` or admin | today's passes on the site |
| `GET`, `POST /api/security/parcels` · `POST …/:id/collect \| /return` · `GET /api/security/units` | `security` or admin | waiting parcels; log one (`PCL-YYYY-NNNNN`, the unit is told); hand over once; apartment names only |

Realtime: `visitor.updated`, `parcel.updated` to the unit's residents. Past passes are deleted after the compound's
`visitors.retentionDays` (90 by default).

## Maintenance, housekeeping and moving — `routes/requests.ts`

| Method & path | Who | Answer |
|---|---|---|
| `GET /api/requests/options?kind=maintenance\|housekeeping\|moving` | resident in a unit | `ServiceRequestOptions`: active categories, visit windows (`HH:MM-HH:MM`), first and last day, the emergency number (or null), time zone, apartment name |
| `GET`, `POST /api/requests` | resident in a unit | the unit's requests, newest first; a new one follows the compound's rules (`422 invalid` with `field`: `category`, `title`, `details`, `preferredDate`, `preferredWindow`) and gets `REQ-YYYY-NNNNN` |
| `POST /api/requests/:id/cancel` | any resident of the unit | only while `submitted` or `assigned` (`409 invalid_transition` after) |
| `POST /api/requests/:id/comments { note }` | any resident of the unit | not on a cancelled request |
| `POST /api/requests/:id/photos` (JPEG or PNG as the body, 5 MB) | any resident of the unit | up to 4 per open request; checked by its first bytes; sealed on disk |
| `GET /api/requests/photos/:id/file` | a resident of the unit, an admin, or a two-hour signed link | the photo |
| `GET /api/admin/requests?status=open\|…&kind=&site=` | admin | the queue: open first, urgent on top |
| `POST /api/admin/requests/:id/assign { technicianId, scheduledDate, scheduledWindow, note? }` | admin | books an active technician of the same compound; again to change the booking, until work starts |
| `POST /api/admin/requests/:id/status { status, note? }` | admin | `in_progress` (from assigned), `completed` (from assigned or in progress), `cancelled` (needs a note); only one of two people acting at once wins |
| `POST /api/admin/requests/:id/comments { note }` | admin | a message to the unit |
| `GET`, `POST /api/admin/technicians` · `PUT /api/admin/technicians/:id` | admin | technicians on record (not app accounts); the phone is sealed and shown to the resident once booked |
| `GET /api/admin/service-categories` · `PUT /api/admin/service-categories/:kind/:id { active }` | admin | which categories residents may choose |

Realtime: `request.updated` to the unit's residents. Management's steps and messages also go to their inbox
(kind `requests`). The request stays with the apartment when the person who made it deletes their account.

## Community — `routes/community.ts`

| Method & path | Who | Answer |
|---|---|---|
| `GET /api/community` | resident in a unit | `CommunityFeed`: live notices and alerts, upcoming events (with `rsvp`: going / open / soon / full / closed), the open poll, the last 5 closed polls, the compound's time zone |
| `POST /api/community/events/:id/rsvp { going }` | resident | places are counted inside one transaction (`409 conflict` when full; `409 invalid_transition` before registration opens or after it closes) |
| `POST /api/community/polls/:id/vote { optionId }` | resident | one vote per resident, changeable until the poll closes |
| `GET`, `POST /api/community/feedback { topic, message }` | resident | topic suggestion / concern / compliment / other, message 10–500 characters, sealed at rest; the list shows management's reply |
| `GET /api/admin/community` · `GET /api/admin/pictures` | admin | everything published (expired too) · the picture names the app ships |
| `POST /api/admin/community/announcements` · `PUT`, `DELETE …/:id` · `POST …/:id/expire` | admin | publishing tells residents (inbox kind `community`); `picture` must be one of the listed names |
| `POST /api/admin/community/events` · `PUT …/:id` · `POST …/:id/cancel { note? }` · `GET …/:id/attendees` | admin | a new event tells residents; a change of time or place, or a cancellation, tells those registered |
| `POST /api/admin/community/polls { question, closesAt, opensAt?, options }` · `POST …/:id/close` · `DELETE …/:id` | admin | 2–6 options, up to 90 days |
| `GET /api/admin/community/feedback?status=` · `POST …/:id/reply { reply }` · `POST …/:id/close` | admin | the reply goes to the resident's inbox |

Realtime: `community.updated` to the compound's residents whenever management changes something.

## Amenities — `routes/amenities.ts`

| Method & path | Who | Answer |
|---|---|---|
| `GET /api/amenities` | resident in a unit | `AmenityOptions`: active amenities, the days that can be booked, the time zone |
| `GET /api/amenities/:id/slots?date=YYYY-MM-DD` | resident | each slot's places left (shared) or 1 / 0 (exclusive), whether it is the apartment's, whether it has started |
| `POST /api/amenities/:id/bookings { date, start, people }` | resident | `BK-NNNNN`; `409 slot_taken` when there is no room, the court is taken, or the apartment already has that slot. Checked in one transaction, and the database refuses a second booking of an exclusive slot or of the same slot by one apartment |
| `GET /api/amenities/bookings` · `POST /api/amenities/bookings/:id/cancel` | anyone in the apartment | until the amenity's cut-off before the start |
| `GET`, `POST /api/admin/amenities` · `PUT /api/admin/amenities/:id` | admin | the catalogue; switching one off stops new bookings and keeps those made |
| `GET /api/admin/amenities/:id/bookings?date=` · `POST /api/admin/amenity-bookings/:id/cancel { note }` | admin | a day's bookings with apartment names; a cancellation tells the apartment |

Realtime: `amenity.updated` to the compound's residents on every booking or cancellation. Deleting an account
cancels that person's bookings that haven't started.

## Parking — `routes/parking.ts`

The parking rules (`backend/src/parking/engine/`, ported from the app) run on the server. Each request is one SQLite
transaction: load what a rule can touch, run the due rules (no-shows, overdue visits, charging windows), run the
step, write back only what changed. A rule's refusal is `409 parking_refused` with the rule's code in `field`
(`space-unavailable`, `guest-limit`, `stale`, `checked-in`, …). Pass and invitation tokens are never stored, only
their hashes; the server re-creates them from its key for the people allowed to see them.

| Method & path | Who | Answer |
|---|---|---|
| `GET /api/parking/snapshot` | resident in a unit | the store as the apartment may see it: the layout and live occupancy, its own bookings (90 days) with their passes and links (`displayToken`, `inviteToken`), other apartments' open bookings as bay and time only, `me`, `inviteBase`, `securityPhone` |
| `POST /api/parking/search { kind, start, end, connectorType?, chargingStart?, chargingEnd? }` | resident | bays and whether each is free for that time (times in ms) |
| `POST /api/parking/reservations` | resident | a booking for a guest (or the resident's own EV); the apartment and person come from the session |
| `POST /api/parking/reservations/:id/cancel \| replace-pass \| reassign \| share \| plug-in \| stop \| extend \| edit` | anyone in the apartment | the apartment's bookings only (`404` otherwise); `extend` and `edit` take `expectedVersion` |
| `POST /api/parking/notifications/read` · `GET`, `POST /api/parking/vehicles` · `DELETE …/:id` | resident | up to 5 vehicles; one with an open booking can't be removed |
| `GET /api/parking/pass/:token` · `POST …/plate \| help \| plug-in \| stop` | the visitor (no account; the link is the key) | that booking only, with its QR while it can open a gate; rate limited per address |
| `GET /parking/pass/:token` | the visitor | the pass page (`no-store`, `no-referrer`, strict CSP) |
| `GET /api/security/parking` | `security` or admin | gates, expected arrivals, who is inside, upcoming visits, bays, chargers, open alerts |
| `POST /api/security/parking/scan { code, gateId, direction }` | `security` or admin | the gate's decision; only one scan admits a pass |
| `POST /api/security/parking/reservations/:id/entry \| exit { gateId, reason, plate? }` · `…/moved-out \| reassign \| stop-charging` | `security` or admin | by hand, with a reason (plates checked) |
| `POST /api/security/parking/spaces/:id/occupancy \| serviceability { state, note }` · `…/chargers/:id/fault \| restore` · `…/alerts/:id/resolve` | `security` or admin | |

Realtime: `parking.updated` to the compound's residents after any change. The rules' alerts go to the inbox (kind
`parking`): the owner's to the resident who booked, operator alerts to `security` and admin accounts. A sweep runs
the due rules every minute. Deleting an account cancels that person's upcoming bookings (the pass and link stop
working) and keeps past ones as the gate's log without them.

## Quarter-hour series and weather — `routes/series.ts`, `routes/sites.ts`

Readings are stored one per quarter hour (`slot = floor(epoch ms / 900 000)`). Rows may be written ahead (the
generator fills through 2029), but **no query reads a slot after now**, so one new reading per series appears every
15 minutes by itself. Answers carry `source` (`simulated` for a demo compound, `live` otherwise).

| Method & path | Who | Answer |
|---|---|---|
| `GET /api/sites/me/bms/latest` | resident in a unit | `BmsLatest` (power, solar, MDB, generator, water and pumps, air, fans, internet, cameras, elevator, gates, fire panel, any non-safety fault, health) or `null`; `Cache-Control: private, max-age=<seconds to the next quarter>`, `ETag` (a match gets `304`) |
| `GET /api/sites/me/bms/series?metrics=kw,co2&from&to&bucket=15m\|1h\|1d` | resident | average, min and max per bucket (days follow Cairo's calendar), at most 2,000 points; metrics `kw kwh solar_kw grid_cost co2 temp humidity net_down ping water_tank` |
| `GET /api/units/me/energy/latest` | resident | `EnergyLatest`: this quarter hour and today since midnight, by lighting, AC, media and other; or `null` |
| `GET /api/units/me/energy/series?…` | resident | metrics `total lighting ac media other` (kWh per quarter hour, averaged per bucket) |
| `GET /api/admin/sites/:id/bms/latest` | admin | the compound's latest reading |
| `GET /api/weather` | resident | `{ temperatureC, symbol, updatedAt, credit }` from MET Norway, or `null` while `WEATHER_CONTACT` is unset |

Realtime: `bms.reading` to the compound's residents and `energy.reading` to the apartment's members when a new
quarter hour becomes current (a timer re-aligned at every tick).

Generator: `node scripts/generate-series.ts --site <demo site> [--create "Name" --demo-units N] --from 2026-01-01
--to "2029-12-31 23:45" --seed 42 --units all [--yes-i-am-sure]`. It writes only to a demo site, refuses a database
with real residents without `--yes-i-am-sure` (checked before anything is written), and never writes an alarm.

## Scenes and automations — `routes/home.ts`

| Method & path | Who | Answer |
|---|---|---|
| `GET /api/home/scenes` · `POST /api/home/scenes/:id/activate` | resident (assistant tokens may read) | the scenes in the apartment's Home Assistant (hidden or disabled ones left out); activating calls `scene.turn_on` only |
| `GET /api/home/automations` · `PATCH /api/home/automations/:id { action: enable \| disable \| run }` | resident | `automation.turn_on`, `turn_off` or `trigger` only; anything else is `404` or `422` |

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

All need `Authorization: Bearer <ADMIN_API_KEY>`, or the session of an EMS account with the `admin` role that has
chosen its own password (the admin dashboard at `/admin` signs in this way). A resident's session gets 403. Changes
are logged with who made them.

| Method & path | Body | Answer |
|---|---|---|
| `GET /api/health` | — | `{ status: 'ok' }` |
| `GET /api/admin/features` | — | `{ gatewayContainers }`: whether this server makes each unit's CUBE gateway (`GATEWAY_RELAY_ENROLL_TOKEN` set) |
| `GET /api/admin/units` | — | units, each with its `hub` and `gatewayContainer` |
| `POST /api/admin/units` | `{ name, building?, provision?, gateway? }` | the unit with its `hub` and `gatewayContainer`. Provisions a Home Assistant container unless `provision: false`, and starts its CUBE gateway when the server makes them, unless `gateway: false` |
| `DELETE /api/admin/units/:id` | — | `{ deleted: true }`; removes its Home Assistant and gateway containers, keeping their data (`/config` folder, gateway volume) |
| `POST /api/admin/units/:id/provision` | — | the hub; starts or retries provisioning |
| `POST /api/admin/units/:id/gateway` | `{ update? }` | the `gatewayContainer`. Starts the unit's gateway, or retries one that failed, or starts a removed one again with the same id and devices. With `update: true`, pulls the image again and recreates it with the same settings. 409 `conflict` when another gateway (a box at home) is linked; 503 `not_configured` when the server makes none |
| `DELETE /api/admin/units/:id/gateway` | — | `{ removed }`; stops and removes the container and unlinks it. Its volume and id are kept |
| `POST /api/admin/units/:id/members` | `{ email, role? }` | `{ unitId, user, role }`; puts an existing account in the unit (`owner` or `member`) |
| `DELETE /api/admin/units/:id/members/:userId` | — | `{ removed }`; takes a resident out of the unit |
| `GET /api/admin/units/:id` | — | the unit with its `hub`, `gateway`, `gatewayContainer` and `members` (`userId, name, email, role, since`) |

`gatewayContainer` is the gateway the server runs for the unit, or `null`: `{ unitId, gatewayId, containerName, port,
status, lastError }`. `status` is `provisioning` (starting, until it has checked in and answers through the relay, up
to three minutes), `running`, `failed` (`lastError` says why) or `removed`.
| `GET /api/admin/users?q=` | — | accounts matching name or email (newest first, 200 at most), each with `role`, `mustChangePassword` and its `unit` |
| `POST /api/admin/users` | `{ email, name?, role?, unitId?, unitRole? }` | `{ user, temporaryPassword, unitId }`; `role` is `resident` (default) or `admin`; the temporary password is shown only here |
| `POST /api/admin/users/:id/reset-password` | — | `{ temporaryPassword }`; signs the account out everywhere; it must choose a new password |
| `GET /api/admin/hubs` | — | all hubs |
| `POST /api/admin/hubs` | `{ unitId, baseUrl, token }` | attaches a separately run Home Assistant (address inside `HA_ALLOWED_NETWORKS`) |
| `GET /api/admin/gateways` | — | the CUBE gateways attached to units, with `lastSync` |
| `POST /api/admin/gateways` | `{ unitId, gatewayId, secret, url? }` | attaches a CUBE gateway to a unit; `secret` (32+ characters) is the one the gateway was started with (`CUBE_EMS_SECRET`), `url` its https relay address |
| `DELETE /api/admin/gateways/:id` | — | `{ deleted }` |

## The resident's apartment — `routes/unit.ts`

App sessions only (`backend/src/ems/membership.ts`). Joining a unit gives an account both the unit's brand-account
devices (Home Assistant) and its CUBE gateway (passes go only to members); removing a member ends both, Home Assistant
at once and the gateway at its next member check.

| Method & path | Body | Answer |
|---|---|---|
| `GET /api/unit` | — | `MyUnit`: `{ unit, role, members }`; members' emails only for owners; 404 `no_home` without a unit |
| `POST /api/unit/invites` | `{ role? }` | `UnitInvite`: `{ code, role, expiresAt }`; owners only; single use, 24 hours, at most 10 open per unit |
| `POST /api/unit/join` | `{ code }` | `MyUnit`; 422 `invalid` (wrong, used, expired), 409 `conflict` (already in another unit); a code for your own unit isn't used up |
| `DELETE /api/unit/members/:userId` | — | `MyUnit`; owners only, not themselves |

## CUBE gateway access — `routes/gateway.ts`

Residents reach their apartment's CUBE gateway with their account instead of a setup code
(`backend/src/ems/gatewayAccess.ts`, `gateway/cube_gateway/accounts.py`).

| Method & path | Who | Answer |
|---|---|---|
| `GET /api/gateway/key` | anyone | `{ alg: 'Ed25519', key }`: the public key gateways check passes with (they pin it) |
| `POST /api/gateway/pass` | a session (not an assistant token) | `GatewayPass`: `{ gateway: { id, url }, pass, expiresAt, role }`; 404 `no_gateway` when the resident's unit has none. The pass is signed, single use, valid 5 minutes, for that gateway only; the app hands it to `POST <url>/api/v1/auth/account` |
| `GET /api/gateway/members` | the gateway, `Bearer <gateway id>.<secret>` | `{ gatewayId, unitId, members: [{ userId, role, sessions }] }`; `sessions` are the ids of the member's signed-in app sessions. The gateway removes phones of anyone not listed, phones whose session ended, and follows roles |
| `POST /api/gateway/sessions/revoke` | the gateway | `{ sessions: [id] }` → `{ revoked }`: ends the app sessions of phones an owner removed on the gateway (its own residents' only), so a lost phone can't ask for a new pass |

A phone's gateway token lives as long as the app session that asked for its pass: the pass carries the session's id
(`sid`, a one-way fingerprint, never the token).

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
