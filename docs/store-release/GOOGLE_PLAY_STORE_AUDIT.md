# Google Play audit — Parklane 1.0.0

Date: 10 November 2026 · Branch: `release/store-readiness-2026-11` · Package: `com.emsiot.parklane` (was
`com.parklane.app` when this audit ran; renamed on 12 November 2026 because Google Play reported that name taken)

Rules were read from Google's own pages on 10 November 2026 (Play Console Help and the Developer Policy Center).
Status words: *Fixed*, *OK*, *Owner* (an account, console or legal step only you can do), *Open*, *Not verified*.

---

## 1. Technical requirements

| Requirement | Project | Status |
|---|---|---|
| Target API 36 (Android 16) for new apps and updates, since 31 Aug 2026 ([answer 11926878](https://support.google.com/googleplay/android-developer/answer/11926878)) | React Native 0.88 defaults: **targetSdk 36**, compileSdk 37, minSdk 24 (`react-native/gradle/libs.versions.toml`) | OK (confirm in the EAS build log, BUILD_VALIDATION.md) |
| 16 KB memory pages: updates that don't support them are blocked from 1 Feb 2027 ([page sizes](https://developer.android.com/guide/practices/page-sizes)) | RN builds its native code with `ANDROID_SUPPORT_FLEXIBLE_PAGE_SIZES=ON`, NDK 27.1 | See BUILD_VALIDATION.md (checked on the built bundle) |
| Android App Bundle | `eas.json → production` builds an `.aab` (store distribution) | OK |
| Play App Signing | Google enrolls new apps automatically; EAS holds the upload key | **Owner** (team project credentials) |
| Package registration (developer verification), from 30 Sep 2026 ([answer 16984799](https://support.google.com/googleplay/android-developer/answer/16984799)) | Not visible from the repo | **Owner**: check `com.emsiot.parklane` is registered to your developer account |

## 2. Permissions (what the build asks for)

From `npx expo config --type introspect` and the libraries' manifests:

| Permission | Why | Status |
|---|---|---|
| CAMERA | QR codes for devices, Health Passport photos, showing things to the assistant | OK, asked at the moment of use |
| RECORD_AUDIO, MODIFY_AUDIO_SETTINGS | Voice conversation with the assistant | OK, asked when you press Start |
| ACCESS_FINE_LOCATION, ACCESS_COARSE_LOCATION | Reading the Wi-Fi name during device setup (Android requires location for that) | OK, foreground only, asked only in device setup |
| NEARBY_WIFI_DEVICES | Joining a device's setup Wi-Fi on Android 13+ | OK, asked only in device setup |
| FOREGROUND_SERVICE, FOREGROUND_SERVICE_MEDIA_PLAYBACK | The spoken health summary keeps playing in the background, with controls | OK — **Owner**: needs the Foreground service declaration and a short video in Play Console |
| READ/WRITE_EXTERNAL_STORAGE (max SDK 32) | Added by `expo-image-picker` and `expo-file-system`, only for Android 12 and older | OK (no READ_MEDIA_IMAGES; photos use the system Photo Picker) |
| INTERNET, Wi-Fi/network state | Standard | OK |

**Cleartext HTTP** (`usesCleartextTraffic: true`) is needed to set up and control devices on the home network
(Shelly, SONOFF, Meross setup hotspots, a gateway on the LAN). The app's own servers use HTTPS. Android can't limit
cleartext to private IP ranges, so this stays. Mention it in Data safety: data to our servers is encrypted in transit.

## 3. Policies

| Policy | Status |
|---|---|
| **Account deletion** in the app and on the web ([answer 13327111](https://support.google.com/googleplay/android-developer/answer/13327111)) | **Fixed**: in the app (Settings → Account & security → Delete account), and the web page `/account/delete` on the backend. **Owner**: deploy the backend, then enter `https://api-iot-2.ems-iot.com/account/delete` in Play Console |
| **Privacy policy** (User Data policy) | **Fixed in code**: `/privacy` on the backend, linked inside the app. **Owner**: set `LEGAL_OPERATOR_NAME` / `LEGAL_CONTACT_EMAIL`, have it reviewed, deploy |
| **Data safety form** | Proposed answers in PRIVACY_AND_DATA_DECLARATIONS.md. Health info, photos, audio and messages are collected; Gemini/Claude/ElevenLabs act as service providers |
| **Health apps declaration** (required for every app, since 31 Aug 2024; [answer 14738291](https://support.google.com/googleplay/android-developer/answer/14738291)) | **Owner**: declare "Healthcare services and management" (medical records, appointment booking). The disclaimer Google asks for ("not a medical device … consult a healthcare professional") is now in the app |
| **Organization account for health apps** ([answer 13634885](https://support.google.com/googleplay/android-developer/answer/13634885)) | **Owner — blocking if your account is personal**: medical apps need an organization developer account (D-U-N-S number) |
| **12 testers for 14 days** (personal accounts made after 13 Nov 2023; [answer 14151465](https://support.google.com/googleplay/android-developer/answer/14151465)) | **Owner**, if the account is personal |
| **AI-generated content** (chatbot, AI summaries; [answer 14094294](https://support.google.com/googleplay/android-developer/answer/14094294)) | **Required. Fixed**: a "Report" button (flag icon) under every assistant answer in chat, under each spoken reply in voice mode, under Health Passport's spoken summaries and on the AI's reading of a document (review and document screens). It opens an in-app sheet (four reasons, optional note), works for guests too, and sends `POST /api/ai-reports`; building management reads them on the dashboard's **AI reports** tab. Code: `frontend/src/features/aiReports`, `backend/src/routes/aiReports.ts`. **Owner**: deploy the backend, then check reports on the dashboard regularly |
| Deceptive behaviour | **Fixed** with store mode: no form claims a request was sent when it wasn't |
| Ads / advertising ID | Not applicable: no ads, no AD_ID permission found |
| Target audience | **Owner**: 18+ (residents); not for children |
| Content rating (IARC) | **Owner**: questionnaire in Play Console |
| App access (login) | **Owner**: give the reviewer account (see APP_STORE_METADATA.md) |

## 4. Reviewer simulation (as Google Play policy and quality review)

| # | What review could flag | Evidence | Before → now | Fixed? | Left for you |
|---|---|---|---|---|---|
| 1 | No account deletion / no web deletion link | no endpoint | Certain → Low | Yes | Deploy; enter the URL |
| 2 | Misleading functionality (forms that send nothing) | store-mode scan | High → Low | Yes | — |
| 3 | Health app from a personal account | — | Blocking if personal | No | Organization account |
| 4 | Health declaration missing | — | Certain | — | Fill it in |
| 5 | Data safety doesn't match the app | the app sends health data to AI | High → Low | Wording fixed | Fill the form as proposed |
| 6 | Foreground service without declaration | mediaPlayback | Certain prompt | — | Declaration and video |
| 7 | Login-restricted, no access details | — | Certain | — | Reviewer account |
| 8 | Unnecessary permissions | storage for old Android only | Low | — | — |
| 9 | Pre-launch report crashes | the iOS launch crash came from package versions; Android was not shown to crash | Unknown | Versions aligned | Check the pre-launch report |
| 10 | Target API / 16 KB | API 36; see BUILD_VALIDATION.md | Low | — | — |

**Google Play verdict:** NOT READY. See RELEASE_READINESS_REPORT.md.
