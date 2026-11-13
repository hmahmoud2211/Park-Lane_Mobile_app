# Plan: Family Circle (location sharing, like Life360)

Status: **draft, 13 November 2026, not approved.** Nothing is built yet.

## Progress

| Phase | What | Size | State |
|---|---|---|---|
| 0 | "Find my things" button (opens Apple's Find My) | Small | not started |
| 1 | Live location + phone battery | Large | not started |
| 2 | Push notifications + place alerts | Large | not started |
| 3 | Location history | Medium | not started |
| 4 | Compound tag network (optional) | Large | only if residents ask |

## 1. What residents get

People who live in the same unit form a **Circle**. Inside the Circle:

1. **Live location.** Everyone sees the others on a map.
2. **Battery.** Everyone sees how much battery each phone has, and whether it is charging.
3. **Place alerts.** The family saves places like "Home" or "School". The others get an alert when someone
   arrives or leaves.
4. **History.** You can see where a person has been on a chosen day, for the last 30 days.
5. **Find my things.** A button that opens Apple's Find My app, where residents see their own AirTags.

## 2. What we do not build, and why

- **Tile, AirTag, Samsung and Google trackers inside our app.** None of them has a public API. Their networks
  are closed to other apps. Apple's and Google's programmes are for companies that make tracker hardware, and
  even those tags only appear in Apple's or Google's own app. The only Tile library (pytile) is unofficial and
  can break at any time. So Park-Lane does not show trackers. It only opens Apple's Find My app (Phase 0).
- **Driving reports and crash detection.** Not asked for. They also need far more battery and more store review.
- **People outside the unit** (for example, grandparents in another building). Not in the first version. See
  open question Q1.

## 3. Decisions (recommended)

| # | Decision | Recommendation | Why |
|---|---|---|---|
| D1 | Who is in a Circle | The members of one unit (`unit_members`) | It already exists. No invite system needed. |
| D2 | How often a phone reports | About every 100 m of movement, at most once a minute | Saves battery. Life360 works the same way. |
| D3 | Sharing on or off | **Off by default.** Each person turns it on for themselves | Privacy, and the stores expect it. |
| D4 | How long history is kept | 30 days, then deleted by the hourly upkeep | Enough to be useful, small database. |
| D5 | Coordinates at rest | Sealed, like health text (`ems/secrets.ts`) | A location is personal data. We never search by place on the server. |
| D6 | Who notices "arrived at Home" | The moving phone itself (geofencing) | More reliable than guessing from sparse points on the server. |
| D7 | Map library | `expo-maps` (Apple Maps on iOS, Google Maps on Android) | An Expo module. No key on iOS. |
| D8 | Web app | A list (name, last place, time, battery), no map | `expo-maps` has no web version. A browser cannot share in the background. |
| D9 | When to ship | **After** the first Play Store release, as an update | Background location starts a new Google review (section 8). |

## 4. How it works

```
Phone A (moving)
  │  background task: location + battery, every ~100 m
  ▼
POST /api/location/report ──▶ backend: check, seal, save
                                   │
                                   ├──▶ WebSocket /api/events ──▶ Phone B, map open: the dot moves
                                   └──▶ push notification ──────▶ Phone B, app closed: "Sara arrived at Home"
```

A request travels the normal way:
`screen → feature hook → feature service → src/lib/http → backend route → domain module → repository (SQL)`.
Work starts in `shared/contracts`, then the backend, then the app.

## 5. Privacy rules (these must always be true)

1. Only members of the **same unit** see a person's location, battery or history.
2. Nobody can turn sharing on for someone else. Not even the unit owner.
3. When sharing is off, others see "Not sharing". They see no position and no history.
4. A person can delete their own history at any time.
5. Leaving the unit, or moving to another unit, ends sharing at once. A database trigger does this, like
   `health_shares_end_on_leave` does for health shares.
6. Deleting the account deletes all location rows (`ems/accountDeletion.ts`).
7. History older than 30 days is deleted every hour.
8. The privacy page (`backend/src/public/privacy.html`) and the store forms say what we collect and why.

## Phase 0: "Find my things" button

Small, no new permissions, so it can ship at any time.

- **Where:** a row in the Services list ("Find my things"). Services rows open a route today, so the row needs a
  small "open a link" option.
- **iPhone:** opens Apple's Find My app. Apple does not document a link for this app. Test on a real iPhone.
  If the link does not work, open `https://www.icloud.com/find` instead.
- **Android and web:** opens `https://www.icloud.com/find` with `expo-web-browser` (already installed). The label
  says "Find your Apple devices", because AirTags do **not** appear on the iCloud website.
- **Rule:** the sign-in always happens on Apple's own page or app. Park-Lane never shows an Apple sign-in form
  and never asks for an Apple password.

**Done when:** the button works on an iPhone, an Android phone and the web app.

## Phase 1: Live location and battery

### Contract: `shared/contracts/location.ts`

Re-export it from `index.ts`. The app imports it with `import type` only.

```ts
export interface LocationPoint { lat: number; lng: number; accuracyM: number; at: string }
export interface BatteryInfo { level: number; charging: boolean }            // level 0..1
export interface LocationReport { points: LocationPoint[]; battery: BatteryInfo | null }

export interface CircleMember {
  userId: string;
  name: string;
  sharing: boolean;
  location: LocationPoint | null;   // null when not sharing or never reported
  battery: BatteryInfo | null;
}
export interface Circle { members: CircleMember[] }
```

Add one event to `RealtimeEvent` in `events.ts`:
`{ type: 'location.updated'; member: CircleMember }`.

### Backend

- **Migration** (the next one in `backend/src/ems/db.ts`):
  - `location_settings` (user_id, sharing, updated_at)
  - `member_locations` (user_id primary key, sealed coordinates, accuracy_m, battery_level, charging, at),
    one row per person with their latest position
  - triggers that end sharing when a person leaves or changes unit
- **Repository:** `backend/src/repositories/locations.ts` (SQL only).
- **Domain module:** `backend/src/location/`:
  - only members of the same unit can read
  - reject bad points: accuracy worse than 1 km, time in the future, older than 24 hours, more than 200 points
    in one report
  - ignore points that arrive older than the saved one
  - rate limit with `ems/rateLimit.ts` (about one report every 20 seconds)
- **Routes:** `backend/src/routes/location.ts`, added to `API_ROUTES` in `backend/src/app.ts`:

  | Method | Path | What |
  |---|---|---|
  | GET | `/api/location/circle` | The unit's members, their last position and battery |
  | POST | `/api/location/report` | A phone sends its points and battery |
  | PUT | `/api/location/sharing` | Turn my sharing on or off |

- After a report, send `location.updated` to the other unit members with `publishToUnit` (`ems/broadcast.ts`).
- **A token for the background task.** The app keeps its login token with
  `WHEN_UNLOCKED_THIS_DEVICE_ONLY` (`frontend/src/lib/storage/secureStorage.ts`). A background task on a locked
  iPhone cannot read it. Add a narrow token kind `location`, like the existing `assistant` kind. It can **only**
  call `POST /api/location/report`. The app stores it with `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`. Signing out
  ends it.
- **Tests:** a member of another unit gets nothing; sharing off hides the position; bad points are rejected;
  leaving the unit ends sharing; the location token cannot call any other route.

### App

- **Install** from `frontend/`:
  `npx expo install expo-location expo-task-manager expo-battery expo-maps`
- **`app.json`**, the `expo-location` plugin:
  - `isIosBackgroundLocationEnabled: true`
  - `isAndroidBackgroundLocationEnabled: true` (this also turns on the Android foreground service)
  - `locationAlwaysAndWhenInUsePermission` and `locationWhenInUsePermission`, for example:
    "Park-Lane shares your location with the people in your unit, only when you turn on Family Circle."
  - a Google Maps API key for Android (`expo-maps`), stored as an EAS secret, not in git
- **Feature folder:** `frontend/src/features/location/`
  - `services/locationApi.ts`: the three routes, through `src/lib/http`
  - `services/backgroundTask.ts`: `TaskManager.defineTask(...)` at the top level. Import it in the app's entry
    file before anything renders, or the task is missing when the system wakes the app. The task reads the
    battery with `getBatteryLevelAsync()` and `getBatteryStateAsync()`, then sends one report.
  - `services/outbox.ts`: keeps points that could not be sent (no signal) and sends them later
  - `hooks/useCircle.ts`: loads the Circle, then listens for `location.updated` on the WebSocket
  - `hooks/useLocationSharing.ts`: the permission steps and the on/off switch
- **Starting the updates:**
  `Location.startLocationUpdatesAsync(TASK, { accuracy: Balanced, distanceInterval: 100, timeInterval: 60000,
  deferredUpdatesInterval: 60000, foregroundService: { notificationTitle, notificationBody } })`.
  The Android notification is required by the system and cannot be hidden. Example text: "Park-Lane is sharing
  your location with your unit."
- **Permission steps** (the order matters):
  1. Our own explanation screen first. Google requires this "prominent disclosure" **before** the system asks.
  2. `requestForegroundPermissionsAsync()` ("While using the app").
  3. `requestBackgroundPermissionsAsync()` ("Always"). On Android 11+ this opens system settings, so explain
     that first.
  4. If the person says no, or picks "Allow once" on iPhone, sharing still works while the app is open. Show a
     button that opens the phone's settings.
- **Screens:**
  - `CircleScreen`: a map with everyone's dot, and a list under it (name, place, "5 min ago", battery). Web: the
    list only (a `.web.tsx` file).
  - Its own sharing switch, plus a row in Settings.
  - A Home tile "Family Circle". **Route limit:** `ParamlessRoute` has one free slot (it must stay at 25 or
    fewer, see `frontend/src/types/navigation.types.ts`). `Circle` takes that slot. Every later screen in this
    plan goes in `FlowOnlyRoute`.

**Done when:** on two real phones (one iPhone, one Android) in the same unit, each sees the other move and sees
the battery; turning sharing off hides the dot within seconds; leaving the unit stops it; one day of sharing
uses an acceptable amount of battery (measure it).

## Phase 2: Push notifications and place alerts

### 2a. Push notifications (new for the whole app)

Today the backend has only the in-app inbox (`notify()` in `backend/src/ems/notifications.ts`). It says:
"Push notifications to the phone are not part of this." Place alerts need push, because the other phones are
usually closed. Push also helps every other feature.

- **App:** `npx expo install expo-notifications`, add the `expo-notifications` plugin, and get the token with
  `getExpoPushTokenAsync({ projectId })`. Send it to the backend after sign-in, and remove it on sign-out.
- **Credentials:** Android needs an FCM key uploaded to EAS. iPhone needs an APNs key, and that needs the Apple
  developer account, **which we do not have yet**. Until then, push works on Android only.
- **Backend:**
  - a migration with `push_tokens` (user_id, token, platform, created_at)
  - routes `POST /api/notifications/push-token` and `DELETE /api/notifications/push-token`
  - `notify()` also sends a push through Expo's push service (`https://exp.host/--/api/v2/push/send`) with plain
    `fetch`. The backend has no runtime packages, and it does not need any for this. Delete a token when Expo
    answers `DeviceNotRegistered`.
  - The resident's notification settings still decide. A kind that is off gets no push.
  - add the kind `family` to `NOTIFICATION_KINDS` and to the contract

### 2b. Place alerts

- **Contract:** `Place { id, name, lat, lng, radiusM }` and `PlaceEvent { placeId, userId, type: 'enter' | 'exit', at }`.
- **Backend:**
  - a migration with `places` (id, unit_id, name, sealed coordinates, radius_m, created_by) and `place_events`
  - **at most 20 places per unit**, because an iPhone watches at most 20 places at once (Android: 100)
  - radius from 100 m to 500 m (smaller is not reliable)
  - routes: `GET` / `POST /api/location/places`, `PUT` / `DELETE /api/location/places/:id`,
    `POST /api/location/places/:id/events`
  - ignore the same event from the same person within 2 minutes. Phones can "bounce" at the edge of a place.
  - on a new event: save it, then `notify()` the other members ("Sara arrived at Home"), kind `family`
  - send `places.updated` on the WebSocket when the list changes
- **App:**
  - a second task with `Location.startGeofencingAsync(TASK, places)`. Call it again whenever the list changes.
  - on enter or exit, the task calls the events route
  - `PlacesScreen`: the list of places, and "add a place" with a pin on the map and a radius slider
    (`FlowOnlyRoute`)

**Done when:** one phone walks out of "Home" and back in, and the other phone (app closed) gets both alerts.

## Phase 3: Location history

- **Backend:**
  - a migration with `location_history` (user_id, at, sealed coordinates, accuracy_m) and an index on
    (user_id, at)
  - each accepted point from Phase 1 is also added here
  - the hourly upkeep deletes rows older than 30 days, the same way `purgeOldNotifications` does
  - `GET /api/location/history?userId=…&date=YYYY-MM-DD`: one day in the compound's time zone (`sites.timezone`).
    Same unit only, and only while that person shares.
  - `DELETE /api/location/history`: delete my own history
  - send fewer points: drop points less than 20 m from the one before
- **App:** `HistoryScreen` (`FlowOnlyRoute`): pick a day, see the path as a line on the map, and a list of stops
  ("Home 08:10 to 08:45, School 09:00 to 14:30") made from the place events.

**Done when:** a day of walking shows the right path, and history from another unit cannot be read.

## Phase 4 (optional): compound tag network

Only if residents ask for it. Cheap Bluetooth tags on keys or bags. Every Park-Lane phone, plus small fixed
receivers at the gates, parking and lobby, reports "seen here". The owner sees "last seen in Parking B, 10 min
ago". It works **inside the compound only**, and phones limit Bluetooth scanning in the background. Plan it
separately if it is wanted.

## 8. Store and legal steps

| Where | What to do |
|---|---|
| Google Play | Fill in the **background location** declaration and upload a short video that shows the feature and the disclosure screen. Expect a new review. |
| Google Play | Update the **Data safety** form: location and battery are collected, shared only with members of the same unit, never sold. |
| Apple | Clear "Always" location text. Explain the feature in the review notes. Needs the Apple developer account first. |
| Both | Update `backend/src/public/privacy.html`. |
| Timing | Keep the `expo-location` plugin out of `app.json` until we are ready to submit. The permission in the build is what starts Google's review, not whether the screen is visible. Build the feature on its own branch. |

## 9. Limits and risks

- **Force-closed apps.** On Android, if someone force-closes the app, sharing stops until they open it again.
  iPhone wakes the app for place alerts, but not for normal updates after a force-close. Life360 has the same
  limit.
- **Battery savers.** Some Android makers (Samsung, Xiaomi, Huawei) stop background apps. Use
  `isBatteryOptimizationEnabledAsync()` and show the person how to allow Park-Lane.
- **No Expo Go.** Background location and push need a development build
  (`eas build --profile development`).
- **"Live" is not every second.** Updates come about every 100 m or every minute. Say this in the app.
- **iPhone "Allow once"** looks the same as "While using" to the app. The later "Always" request then fails
  silently. Send the person to Settings.
- **Web** cannot share its own location in the background, and it shows no map.

## 10. Checks before each phase is called done

1. `node .claude/hooks/check-structure.mjs --changed` from the repo root.
2. From `frontend/`: `npx tsc --noEmit` and `npx expo lint`.
3. From `backend/`: `npm run typecheck` and `npm test`. Or `./scripts/dev.sh check` for both.
4. New screens: compare screenshots with `frontend/scripts/visual-regression.mjs`.
5. The phase's "Done when" test on **real phones**. These features cannot be tested properly in a simulator.

## 11. Open questions for the owner

- **Q1.** Circle = people in the same unit only? Or also invite people from outside? (Recommended: unit only first.)
- **Q2.** Is 30 days of history right?
- **Q3.** Is the Services list the right place for "Find my things"?
- **Q4.** Can children in the unit turn sharing off themselves? (Recommended: yes, everyone controls their own.
  The stores expect this.)
