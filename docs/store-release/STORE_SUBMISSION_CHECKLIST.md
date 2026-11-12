# Store submission checklist

Labels: **VERIFIED PASS** · **FIXED AND VERIFIED** · **NEEDS MANUAL ACTION** · **NOT VERIFIED** · **FAILED / BLOCKING** · **NOT APPLICABLE**

"Verified" means it was run or inspected in this session (10 November 2026), with the evidence named. Simulator and
browser checks are not real-device checks.

## Shared (both stores)

| # | Item | Status | Evidence / action |
|---|---|---|---|
| 1 | App typecheck and lint | VERIFIED PASS | `npx tsc --noEmit` exit 0; `npx expo lint --no-cache` 0 problems |
| 2 | App check suites | VERIFIED PASS | 9 suites, 183/183 checks |
| 3 | Backend typecheck and tests | VERIFIED PASS | `npm run typecheck` exit 0; `npm test` 144/144 (6 new). On `feature/real-backend`: 222/222 |
| 4 | Expo package versions match SDK 58 | FIXED AND VERIFIED | 14 mismatches fixed with `npx expo install --fix`; lockfile rebuilt with npm 10.9.9; `npm ci --dry-run` OK. Expo Doctor's only remaining note: `react-native-tcp-socket` untested on the New Architecture (informational) |
| 5 | Dependency advisories | FIXED AND VERIFIED | Critical/high build-tool advisories fixed; 5 moderate left (need breaking upgrades, build machine only); backend 0 |
| 6 | Account deletion in the app | FIXED AND VERIFIED | Browser flow (wrong password refused, deletion, sign-in refused afterwards) + backend tests |
| 7 | Account deletion live on the production server | NEEDS MANUAL ACTION | Deploy the backend (RELEASE_READINESS_REPORT.md §8) |
| 8 | Web page for deletion | FIXED AND VERIFIED | `/account/delete` served with strict CSP (test). Live URL after deployment |
| 9 | Privacy policy in the app | FIXED AND VERIFIED | Settings, Help & Support, Create account, Assistant consent |
| 10 | Privacy policy text and operator details | NEEDS MANUAL ACTION | Set `LEGAL_OPERATOR_NAME`, `LEGAL_CONTACT_EMAIL`, `PRIVACY_POLICY_DATE`; legal review of `backend/src/public/privacy.html` |
| 11 | No demo data or placeholders in the store build | FIXED AND VERIFIED | Store mode; bundle scan 0 matches; browser checks. Re-checked on `feature/real-backend` with the real features back in: bundle scan 0 matches, store-mode browser walk 15/15 |
| 11a | Building services in the store build have a real backend | VERIFIED PASS (local) | My Unit, Bills, Visitors, Deliveries, Maintenance/Housekeeping/Moving, Community, Amenities, inbox: backend tests and browser checks (REAL_BACKEND_PLAN.md) |
| 11b | Parking layout confirmed by building management | NEEDS MANUAL ACTION | Until then Parking stays out of the store build; then build with `EXPO_PUBLIC_PARKING=1` |
| 11c | Privacy answers updated for the new data | NEEDS MANUAL ACTION | Enter the new rows of PRIVACY_AND_DATA_DECLARATIONS.md §3–4 in App Store Connect and Play Console |
| 12 | Dev and preview builds unchanged | VERIFIED PASS | Visual comparison, FUNCTIONAL_TEST_REPORT.md §3 |
| 13 | Third-party AI disclosure and consent | FIXED AND VERIFIED | Wording fixed; assistant consent tested in browser |
| 14 | Assistant's AI company named | NEEDS MANUAL ACTION | Set `EXPO_PUBLIC_ASSISTANT_AI_PROVIDERS` in eas.json |
| 15 | Assistant service security (open resident list, unauthenticated `resident_id`) | FAILED / BLOCKING | Outside this repo: lock it down (SECURITY_AUDIT.md X1) |
| 16 | Medical disclaimers | FIXED AND VERIFIED | Health consent, Help & Support, summary label |
| 17 | AI results confirmed by the user before saving | VERIFIED PASS | `HealthReviewScreen` (code review); existing health checks pass |
| 18 | Reviewer demo account in a demo apartment | NEEDS MANUAL ACTION | APP_STORE_METADATA.md, review notes |
| 19 | Publisher is the healthcare service's legal entity / organization account | NEEDS MANUAL ACTION | Apple 5.1.1(ix); Google health → organization account |
| 20 | Permission to use the "Park Lane" brand | NEEDS MANUAL ACTION | Keep a letter ready |
| 21 | Real-device test of the store build (iPhone and Android) | NOT VERIFIED | Build `store-preview` and test |
| 22 | Medication reminders, IAP, subscriptions, ads, tracking | NOT APPLICABLE | None in the app |

## Apple App Store

| # | Item | Status | Evidence / action |
|---|---|---|---|
| A1 | Built with Xcode 26+ / iOS 26 SDK | VERIFIED PASS (local) | Xcode 27.2, iOS 27.2 SDK; EAS image NOT VERIFIED |
| A2 | Release build launches without crashing | FIXED AND VERIFIED (simulator) | Launch crash fixed; Release app opens on iPhone 17 / iOS 26.5 simulator |
| A3 | Store-mode Release build compiles and launches | see BUILD_VALIDATION.md | — |
| A4 | Signed archive / App Store Connect upload | NEEDS MANUAL ACTION | `eas build -p ios --profile production` with the team account and Apple credentials |
| A5 | Minimum iOS version | VERIFIED PASS | 16.4 |
| A6 | Privacy manifest / required reasons | FIXED AND VERIFIED | `ios.privacyManifests`; confirm no ITMS-91053 e-mail after upload |
| A7 | Purpose strings accurate | FIXED AND VERIFIED | Camera text corrected; unused Face ID text removed (introspect) |
| A8 | Background audio justified | VERIFIED PASS | Health summary player; explained in review notes |
| A9 | Sign in with Apple | NOT APPLICABLE | Own accounts only (4.8 exemption) |
| A10 | Export compliance answer | NEEDS MANUAL ACTION | AES used for Meross setup; French declaration if sold in France |
| A11 | App Privacy questionnaire | NEEDS MANUAL ACTION | PRIVACY_AND_DATA_DECLARATIONS.md §3 |
| A12 | Age rating (incl. new Shared Location / Dating questions, by 12 Jan 2027) | NEEDS MANUAL ACTION | APP_STORE_METADATA.md |
| A13 | Screenshots iPhone + iPad 13" | NEEDS MANUAL ACTION | From the store build |
| A14 | Support URL | NEEDS MANUAL ACTION | Required by 1.5 |
| A15 | iPad test pass | NOT VERIFIED | Run on an iPad simulator, or set `supportsTablet: false` |
| A16 | Entitlements (Hotspot Configuration, Access Wi-Fi Information) enabled on the App ID | NOT VERIFIED | EAS can sync capabilities; check in the Apple Developer portal |

## Google Play

| # | Item | Status | Evidence / action |
|---|---|---|---|
| G1 | Target API 36 | VERIFIED PASS | Read from the built `.aab`'s manifest: target 36, min 24 |
| G2 | Android App Bundle builds | VERIFIED PASS | EAS production build `f4bc8a96…` finished, 78.2 MB `.aab` (personal project's key) |
| G3 | 16 KB page support | VERIFIED PASS | 92/92 native libraries 16 KB-aligned (ELF headers) |
| G4 | Upload key / Play App Signing on the team project | NEEDS MANUAL ACTION | The test build used the personal project's key |
| G5 | Data safety form | NEEDS MANUAL ACTION | PRIVACY_AND_DATA_DECLARATIONS.md §4 |
| G6 | Health apps declaration | NEEDS MANUAL ACTION | Healthcare services and management |
| G7 | Organization developer account (health app) | NEEDS MANUAL ACTION | D-U-N-S |
| G8 | Foreground service declaration + video | NEEDS MANUAL ACTION | mediaPlayback |
| G9 | Account deletion URL in Play Console | NEEDS MANUAL ACTION | After deployment |
| G10 | Content rating (IARC), target audience, ads = no, app access | NEEDS MANUAL ACTION | — |
| G11 | Closed test 12 testers × 14 days | NEEDS MANUAL ACTION | Only for new personal accounts |
| G12 | Package registration (developer verification) | NEEDS MANUAL ACTION | `com.parklane.app` was taken on Google Play, so the app is now `com.emsiot.parklane` on Android and iOS (12 Nov 2026). Register that name when creating the app in Play Console |
| G13 | Permissions minimal and asked in context | FIXED (verify next build) | The bundle carried `SYSTEM_ALERT_WINDOW`, `USE_BIOMETRIC`, `USE_FINGERPRINT` from templates; now blocked in app.json |
| G14 | Assistant reachable on Android (underscore hostname) | NOT VERIFIED | Test on a phone |
| G15 | Store screenshots, feature graphic, 512 px icon | NEEDS MANUAL ACTION | — |
