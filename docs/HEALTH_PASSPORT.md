# Health Passport

A resident keeps their family's medical records in the app and, at a doctor's visit, plays a clear spoken summary of the whole record. The feature is fully in English and Arabic, with right-to-left layout.

**Status:** the app side is complete and runs on a built-in mock. This repository's backend (`backend/`) does not serve the `/health` API yet, so a release build shows an error until it does. See [What is still open](#what-is-still-open).

## What it does

- **Consent first.** Nothing opens until the resident agrees to how the data is used. Withdrawing consent deletes everything.
- **Family profiles.** One record per person: the resident, and the children, parents or others they add.
- **Records.** Allergies, medications, conditions, lab results with trends, procedures and visits, added by hand or read from documents.
- **Documents.** Photograph or pick a prescription, lab report or discharge summary. Photos are converted and scaled on the phone (HEIC to JPEG, 2500 px, 10 pages, 10 MB each). The server reads the document in the background, and the resident checks every item before anything is saved.
- **Spoken summary.** Generated in the background in Arabic or English, for a chosen specialty. It keeps playing with the screen locked, for a phone handed across the desk.
- **Banners.** The app has no push notifications, so a banner over every screen says when a document or summary is ready.

## Screens

Entered from the Health Passport row on the Services screen, or at `/health` on the web.

| Route | Purpose |
| --- | --- |
| `HealthPassport` | Home: the active profile, progress, record summary, gaps to fill. Sends a resident without consent to onboarding |
| `HealthOnboarding` | How the data is used, and the agreement |
| `HealthProfile` | A person's basic details; adds a family member when opened without an id |
| `HealthRecords` | Every section of a record, and the documents |
| `HealthDocument` | One document: status, original, extracted text, what was saved from it |
| `HealthUpload` | Take photos or pick files, then upload |
| `HealthReview` | Check, correct or reject what was read, item by item |
| `HealthItemForm` | Add or edit one item by hand |
| `HealthSummary` | Prepare, follow and play a summary |
| `HealthSettings` | Family profiles, data use, deleting data, withdrawing consent |

## Where the code is

| Path (under `frontend/src/`) | What |
| --- | --- |
| `features/health/services/` | No React: `healthService` (the interface and errors), `httpHealthService`, `mockHealthService`, `healthStore` (cache and notices), `statusPoller`, `review`, `itemForm`, `selectors`, `i18n` |
| `features/health/context/HealthContext.tsx` | `HealthProvider`: owns the service, cache and pollers. Every change goes through it, so it marks exactly what went out of date |
| `features/health/hooks/` | `useHealth`, and `useHealthData` for one cached resource each |
| `features/health/components/` | `HealthFrame`, `HealthNotifier`, `ConfirmSheet`, `DateField`, `SummaryPlayer`, `ZoomableImage`, `ItemRow` and friends |
| `screens/Health*Screen/` | One folder per route, each with its own English and Arabic copy in `.data.ts` |
| `types/health.types.ts` | The API's types, snake_case as sent |
| `config/health.ts` | Backend address, timeouts, polling schedules |

## Mock or real backend

| `EXPO_PUBLIC_HEALTH_API` | Development | Release build |
| --- | --- | --- |
| unset | mock | real backend |
| `mock` | mock | mock |
| `http` | real backend | real backend |

`EXPO_PUBLIC_HEALTH_API_URL` sets the backend, and defaults to the EMS backend. The app only ever talks to its own backend: no AI address or key belongs in it.

**Do not read this variable through `env.ts` in `createHealthService.ts` or `media.ts`.** They use the literal `process.env.EXPO_PUBLIC_HEALTH_API` on purpose, as the one exception to the rule that `env.ts` reads every setting. Metro drops the mock only when it can see the value right at the `require()`. Tested on release web builds, and the first two rows also on iOS and Android bundles:

| Build | Mock code and sample medical records | Sample audio and photos |
| --- | --- | --- |
| Default | absent | 0 files |
| `EXPO_PUBLIC_HEALTH_API=mock` | included | 7 files |
| Default, with the check read through `env.ts` | included | 7 files |

## The API it expects

Bodies are plain JSON in snake_case, without the `{ ok, data }` envelope (`types/health.types.ts`). Requests carry `Authorization: Bearer <EMS session>` and `Accept-Language: en|ar`, and texts come back in that language. Paths are `/health/...`, not `/api/...`.

| Method and path | Purpose |
| --- | --- |
| `GET`, `POST /health/consent` | Read or set consent. `{ given: false }` deletes all health data |
| `GET`, `POST /health/profiles` | List or add profiles |
| `PUT`, `DELETE /health/profiles/:id` | Update a profile, or delete it with its data |
| `GET /health/profiles/:id/record` | The whole record, with its gaps |
| `POST /health/profiles/:id/:section` | Add an item (`allergies`, `medications`, `conditions`, `procedures`, `labs`, `visits`) |
| `PUT`, `DELETE /health/profiles/:id/:section/:itemId` | Change or delete an item |
| `GET`, `POST /health/profiles/:id/documents` | List documents, or upload one (multipart `files[]`, `type`, `document_date`) |
| `GET /health/documents/:id` | A document and what was read from it |
| `POST /health/documents/:id/confirm` | Save reviewed items; may be called more than once |
| `DELETE /health/documents/:id?delete_items=` | Delete a document, optionally with its items |
| `GET /health/profiles/:id/summary?lang=&specialty=` | Current summary state. 404 means none yet |
| `POST /health/profiles/:id/summary` | Ask for a summary: 200 if current, 202 with the background job |

Failures map to `HealthError` kinds that the screens explain: 401 ends the session, 404 `not_found`, 413 `too_large`, 422 `invalid`, 503 `busy`. A message in `detail`, `message` or `error.message` is used.

## What is still open

1. **The backend.** It exists on branch `feature/clinical-system`, under the old `server/` path, along with the Clinic and its AI keys. It has to be moved to `backend/`. Until then a release build gets a 404 on opening Health Passport and shows "Not found: This may have been deleted." The resident is not signed out, but that wording is alarming on a medical record, so settle this before residents see the Services row: move the backend, or build with `EXPO_PUBLIC_HEALTH_API=mock` for a demo, which shows sample records.
2. **Two changes the backend port needs here.** `backend/src/app.ts` dispatches only `/api/` paths, and `backend/src/http/cors.ts` does not allow `PUT`, which the web app uses to change profiles and items.
3. **Sign-in.** The API uses the EMS session, but the app's own login is not wired to EMS yet. A resident with no EMS session would get a 401, and `HealthNotifier` then sends them to Login, which does not create one. Health Passport needs to ask for the EMS sign-in first, or the two logins need joining.
4. **Icon.** `service-health.png` is not from the Figma design; replace it when an official export exists.

## Checks

```bash
cd frontend
npm run check:health       # 25 acceptance checks on the mock, polling, review rules and forms
npm run check:transport    # the HTTP client, against a stubbed fetch and XMLHttpRequest

# Every screen, in both layouts, through the mock
EXPO_PUBLIC_VISUAL_ROUTES=1 EXPO_PUBLIC_HEALTH_API=mock EXPO_PUBLIC_DEVICE_BACKEND_URL= \
  npx expo export -p web --output-dir /tmp/web-health
node scripts/visual-regression.mjs capture --profile health --dist /tmp/web-health --out /tmp/shots-health
```

Medical data is never logged: nothing in the client writes request or response bodies anywhere.
