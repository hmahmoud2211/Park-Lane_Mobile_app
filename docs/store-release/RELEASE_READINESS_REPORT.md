# Release readiness report — Parklane 1.0.0

Date: 10 November 2026 · Branch: `release/store-readiness-2026-11` (from Master `7a1f4bb`, **not committed or pushed**)

## The answer first

| Store | Verdict | Why, in one line |
|---|---|---|
| **Apple App Store** | **NOT READY** | The code blockers are fixed. Still blocking: the backend fixes are not on the production server, the assistant service exposes residents, and healthcare apps must come from the healthcare provider's legal entity |
| **Google Play** | **NOT READY** | The same, plus a health app needs an organization developer account, and the Play Console forms aren't filled |

Approval is never guaranteed. These verdicts follow the rule "never turn missing evidence into a pass".

The path to **CONDITIONALLY READY** is the numbered list in §8. Most of it is account, server and console work,
not code.

## 1. What was done

1. **Discovered.** Read the whole repository and its documentation. Four parallel reviews covered the current Apple and Google rules (official pages, read 10 Nov 2026), backend security, the app's features and placeholders, and privacy, permissions and accessibility.
2. **Built and ran it.** A real iOS Release build **crashed at launch**. Found the cause (mismatched Expo packages), fixed it, rebuilt, and it launched.
3. **Fixed** the blockers in the code: account deletion, privacy policy, demo content, consent, crash, and others (§3).
4. **Tested** with automated suites (all green) and a real browser flow against a real backend (27/27). A visual comparison proves development and preview builds are unchanged apart from the intended fixes.
5. **Built for release:** iOS Release (simulator) and an Android production bundle on EAS (BUILD_VALIDATION.md).
6. **Documented** everything in this folder.

## 2. Numbers

| | Count |
|---|---|
| Issues found (register below) | **46** |
| Fixed and verified in this branch | **26** |
| Remaining: you must act (accounts, server, consoles, legal) | **11** (4 of them P0) |
| Remaining: code improvements, not blocking | **9** (1 of them P1: issue 24) |
| Automated checks passing | 144/144 backend tests · 183/183 app checks · typecheck · lint · 27/27 browser flow checks |

## 3. Issue register

**P0 = blocks release · P1 = high · P2 = quality · P3 = nice to have.**
Status: **Fixed** (verified), **You** (manual action), **Open** (code, not done).

| ID | Pri | Issue | Status |
|---|---|---|---|
| 1 | P0 | iOS Release build crashed at launch (Expo package mismatch, `dyld Symbol not found`) | Fixed (rebuilt, launches) |
| 2 | P0 | No account deletion (Apple 5.1.1(v), Google) | Fixed in code |
| 3 | P0 | Account deletion not on the production server | **You** (deploy) |
| 4 | P0 | No web page for deletion (Google) | Fixed in code (`/account/delete`) |
| 5 | P0 | No privacy policy in the app or as a URL | Fixed in code (`/privacy`) |
| 6 | P0 | Privacy policy needs the operator's name, contact and a legal review | **You** |
| 7 | P0 | Store build showed a made-up resident to everyone; fabricated contract/receipt PDFs | Fixed (store mode) |
| 8 | P0 | Forms said "submitted"/"booked" but sent nothing (maintenance, feedback, amenities, visitor passes) | Fixed (left out of store build) |
| 9 | P0 | Parking demo, Demo controls and a test runner reachable in production | Fixed |
| 10 | P0 | 12 "Coming soon" placeholder pages | Fixed (real screens or hidden) |
| 11 | P0 | Login buttons that did nothing ("Biometric", "Forget Password?") | Fixed |
| 12 | P0 | Health consent said AI ran on Parklane's own servers; really Gemini/Claude and ElevenLabs | Fixed (EN + AR) |
| 13 | P0 | Assistant sent voice, camera and text to outside AI without consent | Fixed (consent screen) |
| 14 | P0 | Assistant let anyone switch to another resident; everyone answered as demo resident 1001 | Fixed in the app |
| 15 | P0 | The assistant **service** answers its resident list without login and trusts any `resident_id` | **You** (outside repo) |
| 16 | P0 | Healthcare app must be submitted by the healthcare provider's legal entity (Apple 5.1.1(ix)); Google needs an organization account for health apps | **You** |
| 17 | P1 | WebSocket kept sending events after a session was revoked (patient names for doctors) | Fixed |
| 18 | P1 | Anyone could lock the public demo account (change its password, sign others out) | Fixed |
| 19 | P1 | Required-reason declaration (DiskSpace) missing from the merged privacy manifest | Fixed |
| 20 | P1 | Camera purpose string described a feature the store build doesn't have; unused Face ID text | Fixed |
| 21 | P1 | Developer text shown to residents ("docker ps", "Expo Go", wrong app name "CUBE OS") | Fixed |
| 22 | P1 | Sample data and fake identities inside the store binary (Apple 2.5.19) | Fixed (build-time removal; scan 0 matches) |
| 23 | P1 | Build-tool advisories (1 critical, 3 high) | Fixed (5 moderate left, build machine only) |
| 24 | P1 | Open sign-up lets anyone book real clinic slots and use paid AI | **Open** (SECURITY_AUDIT R1) |
| 25 | P1 | No reviewer account in a demo apartment | **You** |
| 26 | P1 | Assistant's AI company not named anywhere | **You** (`EXPO_PUBLIC_ASSISTANT_AI_PROVIDERS`) |
| 27 | P1 | Brand permission for "Park Lane" (Apple 5.2.1) | **You** |
| 28 | P1 | Export-compliance answer (own AES code for Meross setup) | **You** |
| 29 | P1 | Signed iOS archive and team-project Android bundle not produced (needs your accounts) | **You** |
| 30 | P2 | Store consoles: App Privacy, Data safety, Health declaration, FGS declaration, ratings, screenshots | **You** |
| 31 | P2 | VoiceOver could not reach items inside menus (backdrop trap) | Fixed (not tested on a device) |
| 32 | P2 | Unbuilt preference rows in Settings | Fixed (hidden in store mode) |
| 33 | P2 | Smart Home showed a sample home to guests and new accounts, with fake energy and automations | Fixed (real home only) |
| 34 | P2 | Assistant suggestions about installments/visitors the store build can't answer | Fixed |
| 35 | P2 | Uploaded medical files served without nosniff | Fixed |
| 36 | P2 | Change password only existed as a forced step | Fixed (voluntary mode) |
| 37 | P2 | "Explore Now" promo did nothing | Fixed (opens Services) |
| 38 | P2 | Per-IP-only brute-force limits; proxy header trust | Open (R2, R3) |
| 39 | P2 | Admin can reset doctors' passwords; desk sees booking reasons | Open (R4, R5) |
| 40 | P2 | Large uploads held in memory | Open (R6) |
| 41 | P2 | Gateway address typed by a user becomes plain http even off the LAN | Open (R12) |
| 42 | P2 | People who agreed to the old Health consent wording | **You** (re-ask or notify) |
| 43 | P2 | Very small text sizes in some tokens (7–9.5 pt) | Open (needs design review against Figma) |
| 44 | P2 | Assistant hostname has underscores (may fail on some Android stacks) | Open (not verified on Android) |
| 45 | P3 | Launch screen is a plain dark screen, no logo | Open |
| 46 | P3 | Low-severity backend items (scrypt cost, link lifetime, CORS default, 500 on bad URLs, email enumeration, token sent to any media host); "report this answer" in the assistant; Settings buttons after a permission is refused | Open |

## 4. Store mode in two sentences

The store build (`EXPO_PUBLIC_STORE_MODE=1`, set in `eas.json → production` and `store-preview`) contains only the
parts with real services behind them, and shows the signed-in person. Development and preview builds are unchanged.
To bring a part back, give it a backend and move its screen from `navigation/sampleScreens.tsx` back into the
navigator.

## 5. Builds

| Build | Result | Evidence |
|---|---|---|
| iOS Release (simulator), store mode | **Builds and launches** (Xcode 27.2, iOS 27.2 SDK, minimum iOS 16.4) | BUILD_VALIDATION.md, run 3 |
| iOS signed archive / TestFlight | **Not done**: needs the team's Apple account | — |
| Android production `.aab` on EAS (personal project) | **Queued on EAS** at the time of writing; result not yet verified | BUILD_VALIDATION.md |
| Android on a phone | Not tested | — |

## 6. Policy compliance (summary)

- **Apple:** platform, privacy manifest, purpose strings, background audio, account deletion, privacy policy link, AI consent, medical disclaimers and app completeness are now met in the code. Open: publisher entity (5.1.1(ix)), brand permission, reviewer account, consoles. See APPLE_APP_STORE_AUDIT.md.
- **Google:** target API 36, App Bundle, permissions, deletion (in-app + web), disclaimers and honest functionality are met in the code. Open: organization account, Health and FGS declarations, Data safety, account deletion URL after deployment. See GOOGLE_PLAY_STORE_AUDIT.md.

## 7. Store listing completeness

Text is ready in APP_STORE_METADATA.md. Missing, and only you can supply them:

- support URL and contact e-mail;
- legal company name;
- reviewer account details;
- screenshots (iPhone, iPad 13", Android);
- the Play feature graphic and 512 px icon;
- the assistant's AI company.

## 8. What you must do before pressing "Submit for Review"

1. **Decide who publishes.** Use the developer account of the company that runs the compound or the clinic, or keep EMS and get a written authorization from them for healthcare (Apple 5.1.1(ix)) and the "Park Lane" brand. On Google Play this must be an **organization** account (D-U-N-S).
2. **Review and commit this branch**, then merge it to Master. Nothing is committed yet.
3. **Deploy the backend** to the production server (`/opt/parklane`, see `docs/on_server.md`). Before restarting, add to `backend/.env`: `LEGAL_OPERATOR_NAME`, `LEGAL_CONTACT_EMAIL`, `PRIVACY_POLICY_DATE`. Then check:
   - `https://api-iot-2.ems-iot.com/privacy` shows no "Draft" notice;
   - `https://api-iot-2.ems-iot.com/account/delete` opens.
4. **Have the privacy policy text reviewed** (`backend/src/public/privacy.html`). Add how long backups keep data, if you keep backups.
5. **Fix the assistant service** (outside this repository): require the EMS sign-in for `/api/v1/residents` and chat, and remove its public "Chat Console" page. Tell me its AI company, or set `EXPO_PUBLIC_ASSISTANT_AI_PROVIDERS` in `frontend/eas.json` (`production` and `store-preview`).
6. **Create the reviewer account:**
   - In the app, use **Create account**, with a strong password (not `ems`/`5002`).
   - From the admin dashboard, add it to a demo apartment that has devices; the stand-in hub `npm run fake-hub` is enough.
   - Put the username and password in the review notes.
7. **Build with the team account** (`emscompany2016s-team`). Then install the `store-preview` APK and the iOS build on real phones, and go through the review-notes steps once. Include an iPad, or set `supportsTablet: false`.

   ```
   cd frontend
   npx eas-cli@latest build --profile store-preview --platform android   # test APK, store mode
   npx eas-cli@latest build --profile production --platform all          # store builds
   ```

8. **Fill in the consoles** with the proposed answers in PRIVACY_AND_DATA_DECLARATIONS.md and APP_STORE_METADATA.md:
   - Apple: App Privacy, age rating (with the new Shared Location / Dating questions), export compliance, screenshots, support URL.
   - Google: Data safety, Health apps declaration, Foreground service declaration with a video, content rating, target audience, app access, account deletion URL, package registration.
9. **Tell earlier Health Passport testers** that the data-use text changed, or ask them to agree again.
10. Recommended before a public listing: limit clinic booking and the health AI to residents of an apartment (issue 24). Or choose Apple's **unlisted** distribution and a Google closed or private track.
