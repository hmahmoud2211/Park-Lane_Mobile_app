# Refactor report — November 2026

Branch `refactor/architecture`, 42 commits on top of Master `64d7c3c`, each one passing the checks below on its own. The aim was a clear, maintainable structure **without changing what the app does or how it looks**:

- **Functionality and visuals are unchanged**, proven pixel by pixel against the original build.
- **Two intended changes:** a crash fix and one small resilience addition.
- **One new feature flag**, which defaults to on.

## What was wrong

- **No separation of programs**: the Expo app sat at the repository root next to `server/`, `gateway/`, Docker files, an orphaned `IOT/core` gitlink and committed launchers. The backend's typecheck borrowed the app's `node_modules`.
- **API types copied by hand on both sides**, already drifted: the app lacked the `forbidden` and `flow_expired` error codes, and nothing tied `/api/home` to a type.
- **Backend**: one 342-line `app.ts` mixed routing, auth, rate limits, CORS and errors. SQL was spread through domain modules, `ha/hubs.ts` was 560 lines (store, live connection and registry in one), and helpers were copied around.
- **App, infrastructure**: five fetch-with-timeout wrappers, two copies of the same reconnecting WebSocket class, two secure-storage set-ups and five copies of an "error to message" helper.
- **App, layering**: a service imported a UI component, the navigation types imported a component and a feature, components imported types from hooks, and screens imported other screens' files.
- **App, configuration**: environment variables were read in two modules, and brand strings and device addresses were typed out across components.
- **App, repeated UI**: the same page frame appeared in twelve screens, the header menu and logout in nine, spinners and error notices with retry in many places, and the forms' CTA in four.
- **Coverage gaps**: no CI for the app or the backend, and no test of the router's behaviour. Visual changes could only be checked by eye.
- **A crash**: opening `/parking/map` without query parameters crashed the web app. The visual capture found it.

## What changed

### Repository (commits `a23c9dc` … `bf31847`)

| Before | After |
|---|---|
| App at the root | `frontend/` (`git mv`, history kept; the lockfile is a 100% rename) |
| `server/` | `backend/` (`git mv`), with its own TypeScript dev dependencies and lockfile |
| — | `shared/contracts/` (type-only API types) |
| `IOT/core` (gitlink without `.gitmodules`) | removed; the local-setup guide clones Home Assistant core at the same commit (`817cea76`, verified upstream) |
| `scripts/ParklaneDev.exe` (stale duplicate) | removed; the root launchers still work (they find `scripts/dev.sh` from their folder) |
| `docker/rethink/data/` showed as untracked (CA certificate, state) | ignored |
| No CI for app or backend | `.github/workflows/ci.yml` |

`scripts/dev.sh` works on `frontend/` and `backend/`. On a checkout from before the move it prints the exact `mv` for a leftover `server/.env` and stops; it never moves secrets itself. It also points out a leftover `.env.local` or root `node_modules`.

The EAS workflow runs in `frontend/`, with three fixes:
- `cache-dependency-path` points at `frontend/package-lock.json`.
- `hashFiles()` takes `frontend/builds.json`; it resolves from the repository root, not the working directory.
- The token check, which runs before checkout, keeps the workspace root.

### Shared contracts (`3e53918`, `f0ed14f`)

`shared/contracts/{home,accounts,auth,events,errors,envelope}.ts` hold the API types once.

- **Backend:** `ha/types.ts`, `errors.ts`, `ha/flows.ts`, `ha/integrations.ts`, `ha/accounts.ts` and `ems/auth.ts` re-export them under the same names, adding only their own extras (`HubStatus | 'failed'`). `homeFor()` now returns the shared `Home` type.
- **App:** `types/home.types.ts` and `ems.types.ts` build on them, and add the gateway-only `Device` fields.
- **Type-only import rule:** everything is imported with `import type`, which both Babel and Node's type stripping erase. The backend image (which has no `shared/`) runs as before, and the app bundles contain nothing from it. CI typechecks `shared/` and rejects value imports.

### Backend (`00170d9`, `3fd0900` … `ce1335a`)

- `test/routing.test.ts` (16 tests) was written against the old router first, to pin the routing rules: 404 never 405, the caller checked before the method, CORS on every answer, `OPTIONS` 204, the access log never printing the query.
- `http/`: context, an ordered router of route groups, guards, a rate-limit table (same numbers), body parsing, answers, CORS, error answers, the access log.
- `routes/`: `auth`, `home`, `accounts`, `ops`, moved verbatim.
- `repositories/`: every SQL statement (users, tokens, units, hubs, pairing sessions, audit); the statements are unchanged.
- `ha/hubs.ts` is split into `hubStore.ts` (stored hub), `hubRuntime.ts` (live connection) and the registry (`hubs.ts`, which re-exports the rest). The Docker Engine client moved to `integrations/docker.ts`.
- `lib/`: `sameSecret`, `parseJsonOrText`, `trimmedText`. `scripts/lib/adminApi.ts` is shared by `fake-hub` and `attach-hub`.
- Every module the tests or the work in progress import keeps its path and exports. `config.ts` stays where it is: it finds `.env` relative to itself.

### App: structure (`4a05b07` … `56d6f1f`)

- `src/features/<domain>/{services,hooks,context,components,types.ts}` for documents, parking, lg, provisioning, assistant, ems, home and gateway. The moves were made with a ts-morph codemod (imports rewritten), one domain per commit, each `.web.ts` moving with its native twin. `src/services/` and the domain folders in `components/`, `hooks/` and `context/` are gone.
- **Imports that pointed the wrong way are fixed:**
  - `IconSet` moved to `types/icons.types.ts`, and `Lang` to `types/i18n.types.ts`.
  - Types defined in hooks moved to `features/*/types.ts`.
  - The demo resident moved to `data/demoResident.ts`, `formatDate` and `guestsLabel` to `utils/format.ts`, the form sizes to `components/forms/formMetrics.ts`, and `statScaleFor` to `utils/responsive.ts`.
  - App-wide components left `components/parking`: `Notice` → `components/feedback`, `QrScanner` → `components/common`, `ParkingButton` → `components/ui`.
- **`src/config/`:**
  - `env.ts` is the only reader of `process.env`, with each variable written out in full so Expo still inlines it (checked in the bundle).
  - The former `constants/*Config.ts` became `config/ems`, `assistant`, `gateway` and `lg`.
  - New modules: `brand.ts` (product names, the `parklane://` return URL), `demo.ts` (the three demo identities, documented), `vendorDevices.ts` (setup-hotspot addresses) and `flags.ts`.
  - `frontend/.env.example`.

### App: infrastructure (`6c86b94` … `b849830`)

- **`lib/http`:**
  - `timedFetch()`: timeout, the caller's cancel, and a read step inside the timeout.
  - `jsonRequest()` and `readEnvelope()`.
  - The EMS, gateway, assistant and device clients keep their signatures, error classes and wording. Each still decides whether a timeout or a cancel wins.
- **`lib/realtime/ReconnectingSocket`:** both event channels extend it. The back-off formula is unchanged; the EMS channel still lets a constructor error through, and the gateway's still retries and can `retarget()`.
- **`lib/storage`:** the Keychain options and the tab storage. Keys and options are unchanged, so existing sessions and paired gateways are still found.
- **Error helpers:** `emsErrorText()` and `gatewayErrorText()` replace five copies.
- **`utils/format`:**
  - `SHORT_MONTHS`, `formatClock12()` and `pad2()` replace six month arrays, three clock formatters and two `pad`s. A throwaway check compared old and new over 5,376 inputs; all identical.
  - `utils/typography.scaledType()` replaces four identical blocks.
- **`npm run check:transport`** (22 checks, also in CI) pins every client's and channel's behaviour. The checks were written against the old code first; the realtime checks pass on both the old and new classes.

### App: design system and components (`5480497` … `f4ab6d1`)

- **Theme:**
  - Stroke colours reference the palette, and five assistant type variants share their inner-screen twins.
  - `layout.innerScreen` holds the inner screens' rhythm, adopted by 24 style files where the value matched exactly.
  - The serialized theme is byte-identical.
- **New shared pieces:**

  | Piece | Replaces |
  |---|---|
  | `hooks/useScreenMenu` and `useLogout` | the menu and logout code in nine screens; logout still does not end the EMS session |
  | `layout/InnerScreenFrame` | the page frame of twelve screens |
  | `feedback/LoadingState` | spinners in eight places |
  | `feedback/ErrorNotice` | error notices with retry in three places |
  | `ui/SelectableCard` | the tappable glass card in three lists |
  | `forms/FormSubmitButton` | the CTA of four forms |
  | `features/ems/services/readyHome()` | the hub-readiness check in five places |
  | `features/gateway/components/NoGatewayNotice` | the "connect a gateway" notice in two places |

- **Kept separate on purpose, because they look different:**
  - The two notices and the two device cards. The look-alikes got distinct names: `LgNotice` and `SmartHomeDeviceTile`.
  - The six step indicators and the four tab controls.

  [COMPONENTS.md](COMPONENTS.md) lists why.
- **Removed (nothing used them):** `AssistantLauncher`, `ActivityRow`, `GoogleMark`, `constants/appConfig.ts`, two images, four unused definitions and twelve needless exports.

## Intended behaviour changes

1. **Fix** (`86a2229`): `/parking/map` without parameters no longer crashes.
2. **Resilience** (`30de1a2`): EMS reads that are safe to repeat (`me`, home, devices, a device, rooms, integrations, accounts) are tried once more after 500 ms when the request could not reach the backend. Timeouts, writes and the backend's own errors are never retried (a check pins this). Drop the `retry: true` flags in `features/home/services/homeApi.ts` and `features/ems/services/emsApi.ts` to undo it.
3. **New flag** (`f4ab6d1`): `EXPO_PUBLIC_DEMO_TOOLS=0` hides the parking demo's tools and their web addresses. It is on when unset, so builds behave as before until a profile turns it off.

Breaking for developers only: app commands run from `frontend/`, and `server/` is `backend/` (see "Steps outside the repository").

## Dependencies

- **Added:** `typescript` and `@types/node` as backend dev dependencies (the versions it already used from the app's `node_modules`).
- **Removed:** none.
- **Unchanged:** the app's dependencies and lockfile.
- **Test-time only, not part of the project:** `tsx` (via `npx`, as `check:parking` already did) and ImageMagick plus Chrome for the visual capture.

## How it was verified

Results from the final run of each check:

| Check | Result |
|---|---|
| `./scripts/dev.sh check` on the committed code | app typecheck 0 errors, lint clean, backend typecheck 0 errors, backend tests 73/73 (the original 57 plus 16 routing tests) |
| `npm run check:parking` | 23/23 |
| `npm run check:transport` (new) | 22/22 |
| `backend/node_modules/.bin/tsc -p shared` and the type-only import check | pass (459 files) |
| `npx expo export -p web` and `-p android` | both build, after every commit |
| Backend image contents (`package.json`, `src`, `scripts` only, no `shared/`) started with plain Node | answers `401` without a token |
| `npx -y npm@10.9.9 ci --dry-run` in `frontend/` and `backend/` | pass |
| Visual regression: every route at 390×844 and 1280×800, top and bottom, painted-box dumps, plus the header menus open and logout on nine screens (243 files), against a build of the original code | **0 differences** at each checkpoint (after the move, the feature moves, configuration and transport, the theme, and the components) |
| Visual regression with `EXPO_PUBLIC_DEMO_TOOLS=0` | demo strip and menu item absent |
| `npx expo-doctor` | 18/20. The two failures are pre-existing: 14 Expo packages a patch behind (one a minor behind), and `react-native-tcp-socket` untested on the New Architecture. The lockfile is unchanged by this work. |

**Visual capture:** headless Chrome with software rendering, a fixed clock and seeded randomness; a capture compared with itself shows 0 differences. Its harness is `frontend/scripts/visual-regression.mjs`.

**The unfinished Direct-mode work** was carried through the refactor uncommitted, with only its import paths updated. It was later merged with the refactor, which failed the new CI, so it now lives on the `feature/direct-mode` branch until it is finished. Nothing in the app or backend imported it, so removing it from Master changes no behaviour.

**Not run:**
- An EAS build: it uses the account's build quota, so it is left to the reviewer (Actions → "App build (EAS)" on this branch).
- Docker itself: the daemon was not running, so the image was emulated as above, and CI builds it.
- The gateway's pytest suite: not installed here. `gateway/` changed only in code comments.
- Native runs on a phone.

## Steps outside the repository

1. **Vercel**: set Root Directory to `frontend` on both projects, then redeploy `park-lane-mobile-app`. **Do this as part of merging, not after:** that project has no build command of its own, so with the old setting a Master build finds nothing to build, "succeeds" with an empty deployment, and replaces the live site with a 404. That happened when this branch was merged. `park-lane_mobile_app_2` deploys production from `feature/home-assistant-integration`, so it only fails its Master previews.
2. **Production backend** (`/opt/parklane`, branch `feature/home-assistant-integration`): once that branch gets this change, `git pull && ./scripts/dev.sh server` stops and prints the command. Run `mv server/.env backend/.env && rmdir server`, then `./scripts/dev.sh server` again. Data in `/srv/parklane` is not affected; see [production.md](production.md).
3. **Each development machine**:
   - `mv .env.local frontend/`.
   - Move `server/.env` (and `server/data` if `DATA_DIR` is relative) into `backend/`.
   - Delete the root `node_modules`.
   - Run `./scripts/dev.sh check`.
4. **Optional**:
   - Delete `EXPO_PUBLIC_CUBE_URL` and `EXPO_PUBLIC_CUBE_PASSWORD` from `.env.local`. Nothing reads them, and an `EXPO_PUBLIC_*` value is built into the app.
   - Make the "Checks" workflow required for pull requests.
5. **Merging** touches `gateway/` (code comments only), so the gateway workflow will rebuild and publish its image on Master.

## Remaining issues and technical debt

- **Not done in this pass** (planned, but optional and visually risky):
  - **Splitting the largest files:** `SiteMap.tsx` (890 lines), `SmartHomeScreen.tsx` (~780), `DeviceProvisioningScreen` (~650), `ReserveParkingScreen`, `LgPairingSteps`, parking `Controls.tsx`, `MapLayers`, `MaintenanceScreen`, `GatewaySetupScreen`, `AcControlScreen`, `DeviceControl`, `CommunityScreen` and `VisitorAccessScreen`.
  - **A shared select field:** an anchored select (`SelectField` / `useAnchoredSelect`) for the Visitor Access, booking, feedback and maintenance forms.

  Both are pure extractions, and the visual harness makes them safe to do one at a time.
- **Kept on purpose:**
  - **EmsContext and GatewayContext** still hold many concerns and start at launch. Splitting them or loading them lazily changes network timing.
  - **The three demo identities stay separate:** the screens' resident, the parking seed's `res-ahmed` and the assistant's resident 1001. Unifying them changes visible data, and the assistant's ID is a real record on its backend; `config/demo.ts` documents them.
  - **The app's Login screen is not wired to a backend,** and logging out does not end the EMS session (`TODO(auth)`).
- **Not abstracted yet:** the "listen for events, poll as a fallback" loops (five places) and the fetch-on-mount effects with a `cancelled` flag.
- **Platform and dependency work:**
  - **API types:** the gateway's are still mirrored by hand (Python ↔ `types/gateway.types.ts`).
  - **Dependencies:** run `npx expo install --fix`, then regenerate the lockfile with npm 10, and check `react-native-tcp-socket` on the New Architecture.
  - **Demo-tools flag:** `EXPO_PUBLIC_DEMO_TOOLS` is not yet set to `0` in any EAS profile; decide for production.
- **Small leftovers:**
  - Unused `theme` parameters in three `createStyles(theme)` functions (the codebase's convention).
  - The gateway API client keeps wrappers the app does not call yet.
  - `docker/rethink/.env` stays tracked: it holds only a LAN IP, and untracking it would delete it on other clones.
- **The Direct-mode work** (branch `feature/direct-mode`) still needs:
  - its `/api/direct` routes (now a `routes/direct.ts` module added to `API_ROUTES`), a migration for `direct_devices`, `config.direct`, `membersOfUnit` and its error codes in `shared/contracts/errors.ts`;
  - in the app: its types in `shared/contracts`, `EmsContext` support and a registered route.
