# Privacy and data declarations

Date: 10 November 2026. These are **proposed answers**, worked out from the code. Every row marked ⚑ needs you (the
owner) to confirm it before you submit, because some data flows depend on how the servers are set up.

## 1. Where data goes

```
Phone ──HTTPS──► EMS backend (api-iot-2.ems-iot.com)
                   ├─ account, apartment, devices, audit log
                   ├─ Health Passport + clinic (encrypted at rest)
                   ├─► Google Gemini or Anthropic Claude   (document reading, summaries, clinic notes — only with consent)
                   ├─► ElevenLabs                           (speech for summaries; clinic transcription — only with consent)
                   └─► Home Assistant hub per apartment ─► device makers' clouds (brand accounts the resident links)
Phone ──HTTPS──► Parklane Assistant service (attal_voice_2.ems-iot.com) ─► its AI providers ⚑ (not named in code)
Phone ──LAN────► CUBE Gateway and devices on the home Wi-Fi (Wi-Fi name/password sent to the device to set it up)
Phone (Android) ─► Google ML Kit inside expo-camera (QR scanning on the phone; anonymous usage data to Google)
```

No analytics, advertising, crash reporting or tracking SDK is in the app.

## 2. Data inventory

| Data | Collected (leaves the phone)? | Linked to the person | Why | Kept until |
|---|---|---|---|---|
| Name, email or username | Yes | Yes | Account | Account deleted |
| Password | Yes (stored as a scrypt hash) | Yes | Sign-in | Account deleted |
| Apartment and role | Yes | Yes | Smart home access | Leaving, or account deleted |
| Device list, states, actions (e.g. door unlocked) | Yes | Yes; the audit log is anonymised on deletion | Smart home, security log | Hub data: the apartment's; log: kept anonymised |
| Brand accounts the resident links | Yes (in the apartment's hub) | The apartment | Device control | Removed in My Devices |
| Home Wi-Fi name and password | Sent to the device or gateway only during setup | — | Device setup | Not kept by the account ⚑ (confirm for server-hosted gateways) |
| Health records (profiles, allergies, medicines, labs, visits) | Yes, only with Health Passport consent | Yes | Health Passport | Deleted by the resident, consent withdrawn, or account deleted |
| Photos/PDFs of medical documents | Yes, with consent | Yes | Reading into records | Same as above |
| Spoken summaries (audio) | Yes, when asked for | Yes | For the doctor | Same as above |
| Clinic bookings, reason, consents, doctor's notes | Yes | Yes | Clinic care | Past visits are kept as medical records ⚑ (confirm the legal period with the clinic) |
| Consultation transcripts, AI drafts | Yes, only with consent | Yes | Clinic notes | 30 days after the visit is finalised |
| Assistant messages, voice, camera pictures shown | Yes, after the assistant consent | ⚑ depends on the assistant service | Answering, device control | ⚑ set by the assistant service |
| Apartment records (details, contract, bills, payments, meters, documents) | Yes (entered by building management) | Yes (the apartment) | My Unit, Bills | Kept as the building's records |
| Visitors' names, phones (optional), plates (optional), arrival; gate entries | Yes | Yes (the apartment that invited) | Visitor passes and the gate | Building's retention, 90 days by default; names and phones sealed |
| Guests' names, phones (optional), plates for parking; gate scans | Yes (when parking is on) | Yes | Guest parking and the gate | Kept as the gate's log; sealed |
| Parcels (courier, description, times) | Yes (logged by the gate) | Yes (the apartment) | Deliveries | Kept as the building's records |
| Service requests: description, photos, messages, visit time | Yes | Yes; the person's link is cleared on deletion | Maintenance, housekeeping, moving | Kept with the apartment; description, messages and photos sealed |
| Community: event registrations, poll votes, feedback and replies | Yes | Yes (votes are shown only as totals) | Community | Registrations and votes go with the account; feedback stays without the name, sealed |
| Amenity and parking bookings; vehicles (make, model, colour, plate) | Yes | Yes | Bookings | Bookings: building's records; vehicles: deleted with the account |
| In-app notifications and their settings | Yes | Yes | Inbox | 180 days; deleted with the account |
| Building readings and apartment energy | Only simulated figures for demo compounds today (no live source yet) | Demo apartments only | BMS, Smart Home energy | Not shown in the store build while simulated |
| Weather | Fetched by the server from MET Norway; nothing about the person is sent | — | Home | Cached by the server |
| Wi-Fi network name (SSID) | No (read on the phone only) | — | Checking the setup network | Not kept |
| Location | No (only the permission, for the SSID) | — | — | — |

## 3. Apple App Privacy answers (proposed)

**Does the app collect data?** Yes. **Tracking?** No (no data is linked with others' data for ads, and nothing goes to data brokers).

| Apple category → type | Collected | Linked to user | Used for tracking | Purposes |
|---|---|---|---|---|
| Contact info → Name | Yes | Yes | No | App functionality |
| Contact info → Email address | Yes | Yes | No | App functionality |
| Health & fitness → Health | Yes | Yes | No | App functionality |
| User content → Photos or videos (medical document photos; pictures shown to the assistant) | Yes | Yes | No | App functionality |
| User content → Audio data (voice to the assistant; clinic transcription with consent) | Yes | Yes ⚑ | No | App functionality |
| User content → Other user content (assistant messages, booking reason, service-request descriptions and messages, community feedback, poll votes) | Yes | Yes | No | App functionality |
| User content → Photos or videos (photos added to a service request) | Yes | Yes | No | App functionality |
| Contact info → Name, Phone number (of visitors and guests the resident enters) | Yes | Yes | No | App functionality |
| Contact info → Other user contact info (vehicle plates of the resident and their visitors) | Yes | Yes | No | App functionality |
| Purchases → none; Financial info → Payment info: amounts and receipts building management records (no card numbers) | Yes | Yes | No | App functionality |
| Identifiers → User ID (account id) | Yes | Yes | No | App functionality |
| Usage data → Product interaction (device actions log) | Yes | Yes | No | App functionality |
| Diagnostics | No ⚑ (Android-only ML Kit metrics are Google's, not in the iOS app) | — | — | — |
| Location | No | — | — | — |

## 4. Google Play Data safety answers (proposed)

- **Data collected or shared?** Yes. **Encrypted in transit?** Yes: the app's servers use HTTPS. Local device setup uses the home network. ⚑ Confirm you are comfortable answering "Yes" given that local device setup uses plain HTTP on the LAN.
- **Can people ask to delete their data?** Yes: in the app, and at `https://api-iot-2.ems-iot.com/account/delete` once deployed.
- **Shared with third parties:** No. Gemini/Claude/ElevenLabs and the assistant's AI provider act as **service providers** processing on your behalf, which Google exempts from "shared". ⚑ Confirm you have data processing terms with them.

| Data type | Collected | Shared | Optional? | Purpose |
|---|---|---|---|---|
| Personal info → Name, Email, User IDs | Yes | No | Required for an account | App functionality, account management |
| Health and fitness → Health info | Yes | No | Optional (Health Passport, clinic) | App functionality |
| Photos and videos → Photos | Yes | No | Optional | App functionality |
| Audio → Voice or sound recordings | Yes | No | Optional | App functionality |
| Messages → Other in-app messages (assistant chat; service-request messages; community feedback) | Yes | No | Optional | App functionality |
| Personal info → Phone number, Name (visitors' and guests' details the resident enters); Other info (vehicle plates) | Yes | Shared with the compound's gate staff and building management, who operate the service ⚑ (confirm this counts as "service provider", not "sharing") | Optional | App functionality |
| Photos and videos → Photos (added to a service request) | Yes | No | Optional | App functionality |
| Financial info → Purchase history: payments and bills building management records (no card details) | Yes | No | Required for owners' Bills | App functionality |
| App activity → Other user-generated content (poll votes, event registrations, bookings) | Yes | No | Optional | App functionality |
| App activity → Other actions (device actions) | Yes | No | Required for smart home | App functionality, security |
| App info and performance → Diagnostics | ⚑ ML Kit may send usage metrics to Google | — | — | Analytics (Google's) |
| Location | No (SSID read on device; location permission only for that) | — | — | — |

**Health apps declaration (Google):** "Healthcare services and management" (medical records, appointment booking);
not a medical device. **Apple medical device status (EEA, UK, US):** "No", if you choose a Health or Medical category ⚑.

## 5. Deletion and retention (what we tell users)

The in-app screen, the web page and the privacy policy all say the same thing:

- **Deleted at once:** name, email, password, sign-ins, apartment membership, Health Passport data and files, shares, invites, vehicles, the inbox and its settings, event registrations, poll votes. Upcoming clinic visits, visitor passes, amenity bookings and parking bookings the person made are cancelled.
- **Kept:**
  - the clinic's record of past visits, with no link to the person's name or email in the app;
  - the anonymised device-action log;
  - brand accounts in the apartment's hub;
  - the building's records: requests, past bookings, parcels, payments and the gate's log, with the apartment and no longer linked to the person; feedback, without the name.
- **Retention:** visitor passes after the compound's period (90 days by default); inbox messages after 180 days.
- **Backups:** ⚑ say how long server backups keep deleted data, if you keep backups.

## 6. Consent points in the app

| Where | What it says | Since |
|---|---|---|
| Create account | Link to the privacy policy | This branch |
| Health Passport onboarding | What is kept, that documents go to Google Gemini or Anthropic Claude, summaries also to ElevenLabs, sharing, deletion, not a medical device | Wording fixed in this branch |
| Spoken summary | "I agree to send this medical record to … to make a spoken summary" | This branch |
| Clinic booking | Per visit: share the record; allow AI (named providers); off by default | Names added in this branch |
| Assistant | One-time consent before first chat or call; names providers once `EXPO_PUBLIC_ASSISTANT_AI_PROVIDERS` is set ⚑ | This branch |
| OS permissions | Camera, microphone, photos, location, local network: asked at the moment of use | Existing |
