# Apple App Store audit — Parklane 1.0.0

Date: 10 November 2026 · Branch: `release/store-readiness-2026-11` (from Master `7a1f4bb`) · App: `com.parklane.app`

This audit checks the iPhone and iPad app against Apple's rules as they are today. Every rule was read from Apple's
own pages on 10 November 2026 (App Review Guidelines "Last updated October 16, 2026"). Nothing here promises approval.

**Status words used here:** *Fixed* (changed in this branch and checked), *OK* (already met, checked), *Owner* (only you
can do it: an account, a console or a legal decision), *Open* (a known problem left in place), *Not verified*.

---

## 1. Platform requirements

| Requirement (Apple source) | What the project has | Status |
|---|---|---|
| Builds must use Xcode 26+ and the iOS 26 SDK (since 28 Apr 2026, [Upcoming requirements](https://developer.apple.com/news/upcoming-requirements/)) | Built here with **Xcode 27.2, iOS 27.2 SDK**. EAS uses its own Xcode image for SDK 58 | OK locally; EAS image *Not verified* |
| From April 2027: iOS 27 SDK and minimum iOS 15 ([submitting](https://developer.apple.com/app-store/submitting/)) | Minimum iOS **16.4** (generated project) | OK |
| Privacy manifest and required-reason APIs (since 1 May 2024) | Expo merges library manifests (`apple.privacyManifestAggregationEnabled`). The merge missed `expo-file-system`'s DiskSpace reason, so `app.json → ios.privacyManifests` now declares UserDefaults CA92.1, FileTimestamp C617.1/3B52.1, SystemBootTime 35F9.1, DiskSpace E174.1 | **Fixed** |
| Export compliance (`ITSAppUsesNonExemptEncryption`) | Not set. The app uses HTTPS **and** its own AES code (`@noble/ciphers`) to set up Meross devices. Apple counts "industry standard algorithm not provided by the OS" as needing a French declaration if you sell in France | **Owner** (legal answer; see §6) |
| Launch, no crash (2.1) | First Release build **crashed at launch** (`dyld: Symbol not found … ExpoImageManipulator`, mismatched Expo package versions). Fixed with `npx expo install --fix`; the rebuilt Release app opens on an iPhone 17 simulator (iOS 26.5) | **Fixed** (simulator only) |
| Purpose strings (5.1.1) | Camera text mentioned scanning parking passes, which the store build doesn't have; rewritten. The unused default Face ID text from `expo-secure-store` is removed (`faceIDPermission: false`) | **Fixed** |
| Background audio (2.5.4) | `UIBackgroundModes: audio` is used by a real feature: Health Passport's spoken summary keeps playing with lock-screen controls (`SummaryPlayer.tsx`) | OK — tell the reviewer how to reach it (§7) |
| iPad (`supportsTablet: true`) | Responsive layouts exist (side rail, columns). Needs a 13-inch iPad screenshot and an iPad test pass | **Owner** / *Not verified on iPad* |
| Sign in with Apple (4.8) | Not required: the app uses only its own accounts ("exclusively uses your company's own account setup") | OK (not applicable) |

## 2. App completeness and honesty (2.1, 2.2, 2.3, 2.5.19)

Before this work, a store build showed:

- the same made-up resident ("Ahmed Hassan, Unit A-302") to everyone;
- generated contract and receipt PDFs for that person;
- forms that said "submitted" or "booked" but sent nothing (maintenance, community feedback, amenities, visitor passes);
- a parking demo with "Demo controls" and a test runner;
- 12 "Coming soon" pages;
- two login buttons that did nothing (Biometric, Forget Password).

Apple rejects demos (2.2), placeholders (2.1) and hidden features (2.5.19, new in October 2026). A resident could also
think a water-leak report reached management when it did not.

**What changed (Fixed, checked in a real browser; see FUNCTIONAL_TEST_REPORT.md):**

- **Store mode.** `EXPO_PUBLIC_STORE_MODE=1` is set in `eas.json → production` (and in a new `store-preview` APK profile). In store mode:
  - every sample-data screen is left out of the app binary: My Unit, Visitor Access, Maintenance, Parking and its 7 sub-screens, Community, Amenities, BMS, Demo controls, Security console. The bundler removes them (`navigation/sampleScreens.tsx`); a scan of the store bundle finds none of their made-up names, receipts or links;
  - Home and Profile show the signed-in person (or "Guest"); Home shows only Smart Home, Health Passport, Clinic and EMS AI;
  - Smart Home shows only a real home; guests and accounts without a home go to My Devices, which offers sign-in. Its sample Scenes, Energy and Automations panels are hidden;
  - Settings, Services and Profile list only rows that open something real.
- **Development and preview builds keep everything**, unchanged (see the visual comparison in FUNCTIONAL_TEST_REPORT.md).
- "Forget Password?" is now **"Forgot password?"** and explains the real reset (building management issues a temporary password, which the app makes the resident change). "Biometric" is hidden in store mode.
- "Contact Us", "Help & Support" and "Security" now open real screens.
- Developer text residents could see ("docker ps", "docker logs …", "Install the CUBE OS phone app build (Expo Go…)") is rewritten.

**Still a risk (Open):** the store build is smaller than the full app. Guideline 4.2 (minimum functionality) should be
fine: smart-home control, medical records with AI reading, clinic booking and an assistant are substantial. But the
reviewer must be able to see them working (§7).

## 3. Accounts (5.1.1(v))

| Check | Status |
|---|---|
| Account creation in the app | OK (`Create account` on Login) |
| Account deletion **inside the app** | **Fixed**: Settings → Account & security → Delete account. Password plus an "I understand" switch; says what is deleted and what is kept; signs out at the end |
| Deletion really deletes | **Fixed and tested**: `POST /api/auth/delete-account` removes sign-ins (and live connections), apartment membership, Health Passport data and files, invites; cancels upcoming clinic visits; keeps past clinic visit records with an anonymous account row (medical-record retention, explained to the user). 6 backend tests + browser test |
| Deletion works on the **production server** | **Owner**: the backend change is not deployed yet. Until it is, the button answers "Not found" (§8 of RELEASE_READINESS_REPORT.md) |
| Shared demo account can't be broken by reviewers | **Fixed**: `ems` / `5002` cannot change its password, sign out others or be deleted (403 with an explanation) |

## 4. Privacy (5.1.1, 5.1.2, 5.1.3)

| Check | Status |
|---|---|
| Privacy policy inside the app | **Fixed**: Settings → Privacy Policy, Help & Support, the Create-account screen, and the assistant's consent screen open it |
| Privacy policy URL for App Store Connect | **Fixed in code / Owner**: the backend serves `/privacy` (e.g. `https://api-iot-2.ems-iot.com/privacy` after deployment). It shows a "Draft" notice until `LEGAL_OPERATOR_NAME` and `LEGAL_CONTACT_EMAIL` are set. The text is written from the code's real data flows, and **needs your legal review** |
| Third-party AI: disclose and get explicit permission (5.1.2(i), since 13 Nov 2025) | **Fixed**: (1) Health Passport's consent wrongly said AI ran "on Parklane's own servers"; it now names Google Gemini or Anthropic Claude, and ElevenLabs, in English and Arabic, and the checkbox covers sending to them. (2) The spoken-summary consent names them. (3) The clinic's AI opt-in names them. (4) The Assistant now shows a consent screen before the first message or call |
| Assistant provider named | **Owner**: the assistant service is outside this repository, and its AI company isn't recorded anywhere. Set `EXPO_PUBLIC_ASSISTANT_AI_PROVIDERS` (e.g. "OpenAI") in `eas.json` so the consent screen names it |
| Health data not in iCloud, not for ads (5.1.3) | OK: no iCloud, no ads, no analytics. Tokens are in the Keychain (this device only) |
| Tracking / ATT | Not applicable: no tracking, no advertising ID |

## 5. Medical rules (1.4.1, 5.1.1(ix))

- **OK:** the AI never writes to a record. Each extracted item waits for the resident to confirm it. Low-confidence items and possible duplicates are flagged. Doses carry a warning to compare with the original (`HealthReviewScreen`). Names are not sent to the AI.
- **Fixed:** the app now says, in Health Passport's consent and in Help & Support, that it is not a medical device, does not diagnose or treat, that AI can be wrong, and to ask a doctor or pharmacist. Spoken summaries are labelled "AI-generated … not medical advice".
- **Owner — high risk:** guideline **5.1.1(ix)** says apps in *highly regulated fields such as healthcare* "should be submitted by a legal entity that provides the services". The clinic and the compound are not EMS. Expect Apple to ask who runs the clinic. Options: publish under the compound operator's developer account; attach written authorization from the clinic/compound in the review notes; or ship v1 without the clinic and health features.
- There are no medication reminders or notifications in this app, so reminder-timing rules don't apply.

## 6. Intellectual property and business (5.2, 3.1, 3.2)

- **Owner:** the name and logo "Park Lane" belong to the compound's developer. If EMS publishes, keep written permission ready (5.2.1).
- No in-app purchases, and no payments in the store build (payments were sample screens). 3.1.3(e) would allow outside payment for building services later.
- **Distribution:** the app only works for Park Lane residents. Apple has no rule against that if the reviewer gets a working account. **Unlisted distribution** (direct link only, normal review) fits a single compound well: https://developer.apple.com/support/unlisted-app-distribution/.

## 7. What the reviewer needs (2.1)

- A **dedicated reviewer account** that doesn't expire, isn't the public `ems` account, and is a member of a demo apartment that has devices (the backend has a stand-in hub, `npm run fake-hub`). Create it through the app's own **Create account**, so there is no forced password change. Then add it to the demo apartment from the admin dashboard.
- The production backend must be up during review. It answered on 10 November 2026: `/api/home` gave 401 without sign-in, as it should.
- Review-notes text is in APP_STORE_METADATA.md.

## 8. Reviewer simulation (as Apple App Review)

| # | What a reviewer could see or ask | Evidence | Likelihood before → now | Fixed? | Left for you |
|---|---|---|---|---|---|
| 1 | App crashes on launch | crash report, `dyld Symbol not found` | Certain → Low | Yes (rebuilt, launches) | Re-test the EAS build on a real iPhone |
| 2 | Placeholder / "Coming soon" pages, demo data | 12 placeholder rows, fake resident | Very high → Low | Yes (store mode) | — |
| 3 | No account deletion | no endpoint | Certain → Low | Yes | Deploy the backend |
| 4 | Privacy policy missing | none in app | Certain → Low | Yes | Set operator + contact, review text, deploy |
| 5 | Third-party AI without consent | wrong consent text, no assistant consent | High → Low | Yes | Name the assistant's AI company |
| 6 | Healthcare app not from the provider (5.1.1(ix)) | publisher is EMS | Medium–high | No (not code) | Decide the publisher; authorization letter |
| 7 | Login needed, no demo account | — | Certain → Low | — | Create the reviewer account and demo apartment |
| 8 | Background audio misuse | used by summaries | Low | — | Explain in notes |
| 9 | Brand ownership (Park Lane) | — | Medium | No | Permission letter |
| 10 | iPad layout problems | not tested on iPad | Unknown | — | Test on an iPad simulator; or set `supportsTablet: false` |
| 11 | Missing required-reason declarations (ITMS-91053) | merge missed DiskSpace | Medium → Low | Yes | Watch the upload e-mail |
| 12 | Export compliance prompt | key not set | Certain prompt | — | Answer in App Store Connect |

**Apple verdict:** NOT READY. See RELEASE_READINESS_REPORT.md for the short path to "conditionally ready".
