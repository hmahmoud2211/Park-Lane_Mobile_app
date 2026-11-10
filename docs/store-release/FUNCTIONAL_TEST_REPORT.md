# Functional test report

Date: 10 November 2026 · Mac: macOS 27.0.1, Node 24.13.0 (the project pins Node 22, as CI does; CI was not run: GitHub Actions was locked for billing on
7 November 2026, not rechecked), Xcode 27.2, Chrome (headless) · Branch: `release/store-readiness-2026-11`

**Important:** no test ran on a real iPhone or Android phone in this session. The device-level evidence is one iOS
simulator and one browser. Anything that needs hardware (cameras, microphones, Wi-Fi device setup, LG ACs, a real
CUBE Gateway, push of audio to the lock screen) is listed under "Not tested" below.

## 1. Automated suites

| Suite | Command | Result |
|---|---|---|
| App typecheck | `cd frontend && npx tsc --noEmit` | exit 0 |
| App lint | `npx expo lint --no-cache` | 0 problems |
| Parking demo | `npm run check:parking` | 23/23 |
| HTTP client and realtime | `npm run check:transport` | 37/37 |
| Health Passport | `npm run check:health` | 26/26 |
| Gateway pairing codes | `npm run check:pairing` | 11/11 |
| Gateway addresses | `npm run check:endpoints` | 22/22 |
| Gateway account access | `npm run check:account` | 24/24 |
| Gateway phones | `npm run check:phones` | 13/13 |
| Apartment rules | `npm run check:unit` | 14/14 |
| Password change | `npm run check:password` | 13/13 |
| Backend typecheck | `cd backend && npm run typecheck` | exit 0 |
| Backend tests | `npm test` | **144/144** (138 before + 6 new) |
| Combined | `./scripts/dev.sh check` | all green |
| Shared contracts type-only (CI rule) | CI script | 683 files OK |

New backend tests (`backend/test/account-deletion.test.ts`):

1. A wrong password deletes nothing.
2. Everything the account holds goes: sign-ins, Health Passport rows, items, shares, consent, apartment membership, an orphaned file on disk. The other parent keeps their own record. The email can be registered again.
3. Upcoming clinic visits are cancelled. Past visits stay, linked to an anonymised account row, and the doctor still sees them. The old login no longer works.
4. The shared demo account can't be deleted, can't change its password and can't sign others out. A doctor can't self-delete.
5. A live WebSocket is closed (code 4401) the moment the account is deleted.
6. `/privacy`, `/account/delete` and their files are served with strict CSP and nosniff. They show the draft notice while `LEGAL_*` is unset, and accept nothing but GET/HEAD.

## 2. Store-mode flow test in a real browser

Setup:

- the store-mode web export (`EXPO_PUBLIC_STORE_MODE=1`), served locally;
- the **real backend** (`node src/index.ts`) with a fresh database;
- headless Chrome at 390×844 (iPhone size), driven over the DevTools protocol.

Script: kept in the session scratch folder (not in the repo). **Result: 27/27 checks passed** on the final code.

| Flow | Checked | Result |
|---|---|---|
| Sign-in screen | No "Biometric"; "Forgot password?" spelled right and explains the reset | Pass |
| Create account | Privacy-policy line with link; account created; Home greets the new person by name | Pass |
| Home | Only Smart Home, Health Passport, Clinic, EMS AI; no "Ahmed" or fake weather; "Explore Now" opens Services | Pass |
| Settings | Profile, My Devices, Account & security, Help & Support, Privacy Policy, Log Out; no placeholder rows | Pass |
| Account & security | Shows the signed-in email | Pass |
| Delete account | Explains what is deleted and kept; wrong password refused with a message; right password deletes and returns to sign-in with "Your account and its data were deleted."; the backend then refuses that login (401) | Pass |
| Shared demo account | Signs in; deletion refused with an explanation | Pass |
| Guest | "Welcome, Guest" on Home | Pass |
| Assistant | Consent screen before first use; the resident list is never requested; chat opens after "I agree"; store suggestions only | Pass |
| Contact Us tab | Opens Help & Support | Pass |
| Services | Only Health Passport, Clinical Appointment, Help & Support | Pass |
| Smart Home as guest | No sample home; My Devices with sign-in | Pass |
| Profile as guest | No demo gate pass, no demo name | Pass |
| Parking | Not reachable in the store build | Pass |

The one first-run failure was in the test itself (it looked for "Sign in", and the button shows "SIGN IN"); the
screenshot showed the right screen.

Screenshots of each step were reviewed. Two layout fixes came out of them: the assistant consent panel got the
standard side margin, and Home's "Explore Now" now opens Services instead of nothing.

## 3. Development and preview builds unchanged

Visual regression (`frontend/scripts/visual-regression.mjs`, `basic` profile, phone and desktop):

- **Before:** Master `7a1f4bb`, exported to the scratch folder with `git archive`.
- **After:** this branch, both as normal (non-store) web builds.

**Result: 170 files compared, 25 differ, all in 6 screens, all intended:**

| Screen (phone and desktop) | Why it differs |
|---|---|
| Assistant | The new AI consent screen before first use (every build) |
| Login | "Forget Password?" → "Forgot password?" |
| Settings | "Security" → "Account & security" (now real), new "Privacy Policy" row, Help & Support text |
| Gateway Setup | "docker logs …" instruction replaced |
| LG Pairing | "CUBE OS phone app build (Expo Go…)" replaced |
| Under Development | The Contact Us tab no longer lights up here, because Contact Us now opens Help & Support |

Every other screen is unchanged in development and preview builds, including Home, Profile, Services, Smart Home,
My Unit, Parking and Health. Run-to-run noise is at most 2/255, so a difference above that is real.

## 4. iOS simulator

- Release build for the simulator (no signing), from a scratch copy of `frontend/`:
  `expo prebuild -p ios` → `pod install` → `xcodebuild -configuration Release -sdk iphonesimulator`.
- **Run 1 (Master's packages): built, then crashed at launch.** The crash report said:
  `Symbol not found: … ExpoModulesCore … AnyModule._classTypes`, referenced from `ExpoImageManipulator.framework`. Mismatched prebuilt Expo binaries.
- **Run 2 (after `npx expo install --fix`): built; launched on iPhone 17 (iOS 26.5); stayed running; welcome screen drawn**; no new crash report.
- **Run 3 (store mode, final code): built; launched; stayed running; welcome screen drawn; no crash report.** The real Info.plist has no Face ID text and the corrected camera text; the privacy manifest lists all four required-reason categories. The Hermes bundle (4.8 MB, down from 5.4 MB) contains none of the demo names, receipts, links or the test runner, and does contain the new texts (control check).

## 5. Not tested (needs a phone, hardware or the live servers)

- Real iPhone and Android phones (store-preview build), including iPad layouts.
- Camera, microphone and photo permission prompts and denial paths on device.
- Background playback of the spoken summary with the screen locked.
- Device setup over Wi-Fi (Shelly, SONOFF, Meross, LG), a real CUBE Gateway, Home Assistant with real brand accounts.
- The live AI services (Gemini/Claude, ElevenLabs) and the live assistant service. The backend tests use stand-ins.
- The production server: none of the backend changes are deployed there yet.
- Offline, slow-network, background/foreground and restart behaviour on device. The code has timeouts and error states everywhere it fetches, but they weren't exercised on a phone.
- Time-zone changes. The clinic uses `Africa/Cairo` on the server; the phone shows server times.

## 6. Feature inventory (store build)

| Feature | Backed by | In store build |
|---|---|---|
| Sign-in, create account, sign-out, change password, sign out other phones, delete account | EMS backend | Yes |
| Smart home dashboard, My Devices, device detail, linked brand accounts | EMS backend + Home Assistant | Yes (real home only) |
| Add device, CUBE Gateway pairing, device setup over Wi-Fi, LG pairing, AC controls | CUBE Gateway on the LAN | Yes (needs hardware) |
| Health Passport (13 screens) | EMS backend `/health` | Yes |
| Clinic booking (4 screens) | EMS backend `/api/clinic` | Yes |
| Parklane Assistant (chat, voice, camera) | Separate assistant service | Yes, with consent |
| Help & Support, Privacy policy, Account & security | App + backend pages | Yes (new) |
| My Unit, Visitor Access, Maintenance, Parking (8 screens), Community, Amenities, BMS, demo tools | Sample data / on the phone | No (dev and preview builds only) |
