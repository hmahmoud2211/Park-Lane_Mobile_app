# Store listing text and assets

Everything here describes **only what the store build contains** (store mode): sign-in, smart home, Health Passport,
clinic booking, the assistant, account settings. Do not mention parking, visitor passes, maintenance, payments or
BMS until those parts have real backends.

Fields marked **[YOU]** need information only you have. Nothing below is invented: no phone numbers, addresses or URLs
that don't exist yet.

## Apple App Store

| Field | Proposed value | Limit |
|---|---|---|
| App name | `Parklane` | 30 characters |
| Subtitle | `Your Park Lane home, connected` (30 characters) | 30 |
| Primary category | Lifestyle | — |
| Secondary category | Utilities (avoid "Medical": it adds medical-device questions) | — |
| Privacy policy URL | `https://api-iot-2.ems-iot.com/privacy` (after the backend is deployed and LEGAL_* are set) | — |
| Support URL | **[YOU]** A web page with a way to contact you. Apple requires one (guideline 1.5) | — |
| Marketing URL | optional | — |
| Copyright | **[YOU]** e.g. "2026 <legal company name>" | — |
| Age rating | Answer the questionnaire honestly. Likely: medical or treatment information *infrequent*; no user-generated content shared publicly; no web browsing; **Shared location: No**; **Dating: No** (new questions due 12 Jan 2027) | — |
| Price | Free | — |
| Export compliance | **[YOU]** see APPLE_APP_STORE_AUDIT.md §1 | — |

**Keywords (100 characters):**
`smart home,residents,compound,health records,clinic,doctor,assistant,devices,AC,lights,Park Lane`

**Description:**

> Parklane is the resident app for the Park Lane compound in the New Capital.
>
> SMART HOME
> • See and control your apartment's lights, air conditioning, curtains and other connected devices.
> • Add new devices through your apartment's CUBE Gateway or your device maker's account.
>
> HEALTH PASSPORT
> • Keep your family's medical records in one place: allergies, medicines, conditions, lab results and visits.
> • Photograph a medical document and Parklane suggests the items it contains. You check and confirm each one before
>   it is saved.
> • Play your doctor a spoken summary of the record, in English or Arabic.
> • Share a record with family members who live in your apartment.
>
> CLINICAL APPOINTMENTS
> • Book a visit with a doctor at the compound's clinic, and choose what the doctor may see.
>
> PARKLANE ASSISTANT
> • Ask questions and control your devices by chat or voice, in Arabic or English.
>
> Parklane is for Park Lane residents. Sign in with the account building management gives you, or create one.
> Parklane does not give medical advice and is not a medical device. Always ask a doctor or pharmacist before making
> a medical decision.

**Promotional text (170 characters):**
`Control your Park Lane home, keep your family's medical records together, and book the compound's clinic — all in one app.`

**What's new (1.0.0):** `First release.`

### Review notes (App Review Information, under 4,000 bytes)

> Parklane is the resident app of the Park Lane residential compound. It is published by [YOU: legal entity], which
> runs the compound's smart-home service, with the permission of [YOU: compound operator / clinic], attached.
>
> Demo account (does not expire, belongs to a demo apartment with sample devices):
> Username: [YOU]   Password: [YOU]
>
> Please do not use the public account "ems" / "5002" for review: it is shared and has no apartment.
>
> How to see each feature:
> 1. Smart home: Home → Smart Home. Tap a light or the AC to change it. My Devices (Settings) lists every device.
> 2. Health Passport: Home → Health Passport. Agree to the data-use terms (they name the AI services used). Add an
>    allergy by hand. "Upload a document" reads a photo with AI. Nothing is saved until you confirm each item.
> 3. Spoken summary (uses background audio): Health Passport → Summary → choose a language → agree → Generate. Press
>    Play, then lock the phone: the summary keeps playing, with lock-screen controls. This is the only use of the
>    audio background mode.
> 4. Clinic: Home → Clinic → choose a doctor and a time. AI help for the visit is optional and off by default.
> 5. Assistant: the "EMS AI" tab. A consent screen names the AI service before the first message.
> 6. Account deletion: Settings → Account & security → Delete account. To try it without losing the demo account,
>    create a new account on the sign-in screen ("Create account"), then delete that one. The demo account itself is
>    protected from deletion and password changes, so other reviewers can use it.
> 7. Privacy policy: Settings → Privacy Policy.
>
> Device setup on the home Wi-Fi (camera, local network and location permissions) needs physical devices in a
> Park Lane apartment. Location is used only to read the Wi-Fi network name during device setup; it is never stored.
>
> Contact during review: [YOU: name, phone, email]

## Google Play

| Field | Proposed value | Limit |
|---|---|---|
| App name | `Parklane` | 30 |
| Short description | `Your Park Lane home, health records and clinic, in one resident app.` (69) | 80 |
| Full description | Same text as Apple's description above | 4,000 |
| Category | Lifestyle | — |
| Contact email | **[YOU]** (required, shown publicly) | — |
| Privacy policy | `https://api-iot-2.ems-iot.com/privacy` | — |
| Account deletion URL | `https://api-iot-2.ems-iot.com/account/delete` | — |
| App access | Give the same reviewer account and the steps above | — |
| Ads | No | — |
| Target audience | 18 and over | — |
| Health apps declaration | Healthcare services and management; not a medical device | — |
| Foreground service declaration | `mediaPlayback`: "The resident's spoken health summary keeps playing when the screen locks or they switch apps; playback starts only when they press Play." Plus a short screen recording **[YOU]** | — |
| Release notes | `First release.` | 500 |

## Assets

| Asset | Required size | We have | Status |
|---|---|---|---|
| App icon (Apple) | 1024×1024, no transparency | `frontend/assets/icon.png`: 1024×1024, no alpha | OK |
| Adaptive icon (Android) | foreground/background/monochrome 1024×1024 | present in `frontend/assets` | OK |
| Play store icon | 512×512 PNG | not in the repo | **[YOU]** export from icon.png |
| Feature graphic (Play) | 1024×500 | none | **[YOU]** |
| iPhone screenshots | at least one 6.3–6.9" set, e.g. 1206×2622 or 1320×2868 | none from the store build | **[YOU]** capture from the `store-preview` build on a phone, or the iPhone 17 simulator (gives 1206×2622) |
| iPad screenshots | 13-inch: 2064×2752 or 2048×2732 (the app supports iPad) | none | **[YOU]** or set `supportsTablet: false` |
| Android phone screenshots | 2–8, 16:9 or 9:16, min 320 px | none | **[YOU]** |
| Launch screen | — | plain dark screen (no logo) | OK; optional polish: add `expo-splash-screen` with `assets/splash-icon.png` |

Screenshots must come from the real store build, signed in with the demo account, and show real screens only.
