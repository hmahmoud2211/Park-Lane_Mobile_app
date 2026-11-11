# Security audit — app, backend and connected services

Date: 10 November 2026 · Branch: `release/store-readiness-2026-11`

This report holds no secret values. Where a secret was found, it gives only the file and what kind it is.

## Summary

The core is solid:

- Every route checks who is calling. No IDOR (reading someone else's records) was found.
- All SQL uses parameters. Uploaded file names are UUIDs, so there's no path traversal.
- Medical data is encrypted at rest (AES-256-GCM).
- Passwords are scrypt-hashed. Session tokens are 32 random bytes, stored only as SHA-256 hashes.
- Logs carry no prompts, documents, passwords or tokens.

Nothing secret is committed. The whole tracked tree and 199 commits of history were searched.

The serious problems were about *missing* things (account deletion, honest AI consent) and about a connected service
outside this repository (the assistant). Those are listed below.

## Fixed in this branch (with tests)

| # | Finding | Severity | Fix | Proof |
|---|---|---|---|---|
| S1 | No way to delete an account and its data | High | `POST /api/auth/delete-account` (`backend/src/ems/accountDeletion.ts`): password re-check, every sign-in and live socket ended, membership, Health Passport data **and files on disk**, invites removed; clinic history kept with an anonymous account row | `backend/test/account-deletion.test.ts` (5 tests), browser flow |
| S2 | Consent said AI ran "on Parklane's own servers"; documents really go to Google Gemini or Anthropic Claude, and summaries to ElevenLabs | High (privacy law, store rules) | Wording corrected in English and Arabic; the providers are named in every consent | Text in `dataUse.ts`, onboarding, summary, clinic booking |
| S3 | A WebSocket kept receiving events after its session was revoked (sign-out, "sign out other phones", password change, admin reset, account deletion). For doctors that included patient names | Medium | Each ping (25 s) re-checks the token; account deletion closes the user's sockets at once (`ems/realtime.ts`) | Socket test in `account-deletion.test.ts` |
| S4 | Anyone signed in to the public demo account could change its password or sign everyone else out, locking out the next person (and App Review) | Low → Medium for review | `change-password`, `logout-others` and `delete-account` refuse the default account (403) | Test "the shared demo account … cannot be deleted" |
| S5 | Uploaded medical files were served without `X-Content-Type-Options: nosniff` | Low | Header added to every binary answer (`http/respond.ts`) | Backend tests |
| S6 | The Assistant downloaded the hosted service's resident list and let **anyone, even a guest**, switch to another resident | High in production | The store build never calls `/residents`, has no picker, and never sends a resident id | Browser test "never downloads the resident list" |
| S7 | Build-tool advisories (1 critical `shell-quote`, high `node-forge`, `zod`, `@expo/cli`) | Low (build machine only, not in the app) | `npm audit fix` within semver ranges; lockfile regenerated with npm 10 for EAS | `npm audit --omit=dev`: 5 moderate left, all needing breaking upgrades |
| S8 | Sample data and fake identities inside the store binary | Low (privacy hygiene, Apple 2.5.19) | Removed at build time | Bundle scan: 0 matches |

## Open — inside this repository (recommended next)

| # | Finding (file) | Severity | Smallest fix |
|---|---|---|---|
| R1 | **Open sign-up**: anyone with the public app can create an account, then book up to 6 real clinic slots and use the AI for document reading and summaries (`routes/auth.ts`, `clinic/appointments.ts`, `http/rateLimits.ts`). Limits are per user or per IP only, with no overall budget | **High once the app is public** | Require apartment membership (or an admin-made account) for clinic booking and the health AI, and add global daily budgets. Unlisted distribution lowers the exposure |
| R2 | Login brute-force limits are per IP only (10/min); no per-account lockout, no MFA for admins; default admin username `admin` (`ems/rateLimit.ts`, `config.ts`) | Medium | Per-account back-off; MFA for admins; a non-default admin username |
| R3 | `TRUST_PROXY=1` trusts the first `X-Forwarded-For` value. Safe behind Caddy, which overwrites the header; not safe behind nginx's usual `$proxy_add_x_forwarded_for` (`compose.yaml` mentions nginx) | Medium | Use the right-most hop; confirm the live proxy |
| R4 | An admin (or the `ADMIN_API_KEY`) can reset a **doctor's** password and so read clinical records (`routes/ops.ts`) | Medium | Refuse staff accounts in the admin API; tell the person by another channel |
| R5 | The clinic desk sees the encrypted booking reason, plus age and sex, though the docs say "no clinical content" (`clinic/appointments.ts` `staffView`) | Medium | A desk view without `reason` |
| R6 | Uploads (up to ~100 MB) are parsed fully in memory; several at once could exhaust memory (`routes/health.ts`) | Medium | Concurrency limit; stream to disk; total cap 20–30 MB |
| R7 | scrypt uses Node's defaults (N=2^14), below OWASP's 2^17 (`ems/auth.ts`) | Low | Raise N for new hashes; rehash at sign-in |
| R8 | Signed media links last 2 h and aren't tied to a user (`health/files.ts`) | Low | Shorter life; bind to the session |
| R9 | `CORS_ORIGIN` defaults to `*` (bearer tokens, not cookies, so impact is low) | Low | Set the app's origins in production |
| R10 | A malformed `%` in a URL gives 500 instead of 400 | Low | Catch `decodeURIComponent` errors centrally |
| R11 | Register reveals whether an email exists (409) | Low | Accept and send a neutral message |
| R12 | The app turns a typed or QR gateway address into `http://` even for non-LAN hosts (`config/gateway.ts`) | Medium | Accept http only for private IPs and `.local` |
| R13 | The session token is attached to any media URL the backend returns, whatever its host (`httpHealthService.ts`) | Low | Send it only to the backend's origin |
| R14 | People who agreed to Health Passport before this change agreed to the old (wrong) wording | Medium (legal) | Ask them again, or tell them about the change |

## Open — outside this repository

| # | Finding | Severity | Who |
|---|---|---|---|
| X1 | The assistant service (`attal-voice-2.ems-iot.com`, "Al Atal Voice") answers `GET /api/v1/residents` **without any login** (HTTP 200, checked by status code only; content not read). Its chat accepts any `resident_id` without proof, so a caller can ask as any resident it knows. Its home page is a public "Chat Console" | **High** if it holds real residents | Its owner: require the EMS session or assistant token; remove the console |
| X2 | Which AI company the assistant uses, and its data retention, are not documented anywhere | Medium (consent accuracy) | You: name it in `EXPO_PUBLIC_ASSISTANT_AI_PROVIDERS` and the privacy policy |
| X3 | The production backend has not been updated with these fixes | High (deletion doesn't exist until then) | You: deploy (RELEASE_READINESS_REPORT.md §8) |
| X4 | ElevenLabs keeps request data unless an enterprise zero-retention plan is used (`ELEVENLABS_ZERO_RETENTION`) | Medium | You: choose the plan; the privacy policy says so |
| X5 | **Confirmed, Nov 11 2026:** voice did not work in the APK. The service's first hostname had underscores. On Android 10+, OkHttp 4.9.2 (React Native's HTTP and WebSocket client) reads the socket's `SSLParameters`; Android builds an `SNIHostName` from the host, which throws on `_`, and OkHttp fails the connection ("Android internal error"). Voice and text chat both fail; the web and iPhone are unaffected. Sending `Host:` through another `ems-iot.com` name works for REST but not for the voice WebSocket (502), so it has to be a new name. The app now uses only `attal-voice-2.ems-iot.com` (`config/assistant.ts`, `eas.json`), live in Cloudflare and checked (health 200, voice WebSocket opens a session) | **High** (no assistant on Android) | You: rebuild the APK and test voice on a phone |

## Secrets

- **No rotation is needed for anything in git.** The only tracked env files hold placeholders, or a LAN IP (`docker/rethink/.env`).
- On this Mac (not in git): `backend/.env` holds real keys and is readable by other users of the Mac (mode 644). Run `chmod 600 backend/.env`.
- `frontend/.env.local` still has an old `EXPO_PUBLIC_CUBE_PASSWORD`. The app never reads it (checked), so it isn't in any bundle. Delete the line anyway: every `EXPO_PUBLIC_*` value is public by design.
- No secret is in the app bundle; the `EXPO_PUBLIC_*` values are URLs and switches only.

## On the phone

- Sign-in and gateway tokens: Keychain / Keystore, `WHEN_UNLOCKED_THIS_DEVICE_ONLY` (`lib/storage/secureStorage.ts`). The web build uses per-tab storage.
- Health data: in memory. Opened originals go to a cache folder that is emptied before each new one and at sign-out.
- No analytics, crash reporting, advertising ID or fingerprinting. `expo-camera` on Android includes Google ML Kit for QR scanning, which can send anonymous usage data to Google; this is declared in the privacy policy.
- Logging: one `console.warn` with a server error message; no personal data.
