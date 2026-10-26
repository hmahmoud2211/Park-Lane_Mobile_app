# Alexa integration (EMS Voice Control)

The EMS app and the **EMS Voice Control** Alexa skill switch the same devices through one backend. This document explains how the pieces fit, what you have to configure at Amazon and on the backend, how to test it, and what is and is not verified yet.

> EMS Voice Control is a **Custom Skill**. Customers talk to it by name ("Alexa, open EMS assistant" / «أليكسا، افتحي مساعد إدارة المنزل»). Devices do **not** appear in the Alexa app's Devices list, and Alexa routines cannot see them. That needs a Smart Home skill, which is a separate project.

## 1. How it works

```text
 EMS app ──HTTPS──▶ EMS backend (server/) ──▶ device controller ──▶ adapter ──▶ device
                     │  accounts, registry (SQLite)           virtual │ sonoff-lan
                     │  WebSocket /api/events ◀── every change        │
 Alexa / Echo ──▶ EMS Voice Control skill (alexa/lambda, Alexa-hosted, EU)
                     └─HTTPS POST /api/voice/command (customer's EMS token)─▶ same controller
```

- **One controller.** App taps (`POST /api/devices/:id/power`) and voice commands (`POST /api/voice/command`) both call `setPower` in `server/src/ems/devices.ts`. It records the request as `pendingPower`, waits for the adapter to confirm, and only then stores `power`. A failed or timed-out command keeps the last confirmed state, marks the device offline, and stores the reason.
- **Realtime.** Every change (from the app, from Alexa, or from the plug's own button for SONOFF) is pushed over the WebSocket `GET /api/events` to all of the owner's open app sessions. The app reconnects with exponential back-off (1 s up to 30 s), re-reads the list after reconnecting, and reconnects as soon as it returns to the foreground. Nothing polls on a timer.
- **No CUBE dependency.** The registry, controller, adapters, OAuth server and linking don't touch the CUBE hub. The old CUBE routes are still there (now under `/api/cube/…`) for the existing Smart Home screen.

### Code map

| Area | Files |
| --- | --- |
| Backend router | `server/src/app.ts` (routes), `server/src/index.ts` (startup) |
| Accounts and tokens | `server/src/ems/auth.ts`, `secrets.ts` (scrypt passwords, hashed tokens, AES-GCM sealing) |
| Database | `server/src/ems/db.ts` (SQLite `DATA_DIR/ems.db`, versioned migrations) |
| Registry and controller | `server/src/ems/devices.ts`, adapters in `server/src/ems/adapters/` |
| Realtime | `server/src/ems/realtime.ts` (dependency-free WebSocket), `events.ts` |
| Voice API | `server/src/ems/voice.ts` (Arabic and English name matching, rooms, ambiguity, default device) |
| OAuth server for Alexa | `server/src/ems/oauth.ts` (`/oauth/authorize`, `/oauth/token`) |
| App-initiated linking | `server/src/ems/alexaLink.ts` (Login with Amazon, Skill Enablement API) |
| App | `src/context/EmsContext.tsx`, `src/services/ems/*`, `src/hooks/useEmsDevices.ts`, `src/hooks/useAlexaIntegration.ts`, `src/screens/EmsDevicesScreen`, `src/screens/AlexaIntegrationScreen`, `src/components/ems/*` |
| Skill | `alexa/lambda/index.js`, `speech.js`, `emsClient.js`, `config.js`; models in `alexa/skill-package/interactionModels/custom/` |
| Tests | `server/test/ems.test.ts`, `server/test/voice.test.ts` |

### Backend API (EMS)

Every response is `{ ok: true, data }` or `{ ok: false, error: { code, message } }`.

| Method and path | Auth | Purpose |
| --- | --- | --- |
| `POST /api/auth/register` · `/login` | none (rate limited) | `{ email, password, name? }` → `{ user, token }` |
| `POST /api/auth/logout` · `GET /api/auth/me` | session | |
| `GET /api/devices` · `POST /api/devices` | session | List; create `{ name, room?, type, protocol: 'virtual' }` or `{ …, protocol: 'sonoff-lan', sonoff: { deviceId, deviceKey } }` |
| `GET` · `PATCH` · `DELETE /api/devices/:id` | session | `PATCH { name?, room?, alexaEnabled?, isDefault?, online? }` (`online` only for virtual switches) |
| `POST /api/devices/:id/power` | session | `{ power: 'on' \| 'off' }`. Resolves with the **confirmed** device, or fails with `device_offline`, `device_unreachable` or `command_timeout` |
| `GET /api/integrations/alexa/status[?refresh=1]` | session | Link status; re-checked with Amazon at most once a minute unless `refresh=1` |
| `POST /api/integrations/alexa/link/start` | session | `{ url }`: the Login with Amazon page to open |
| `GET /alexa/link/callback` | `state` | Where Login with Amazon returns the browser (this is the "link callback" step) |
| `POST /api/integrations/alexa/unlink` | session | Disables the skill at Amazon and revokes Alexa's EMS tokens |
| `GET /api/events` | first message `{type:'auth', token}` | WebSocket: `device`, `device_removed`, `alexa` events |
| `POST /api/voice/command` | Alexa's EMS access token | `{ action: 'on'\|'off'\|'status', device?, room? }` → `{ outcome, … }` |
| `GET`/`POST /oauth/authorize`, `POST /oauth/token` | client credentials | Account linking (Authorization Code grant, PKCE supported, refresh tokens rotate) |

Ownership is enforced on every device route: another user's device answers exactly like a missing one (`404`).

## 2. Connecting Alexa without the Alexa app

This uses Amazon's **app-to-app account linking starting from your app**, with the **Login with Amazon (LWA) web fallback**. No Alexa app, and no embedded Amazon form.

1. In the EMS app: **Settings → Alexa** (or Smart Home menu → Alexa). The user signs in to their EMS account if they haven't.
2. They tap **Connect to Alexa**. The app asks `POST /api/integrations/alexa/link/start`. The backend stores a single-use `state` (10 minutes) and a PKCE verifier, and returns `https://www.amazon.com/ap/oa?client_id=<Alexa Client ID>&scope=alexa::skills:account_linking&response_type=code&redirect_uri=<EMS_PUBLIC_URL>/alexa/link/callback&state=…&code_challenge=…&code_challenge_method=S256`.
3. The app opens it with `expo-web-browser`, Amazon's own page in the system browser. The user signs in to Amazon and approves.
4. LWA redirects to `GET /alexa/link/callback?code&state`. The backend:
   - checks and deletes the `state` (protects against CSRF and replay);
   - exchanges Amazon's code at `https://api.amazon.com/auth/o2/token` with the PKCE verifier;
   - asks `GET https://api.amazonalexa.com/v1/alexaApiEndpoint` for the user's region (falling back to NA, EU and FE in turn);
   - issues a single-use EMS authorization code bound to its own PKCE challenge;
   - calls `POST {region}/v1/users/~current/skills/{skillId}/enablement` with `{ stage, accountLinkRequest: { redirectUri, authCode, type: 'AUTH_CODE', authCodeVerifier } }`.
5. Amazon redeems the EMS code at `/oauth/token` and receives an EMS access token (1 hour) and refresh token, which only work for the voice API.
6. The link is recorded as **linked only if** the Enablement API answers `accountLink.status: "LINKED"`. Amazon's tokens are stored sealed (AES-256-GCM) for status checks and unlinking.
7. The browser is sent to `parklane://alexa-link?result=linked|cancelled|failed`. The app closes the browser and re-reads the status from the backend. The user sees "Connected" only when the backend says so.

**Status and unlinking.**
- **Status:** a status check asks Amazon whether the skill is still enabled. If the user disabled it in their Amazon account, the link turns "Not connected" and Alexa's EMS tokens are revoked. If Amazon no longer accepts the stored authorization, the status is "Authorization expired" and the screen offers **Connect again**.
- **Unlink:** **Disconnect Alexa** calls `DELETE …/enablement` and always revokes Alexa's EMS tokens, even when Amazon cannot be reached.

Linking from the Alexa app's skill page also works. That path uses the `/oauth/authorize` sign-in page. In that case the app shows "Linked from the Alexa app", and disconnecting revokes EMS access but cannot disable the skill at Amazon, because the backend holds no Amazon token for that user.

## 3. Amazon developer console settings

In the developer console, open **EMS Voice Control → Build**.

**Skill ID.** Copy it into `ALEXA_SKILL_ID`.

**Tools → Account Linking:**

| Setting | Value |
| --- | --- |
| Do you allow users to create an account or link to an existing account with you? | On |
| Allow users to enable skill without account linking | Off (recommended) |
| Allow users to link their account to your skill from within your application or website | **On**. Copy the **Alexa Client ID** and **Alexa Client Secret** shown into `ALEXA_LWA_CLIENT_ID` / `ALEXA_LWA_CLIENT_SECRET` |
| Your Redirect URLs (app-to-app section) | `https://api-iot.ems-iot.com/alexa/link/callback` (`EMS_PUBLIC_URL` + `/alexa/link/callback`) |
| Security provider / grant | Auth Code Grant |
| Your Web Authorization URI | `https://api-iot.ems-iot.com/oauth/authorize` |
| Access Token URI | `https://api-iot.ems-iot.com/oauth/token` |
| Your Client ID | `ems-alexa` (must equal `ALEXA_OAUTH_CLIENT_ID`) |
| Your Secret | a random secret (`openssl rand -base64 32`), the same as `ALEXA_OAUTH_CLIENT_SECRET` |
| Your Authentication Scheme | HTTP Basic (recommended); credentials in the request body also work |
| Scope | `devices` |
| Default Access Token Expiration Time | leave empty (the backend returns `expires_in: 3600`) |
| **Alexa Redirect URLs** (listed at the bottom of the page) | copy all of them, comma separated, into `ALEXA_REDIRECT_URIS` |

**Interaction model.**
- **What to paste:** for **Arabic (SA)** and **English (US)**, open **Interaction Model → JSON Editor** and paste `alexa/skill-package/interactionModels/custom/ar-SA.json` and `en-US.json`. Then **Save** and **Build**.
  - The models keep `TurnOnIntent` and `TurnOffIntent`, add optional `device` (`DEVICE_NAME`) and `room` (`ROOM_NAME`) slots and a `DeviceStatusIntent`, and keep your Arabic invocation name «مساعد إدارة المنزل».
  - The English invocation name in the file is `e. m. s. assistant`. If yours is different, change `invocationName` before pasting.
- **Custom slot values:** a custom slot type also passes through words that aren't in its list, so names like "desk lamp" reach the backend even when they're not listed. Adding the names your customers actually use as values or synonyms improves recognition.

**Code tab (Alexa-hosted).**
- Replace `lambda/index.js` and add `speech.js`, `emsClient.js` and `config.js` from `alexa/lambda/`.
- Make sure `package.json` lists `ask-sdk-core`.
- Set `EMS_API_URL` in `config.js` if your backend isn't at `https://api-iot.ems-iot.com`.
- **Deploy.**

I didn't have your current `index.js`. The new one keeps the same intent names and the Arabic welcome you described, but replaces the simulated replies with real backend calls. If your version has other handlers you rely on, merge them in.

**Certification.** While the skill is in development, app-initiated linking works for the developer's Amazon account and beta testers. Set `ALEXA_SKILL_STAGE=live` once the skill is certified and published.

## 4. Backend settings

Set these in `server/.env` or the host's environment. `server/.env.example` lists them all with comments; none of the values are real.

| Variable | What it is |
| --- | --- |
| `EMS_PUBLIC_URL` | Public HTTPS base URL, e.g. `https://api-iot.ems-iot.com`. Linking is disabled until set |
| `EMS_ENCRYPTION_KEY` | 32 random bytes, base64. Seals Amazon tokens and plug keys. Auto-generated into `DATA_DIR/ems.key` if unset; set it explicitly in production |
| `ALEXA_SKILL_ID`, `ALEXA_SKILL_STAGE` | From the console; stage is `development` until certified |
| `ALEXA_LWA_CLIENT_ID`, `ALEXA_LWA_CLIENT_SECRET` | The console's "Alexa Client ID / Secret" (app-to-app section) |
| `ALEXA_OAUTH_CLIENT_ID`, `ALEXA_OAUTH_CLIENT_SECRET` | "Your Client ID / Secret" in Account Linking |
| `ALEXA_REDIRECT_URIS` | The console's Alexa Redirect URLs |
| `APP_RETURN_URL` | `parklane://alexa-link` (the app's scheme is set in `app.json`) |
| `TRUST_PROXY` | `1` only behind a reverse proxy that overwrites `X-Forwarded-For` |
| `DEV_VOICE_TOKEN`, `DEV_VOICE_USER_EMAIL` | **Development only** (see section 7). Ignored when `NODE_ENV=production` |

**Hosting requirements.**
- **HTTPS endpoint:** Amazon and the skill must reach `EMS_PUBLIC_URL` over HTTPS.
- **WebSocket upgrades:** the proxy in front must forward them on `/api/events`. For nginx: `proxy_http_version 1.1; proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade";`. Cloudflare Tunnel forwards them by default.
- **Persistent storage:** `DATA_DIR` must survive restarts and deploys. It holds `ems.db`, `ems.key` and `sonoff.json`.
- **What to expose publicly:** only the EMS backend. CUBE, plugs and other LAN equipment are never exposed, and no request can make the backend contact an address a client supplied. Device addresses come only from LAN discovery.

## 5. Registering and controlling devices

In the app: **Settings → My Devices** (or Smart Home menu → My Devices).

- **Virtual switch:** **Add → Virtual switch**, then a name, an optional room and a type. It behaves like a real switch for the app and Alexa, and is always labelled **Virtual** (Alexa says "That is a virtual test switch"). **Simulate offline** lets you test offline handling.
- **SONOFF Wi-Fi plug:** **Add → SONOFF Wi-Fi plug** opens the existing pairing wizard.
  - **Always:** the final step registers the plug on the **CUBE hub**, as before (a third-party device the backend's bridge drives over the LAN).
  - **Signed in to EMS:** it is then also added to the user's EMS devices with `protocol: 'cube'` (`server/src/ems/adapters/cube.ts`), so the app and Alexa switch it **through CUBE**, the same path as the CUBE dashboard. If that second step fails, the plug stays on CUBE and the wizard shows why it was not added to EMS.
  - **Live updates:** state changes the bridge sees (the plug's button, a switch from the CUBE dashboard, going offline) reach the app live through the registry.
  - **Conditions:** the backend refuses registration unless the plug is announcing itself on the backend's LAN, its key decrypts the announcement, and it reports a single switch. A hub device can belong to one EMS account only.
  - **Unused for now:** the direct `sonoff-lan` adapter (no hub) is kept, but the wizard no longer uses it.
- **Per device:** rename, change room, remove (tap twice), switch on and off. Each card shows online/offline, the last confirmed state and when it was confirmed, a pending spinner while a command is in flight, and the reason for the last failure.
- **Alexa access:** in **Settings → Alexa → Device access**, allow or block each device and pick the **default** device for "turn on" with no name. The first device added becomes the default.

## 6. Voice commands

| Arabic (ar-SA) | English (en-US) |
| --- | --- |
| «أليكسا، افتحي مساعد إدارة المنزل» → «أهلاً بك في مساعد إدارة المنزل. كيف أقدر أساعدك؟» | "Alexa, open EMS assistant" |
| «شغل نور غرفة النوم» → «تم تشغيل نور في غرفة النوم.» | "Turn on the bedroom light" |
| «اطفي نور غرفة النوم» → «تم إطفاء نور في غرفة النوم.» | "Turn off the bedroom light" |
| «هل المكيف شغال؟» | "Is the air conditioner on?" |
| «شغل» (no device: the default device) | "Turn on" |

**Free speech in any dialect.**
- **How it works:** besides the fixed intents, `VoiceCommandIntent` has an `AMAZON.SearchQuery` slot (supported in Arabic (SA)). It catches phrases that start or end with words such as «ابي / ابغى / عايز / بدي / اريد / ممكن / لو سمحت / من فضلك / الله يخليك / خلي». The skill passes the whole phrase to the backend as `{ action: 'auto', utterance }`, and `server/src/ems/utterance.ts` reads it:
  - **Action from Gulf, Egyptian, Levantine and MSA verbs**, including feminine, plural and verbal-noun forms and attached pronouns:
    - on: شغّل، ولّع، افتح، اشعل، دوّر…
    - off: طفّي، سكّر، اقفل، بنّد، وقّف، افصل…
    - questions: «النور شغال؟»، «هل المكيف مطفي»، «وش حالة السخان»…
    - «خلّي X شغال/طافي» counts as a command.
  - **Synonyms:** نور = ضو = ضوء = لمبة = إضاءة = light; فيش = فيشة = بريزة = مقبس; مكيف = تكييف = كندشن; غرفة = أوضة = حجرة; صالة = صالون = ليفنج; and more.
  - **Prefixes:** attached prefixes are split off («بالمطبخ»، «والمكيف»، «للصالة»).
  - **Recognition slips:** one wrong letter is tolerated in longer words.
  - **Several devices or all:** «شغل النور والمكيف», «طفي كل الأنوار», «طفي كل شي». Each device is switched and confirmed separately, and the reply names what worked and what didn't.
  - **Unclear action:** «ابي النور» makes Alexa ask «تبي أشغل نور في غرفة النوم ولا أطفيه؟», and a bare «شغّله» then acts on that device (kept in the session).
- **Limit:** Alexa still decides which intent a phrase belongs to before the backend sees it. A phrasing that matches no sample in the model goes to `AMAZON.FallbackIntent`, whose text Alexa doesn't pass on. Add common phrasings you hear in testing to `ar-SA.json`.

How the backend resolves the device (`server/src/ems/voice.ts`):
- **Arabic spelling:** it folds variants (أ/إ/آ→ا, ة→ه, ى→ي), strips diacritics and tatweel, and ignores the definite article ال, so «النور» matches «نور».
- **Name and room:** the spoken phrase can be the name, the name plus the room, or just the room.
- **Several matches:** Alexa lists them and asks which one.
- **Default device:** used when no device is named. With a single device, that one is used.
- **Failures:** Alexa says so when a device is offline, unreachable, or didn't confirm in time (the voice path waits 5 s), and nothing is claimed.
- **Linking required:** a missing or revoked token gets a spoken prompt plus a LinkAccount card in the Alexa app.

## 7. Testing

### Automated (run these)

```bash
cd server && npm test        # 39 tests: registry, controller, realtime, OAuth, linking, voice, persistence
npm run typecheck            # backend
cd .. && npx tsc --noEmit && npx expo lint    # app
```

`server/test/ems.test.ts` runs the real HTTP and WebSocket server on a random port against a **stand-in for Amazon**. The stand-in covers LWA, endpoint discovery and the Skill Enablement API, and redeems the EMS code at `/oauth/token` as Amazon does. Hardware is either the virtual adapter or a test adapter clearly named `test-unreachable`.

| # | Scenario | Test |
| --- | --- | --- |
| 1 | Register a virtual device | `1. registers a virtual device…` |
| 2–3 | On / off from the app | `2–3 and 7. switches on and off…` |
| 4 | Only Alexa's EMS token opens the voice API | `5–6 and 4. links from the app…` |
| 5–6 | On / off from Alexa | same |
| 7 | App sessions receive pending then confirmed state | `2–3 and 7…`, and the Alexa test checks the app socket |
| 8 | Other users and anonymous callers refused | `8. refuses other users…` |
| 9 | Hardware that does not answer (app and voice) | `9. a device that does not answer…`, `9 via voice…` |
| 10 | Expired Amazon linking | `10. expired Amazon authorization…`, plus "disabled in the Alexa app" |
| 11 | Ambiguous, room-qualified, Arabic, default device | `11. ambiguous…`, `voice.test.ts` |
| 12 | Persistence across restart; realtime reconnection | `12. devices survive a restart…` |
| also | Cancelled sign-in, replayed state, OAuth code reuse, PKCE, refresh rotation, rate limiting, logout | |

### Alexa Simulator

1. Deploy the backend with the settings above and deploy the skill code and models.
2. In the EMS app, sign in, add a virtual switch named "نور" in room "غرفة النوم", then **Settings → Alexa → Connect to Alexa** using **the same Amazon account as your developer console**.
3. In the console **Test** tab, set testing to **Development**, pick **Arabic (SA)**, and type «افتحي مساعد إدارة المنزل», then «شغل نور غرفة النوم». The switch in the app flips live, and the simulator answers «تم تشغيل نور في غرفة النوم.».
4. Mark the switch offline in the app and repeat: Alexa reports it offline and nothing changes.

**Before linking works (development only).** Set `DEV_VOICE_TOKEN` (a long random value) and `DEV_VOICE_USER_EMAIL` on a non-production backend, and put the same token in `config.js` → `DEV_VOICE_TOKEN` in the console's Code tab. The skill then acts as that one user whenever the request carries no linked token. Remove both values before anyone else uses the skill, and never commit them.

### Amazon Echo

1. Sign the Echo in to the same Amazon account (or a beta tester's account linked through the app).
2. Make sure the device language is Arabic (Saudi Arabia) or English (US).
3. Say «أليكسا، افتحي مساعد إدارة المنزل», then «شغل نور غرفة النوم».

### Mobile app

The new screens need native modules added in this change (`expo-secure-store`, `expo-web-browser`) and the `parklane` URL scheme, so make a **new build**: `npx eas-cli@latest build -p android --profile preview`. Expo Go and older APKs won't have them.

## 8. What is verified, and what is not

**Verified**

- **Automated backend tests:** all 39 pass (`npm test`), using the virtual adapter and the Amazon stand-in.
- **Skill end to end:** the real `alexa/lambda/index.js` handler, run locally with `ask-sdk-core` against the real backend, gave:
  - the Arabic welcome;
  - «شغل/اطفي نور غرفة النوم» changing the registry state;
  - English status replies;
  - the unknown-device reply;
  - the default-device fallback;
  - a LinkAccount card for unlinked or revoked tokens.
- **App checks:** the app typechecks and lints clean.

**Not verified yet (needs your accounts, hosting or hardware)**

- **Real Amazon services:** LWA sign-in, the Enablement API and Amazon redeeming our code were tested only against the stand-in, which follows Amazon's documented requests and responses. They need the console settings above and one real linking run.
- **Real devices:** no real Echo or the Alexa Simulator was used, and the interaction models haven't been built in the console. Arabic recognition of custom device names depends on Amazon's model.
- **App on a phone:** the new app screens haven't been run on a phone or emulator yet.
- **Backend deployment:** the new backend isn't deployed to `api-iot.ems-iot.com`. That host also needs WebSocket pass-through.
- **SONOFF S26R2TPF:** not verified (see below).

### SONOFF S26R2TPF status

- **Protocol:** the `sonoff-lan` adapter drives plugs over the **eWeLink LAN protocol**. That protocol is not officially documented by ITEAD for stock firmware; the implementation follows the community SonoffLAN project (see `server/README.md`).
- **DIY mode:** SONOFF's official **DIY mode** (a documented local REST API) lists BASICR3, RFR3, MINIR2 and MINIR3 as single-channel DIY devices. The S26 is not on that list, so this project does not assume DIY mode works on the S26R2TPF. Its manual only lists "LAN Control".
- **What `/device` proves:** a successful `http://10.10.7.1/device` answer proves the plug is in pairing mode and identifies it. It does **not** prove it can be provisioned onto Wi-Fi independently or switched locally.
- **Unknowns:** whether this firmware turns on LAN mode without a working eWeLink cloud connection, and whether its `apikey` is its LAN key, are both unverified. The backend checks the key against the plug's own encrypted announcement before registering it.
- **Placement:** the adapter only works when the backend runs on the **same network segment as the plug** (mDNS does not cross routers). A cloud-hosted backend can't reach the plug directly. That needs a small on-site agent, which this change does not include.

Until a physical S26R2TPF has been registered and switched end to end, treat it as **unsupported**. The adapter is isolated behind `DeviceAdapter` (`server/src/ems/adapters/types.ts`), so a verified protocol, or a hub/agent adapter, can be added without touching the app or the skill.

## 9. Security notes

- **Passwords and tokens:** passwords are hashed with scrypt. EMS tokens and codes are stored only as SHA-256 hashes.
  - App sessions last 30 days.
  - Alexa access tokens last 1 hour; refresh tokens last 1 year and rotate on each use.
  - Authorization codes last 5 minutes, are single use, and are PKCE-checked when bound to a challenge.
- **Token separation:** app session tokens, Alexa's EMS tokens and Amazon's tokens are separate and never accepted in place of each other.
- **Secrets at rest:** Amazon tokens and SONOFF keys are sealed with AES-256-GCM. Secrets come from environment variables; none are in the app or the repo.
- **Redirects:** `/oauth/authorize` only redirects to the registered Amazon redirect URLs or our own callback. Its sign-in page loads no scripts and refuses framing.
- **Request limits:** rate limits apply to login, registration, OAuth, linking, device creation, power and voice. Request bodies are capped at 16 KB, and Amazon calls time out after 10 s.
- **Logging:** logs never include request bodies, query strings (codes and states) or fields that look secret.
- **Network scope:** the backend never forwards requests to client-supplied URLs and has no access to unrelated SCADA, industrial or CUBE services from the EMS routes.
- **Still to do before production:**
  - Only the app's own sign-in for EMS accounts exists. Password reset and email verification are not implemented.
  - The app's main login screen is still the frontend-only demo; the EMS account is signed into from the Alexa and My Devices screens.
