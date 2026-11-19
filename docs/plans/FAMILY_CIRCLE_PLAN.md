# Plan: Family Circle (location sharing, like Life360)

Status: **approved 18 November 2026.** Phase 1 is being built on the branch `feature/family-circle`.
First draft: 13 November 2026.

## Progress

| Phase | What | Size | State |
|---|---|---|---|
| 1 | Circles with invite codes, live location + phone battery | Large | built (backend + app, 18 Nov 2026); waiting for the two-phone test |
| 1b | Live view while someone watches (option B), pins that slide | Medium | built (18 Nov 2026); waiting for the two-phone test |
| 2 | Push notifications + place alerts | Large | not started |
| 3 | Location history | Medium | not started |

The "Find my things" button (Apple's Find My, AirTags) and the compound tag network were dropped from the plan
on 18 November 2026: the owner wants location sharing only.

## Decisions taken with the owner (18 November 2026)

| Question | Answer |
|---|---|
| Where to start | Phase 1: live location and battery. No AirTag or tracker features. |
| Who can be in a Circle | **Anyone with a Park-Lane account**, not only the people of one unit. A Circle is its own group, joined with an invite code. |
| Can a member (for example a son) turn his own sharing off | **Yes.** Everyone controls their own sharing. Nobody can turn it on for someone else. |
| When | Build now on its own branch (`feature/family-circle`). Ship as an update **after** the first Play Store release. |

## 1. What residents get

A person makes a **Circle** (for example "Family") and invites others with a code. The father creates
"Family", sends the code to his son, and the son enters it in his own Park-Lane app. Inside the Circle:

1. **Live location.** Everyone who shares is a dot on the map.
2. **Battery.** Everyone sees how much battery each sharing phone has, and whether it is charging.
3. **Place alerts** (Phase 2). The Circle saves places like "Home" or "School". The others get an alert when
   someone arrives or leaves.
4. **History** (Phase 3). Where a person has been on a chosen day, for the last 30 days.

The invited person does **not** have to live in the compound. They only need a Park-Lane account
(`POST /api/auth/register` already lets anyone make one).

## 2. What we do not build, and why

- **Tile, AirTag, Samsung and Google trackers.** Dropped by the owner. They also have no public API.
- **Driving reports and crash detection.** Not asked for. They need far more battery and more store review.
- **Seeing someone without their consent.** The son must join the Circle and turn sharing on himself. The
  stores require this, and Life360 works the same way.

## 3. Design decisions

| # | Decision | Choice | Why |
|---|---|---|---|
| D1 | Who is in a Circle | Its own tables (`circles`, `circle_members`), joined with an invite code | The owner wants people outside the unit too. Works like unit invites (`ems/membership.ts`). |
| D2 | Owners | The person who makes the Circle is its owner. Owners invite, rename, remove members and delete the Circle | Same idea as unit owners. |
| D3 | Sharing on or off | **Off by default, per Circle.** Each person turns it on for each Circle they are in | Privacy. A person can share with "Family" and not with "Friends". |
| D4 | Limits | 20 members per Circle, 10 Circles per person, 10 open invites per Circle | Keeps lists and the map readable. |
| D5 | Invite codes | 8 characters (`XXXX-XXXX`), single use, 24 hours, stored hashed | Same rules as unit invites, so people already know them. |
| D6 | How often a phone reports | About every 100 m of movement, at most once a minute | Saves battery. Life360 works the same way. |
| D7 | What is kept | Only each person's **latest** position (Phase 1). History comes in Phase 3 | Small database, less personal data. |
| D8 | Coordinates at rest | Sealed (`ems/secrets.ts`), like health text | A location is personal data. We never search by place on the server. |
| D9 | Map library | `expo-maps` (Apple Maps on iOS, Google Maps on Android) | An Expo module. No key on iOS. |
| D10 | Web app | A list (name, last update, battery), no map | `expo-maps` has no web version. A browser cannot share in the background. |

## 4. How it works

```
Son's phone (moving)
  │  background task: location + battery, every ~100 m
  ▼
POST /api/location/report ──▶ backend: check, seal, save the latest position
                                   │
                                   └──▶ WebSocket /api/events ──▶ Father's phone, map open: the dot moves
                                        (only to people in a Circle where the son shares)
```

A request travels the normal way:
`screen → feature hook → feature service → src/lib/http → backend route → domain module → repository (SQL)`.
Work starts in `shared/contracts`, then the backend, then the app.

## 5. Privacy rules (these must always be true)

1. A person's location and battery are seen only by people who are in a Circle with them **and** only in a Circle
   where that person has turned sharing on.
2. Nobody can turn sharing on for someone else. Not even the Circle owner.
3. When sharing is off, others see "Not sharing". They see no position and no battery.
4. Leaving a Circle, or being removed, ends sharing in that Circle at once.
5. When a person shares in no Circle any more, their saved position is deleted (a database trigger does this),
   and the backend tells their phone to stop sending.
6. Deleting the account deletes all Circle and location rows (`ems/accountDeletion.ts`).
7. The privacy page (`backend/src/public/privacy.html`) and the store forms say what we collect and why.

## Phase 1: Circles, live location and battery

### Contract: `shared/contracts/circles.ts`

Re-exported from `index.ts`. The app imports it with `import type` only.

- `LocationPoint { lat, lng, accuracyM, at }`, `BatteryInfo { level, charging }`
- `LocationReport { points, battery }` and its answer `LocationReportResult { accepted, sharing }`.
  `sharing: false` tells the phone to stop its background updates.
- `CircleMember { userId, name, role, you, since, sharing, location, battery }`
- `Circle { id, name, role, sharing, members }` (`role` and `sharing` are the signed-in person's own)
- `CircleInvite`, `OpenCircleInvite`, `CircleInvitePreview`, `LocationToken`

Realtime events in `events.ts`:
- `{ type: 'location.updated'; member: MemberPosition }`: someone you can see moved
- `{ type: 'circle.updated'; circleId }`: members, sharing, name or invites changed: refetch

### Backend

- **Migration** (the next one in `backend/src/ems/db.ts`):
  - `circles` (id, name, created_by, created_at)
  - `circle_members` (circle_id, user_id, role, sharing, joined_at)
  - `circle_invites` (code_hash, circle_id, created_by, created_at, expires_at, used_by, used_at)
  - `member_locations` (user_id, sealed point, battery_level, charging, at, updated_at), one row per person
  - triggers: a person who shares in no Circle loses their `member_locations` row; an owner's open invites end
    when they stop being an owner of that Circle
- **Repositories:** `circles.ts`, `circleInvites.ts`, `memberLocations.ts` (SQL only).
- **Domain module:** `backend/src/circles/`:
  - `circles.ts`: making, renaming and deleting Circles, members, sharing, invites and joining
  - `location.ts`: the reports and who may see them
  - reject bad points: accuracy worse than 1 km, time more than 2 minutes in the future or older than 24 hours,
    more than 200 points in one report; points older than the saved one are ignored
  - rate limit `location-report` (10 a minute per person)
- **Routes:** `backend/src/routes/circles.ts`, added to `API_ROUTES` in `backend/src/app.ts`:

  | Method | Path | What |
  |---|---|---|
  | GET | `/api/circles` | My Circles, their members, and the positions I may see |
  | POST | `/api/circles` `{ name }` | Make a Circle (I am its owner) |
  | PATCH | `/api/circles/:id` `{ name }` | Rename (owners) |
  | DELETE | `/api/circles/:id` | Delete (owners) |
  | PUT | `/api/circles/:id/sharing` `{ sharing }` | Turn my sharing in this Circle on or off |
  | POST | `/api/circles/:id/invites` | A new invite code (owners) |
  | GET | `/api/circles/:id/invites` | Invites nobody has used yet (owners) |
  | DELETE | `/api/circles/:id/invites/:inviteId` | Cancel one (owners) |
  | POST | `/api/circles/invites/check` `{ code }` | Which Circle a code is for, before joining |
  | POST | `/api/circles/join` `{ code }` | Join a Circle with a code |
  | DELETE | `/api/circles/:id/members/:userId` | Remove a member (owners), or leave (my own id) |
  | POST | `/api/location/report` | The phone sends its points and battery |
  | POST | `/api/location/token` | A narrow token for the background task (below) |

- **A token for the background task.** The app keeps its login token with
  `WHEN_UNLOCKED_THIS_DEVICE_ONLY` (`frontend/src/lib/storage/secureStorage.ts`). A background task on a locked
  iPhone cannot read it. The new token kind `location` can **only** call `POST /api/location/report`. It belongs
  to the session that asked for it (like `assistant` tokens), so signing out ends it. The app stores it with
  `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`.
- **Tests** (`backend/test/circles.test.ts`): someone outside the Circle sees nothing; sharing off hides the
  position; bad points are rejected; leaving ends sharing; only owners invite and remove; codes work once; the
  location token cannot call any other route; account deletion removes it all.

### App

- **Install** from `frontend/`:
  `npx expo install expo-location expo-task-manager expo-battery expo-maps`
- **`app.json`**, the `expo-location` plugin:
  - `isIosBackgroundLocationEnabled: true`, `isAndroidBackgroundLocationEnabled: true`
  - `locationAlwaysAndWhenInUsePermission` and `locationWhenInUsePermission`, for example:
    "Park-Lane shares your location with the people in your Family Circle, only when you turn sharing on."
  - a Google Maps API key for Android (`expo-maps`), stored as an EAS secret, not in git
- **Feature folder:** `frontend/src/features/circles/`
  - `services/circlesApi.ts`: the routes above, through `call()` (`features/ems/services/emsHttp.ts`)
  - `services/backgroundTask.ts`: `TaskManager.defineTask(...)` at the top level, imported in the app's entry
    file before anything renders. It reads the battery, sends one report, and stops itself when the backend
    answers `sharing: false`.
  - `hooks/useCircles.ts`: loads the Circles, then listens for `location.updated` and `circle.updated`
  - `hooks/useLocationSharing.ts`: the permission steps and the on/off switch
- **Starting the updates:**
  `Location.startLocationUpdatesAsync(TASK, { accuracy: Balanced, distanceInterval: 100, timeInterval: 60000,
  deferredUpdatesInterval: 60000, foregroundService: { notificationTitle, notificationBody } })`.
  The Android notification is required by the system and cannot be hidden.
- **Permission steps** (the order matters):
  1. Our own explanation first. Google requires this "prominent disclosure" **before** the system asks.
  2. `requestForegroundPermissionsAsync()` ("While using the app").
  3. `requestBackgroundPermissionsAsync()` ("Always"). On Android 11+ this opens system settings, so explain
     that first.
  4. If the person says no, sharing still works while the app is open. Show a button that opens the settings.
- **Screens:**
  - `CircleScreen`: the Circle's map with everyone's dot, and a list under it (name, "5 min ago", battery). My
    sharing switch. Owners: invite, rename, remove. Everyone: leave. Web: the list only.
  - Making a Circle and joining with a code, from the same screen when you have no Circle yet.
  - A Home tile "Family Circle".

**Done when:** on two real phones in the same Circle (one of them **not** in the unit), each sees the other move
and sees the battery; turning sharing off hides the dot within seconds; leaving the Circle stops it.

## Phase 1b: Live view (chosen 18 November 2026: option B)

The owner wanted to watch movement live. Sending fast all the time would empty the battery in about a day, so phones
go live **only while someone watches**:

- The watcher's open map calls `POST /api/location/watch { circleId }` every ~30 s (`useLiveWatch`). It stops when the
  screen closes or the app goes to the background, and pauses after 10 minutes ("Watch live again").
- Each watch makes the Circle's sharing members live for 60 seconds (in memory, `backend/src/circles/live.ts`).
- A sharing phone goes live **at once if its app is open** (realtime `location.live`, handled in `CirclesProvider`),
  otherwise **at its next normal report** (`liveUntil` in the answer), so within about a minute or 100 m.
- Live updates: high accuracy, every ~3 s (`updateMode.ts`). The task's options are changed in place, not stopped
  and started, because Android may refuse to start a location service from the background. The Android
  notification says "watching live", and the iPhone shows its blue location pill. With no answer from the backend,
  a phone leaves live 30 s after the last `liveUntil`.
- The watcher's pins slide over 2 s between positions (`useGlidingMembers`, `glideStep`); jumps over ~2 km land at once.

Option C (a silent push that starts live mode at once even with the app closed) needs the push work of Phase 2.

## Phase 2: Push notifications and place alerts

### 2a. Push notifications (new for the whole app)

Today the backend has only the in-app inbox (`notify()` in `backend/src/ems/notifications.ts`). Place alerts need
push, because the other phones are usually closed.

- **App:** `npx expo install expo-notifications`, the `expo-notifications` plugin, and the token from
  `getExpoPushTokenAsync({ projectId })`, sent after sign-in and removed on sign-out.
- **Credentials:** Android needs an FCM key uploaded to EAS. iPhone needs an APNs key, which needs the Apple
  developer account, **which we do not have yet**. Until then, push works on Android only.
- **Backend:** a `push_tokens` table, `POST` / `DELETE /api/notifications/push-token`, and `notify()` also sending
  through Expo's push service with plain `fetch` (no packages). The kind `family` in `NOTIFICATION_KINDS`.

### 2b. Place alerts

- `Place { id, circleId, name, lat, lng, radiusM }` and `PlaceEvent { placeId, userId, type: 'enter' | 'exit', at }`.
- At most 20 places per Circle (an iPhone watches at most 20 at once), radius 100 m to 500 m.
- The phone notices enter and exit itself (`Location.startGeofencingAsync`), and the backend tells the others
  ("Sara arrived at Home"). The same event within 2 minutes is ignored.

**Done when:** one phone walks out of "Home" and back in, and the other phone (app closed) gets both alerts.

## Phase 3: Location history

- `location_history` (user_id, at, sealed point), kept 30 days, deleted by the hourly upkeep.
- `GET /api/location/history?userId=…&date=YYYY-MM-DD`, only for someone who shares with you in a Circle.
- `DELETE /api/location/history`: delete my own history.
- A day's path on the map, and stops made from the place events.

## 8. Store and legal steps

| Where | What to do |
|---|---|
| Google Play | Fill in the **background location** declaration and upload a short video of the feature and the disclosure. Expect a new review. |
| Google Play | Update the **Data safety** form: location and battery are collected, shared only with the person's Circles, never sold. |
| Apple | Clear "Always" location text and review notes. Needs the Apple developer account first. |
| Both | Update `backend/src/public/privacy.html`. |
| Timing | Merge this branch only when we are ready to submit the update. The permission in the build starts Google's review. |

## 9. Limits and risks

- **Force-closed apps.** On Android, a force-closed app stops sharing until it is opened again. Life360 has the
  same limit.
- **Battery savers.** Some Android makers (Samsung, Xiaomi, Huawei) stop background apps. Show the person how to
  allow Park-Lane.
- **No Expo Go.** Background location needs a development build (`eas build --profile development`).
- **"Live" is not every second.** Updates come about every 100 m or every minute. The app says so.
- **iPhone "Allow once"** looks the same as "While using" to the app. Send the person to Settings.
- **Web** cannot share its own location in the background, and it shows no map.

## 10. Checks before each phase is called done

1. `node .claude/hooks/check-structure.mjs --changed` from the repo root.
2. From `frontend/`: `npx tsc --noEmit` and `npx expo lint`.
3. From `backend/`: `npm run typecheck` and `npm test`. Or `./scripts/dev.sh check` for both.
4. New screens: compare screenshots with `frontend/scripts/visual-regression.mjs`.
5. The phase's "Done when" test on **real phones**. These features cannot be tested properly in a simulator.
