# The Park Lane clinic

Residents book a clinic doctor in the app; the doctor runs the visit in the
clinic workspace (a separate web app, `../Parklane-clinical-system`) with AI
help; the approved record lands in the patient's Health Passport. Residents
can also add photographed documents to Health Passport and play their doctor
a spoken summary of their record.

```
Park Lane app (Clinical Appointment,        Clinic web app (doctors, front desk)
               Health Passport)
   │ book a slot for a Health Passport profile      │ dashboard · queue · history · consultation
   ▼                                                ▼
EMS backend (backend/) ── one database (ems.db), one set of accounts, one realtime bus
   │ /api/clinic/...  appointments, status machine, queue, consultations, audit
   │ /health/...      Health Passport (the app's existing HttpHealthService contract),
   │                  documents, spoken summaries, media
   ├──▶ Gemini, or Claude (history summaries, SOAP drafts,       server-side key only
   │    reading documents, spoken handovers)
   └──▶ ElevenLabs (summary speech, Scribe transcription)       server-side key only
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
| Roles: `resident`, `doctor`, `clinic_staff` | `backend/src/ems/auth.ts`, migration 6 |
| Health Passport backend (consent, profiles, record items, gaps) | `backend/src/health/` |
| Doctors, specialties, weekly hours, time off, slots | `backend/src/clinic/doctors.ts` |
| Booking, status machine, queue, next-patient notices | `backend/src/clinic/appointments.ts` |
| History access rules | `backend/src/clinic/history.ts` |
| Consultations: drafts, transcript segments, finalize, addenda, retention | `backend/src/clinic/consultations.ts` |
| AI provider layer: Gemini or Claude (raw HTTP, JSON schemas) | `backend/src/integrations/ai/` |
| History summaries, SOAP drafts | `backend/src/clinic/ai/` |
| Health Passport documents: upload, reading, review | `backend/src/health/documents.ts` |
| The spoken handover, and Health Passport's "Summary for doctor" | `backend/src/health/spoken.ts`, `summaries.ts` |
| Sealed files and signed media links; background jobs | `backend/src/health/files.ts`, `jobs.ts` |
| ElevenLabs TTS and Scribe STT | `backend/src/integrations/elevenlabs.ts` |
| Audit trail | `backend/src/clinic/audit.ts` |
| Admin CLI | `backend/scripts/clinic.ts` (`npm run clinic -- …`) |
| App: Clinical Appointment (directory, doctor, booking, appointment) | `frontend/src/screens/Clinic*`, `frontend/src/features/clinic/` |
| App: clinic visits in Health Passport | `frontend/src/screens/HealthConsultationScreen`, Passport home and Records |

The backend keeps its zero-dependency rule: Gemini, Claude and ElevenLabs are
called with `fetch`, as the CUBE and Amazon clients are.

### AI provider

`AI_PROVIDER` picks `gemini` or `anthropic`; left empty, Gemini is used when
`GEMINI_API_KEY` is set, otherwise Claude when `ANTHROPIC_API_KEY` is. Every
feature goes through `backend/src/integrations/ai/model.ts`, so they all use the same
provider.

- **Gemini**: `generateContent` (`/v1beta/models/{model}:generateContent`)
  with `systemInstruction`, pages as `inlineData`, `responseMimeType` with
  `responseJsonSchema`, and `thinkingConfig.thinkingLevel`
  (`GEMINI_THINKING_LEVEL`). `GEMINI_MODEL` (default `gemini-3.8-flash`)
  writes summaries, notes and spoken handovers; `GEMINI_DOCUMENT_MODEL`
  reads documents. Thought parts are skipped. Use a paid (billing-enabled)
  project for patient data.
- **Claude**: the Messages API with structured outputs, adaptive thinking at
  `ANTHROPIC_EFFORT` and `fallbacks: "default"`.
- On both, a safety block, recitation, refusal or length stop is an error,
  never parsed. A busy or timed-out service is retried once.

## Accounts and access

- The app's login screen is its one sign-in. Residents sign in or create their
  account there, and Clinical Appointment uses that session: it has no sign-in
  of its own, and sends a guest to the login screen. `/api/auth/register` only
  ever makes residents; doctor and desk accounts come from the CLI.
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
| AI history summary, "Listen to summary" (the spoken handover) | full access **and** AI consent for the visit |
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
  summaries and spoken-handover scripts a day after the visit. The approved
  note, the doctor's notes and the audit trail stay.

## Health Passport documents and spoken summaries

Both run in the background (`health/jobs.ts`: two at a time, in order;
unfinished ones are queued again after a restart) and both answer 503
`not_configured` with an explanation when their keys are missing.

### Reading documents

- The resident uploads up to 10 pages (photos or PDFs, 10 MB each) with a
  type and an optional date. Pages are stored sealed in
  `DATA_DIR/health/files` (`files.ts`).
- Each page is one AI request with the document prompt
  (`DOCUMENT_SYSTEM_PROMPT` in `documents.ts`, verbatim as provided) and a
  strict schema: one shape per Health Passport section.
- Then the server cleans what came back: items without a name are dropped; a
  missing date takes the document's date; a month-only date becomes the 1st
  and is marked low confidence; an allergy without a severity keeps it empty
  and is marked low, so the resident must choose one (confirming without it
  answers 422 with `detail: 'severity'`); an item that looks like one already
  recorded points at it (`possible_duplicate_of`).
- **The AI never writes to the record.** The document waits in
  `needs_review` until the resident decides each item: add, replace the
  recorded one, or reject. Saved items have the document as their `source`.
- Deleting a document removes its pages and, if asked
  (`?delete_items=true`), the items it added; otherwise those items stay,
  no longer linked to it.

### The spoken handover

A 60–90 second script a doctor listens to at the start of a visit, written by
the AI from the record and read by ElevenLabs. The prompt is
`SPOKEN_SYSTEM_PROMPT` in `spoken.ts`, verbatim as provided; the record goes
to it as the `facts` JSON that `buildFacts()` makes. Two features use it:

- **Health Passport "Summary for doctor"** (`health/summaries.ts`): the
  resident picks a language and the doctor's specialty; the summary is made
  in the background (phases waiting, writing, recording), and reused while
  the record is unchanged. The recording is stored sealed.
- **The clinic's "Listen to summary"** (`clinic/summaries.ts`): the doctor's
  own specialty is the focus. The script is kept sealed until a day after
  the visit and remade only when the record changes; the audio is not stored.
  Listening takes two steps, so no request waits for everything: the first
  writes (or reuses) the script and answers how it is split; the browser
  then fetches each part's audio, playing the first while the next two are
  made.

Speech is made in parts split at sentence ends (`speechParts` in
`clinic/speech.ts`): the first part is at most 160 characters, so it is
voiced in a second or two, and later parts up to 450. Each part is one
ElevenLabs request with its own timeout (`ELEVENLABS_TTS_TIMEOUT_MS`,
30 s) and one retry when the service is busy or slow. "Summary for doctor"
voices its parts two at a time and joins them into one recording.

`checkScript()` enforces what the prompt says is checked automatically:
every allergy and current medicine is named, no number appears that is not
in the facts, no symbols or unit abbreviations, "Important" (or "مهم") comes
before a severe allergy, and the length is sensible. A failing script is sent
back once with what was wrong; failing again, it is rejected and the
resident or doctor is told it could not be made. The closing line is added by
the server, not the model.

### Media links

`GET /health/media/document/:id/:page` and `/health/media/summary/:id` serve a
page or a recording to the owner's session, or to a signed link valid for
2 hours (browsers' `<img>` and `<audio>` cannot send a session). The app
receives those links in the document and summary responses.

### Consent withdrawal

Withdrawing Health Passport consent, or deleting one's own profile, also
deletes that profile's documents and summaries and removes their files.

## AI safety, in code rather than in prompts alone

- The model sees only records the doctor may see, under short ids
  (`P1`, `C2`), with **no name or identifiers**. The one exception is the
  spoken handover, which the prompt requires to open with the patient's
  **first name** only; no surname, phone or other identifier is sent.
- Every summary statement must cite record ids; uncited or invented
  citations are dropped and the doctor is told how many.
- The allergy line is written by the server: with no allergy records it says
  they are *not documented* and to ask the patient, never "no allergies".
- A history with nothing documented is never sent to the model.
- Requests ask for JSON matching a schema, and a safety block, refusal or
  truncation is reported as an error, never parsed.
- Spoken handovers are checked against the record before they are read
  aloud (see above).
- Prompts, replies, transcripts and audio are never logged.

## Data model (migrations 6–8 in `backend/src/ems/db.ts`)

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
| `clinic_spoken_summaries` | the clinic's spoken-handover script per visit and language, with expiry | script |
| `clinic_audit` | who did what, when; ids only | |
| `health_documents` | uploaded documents: status, pages, what was read | text read, items awaiting review |
| `health_summaries` | "Summary for doctor" per profile, language and specialty | script |

Document pages and summary recordings are files in `DATA_DIR/health/files`,
sealed and owner-only.

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
`/appointments/:id/history-summary/speech {lang}` (the spoken handover: `{ version, parts }`),
`GET /appointments/:id/history-summary/speech/:part?lang=&v=` (one part, audio/mpeg),
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
`/health/consultations/:id`;
`GET`/`POST /health/profiles/:id/documents` (multipart upload),
`GET`/`DELETE /health/documents/:id[?delete_items=true]`,
`POST /health/documents/:id/confirm`;
`GET /health/profiles/:id/summary?lang=&specialty=` (202 while it is being made),
`POST /health/profiles/:id/summary`;
`GET /health/media/document/:id/:page`, `/health/media/summary/:id`.

**Realtime** (`/api/events`): `{ type: 'clinic', kind: 'appointment' | 'next_patient' | 'consultation_final', ... }`.

## Running it locally

Each of these keeps running, so give each its own terminal.

```bash
# Terminal 1: the backend (Node >= 22.18, no install needed)
cd backend
# optional: a backend/.env with only GEMINI_API_KEY and ELEVENLABS_API_KEY (see .env.example)
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
cd Park-Lane_Mobile_app/frontend
EXPO_PUBLIC_DEVICE_BACKEND_URL=http://<this machine>:8787 EXPO_PUBLIC_HEALTH_API=http npx expo start
```

If `npm start` reports `EADDRINUSE ... 8787`, a backend is already running
(`lsof -iTCP:8787 -sTCP:LISTEN` shows it): use that one, or stop it first.
The backend reads `backend/.env` only when it starts, so restart it after
changing a key. With keys set, its startup log shows
`ai: "gemini (gemini-3.8-flash)"` and `clinicSpeech: true`.

Copy only the settings you need into `backend/.env`: placeholders in
`.env.example` such as `PUBLIC_URL` change behaviour.

Run Expo from `frontend/`, never from `backend/`: started there it
serves a blank page and rewrites `backend/tsconfig.json`.

`EXPO_PUBLIC_HEALTH_API=http` matters: in development Health Passport
otherwise runs on its mock, which has no clinic visits.

Demo sign-ins (`demo-seed`): doctor `demo.cardiology@parklane.test` /
`DemoDoctor#2026` (also `demo.gp@…`, `demo.pediatrics@…`), desk
`demo.desk@parklane.test` / `DemoDesk#2026`, resident
`demo.resident@parklane.test` / `DemoResident#2026`. In the app, sign in on the
login screen; Services → Clinical Appointment then opens the directory.

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

- `cd backend && npm test`: 67 tests. 17 for the clinic and Health Passport
  (`test/clinic.test.ts`) over real HTTP and WebSocket, with Claude and
  ElevenLabs stand-ins and a mocked clock: racing bookings, roles, every
  refused transition, queue order with late arrivals, one notice per patient,
  history access, citation filtering, consent gates, idempotent segments and
  finalize, version conflicts, what the patient can and cannot see, retention.
  11 for documents and spoken summaries (`test/health-ai.test.ts`) with Gemini
  and ElevenLabs stand-ins: sealed pages read one by one, the review step,
  confirming exactly what was approved, unreadable documents, upload checks,
  deletion, the automatic script check, one retry then rejection, signed
  links, and consent withdrawal deleting summaries. Tests never read
  `backend/.env`, so real keys are never used.
- `npm run check:health`, `npm run check:parking`: unchanged, passing.
- `cd ../Parklane-clinical-system && npm run test:e2e`: the 20-step workflow
  in a real browser across both apps (see that README).

## Production checklist

- Set `EMS_ENCRYPTION_KEY` from a secrets manager (it seals all clinical text),
  `NODE_ENV=production` (refuses `demo-seed`), and `CORS_ORIGIN` to the
  clinic web app's origin instead of `*`. Serve over HTTPS (microphone access
  requires a secure origin).
- Sign data-processing agreements with Google (a paid Gemini API project) or
  Anthropic, and with ElevenLabs; use ElevenLabs zero retention
  (`ELEVENLABS_ZERO_RETENTION=1`) on an enterprise plan.
- Back up `DATA_DIR` (ems.db, ems.key, clinic/photos, health/files) and restrict it to the service user.

## Limitations and next steps

- **Not yet verified against the live Gemini and ElevenLabs APIs.** The
  integrations follow the documented request shapes and are tested against
  local stand-ins. Before go-live, check with real keys: that Gemini accepts
  the schemas (`anyOf`, nullable types), that real scripts pass
  `checkScript()` (its length limits may need tuning), that `eleven_v4`
  accepts `language_code`, Arabic/Egyptian transcription quality, and the
  voice. The default voice is English; set an Arabic one with
  `ELEVENLABS_VOICE_ID_AR`.
- Patient self check-in (e.g. a QR at the desk) is not built; check-in
  records who did it, so a `self` path can be added beside the desk's.
- The app learns about status changes on screen focus, not by push;
  the backend already sends the resident `appointment` events.
- The clinic web app's interface is English; clinical content and AI output
  can be Arabic (right-to-left where needed).
- Scheduled appointments nobody marks are not turned into no-shows
  automatically.
