# Family Circle

Location and battery sharing between family members, like Life360. Built on the branch `feature/family-circle`
on 18 November 2026. The full plan, with the decisions and later phases, is
[plans/FAMILY_CIRCLE_PLAN.md](plans/FAMILY_CIRCLE_PLAN.md).

**Status:** built and checked (tests, typecheck, lint, bundles). **Not yet tested on real phones.** Ship it as an
update **after** the first Play Store release, because background location starts a new Google review.

## What's new

| # | Update | Where |
|---|---|---|
| 1 | **Circles**: groups of people who share their location. Not tied to a unit: anyone with a Park-Lane account can join, even someone outside the compound | backend + app |
| 2 | **Invite codes**: the owner makes a code (`XXXX-XXXX`, works once, for 24 hours) and shares it by WhatsApp or text | backend + app |
| 3 | **Own sharing switch**: each person turns their sharing on or off themselves, per Circle. Nobody can turn it on for someone else | backend + app |
| 4 | **Map and list**: everyone who shares is a pin (Apple Maps on iPhone, Google Maps on Android), with "seen 5 min ago" and their battery | app |
| 5 | **Background sharing**: the phone keeps sending its position when the app is closed, about every 100 m or every minute | app |
| 6 | **Live view**: while someone has the map open, the people they watch send their position every ~3 seconds | backend + app |
| 7 | **Sliding pins**: pins slide smoothly to each new position instead of jumping | app |
| 8 | **Home tile** "Family Circle" opens the new screen | app |
| 9 | **Privacy**: positions stored encrypted, deleted when someone stops sharing, leaves, or deletes their account | backend |
| 10 | **Map key kept out of git**: `frontend/app.config.js` reads it from an environment variable | app config |

Not included, by the owner's choice: AirTag, Tile or other tracker tags.

## How it works (father and son)

1. **The father** opens Home → **Family Circle**, makes a Circle called "Family", and taps **Make an invite code**.
   The share sheet opens with a message that has the code.
2. **The son** signs in to his own account on his phone (he doesn't need to live in the unit), opens
   **Family Circle**, taps **Join with a code**, and enters the code. The app shows "Join Family?" first.
3. **The son turns on "Share my location".** The app first explains what will happen (Google requires this), then
   the phone asks for permission. He should choose **"Allow all the time"** (iPhone: **"Always"**).
4. **The father sees the son** on the map: where he is, when that was, and his battery.
5. **The son can turn sharing off** at any time. His pin disappears from the father's map within seconds, and his
   saved position is deleted.

Owners can remove people. Anyone can leave a Circle. When the last owner leaves, the longest member becomes the
owner. When the last member leaves, the Circle is deleted.

## Live view

Sending the position every few seconds all the time would empty the battery in about a day. So phones go live
**only while someone is watching**.

```
Father opens the map
   │  every 30 s: POST /api/location/watch
   ▼
Server: "son is live for the next 60 s"
   ├──▶ son's app open:   realtime event location.live ──▶ switches at once
   └──▶ son's app closed: answer to his next report (liveUntil) ──▶ switches within ~1 min / 100 m
                                   │
Son's phone sends every ~3 s ──────┘──▶ server ──▶ father's map: pin slides
```

- The father's map shows a red **Live** chip while live.
- After **10 minutes** live view pauses, with a **Watch live again** button.
- When the father closes the map, or his app goes to the background, the son's phone goes back to normal updates
  within about a minute.
- The son can see it happening: on Android the notification says "watching your location live right now", and on
  iPhone the blue location pill appears.
- If the son's phone loses signal while live, it goes back to normal 30 seconds after the last live time.

A faster start with the son's app closed (a silent push that wakes his phone) needs push notifications. That is
Phase 2 in the plan.

## Privacy rules

1. A person's location and battery are seen only by people in a Circle with them, and only in a Circle where they
   turned sharing on.
2. Nobody can turn sharing on for someone else, not even the Circle owner.
3. Positions are stored encrypted. Only each person's **latest** position is kept.
4. Sharing nowhere, leaving, being removed, or deleting the account deletes the saved position.
5. The background task's login token can **only** send location reports, and signing out ends it.

## Before testing: setup

### 1. Put the new backend on the server

The phone builds talk to `api-iot-2.ems-iot.com`. Deploy this branch's `backend/` the usual way
([on_server.md](on_server.md)). Without it, the screen says "Not available yet". The database migration runs by
itself when the backend starts.

### 2. Google Maps key (Android)

In Google Cloud:

1. Turn on **Maps SDK for Android**.
2. Restrict the key to package `com.emsiot.parklane` and the build's SHA-1. To see the SHA-1, run this in
   `frontend/`: `npx eas-cli@latest credentials -p android`
3. Save the key in EAS (it never goes into git):

```
cd frontend
npx eas-cli@latest env:create --name GOOGLE_MAPS_ANDROID_API_KEY --value YOUR_KEY --environment development --visibility sensitive
```

For local builds, put `GOOGLE_MAPS_ANDROID_API_KEY=...` in `frontend/.env.local` instead. Without a key the app
still works, but the Android map is blank. iPhones use Apple Maps and need no key.

### 3. Development build

Background location doesn't work in Expo Go. Make a development build and install it on both phones:

```
cd frontend
npx eas-cli@latest build --profile development --platform android
npx expo start --dev-client
```

Use **two Android phones** for now: iPhone builds need the Apple developer account.

## How to test on phones

| Step | Phone | Do this | Expect |
|---|---|---|---|
| 1 | A (father) | Home → Family Circle → make "Family" → Make an invite code → share | A code like `K7Q4-9MXD` |
| 2 | B (son) | Sign in with another account → Family Circle → enter the code → Join | "You joined Family" |
| 3 | B | Turn on Share my location → Continue → Allow all the time | The Android notification "Sharing your location" appears |
| 4 | A | Look at the map | Son's pin, "Seen just now", his battery, and the red **Live** chip |
| 5 | B | App open, walk around | On A, the pin slides every few seconds |
| 6 | B | Close the app, keep walking | Within about a minute, live continues |
| 7 | A | Close the map | Within about a minute, B's notification goes back to "Sharing your location" |
| 8 | A | Leave the map closed; B walks 200 m | The pin moves about once a minute (normal mode) |
| 9 | B | Turn sharing off | On A, the pin disappears within seconds |
| 10 | A | Remove the son from the Circle | B no longer sees the Circle |

**Watch step 6 closely.** It hasn't been tested on a real phone yet: Android has to switch the update speed while
the app is closed. The app changes the running settings in place instead of restarting tracking, because Android
may refuse to restart location tracking from the background.

Also check the battery after a day of sharing with no one watching. It should be close to normal.

## API

All under `routes/circles.ts`. Details: [API_DOCUMENTATION.md](API_DOCUMENTATION.md#family-circle--routescirclests).
Types: `shared/contracts/circles.ts`.

| Method | Path | What |
|---|---|---|
| GET | `/api/circles` | My Circles, members, and the positions I may see |
| POST | `/api/circles` | Make a Circle |
| PATCH / DELETE | `/api/circles/:id` | Rename / delete (owners) |
| PUT | `/api/circles/:id/sharing` | My own sharing on or off |
| POST / GET | `/api/circles/:id/invites` | Make a code / codes not used yet (owners) |
| DELETE | `/api/circles/:id/invites/:inviteId` | Cancel a code (owners) |
| POST | `/api/circles/invites/check` | Which Circle a code is for |
| POST | `/api/circles/join` | Join with a code |
| DELETE | `/api/circles/:id/members/:userId` | Remove someone (owners), or leave (own id) |
| POST | `/api/location/report` | The phone sends its position and battery |
| POST | `/api/location/token` | The background task's narrow token |
| POST | `/api/location/watch` | The map is open: go live (new) |

Realtime events: `location.updated` (someone moved), `location.live` (go live now, new), `circle.updated`
(re-read the Circles).

## Where the code lives

**Contract:** `shared/contracts/circles.ts`, and the events in `shared/contracts/events.ts`.

**Backend** (`backend/src/`):

| File | What |
|---|---|
| `ems/db.ts` | The migration: `circles`, `circle_members`, `circle_invites`, `member_locations`, triggers |
| `repositories/circles.ts`, `circleInvites.ts`, `memberLocations.ts` | The SQL |
| `circles/circles.ts` | Circles, members, sharing, invites, joining |
| `circles/location.ts` | Reports: checks, encryption, who may see them |
| `circles/live.ts` | Live view: who is being watched, until when (in memory) |
| `routes/circles.ts` | The routes |
| `ems/auth.ts`, `repositories/tokens.ts` | The `location` token kind |
| `ems/accountDeletion.ts` | Leaving every Circle when an account is deleted |
| `test/circles.test.ts` | 13 tests |

**App** (`frontend/`):

| File | What |
|---|---|
| `src/screens/CircleScreen/` | The screen: map, Live chip, sharing switch, people, invites, make or join |
| `src/features/circles/services/circlesApi.ts` | The API calls |
| `src/features/circles/services/backgroundTask.ts` | The background task (imported first in `index.ts`) |
| `src/features/circles/services/locationSharing.ts` | Permissions, start and stop |
| `src/features/circles/services/updateMode.ts` | Normal (every ~100 m / 1 min) and live (every ~3 s) updates |
| `src/features/circles/services/locationReport.ts` | One report, with battery |
| `src/features/circles/services/circleRules.ts` | "Seen 5 min ago", battery colours, map camera, pin sliding |
| `src/features/circles/hooks/` | `useCircles`, `useCircleInvites`, `useLocationSharing`, `useLiveWatch`, `useGlidingMembers` |
| `src/features/circles/components/CircleMap.tsx` | The map (`.web.tsx`: none on the web) |
| `src/features/circles/context/CirclesProvider.tsx` | Goes live on `location.live`; stops sharing on sign-out |
| `app.json` | The `expo-location`, `expo-task-manager` and `expo-maps` plugins and the permission texts |
| `app.config.js` | Adds the Google Maps key from the environment |

New packages: `expo-location`, `expo-task-manager`, `expo-battery`, `expo-maps`.

## Checks run (18 November 2026)

| Check | Result |
|---|---|
| Backend typecheck (`npm run typecheck`) | passed |
| Backend tests (`npm test`) | 293 of 293 passed. `gateway-containers.test.ts` was left out: it hangs on this Windows machine with or without these changes |
| App typecheck (`npx tsc --noEmit`) | passed |
| App lint (`npx expo lint`) | passed |
| `npm run check:circles` | 7 of 7 passed |
| Android and web bundles (`npx expo export`) | built |
| Structure check | passed for every changed file (the root `package-lock.json` it flags was there before) |
| Screenshot comparison | not run |
| Real phones | **not yet** |

## Limits

- **Live view with the son's app closed** starts at his next normal update (up to about a minute, or 100 m), not at
  once. Push notifications (Phase 2) would fix this.
- **A force-closed app** on Android stops sharing until it is opened again. Life360 has the same limit.
- **Battery savers** on some Android phones (Samsung, Xiaomi, Huawei) can stop background apps.
- **The web app** shows the list only: no map, and it can't share its own location.
- **iPhone** needs the Apple developer account before it can be built and tested.
- **The Home screen** now has 9 tiles, so the last row has a single tile.

## Next steps

1. Test on two Android phones (the table above).
2. Commit the branch, then merge it when the Play Store update is ready to submit.
3. Store steps: Google Play's background location declaration with a short video, the Data safety form, and the
   privacy page (`backend/src/public/privacy.html`).
4. Later: push notifications and place alerts ("arrived at Home"), then location history (Phase 2 and 3 in the plan).
