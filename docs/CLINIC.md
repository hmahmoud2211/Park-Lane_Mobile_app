# The Park Lane clinic

Residents book a clinic doctor in the app; the doctor runs the visit in the
clinic workspace (a separate web app, `../Parklane-clinical-system`) with AI
help; the approved record lands in the patient's Health Passport.

```
Park Lane app (Clinical Appointment)        Clinic web app (doctors, front desk)
   │ book a slot for a Health Passport profile      │ dashboard · queue · history · consultation
   ▼                                                ▼
EMS backend (server/) ── one database (ems.db), one set of accounts, one realtime bus
   │ /api/clinic/...  appointments, status machine, queue, consultations, audit
   │ /health/...      Health Passport (the app's existing HttpHealthService contract)
   ├──▶ Claude (history summaries, SOAP drafts)        server-side key only
   └──▶ ElevenLabs (summary speech, Scribe transcription) server-side key only
   │
   ▼
Health Passport: visit + prescribed medicines (source consultation:<id>) and the readable visit record
```

## What existed and what was added

On the `Ahmed` branch the app had a complete **Health Passport** UI with a
mock service and an HTTP client for `/health/*`, but **no backend served
those routes**. There was **no Clinical Appointment** feature at all. The EMS
backend had accounts, sessions, SQLite, sealing (AES-256-GCM) and a
WebSocket bus.

Added, all on that same backend:

| Area | Where |
| --- | --- |
| Roles: `resident`, `doctor`, `clinic_staff` | `server/src/ems/auth.ts`, migration 2 |
| Health Passport backend (consent, profiles, record items, gaps) | `server/src/health/` |
| Doctors, specialties, weekly hours, time off, slots | `server/src/clinic/doctors.ts` |
| Booking, status machine, queue, next-patient notices | `server/src/clinic/appointments.ts` |
| History access rules | `server/src/clinic/history.ts` |
| Consultations: drafts, transcript segments, finalize, addenda, retention | `server/src/clinic/consultations.ts` |
| Claude (raw HTTP, structured outputs) | `server/src/clinic/ai/` |
| ElevenLabs TTS and Scribe STT | `server/src/clinic/speech.ts` |
| Audit trail | `server/src/clinic/audit.ts` |
| Admin CLI | `server/src/clinic/cli.ts` (`npm run clinic -- …`) |
| App: Clinical Appointment (directory, doctor, booking, appointment) | `src/screens/Clinic*`, `src/services/clinic/` |
| App: clinic visits in Health Passport | `src/screens/HealthConsultationScreen`, Passport home and Records |

The backend keeps its zero-dependency rule: Claude and ElevenLabs are called
with `fetch`, as the CUBE and Amazon clients are.

## Accounts and access

- Residents register in the app as before. `/api/auth/register` only ever
  makes residents; doctor and desk accounts come from the CLI.
- Doctors and desk staff sign in to the clinic web app with the same
  `/api/auth/login`. Their sessions last 12 hours (`CLINIC_STAFF_SESSION_HOURS`),
  the web app also signs out after 30 idle minutes (not while recording), and
  the token lives in `sessionStorage`.
- Every route checks the role on the server. A doctor sees only their own
  appointments (anyone else's id answers 404). The desk sees every doctor's
  day but no clinical content, and cannot start consultations.

### What a doctor may read

Decided in one place, `accessFor` in `history.ts`. **Full** access (the
Health Passport record and every finalized clinic consultation) needs all of:

1. the doctor's own appointment with the patient, not cancelled;
2. the resident's "Share my Health Passport" choice **for that appointment**;
3. the resident's Health Passport consent still on;
4. no more than 7 days after the visit.

Otherwise access is **limited**: name, age, sex, the booking reason, and the
consultations this doctor wrote. The doctor is told why.

### Consent for AI and speech

| Feature | Needs |
| --- | --- |
| AI history summary, "Listen to summary" | full access **and** AI consent for the visit |
| Recording / transcription | AI consent **and** recording consent the doctor records in the room |
| AI consultation draft | AI consent |
| Documenting by hand | nothing; always available |

AI consent is the resident's opt-in at booking (changeable until the visit,
withdrawing deletes any stored summary), or the patient's agreement in
person, which the doctor records (audited with their name). Nothing is on by
default.

## Appointments

```
scheduled ─check_in─▶ checked_in ─mark_ready─▶ waiting ─start─▶ in_consultation ─(finalize)─▶ completed
    │                     │  └──────────start───────────┘ ▲            │
    │                     │                             └─return_to_queue─┘
    ├─cancel / no_show    ├─cancel / no_show            no_show ─check_in (same day)─▶ checked_in
    └─(reschedule)─▶ rescheduled
```

- `transition()` checks the move, the role and the timing in one
  transaction: check-in only on the appointment's day, no-show only after
  the slot plus the grace period, one consultation per doctor at a time,
  residents cancel only upcoming visits. `completed` comes only from
  finalizing.
- **No double booking**: a slot must be on the doctor's grid and free inside
  the transaction, and two partial unique indexes make the database itself
  refuse a second live booking of the same doctor/time or patient/time.
  A patient also cannot overlap two doctors.
- **Queue**: checked-in patients ordered by slot time; one who arrives more
  than `CLINIC_LATE_GRACE_MINUTES` late is placed by arrival time. Early
  arrivals keep their slot. Only checked-in patients are ever "next".
- **Next-patient notice**: after every change the doctor's queue head is
  computed; if it has not been announced, `next_notified_at` is claimed
  atomically and a `next_patient` event goes to the doctor. Once per
  appointment, never on reconnect. The web app also remembers announced ids
  for the browser session, and announces the current next patient once after
  sign-in. Realtime events carry ids only; clients refetch the state.

## Consultations and the record

- One consultation per appointment (`UNIQUE`). The draft is saved with an
  optimistic `version`; a stale save gets `409 version_conflict` and the tab
  reloads.
- **Transcription** is per segment (~30 s of browser audio). A segment
  number is transcribed once: a retried upload returns the stored text. Audio
  is never stored. The patient's documented medicines and conditions go to
  Scribe as key terms.
- **AI draft** is stored *beside* the doctor's draft (`ai_draft`), never in
  it. The model must quote the transcript or notes for every vital,
  diagnosis, prescription, test, examination, assessment and plan; the
  server checks each quote and flags anything unbacked or not found.
- **Finalize** (`attest: true` required) is one transaction: the note becomes
  final and read-only, the appointment completed, and the Health Passport
  gets a `visits` item and each prescribed medicine not already current,
  all with `source = consultation:<id>`. Finalizing again returns the
  finalized record and writes nothing. If the resident's Health Passport is
  off, the clinic keeps the record and says it was not added.
- Corrections after approval are **addenda**: signed, dated, appended.
- **Retention**: transcripts and AI drafts are deleted
  `CLINIC_TRANSCRIPT_RETENTION_DAYS` after finalizing (hourly job); history
  summaries a day after the visit. The approved note, the doctor's notes and
  the audit trail stay.

## AI safety, in code rather than in prompts alone

- The model sees only records the doctor may see, under short ids
  (`P1`, `C2`), with **no name or identifiers**.
- Every summary statement must cite record ids; uncited or invented
  citations are dropped and the doctor is told how many.
- The allergy line is written by the server: with no allergy records it says
  they are *not documented* and to ask the patient, never "no allergies".
- A history with nothing documented is never sent to the model.
- Requests use structured outputs, `fallbacks: "default"`, and a refusal or
  truncation is reported as an error, never parsed.
- Prompts, replies, transcripts and audio are never logged.

## Data model (migrations 2 and 3 in `server/src/ems/db.ts`)

Additive only: one `ALTER TABLE users ADD COLUMN role`, then new tables.

| Table | Holds | Sealed |
| --- | --- | --- |
| `health_consents`, `health_profiles` | consent; the resident's and family profiles | |
| `health_items` | record items by section, with `source` | `data` |
| `clinic_specialties`, `clinic_doctors`, `clinic_schedules`, `clinic_time_off` | the directory and hours | |
| `clinic_appointments` | bookings, status times, per-visit consents | `reason` |
| `clinic_consultations` | draft, AI draft, final note, approver | notes, draft, transcript edits, AI draft, final |
| `clinic_transcript_segments` | one per recorded segment | content |
| `clinic_addenda` | corrections | text |
| `clinic_history_summaries` | AI summaries with expiry | content |
| `clinic_audit` | who did what, when; ids only | |

## API

All `/api/clinic/*` routes answer `{ ok, data }` or `{ ok: false, error: { code, message } }`.
Error codes include `slot_taken`, `invalid_transition`, `version_conflict`,
`consent_required` (403), `invalid` (422), `not_configured` (503),
`ai_failed` and `speech_failed` (502).

**Residents**: `GET /config`, `/specialties`, `/doctors?specialty=&q=`,
`/doctors/:id`, `/doctors/:id/photo`, `/doctors/:id/availability?days=`,
`/doctors/:id/slots?date=`, `/patients`; `POST /appointments`
(`reschedule_of` moves one); `GET /me/appointments`, `/me/appointments/:id`;
`POST /me/appointments/:id/cancel`; `PATCH /me/appointments/:id/consents`.

**Doctors** (`/api/clinic/doctor/...`): `GET /me`, `/dashboard?date=`,
`/appointments?from=&to=&status=&q=`, `/appointments/:id`,
`/appointments/:id/history`, `/appointments/:id/history-summary?lang=`;
`POST /appointments/:id/status {action}`, `/appointments/:id/ai-consent`,
`/appointments/:id/history-summary {lang}`,
`/appointments/:id/history-summary/speech {lang}` (audio/mpeg),
`/appointments/:id/consultation`; `GET /consultations?q=`, `/consultations/:id`;
`PUT /consultations/:id/draft`; `POST /consultations/:id/recording-consent`,
`/consultations/:id/segments?seq=&lang=&duration_ms=` (raw audio body),
`/consultations/:id/ai-draft {lang}`, `/consultations/:id/finalize`,
`/consultations/:id/addenda`; `DELETE /consultations/:id/segments/:segmentId`;
`GET /patients?q=`, `/patients/:profileId`.

**Front desk** (`/api/clinic/desk/...`): `GET /day?date=`, `POST /appointments/:id/status {action}`.

**Health Passport** (bare bodies, `{ detail }` on errors, as the app expects):
`/health/consent`, `/health/profiles[/:id]`, `/health/profiles/:id/record`
(now with `consultations`), `/health/profiles/:id/:section[/:itemId]`,
`/health/consultations/:id`. Document upload and resident voice summaries
answer 503 "not available yet" (see Limitations).

**Realtime** (`/api/events`): `{ type: 'clinic', kind: 'appointment' | 'next_patient' | 'consultation_final', ... }`.

## Running it locally

Each of these keeps running, so give each its own terminal.

```bash
# Terminal 1: the backend (Node >= 22.18, no install needed)
cd server
cp .env.example .env              # optional: add ANTHROPIC_API_KEY, ELEVENLABS_API_KEY
npm run clinic -- demo-seed       # development only, once: demo doctors, desk and resident
npm start                         # http://localhost:8787; stays running
```

```bash
# Terminal 2: the clinic web app (from Park-Lane_Mobile_app's parent folder)
cd Parklane-clinical-system
npm install
npm run dev                       # http://localhost:5174, proxies /api to :8787
```

```bash
# Terminal 3, optional: the resident app against the same backend
cd Park-Lane_Mobile_app
EXPO_PUBLIC_DEVICE_BACKEND_URL=http://<this machine>:8787 EXPO_PUBLIC_HEALTH_API=http npx expo start
```

If `npm start` reports `EADDRINUSE ... 8787`, a backend is already running
(`lsof -iTCP:8787 -sTCP:LISTEN` shows it): use that one, or stop it first.

`EXPO_PUBLIC_HEALTH_API=http` matters: in development Health Passport
otherwise runs on its mock, which has no clinic visits.

Demo sign-ins (`demo-seed`): doctor `demo.cardiology@parklane.test` /
`DemoDoctor#2026` (also `demo.gp@…`, `demo.pediatrics@…`), desk
`demo.desk@parklane.test` / `DemoDesk#2026`, resident
`demo.resident@parklane.test` / `DemoResident#2026`. In the app, sign in from
Services → Clinical Appointment.

### Setting up real doctors

```bash
npm run clinic -- specialty add cardiology --en Cardiology --ar "أمراض القلب"
npm run clinic -- doctor add --email k.hassan@clinic.example --name "Dr. Karim Hassan" \
  --specialty cardiology --minutes 20 --title "Consultant Cardiologist" --years 15 --fee 900 \
  --languages en,ar --photo ./karim.jpg
npm run clinic -- doctor schedule k.hassan@clinic.example --set "sun 09:00-13:00, mon 17:00-21:00"
npm run clinic -- doctor time-off k.hassan@clinic.example --from 2026-11-10T09:00 --to 2026-11-10T13:00
npm run clinic -- staff add --email desk@clinic.example --name "Front Desk"
npm run clinic -- list
```

## Tests

- `cd server && npm test`: 56 tests, including 17 for the clinic and Health
  Passport (`test/clinic.test.ts`) over real HTTP and WebSocket, with Claude
  and ElevenLabs stand-ins and a mocked clock: racing bookings, roles, every
  refused transition, queue order with late arrivals, one notice per patient,
  history access, citation filtering, consent gates, idempotent segments and
  finalize, version conflicts, what the patient can and cannot see, retention.
- `npm run check:health`, `npm run check:parking`: unchanged, passing.
- `cd ../Parklane-clinical-system && npm run test:e2e`: the 20-step workflow
  in a real browser across both apps (see that README).

## Production checklist

- Set `EMS_ENCRYPTION_KEY` from a secrets manager (it seals all clinical text),
  `NODE_ENV=production` (refuses `demo-seed`), and `CORS_ORIGIN` to the
  clinic web app's origin instead of `*`. Serve over HTTPS (microphone access
  requires a secure origin).
- Sign data-processing agreements with Anthropic and ElevenLabs; use
  ElevenLabs zero retention (`ELEVENLABS_ZERO_RETENTION=1`) on an enterprise plan.
- Back up `DATA_DIR` (ems.db, ems.key, clinic/photos) and restrict it to the service user.

## Limitations and next steps

- **Not verified against the live Claude and ElevenLabs APIs**: no keys were
  available. The integrations follow the documented request shapes and are
  tested against local stand-ins; run one real consultation with keys before
  go-live (in particular Arabic/Egyptian transcription quality and the
  chosen voice).
- Health Passport **document reading** (OCR and extraction) and the
  **resident's spoken summary** were never implemented on any backend; their
  routes answer 503 with an explanation. Document lists are empty.
- Patient self check-in (e.g. a QR at the desk) is not built; check-in
  records who did it, so a `self` path can be added beside the desk's.
- The app learns about status changes on screen focus, not by push;
  the backend already sends the resident `appointment` events.
- The clinic web app's interface is English; clinical content and AI output
  can be Arabic (right-to-left where needed).
- Scheduled appointments nobody marks are not turned into no-shows
  automatically.
