# Plan: a real backend for every Parklane feature, and a 15-minute data generator through 2029

Status: **approved 10 November 2026** with every recommendation, except weather (D3): use **MET Norway**'s free
API (CC BY 4.0, commercial use allowed with credit, an identifying User-Agent, its cache headers, called only from the
backend). Store-readiness work committed as `f7b302d`; this work is on `feature/real-backend`, uncommitted.

## Progress

| Phase | State |
|---|---|
| 1 Building blocks | **done**:
- migration 14 (sites, unit details, site settings, reference counters, notifications, admin audit);
- the `security` role and `authorizeStaff`;
- `lib/sealedFiles.ts` (Health uses it);
- broadcasts, the inbox (API, realtime, app screen, Settings row);
- admin page registry and the Compound rules page;
- `field` in API errors, safe path decoding.

Tests: 152/152 backend (8 new), app checks green, browser checks of the dashboard and inbox. |
| 2 My Unit + Bills, Visitors, Deliveries | **done**:
- migration 15;
- finance worked out from records (contract schedule, charges, payments with receipts, meters, sniffed documents);
- visitor passes with sealed names, online gate check, single-gate entry, retention;
- parcels;
- admin pages Unit finance and Gate (security role);
- app: My Unit and Visitor Access on real data, new Bills and Deliveries screens, live updates.

Tests: 161/161 backend (9 new), 15/15 dashboard and 15/15 app browser checks. Still in `sampleScreens` until Phase 7. |
| 3 Service requests | **done**:
- migration 16 (technicians, service categories, requests with sealed details, their steps and sealed photos);
- maintenance, housekeeping and moving through one API; compound rules decide days and windows;
- management books a technician, starts, completes or cancels (one winner at a time); messages both ways;
- inbox messages and live updates to the unit; photo files swept when their apartment goes;
- admin page Requests (queue, booking, history, technicians, categories);
- app: Maintenance on real data, Housekeeping and Moving as the same screen (Services rows), emergency card only
  when management has set the number. Maintenance now in the store build; photos from the app not yet.

Tests: 167/167 backend (6 new), 21/21 browser checks (app and dashboard). |
| 4 Community, Amenities | **done**:
- migration 17 (notices, events and RSVPs, polls and votes, feedback; amenities and bookings);
- RSVPs counted inside a transaction; one vote per resident, changeable until close; feedback sealed, replies to
  the inbox; pictures chosen from the app's own list (no uploads);
- amenity slots in the compound's time; double booking refused by the code and by two unique indexes;
- admin pages Community and Amenities;
- app: Community and Amenities on real data, live updates; both now in the store build. No sample amenities or
  notices are seeded: management adds them (the dev seed in Phase 7 can add examples).

Tests: 176/176 backend (9 new, including two race tests: 20 bookings at once fill exactly 8 places, 5 at once get
one court), 20/20 browser checks (app and dashboard). |
| 5 Parking | **done**:
- the rules engine ported to `backend/src/parking/engine/` (17 files; `.ts` imports, no parameter properties, local
  copies of three helpers); one SQLite transaction per step that loads only what a rule can touch and writes back
  only changed rows; migration 18 (one table per collection, keyed by compound and id, sealed where a row can name
  a person or a plate);
- pass and invitation tokens derived from the server key and stored only as hashes (`displayToken` removed);
  cancelling now also closes the visitor's link; operator plates checked;
- the users and units are the rules' residents and properties; an apartment's snapshot shows others' bookings as
  bay and time only;
- resident, visitor and gate-staff APIs; the visitor's pass page with a QR from a small encoder (`lib/qr.ts`,
  identical to the app's `qrcode` package on 72 of 72 test matrices); the dashboard's Parking page; a minute sweep;
  inbox alerts; account deletion;
- app: the parking screens run on the backend through a remote provider with the same methods; the share link is
  the backend's pass page; the guest pass shows the compound's real security number; Demo controls and the
  Security console keep an offline demo store.

Tests: 208/208 backend (the 23 acceptance checks on the database store, 6 API tests, 2 QR tests), the app's own
23 checks still pass, 14/14 browser checks (app, visitor page, dashboard).

Not yet in the store build: the map files (`site.ts`) also hold the demo's sample residents, and the guest pass
has demo wording; Phase 7 splits them out. The bays, gates and roads are the design's sample layout, and the gates'
map coordinates are not surveyed: building management must confirm the real layout before launch. |
| 6 Time series, generator, energy, HA scenes/automations, weather | **done**:
- migration 19 (`bms_readings`, `unit_energy`, WITHOUT ROWID, keyed by series and slot);
- the simulation (`series/model.ts`): Cairo's occupancy, temperature, sun, water cycle, evening internet, elevator,
  rare non-safety faults; a pure function of (seed, series, slot); four years of the building show no alarm;
- the generator (`scripts/generate-series.ts`): demo sites only, the real-resident guard checked before any
  write, deterministic and resumable; four years for a building and 3 apartments in about 1 s (20.7 MB);
- the API stops at the current slot (one new reading per quarter hour), caches to the next quarter with an ETag,
  averages ranges by bucket; the quarter-hour push (`bms.reading`, `energy.reading`);
- Home Assistant scenes and automations (list, activate, enable / disable / run; nothing else callable);
- the MET Norway weather proxy, off until `WEATHER_CONTACT` is set (User-Agent with contact, four decimals,
  Expires and If-Modified-Since, credit);
- app: `useQuarterHourly`; BMS on the readings with a "Simulated data" label; Smart Home's scenes, automations and
  energy from the apartment's own data; the weather pill from the backend; MET Norway credited in Help & Support.

Tests: 221/221 backend (8 series, 2 scenes, 3 weather), 9/9 browser checks. Not built: the live sampler that would
read real apartments' power sensors (real apartments show no energy until it exists, never invented figures). |
| 7 Store mode hand-over, docs, verification | **done**:
- store build: My Unit and Bills, Visitor Access and Deliveries, Maintenance / Housekeeping / Moving, Community,
  Amenities and the inbox are in, with their Home tiles; BMS stays out (simulated); Parking stays out until its
  real layout is confirmed (`EXPO_PUBLIC_PARKING=1`; its screens are then loaded by a build-time require);
  simulated energy is never shown in the store build;
- parking made store-ready: the demo's people moved out of `site.ts` (`demoPeople.ts`), the context split from the
  offline demo (`parkingValue.ts`), no made-up phone or link left; the store bundle has 0 of the old sample strings;
- `scripts/seed-dev.ts` (a demo compound with something in every feature; demo sites only, real-resident guard);
  it found two real bugs, both fixed and tested: a compound added later had no service categories, and references
  collided between compounds (now one counter per kind and year, migration 20 carries existing numbers on);
- privacy policy, deletion page, in-app deletion text and the store privacy answers list the new data;
  ARCHITECTURE, production (a section for this release), API docs, store checklist and readiness report updated;
- verified: backend 222/222, app tsc and lint clean, 9 app check suites 183/183, browser flows on the final build
  (Phase 2 15/15, Phase 3 21/21, Phase 4 20/20, Phase 5 14/14, Phase 6 9/9), store-mode walk 15/15, visual
  comparison with the starting commit: only the intended Settings subtitle changed.

Generator, measured: 140,256 quarter hours (2026-01-01 to 2029-12-31 23:45) per series; a building and 3
apartments write 561,024 rows in about 1 s, 20.7 MB. |

## 0. Decisions I need from you

| # | Question | My recommendation |
|---|---|---|
| D1 | Keep SQLite, or move to PostgreSQL? | **Keep SQLite** (§2) |
| D2 | Simulated energy for every apartment through 2029 costs about 3.4 MB per apartment (measured). Generate it for every unit, or only for demo units, while real units record live Home Assistant readings? | **Demo units only**; real units get live readings (§5.3) |
| D3 | Weather: Open-Meteo's free API is for **non-commercial** use only (checked on its pricing page today; the paid price isn't published). Parklane is commercial | Buy Open-Meteo's commercial plan, or choose another paid provider. Until then, hide the weather pill |
| D4 | Placeholder rows: build, merge or drop? | Build Bills & Utilities (inside My Unit), Housekeeping and Moving (as service requests), Deliveries (parcels the gate logs), Notifications (the inbox and its settings). **Drop** Language, Appearance and App Preferences for now (§4.9) |
| D5 | Push notifications (needs APNs and FCM keys, `expo-notifications`, a new native build) | **Not in this round**: an in-app inbox plus realtime first |
| D6 | The current store-readiness work is uncommitted on `release/store-readiness-2026-11` | Commit it first, then I branch `feature/real-backend` from it. Otherwise the new branch carries those uncommitted changes too |
| D7 | One apartment per account (today's rule), or several? The parking demo assumes several | **Keep one** for now (§4.7) |

## 1. Inventory: what each screen shows today, and what replaces it

Paths are relative to `frontend/src/`. "sd" means that screen's `.data.ts` file. Today every create or change lives
in the screen's `useState`, so it is lost when the resident leaves the screen. Almost every value is a pre-formatted
English string ("05 Oct 2026", "EGP 8,500,000"). **The API will send ISO dates and integer piastres (EGP × 100), and
the app will format them**, which Arabic support needs anyway. All IDs (`visitor-<ms>`, `REQ-YYYY-NNNNN`, `BK-NNNN`,
`RCP-YYYY-NNNN`) are made on the phone today. **The server will issue them.**

| Screen | Data today (file:line) | Replaced by | Created by |
|---|---|---|---|
| **My Unit** | Hero and overview: tower, floor, type, bedrooms, bathrooms, area, parking bay, handover (sd:39-101). Finance: price, paid, remaining, next installment, due date, remaining count (sd:103-134; the count "18" doesn't match the balance). Maintenance fees (sd:142-153). Meters: electricity, water, gas this month with trend (sd:156-184). Documents: contract, receipts, floor plan (sd:186-208). 31 invented receipts (sd:210-242). PDFs built on the phone (`MyUnitScreen.documents.ts:66-170`) | `units` (new columns), `unit_contracts`, `unit_charges`, `unit_payments`, `meter_readings`, `unit_documents`; `/api/unit/*` (§4.1) | Management (admin); the resident only reads |
| **Visitor Access** | Passes: name, mobile, date, time, guests, plate, status arrived/scheduled/entered (sd:16-127). Form rules: name required, mobile ≥ 8 digits, plate upper-cased, today to +13 days, 08:00–22:00 every 30 min, 1–10 guests (sd:132-285). QR `PARKLANE:VISITOR:<ID>`, marked a placeholder (sd:253-259). "Today" stored literally as the date (`VisitorAccessScreen.tsx:215`) | `visitor_passes`, `visitor_entries`; `/api/visitors/*`, `/api/security/visitors/*` (§4.2) | Resident creates; security checks in; management sets the rules |
| **Maintenance** | 9 categories (sd:39-68). Request: reference, title, category, status submitted → assigned → in progress → completed with stamped stages, technician, visit date and 3-hour window, contact phone (sd:86-163). Form: issue 3–60 characters, details ≤ 200, tomorrow to +14 days, windows 09–12, 12–15, 15–18 (sd:165-257). Emergency number `null` (sd:316-321). Seeded technician has the resident's own name. No priority, cancel or photos today | `service_requests`, `service_request_events`, `service_request_photos`, `technicians`, `site_settings.emergency_phone`; `/api/requests/*` (§4.4) | Resident creates; management assigns and updates |
| **Community** | 4 announcements (sd:57-103). 5 events with ISO date, from/to, venue, RSVP state (sd:117-188). 4 alerts warning/info (sd:206-257). Current poll with no question field (sd:259-283). 2 past polls (sd:300-330). Feedback: 4 topics, 10–500 characters, never sent (sd:332-354) | `announcements`, `events`, `event_rsvps`, `polls`, `poll_options`, `poll_votes`, `feedback`; `/api/community/*` (§4.5) | Management publishes; residents RSVP, vote, send feedback |
| **Amenities** | 7 amenities: location, opens/closes `HH:MM`, capacity, categories (sd:62-167). Booking: amenity, date, one-hour slot, guests (sd:186-199). Rules: today to +13 days, one-hour slots, today from the next full hour, guests ≤ min(6, capacity), no double booking by the same resident; capacity across residents is never checked (sd:212-285) | `amenities`, `amenity_bookings`; `/api/amenities/*` (§4.6) | Management (catalogue); residents book |
| **Parking** | On-device engine and data: see §4.7 | `parking_*` tables (§4.7) | Residents book; gates and security act; management configures |
| **BMS** | Health 0.89; "12 System"; last update a fixed date (`BmsScreen.data.ts:54-65`). Fans ×4, MDB 220 V / 31 I, generator standby with solar tank 82%, feeds 786 kW / 890 EGP and solar 231 kW / 216 EGP (:78-114). Internet 86.4 Mbps, upload, ping (:116-138). Gates ×3 (:145-148). One CCTV still (:162). Elevator floor, maintenance, power (:175-181). Water tank 82%, pumps ×3 (:187-195). Fire alarm, pump, tank with last-maintenance dates (:204-230) | `bms_readings` (15-minute series, §5) + `bms_assets` (names, last maintenance, from management) | Generator now; a live BMS later |
| **Smart Home panels** | 8 scenes, active "welcome" (`SmartHomeScreen.data.ts:157-177`). Energy today 12.4 kWh, budget 28, −12% vs yesterday, breakdown lighting/AC/media/other, by room (:187-207). 6 automations (:249-305). All local | Scenes and automations: the apartment's **Home Assistant** (`scene.*`, `automation.*`). Energy: `unit_energy` (§5) | Home Assistant; the generator or the live sampler |
| **Home** | Weather "24 C Clear Night" (`HomeScreen.data.ts:11-31`). Unit card from `demoResident.ts:23-38` | `/api/sites/me/weather` (D3); unit card from `/api/unit` | Weather provider; management |
| **Profile** | Static gate QR `PARKLANE:RESIDENT:A-302:AHMED-HASSAN` (`ProfileScreen.data.ts:50-55`). Sample rows with no screen (:18-39) | Resident gate pass: `POST /api/access/pass`, short-lived and signed; rows link to the new screens | Backend |
| **Services placeholders** | Housekeeping, Bills & Utilities, Deliveries, Moving Request (`ServicesScreen.data.ts:35-66`) | See D4 and §4.9 | — |
| **Settings placeholders** | Notifications, Language, Appearance, App Preferences (`SettingsScreen.data.ts:48-83`). No `expo-notifications` and no `expo-localization` installed; the app is dark-only (`app.json:8`) | See D4 and §4.9 | — |

## 2. Database: stay on SQLite (decision D1)

**Recommendation: keep SQLite** (`node:sqlite`, one file, WAL), as the project rules say.

- **Size is small.** Measured on this Mac: the building's 15-minute BMS series from 1 Jan 2026 to 31 Dec 2029 (140,256 rows) is **10.1 MB** and is written in **0.15 s**. Each apartment's 15-minute energy series adds **≈3.4 MB** (50 apartments: 7,012,800 rows, 182.5 MB, written in 4.7 s).
- **Queries are fast.** The latest reading takes **0.016 ms**. A daily chart from Jan 2026 to now takes **4.3 ms** (315 points). One apartment's last 30 days, hourly, takes **0.4 ms**. So no rollup tables are needed; charts aggregate on read.
- **Writes are few.** A compound of a few hundred apartments makes a few writes a second at most. That's well within SQLite with WAL and the existing `busy_timeout`.
- **No new moving parts.** One process, one Docker volume, backups by `sqlite3 .backup`, the same 13 migrations.

**PostgreSQL would cost:**

- a database driver, which breaks the "no runtime packages" rule;
- a second service to run, back up and secure;
- porting 13 migrations and every repository;
- hosting: about USD 20–50 a month managed, or more server work self-hosted.

It becomes worth it if the backend must run as several processes, or serve many compounds as one service. Neither is true today.

## 3. Shared building blocks (built first)

| Block | What | Why |
|---|---|---|
| **Sites** | New `sites(id, name, timezone, kind 'real'\|'demo', series_key INTEGER UNIQUE)`; `units.site_id` (new column, existing units → `park-lane`) | Building-level data (BMS, announcements, amenities, parking) belongs to a compound; the generator writes only to `kind='demo'` sites unless forced |
| **Unit details** | New columns on `units`: tower, floor, number, bedrooms, area, `series_key` | Today these are invented in `demoResident.ts` |
| **Roles** | Add `security` (gate and lobby staff) to `Role` (`shared/contracts/auth.ts`); management stays `admin` | Visitor check-in, parcels and parking gates need staff who aren't admins |
| **Sealed files** | Move `backend/src/health/files.ts` storage into `backend/src/lib/sealedFiles.ts` with a folder per kind; Health keeps exactly its behaviour (its tests must stay green) | Maintenance photos, PDFs |
| **Realtime** | Helpers `publishToUnit(unitId, event)`, `publishToSite(siteId, event)` over the existing per-user bus (`ems/events.ts`) | Status changes, new announcements, BMS quarter-hour push |
| **Notifications inbox** | `notifications(id, user_id → users ON DELETE CASCADE, kind, title, body, ref_type, ref_id, created_at, read_at)`; `GET /api/notifications`, `POST /api/notifications/:id/read`, realtime `notification.new` | One place every feature reports to; push notifications later (D5) |
| **Management audit** | `admin_audit(id, actor_id, action, target_type, target_id, detail, at)` | Every management change is traceable (like `clinic_audit`) |
| **Admin dashboard** | Split `backend/src/admin/app.js` (957 lines) into ES modules, one page per domain (`admin/pages/*.js`), still vanilla JS with the same strict CSP | Seven new pages won't fit one file |
| **Contracts** | One file per domain in `shared/contracts` (`unitFinance.ts`, `visitors.ts`, `maintenance.ts`, `community.ts`, `amenities.ts`, `parking.ts`, `series.ts`, `notifications.ts`) | Typed both sides |
| **Account deletion** | Every new table gets a rule in `accountDeletion.ts` (see §4), with tests | Store rules |

## 4. Feature by feature

Conventions for every table:

- **Text ids:** text primary keys (UUIDs). People see a server-issued reference (`REQ-2026-00124`) from a per-site counter table, `reference_counters(site_id, kind, year, next)`.
- **Money:** integer piastres. **Times:** ISO UTC strings.
- **Foreign keys to a person:** `ON DELETE SET NULL` where a building record must survive the person (security logs, finance, maintenance history), and `CASCADE` where the row is only that person's (RSVPs, votes, preferences).
- **Sealed columns:** free text a resident writes about themselves or others (request details, feedback, visitor names and phones) is sealed with the existing `seal()` / `unseal()`.
- **Management actions:** each one writes `admin_audit`; each resident-visible change publishes a realtime event and an inbox notification.

### 4.1 My Unit, Bills & Utilities
| Table | Key columns |
|---|---|
| `units` (+columns) | `site_id`, tower, floor, number, unit_type, bedrooms, bathrooms, area_m2, parking_bay, handover_status, `series_key` |
| `unit_contracts` | unit_id → units CASCADE, kind sale/lease, price, signed_on, handover_on |
| `unit_charges` | unit_id, contract_id (nullable), kind installment / down_payment / service_charge / electricity / water / gas / other, period, due_on, amount, status due/paid/partial/void, reference. Index (unit_id, due_on) |
| `unit_payments` | unit_id, charge_id (nullable), amount, paid_on, method (cash, transfer, cheque, card at the office), **receipt_no UNIQUE (server-issued)**, recorded_by → users SET NULL |
| `meter_readings` | unit_id, meter, period `YYYY-MM`, value, read_on, source manual/live. UNIQUE (unit_id, meter, period) |
| `unit_documents` | unit_id, kind floor_plan / contract_scan / other, sealed file, title |

**Resident API** (`/api/unit/...`): `details`, `finance` (totals computed by the server, so the "remaining installments" count can never disagree with the balance), `charges`, `payments`, `meters`, `documents/:id` (signed link). The existing PDF builders stay on the phone, but are fed only real records.

**Who sees what:** unit **owners** see finance; **members** see details, meters and documents. This is a proposal; tell me if family members should see payments.

**Management:** set unit details; create a contract and generate its installment schedule; add charges; record payments, which issue receipt numbers; bulk-import meter readings (CSV); upload documents.

**No payments in the app** (no card processing, no in-app purchase).

**Account deletion:** finance rows belong to the unit and are kept (legal records); `recorded_by` becomes NULL.

### 4.2 Visitor Access
| Table | Key columns |
|---|---|
| `visitor_passes` | unit_id → units CASCADE, created_by → users SET NULL, visitor_name (sealed), visitor_phone (sealed, optional), plate, guests, valid_from, valid_to, uses single/multi, status scheduled / arrived / used / expired / revoked, token_hash |
| `visitor_entries` | pass_id → CASCADE, kind entry/exit, gate, at, by_user → users SET NULL |

- **QR:** `PLV1.<passId>.<random token>`. Only a hash of the token is stored. The gate checks online with `POST /api/security/visitors/check`, so revoking works at once.
- **Rules** come from `site_settings` (visiting hours 08:00–22:00, 14-day window, guests 1–10): today's values become defaults that management can change.
- **Resident:** list, create, revoke (while scheduled), and share (the existing PDF, now with the real QR).
- **Security role:** today's expected list, check, check-in, check-out.
- **Retention:** past passes are deleted after `VISITOR_RETENTION_DAYS` (default 90), because they hold third parties' names and phones.
- **Account deletion:** future passes deleted; past ones kept until retention with `created_by` NULL.

### 4.3 Deliveries (parcels)
`parcels`: unit_id, carrier, description, photo (sealed), status waiting/collected/returned, received_by and collected_by → users SET NULL, times.

- Security logs each parcel when it arrives; the resident gets a notification and sees a list.
- Security marks it collected.

### 4.4 Maintenance, Housekeeping and Moving (one service-request model)
| Table | Key columns |
|---|---|
| `service_requests` | unit_id → units CASCADE, created_by → users SET NULL, kind maintenance / housekeeping / move_in / move_out, category, title, details (sealed), priority normal/urgent, preferred_date, preferred_window, scheduled_date and window, technician_id, status submitted / assigned / in_progress / completed / cancelled, reference (`REQ-YYYY-NNNNN`) |
| `service_request_events` | request_id → CASCADE, kind status/comment, status, note (sealed), by_user → SET NULL, at (the timeline the screen draws) |
| `service_request_photos` | request_id → CASCADE, sealed file |
| `technicians` | site_id, name, phone, trades, active. Records managed by management; not app accounts in this round |
| `service_categories` | site_id, kind, id, title, sort (seeded with today's 9 maintenance categories) |
| `site_settings` | site_id PK: emergency_phone, visit windows, visitor rules, amenity defaults. **The emergency button is hidden until management sets a number** |

- **Rules:** today's form rules are kept (issue 3–60 characters, details ≤ 200, tomorrow to +14 days, three windows).
- **Added:** priority, photos (up to 4), and cancel while submitted or assigned.
- **Management:** queue with filters, assign a technician and visit, change status, comment.
- **Account deletion:** requests stay as building history, with `created_by` NULL. The privacy policy says so.

### 4.5 Community
| Table | Key columns |
|---|---|
| `announcements` | site_id, kind news/alert, level info/warning, title, body, photo, published_at, expires_at, created_by → SET NULL |
| `events` | site_id, title, description, starts_at, ends_at, venue, photo, capacity (optional), rsvp_until, status open/soon/closed/cancelled |
| `event_rsvps` | (event_id, user_id) PK; user → CASCADE. Capacity is checked inside the same transaction |
| `polls`, `poll_options` | site_id, **question** (missing today), opens_at, closes_at; options with label, photo, sort |
| `poll_votes` | (poll_id, user_id) PK → **one vote per resident**, changeable until the poll closes; user → CASCADE |
| `feedback` | site_id, unit_id, user_id → SET NULL, topic, message (sealed), status new/answered/closed, reply (sealed), replied_by, times |

- **Residents:** read; RSVP; vote; send feedback and see the reply.
- **Management:** publish, edit and expire; see RSVP lists and live poll counts; answer feedback.

### 4.6 Amenities
| Table | Key columns |
|---|---|
| `amenities` | site_id, title, location, opens, closes, slot_minutes (60), capacity, max_guests (6), exclusive (0/1), categories, photo, booking_window_days (14), cancel_cutoff_hours, active |
| `amenity_bookings` | amenity_id, unit_id, user_id → SET NULL, starts_at, ends_at, guests, status booked/cancelled/completed/no_show, reference (`BK-NNNNN`) |

**Double-booking guard in the database:**

- Exclusive amenities (a court): `UNIQUE (amenity_id, starts_at) WHERE status = 'booked'`.
- Shared ones (a pool): the capacity sum is checked inside `BEGIN IMMEDIATE`.
- Every amenity: `UNIQUE (amenity_id, unit_id, starts_at) WHERE status = 'booked'`.
- A race test fires 20 bookings at once and expects exactly the capacity to succeed.

**Account deletion:** future bookings are cancelled; past ones are kept with `user_id` NULL.

### 4.7 Parking (the biggest piece)

**Today:** a complete rules engine runs on the phone (`frontend/src/features/parking/services`). Its 23 acceptance checks pass. It is pure TypeScript with no React or Expo imports. Three things block running it as is under the backend's Node setup:

- relative imports have no `.ts` extension (19 files);
- it uses parameter properties (`tx.ts:18`, `repository.ts:35/37`, `service.ts:39`);
- it imports `config/brand`, `utils/format` and `utils/lang`.

Storage is one JSON file on the phone (`parklane.parking-demo.v1`), with a demo clock offset.

**Plan:**
1. **Port the rule modules to `backend/src/parking/`:** types, policy, time, availability, reservations, gate, charging, scheduler, operations, tx, crypto, routing. Keep their unit of work: one `BEGIN IMMEDIATE`, then run the scheduled rules, then the operation, then write back the rows whose `version` changed and append the logs. One process with synchronous SQLite gives the same ordering the phone has today. Turn `checks.ts` into backend tests, all 23 cases.
2. **Configuration tables**, seeded once from `site.ts`, with each bay's route computed at import: `parking_buildings`, `parking_zones`, `parking_gates`, `parking_spaces` (static columns plus serviceability, occupancy and version), `parking_chargers`, `parking_connectors`, and policy in `site_settings` (today's values: 10-minute turnover buffer, 20-minute late grace, 30-minute early arrival, 2 guest bookings at once per unit, 8 h standard, 10 h EV, 4 h charging, 14-day horizon).
3. **Dynamic tables:**
   - `parking_reservations` (unit_id, booked_by → users SET NULL, guest name sealed, plate, status confirmed / checked-in / completed / cancelled / no-show, booked and actual times, version);
   - `parking_vehicles`;
   - `parking_invitations` (token hash);
   - `parking_credentials` (**hash only**; the demo's stored raw token `displayToken` is removed);
   - `parking_sessions`, `parking_allocations`, `parking_charging_sessions`;
   - `parking_scan_events`, `parking_occupancy_events` (append-only);
   - `parking_audit`, which the guest tracker reads.

   Operator alerts go into the shared notifications inbox.
4. **Resident API** (`/api/parking/...`), mirroring today's `ParkingService`:
   - `site` (bays, gates, chargers for the map), `overview`, `search`;
   - `reservations` CRUD with `expectedVersion`;
   - `extend`, `cancel`, `replace-pass`, `reassign`, `shares`;
   - EV `plug-in` / `stop`.
5. **Visitor page** (no account; the invite token is the key): `GET /api/parking/pass/:invite` shows only that booking. The visitor can add a plate or ask for help. The page is served at a real address on the backend, replacing the dead `https://parklane-demo.example`. The unsigned `d=` snapshot links, which carry a working gate token, are removed.
6. **Security API** (the new `security` role): `gates/:id/scan`, manual entry and exit with a reason, today's expected arrivals, bay occupancy and serviceability, moved-out, charger fault and restore.
7. **Jobs:** the existing rule sweep inside every transaction, plus an in-process sweep every minute (no-shows, overdue, charging windows).
8. **Stays in the app:**
   - the site map and its drawing-only geometry, now fed bays and gates from `/api/parking/site`, so the two copies can't drift;
   - English/Arabic formatting, QR drawing, sharing.
9. **Development only:** Demo controls (clock offset, simulated scans, bays and chargers), the scenario seed, Security's demo-pass picker.
10. **Gaps fixed on the way:**
    - cancelling now revokes the invitation (`GuestInvitation.revokedAt` is never set today);
    - operator plates are validated;
    - the unused `faulted` charging state is removed;
    - no more silent reseed on a schema change.

**Account deletion:** future reservations are cancelled and their passes revoked; past ones are kept as the gate log, with `booked_by` NULL. Vehicles are deleted.

**Decision D7: one apartment per account?** The database allows one unit per resident (`unit_members.user_id` is UNIQUE), but the parking demo's resident owns two properties.

My recommendation: **keep one unit per account for now.** It matches the rest of the app, including the gateway, Health sharing and the assistant. Allowing several units touches every feature, so it is better as a later step.

### 4.8 Notifications (inbox) and Settings → Notifications
`notifications` (see §3) plus `notification_prefs(user_id → CASCADE, kind, enabled)`. The Settings row becomes real and
lists the kinds: requests, visitors, parcels, bookings, announcements, bills.

### 4.9 Placeholder rows (decision D4)
| Row | Proposal |
|---|---|
| Bills & Utilities | Real: the utility charges and meter readings of §4.1, shown on their own screen |
| Housekeeping, Moving Request | Real: service requests (§4.4) of kind housekeeping / move_in / move_out |
| Deliveries | Real: parcels (§4.3) |
| Notifications | Real: §4.8 |
| Language | **Drop for now.** Only Health and the parking pass speak Arabic. Full Arabic is its own project (`expo-localization`, RTL, every screen's copy) |
| Appearance | **Drop.** The design is dark-only by intent (`app.json` fixes dark) |
| App Preferences | **Drop.** The copy promises nothing specific |

### 4.10 Smart Home: Scenes, Automations, Energy
- **Scenes** and **automations** come from the apartment's Home Assistant. Add `scene` and `automation` to `ha/mapping.ts` and the command allowlist: activate a scene; enable, disable or run an automation.
- **Routes:** `GET /api/home/scenes`, `POST /api/home/scenes/:id/activate`, `GET /api/home/automations`, `PATCH /api/home/automations/:id`.
- Creating new automations from the app is a later step; the installer creates them in Home Assistant.
- **Energy** comes from `unit_energy` (§5).

### 4.11 Realtime events
`unit.charge`, `unit.payment`, `visitor.updated`, `parcel.updated`, `request.updated`, `announcement.new`,
`event.updated`, `poll.updated`, `feedback.answered`, `amenity.booking`, `parking.updated`, `notification.new`,
`bms.reading`, `energy.reading`. Every event goes to unit members or site residents only, never wider.


## 5. Time series and the generator

### 5.1 Tables
Keys are compact integers, so 7 million rows stay small. Each table is `WITHOUT ROWID`, keyed by
`(series_key, slot)`, where `slot = floor(epoch_ms / 900 000)`: one number per quarter hour, aligned to :00, :15,
:30 and :45 in UTC and Cairo alike.

| Table | Columns (integers, scaled) |
|---|---|
| `bms_readings` | site key, slot, source (0 simulated / 1 live), building kW and kWh, solar kW, grid cost (piastres), MDB volts and amps, generator state, solar-tank %, water tank %, water flow, pump states (bitmask), CO₂ ppm, temperature, humidity, fans (bitmask), internet down/up (kbps), ping, uptime, cameras online/total, elevator state and floor, fire-panel state, gates (bitmask), fault code |
| `unit_energy` | unit key, slot, source, total Wh, lighting Wh, AC Wh, media Wh, other Wh |

### 5.2 Visibility: a new record every 15 minutes, by itself
Every query adds `slot <= current_slot(now)`. Rows for the future already exist through 2029 but are never served,
so at each quarter hour exactly one new record per series becomes visible.

### 5.3 Where the data comes from (decision D2)

`backend/src/series/source.ts` defines a `SeriesSource` interface. Two implementations:

1. **Generator (simulated):** `backend/scripts/generate-series.ts`.
2. **Live:**
   - a sampler that every 15 minutes reads each real apartment's power and energy sensors through its Home Assistant (adds the `sensor` domain, read-only, to `ha/mapping.ts`). An apartment without such sensors gets **no rows**, never invented ones;
   - later, a BMS integration (a gateway or the BMS vendor's API) writes `bms_readings` with `source=1`.

Recommended: simulate the building, plus demo units only. Real apartments record live readings, which grow by about 0.9 MB per apartment per year.

### 5.4 Generator
```
node scripts/generate-series.ts --site demo-park-lane --from 2026-01-01 --to "2029-12-31 23:45" \
  --interval 15m --seed 42 --units all-demo [--yes-i-am-sure]
```

- **Deterministic:** a counter-based PRNG seeded from (seed, site, slot, series), so any slot can be computed on its own. Re-running gives identical rows; resuming is just re-running.
- **Writes:** `INSERT … ON CONFLICT DO UPDATE`, 5,000 rows per transaction, progress every month of data.
- **Models (Cairo, 30° N):**
  - daily occupancy curve, weekday/weekend (Friday–Saturday) shapes;
  - monthly temperature normals driving AC load (peaks on summer afternoons);
  - solar from the sun's height on clear-sky days;
  - water-tank fill and draw cycles;
  - CO₂ following occupancy;
  - internet peaking in the evenings;
  - an elevator random walk between floors;
  - small noise everywhere.
- **Faults:** rare, *non-safety* only: a camera offline, a pump in maintenance, a slow connection. Each carries a fault code.
- **Safety:** the generator never writes a fire, security or water **alarm**. The fire panel stays "normal" with `source=0`, and nothing simulated ever triggers a notification.
- **Guard:** it refuses a site whose `kind` is not `demo`, and any database with real residents, unless `--yes-i-am-sure` is given. It prints row counts, file size and time at the end.

### 5.5 API
- `GET /api/sites/me/bms/latest`
- `GET /api/sites/me/bms/series?metrics=kw,co2&from&to&bucket=15m|1h|1d`: averages plus min and max, at most 2,000 points.
- `GET /api/units/me/energy/latest`
- `GET /api/units/me/energy/series?from&to&bucket=…`

Rules for all four:

- **Access:** residents of the site or the unit; admins via `/api/admin/sites/:id/…`.
- **Caching:** `Cache-Control: private, max-age=<seconds to the next quarter hour>` and an `ETag` of the last slot.
- **Labels:** every answer carries `source`, so the app can show "Simulated data".

### 5.6 Push
- A timer aligned to the next quarter hour, and re-aligned at every tick, publishes `bms.reading` to signed-in residents of each site.
- It publishes `energy.reading` to the members of each unit that has data.
- It uses the existing WebSocket (`/api/events`), with no new connections.

### 5.7 App
- `useQuarterHourly(load)` in `src/lib/realtime`:
  - loads at once and listens for the push;
  - as a fallback, sets a timer for the next quarter hour plus 5–30 s of jitter;
  - refetches when the app returns to the foreground (`AppState`), and stops in the background.
- Charts call the range endpoint.
- A small **"Simulated data"** chip appears wherever `source` is simulated.

## 6. App side (all features)

- **Domain code:**
  - new `src/features/<domain>/{services,hooks,types}` for `unitFinance`, `visitors`, `maintenance`, `community`, `amenities`, `parking` (services rewritten to HTTP), `notifications`, `bms`, `weather`;
  - all calls through `timedFetch`, all realtime through the existing EMS socket.
- **Screens:**
  - each screen's `.data.ts` keeps only copy and static configuration;
  - data comes from hooks, with `LoadingState`, `ErrorNotice` and empty states;
  - layouts stay as measured.
- **Routes:** new routes (notification inbox, request detail, pass detail…) go into `FlowOnlyRoute`, because `ParamlessRoute` is at its limit of 25.
- **Identity:** the app shows the signed-in resident and their real unit everywhere (`useResidentIdentity` reads the unit from `/api/unit`).

## 7. Store mode after this work

| Screen | Store build |
|---|---|
| My Unit (incl. Bills & Utilities), Visitor Access, Maintenance and service requests, Community, Amenities, Parking (without demo tools), Notifications | **Back in**: moved out of `sampleScreens.tsx` into the navigator; their Home tiles return |
| Smart Home Scenes and Automations | **Back in**, from the apartment's Home Assistant (real) |
| Smart Home Energy | Back in where an apartment has **live** readings; otherwise hidden in the store build |
| BMS | **Stays out** while its data is only simulated; comes in when a live source exists |
| Demo controls, security console, resident picker | Development only |

## 8. Tests and checks

**Backend (`node --test`):**

- per route: who may call it; validation; one resident can't see another's data;
- double-booking races on amenity and parking slots: many requests at once, exactly one wins;
- status flows; account deletion for every new table;
- generator: same seed gives the same rows, slots aligned, resume, the guard refuses real sites;
- the 15-minute rule with a mocked clock: a row appears only once its slot starts;
- the push timer;
- the parking acceptance checks, ported from `npm run check:parking`.

**App:**

- check scripts for each new service (`npm run check:<domain>`);
- `npx tsc --noEmit`, `npx expo lint --no-cache`, `./scripts/dev.sh check`.

**Visual and browser:**

- visual regression against Master for screens that must not move;
- a browser walk through every feature against a local backend seeded with the development seed.

**Report:** row count, database size and generation time through 2029.

## 9. Phases (each ends green and is shown to you)

| Phase | Content | Rough size |
|---|---|---|
| 1 | §3 building blocks: sites, roles, notifications, sealed files, realtime helpers, admin split, contracts | medium |
| 2 | My Unit + Bills & Utilities, Visitor Access, Deliveries (parcels) | large |
| 3 | Maintenance + Housekeeping + Moving (service requests) | medium |
| 4 | Community, Amenities | medium |
| 5 | Parking on the backend | large (biggest single piece) |
| 6 | Time series: generator, BMS API, push, energy, HA scenes and automations, weather (after D3) | large |
| 7 | Store-mode hand-over, docs, development seed, full verification and report | medium |

This is several working sessions, not one. I suggest you review and commit after each phase.

