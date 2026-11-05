# Project structure

Park-Lane is one repository with three programs and their shared contract:

| Folder | What it is | Language / runtime |
|---|---|---|
| [`frontend/`](../frontend) | The resident app: phone (iOS, Android) and web, one codebase | Expo SDK 58, React Native 0.88, React Navigation |
| [`backend/`](../backend) | The EMS device backend: accounts, the resident's home through one Home Assistant per unit, realtime updates | Node ≥ 22.18 running TypeScript directly, no runtime packages |
| [`shared/`](../shared) | The API contract between those two, as TypeScript types only | Type-only TypeScript |
| [`gateway/`](../gateway) | The CUBE Gateway: a box (or container) in the home that controls local devices | Python 3.12+, FastAPI |

Supporting folders: [`docker/rethink`](../docker/rethink) (the local LG ThinQ replacement for development), [`scripts/dev.sh`](../scripts/dev.sh) (runs the pieces together), [`tools/launcher`](../tools/launcher) (the Windows launchers' source), [`docs/`](.) and [`.github/workflows`](../.github/workflows).

There is no root `package.json`: each program installs and runs from its own folder.

## The tree

```
Park-Lane_Mobile_app/
├── frontend/                       the app (run every app command from here)
│   ├── App.tsx, index.ts           entry: providers, fonts, navigator
│   ├── app.json, eas.json          Expo config and EAS build profiles
│   ├── vercel.json                 the web build's hosting (Vercel root directory: frontend)
│   ├── package.json + lock         npm 10 lockfile (EAS runs npm ci with npm 10)
│   ├── patches/                    patch-package fixes applied on install
│   ├── assets/                     icons, splash, the Figma screen exports (assets/Screens)
│   ├── scripts/visual-regression.mjs
│   ├── .env.example                the EXPO_PUBLIC_* settings
│   └── src/
│       ├── components/             UI every screen may use (no business logic)
│       │   ├── common/             primitives: AppText, AppButton, AppInput, GlassSurface, AppIcon, QrScanner …
│       │   ├── ui/                 composed pieces: NeonPanel, PanelHeading, StatusChip, FilterChip, AppMenu, SelectableCard …
│       │   ├── layout/             page structure: ScreenWrapper, PageHeader, BottomBar, InnerScreenFrame, ResponsiveColumns …
│       │   ├── feedback/           Notice, LoadingState, ErrorNotice
│       │   └── forms/              formMetrics, FormSubmitButton
│       ├── features/<domain>/      everything one domain needs
│       │   ├── services/           API clients and pure logic (no React)
│       │   ├── hooks/              React state over those services
│       │   ├── context/            app-wide providers, where the domain has one
│       │   ├── components/         UI only this domain uses
│       │   └── types.ts            the domain's own types
│       ├── screens/<Name>Screen/   one folder per route: <Name>.tsx, .styles.ts, .data.ts, index.ts
│       ├── navigation/             AppNavigator (routes, web addresses) and navTabs
│       ├── config/                 every setting: env.ts reads EXPO_PUBLIC_*, plus ems, assistant, gateway, lg, brand, demo, flags, vendorDevices
│       ├── lib/                    app infrastructure: http (fetch core), realtime (reconnecting socket), storage
│       ├── context/                app-wide UI state: AppContext, ThemeContext, ShellContext
│       ├── hooks/                  app-wide UI hooks: useAppTheme, useScreenLayout, useScreenMenu, useReduceMotion …
│       ├── theme/                  every design token: colours, typography, spacing, radius, shadows, glass, layout, breakpoints, motion
│       ├── types/                  app-wide types: navigation, theme, icons, i18n, and home / ems / gateway (API types)
│       ├── data/                   mock content shared by several screens (the demo resident)
│       ├── utils/                  small pure helpers: format, responsive, typography, share, web fixes
│       ├── constants/images.ts     the image table (require() of every bundled image)
│       └── assets/images/          the bundled images
├── backend/
│   ├── package.json + lock         only TypeScript and Node's types, for the typecheck
│   ├── Dockerfile, compose.yaml    the production image and how it runs (one container)
│   ├── .env.example                every setting, documented
│   ├── src/
│   │   ├── index.ts                start: database, hub connections, listen
│   │   ├── app.ts                  the HTTP server: CORS, OAuth callback, dispatch, errors, access log
│   │   ├── config.ts               settings, read once (do not move: it finds .env next to itself)
│   │   ├── http/                   plumbing: context, router, guards, rate limits, body, answers, CORS, errors, access log
│   │   ├── routes/                 one module per API area: auth, home, accounts, ops
│   │   ├── ems/                    accounts and tokens, the realtime WebSocket, migrations, sealing secrets
│   │   ├── ha/                     the home facade over Home Assistant: hubs, mapping, commands, account linking, provisioning
│   │   ├── repositories/           every SQL statement, one file per table
│   │   ├── integrations/           outside systems besides Home Assistant (the Docker Engine API)
│   │   └── lib/                    small pure helpers
│   ├── test/                       HTTP-level tests and a stand-in Home Assistant (fakeHa.ts)
│   └── scripts/                    fake-hub (development), attach-hub
├── shared/contracts/               home, accounts, auth, events, errors, envelope (+ index)
├── gateway/                        see gateway/README.md and gateway/API.md
├── docker/rethink/                 rethink, its Mosquitto broker and a DNS redirect, for LG ACs
├── scripts/dev.sh                  fake | local | check | attach | server
├── tools/launcher/                 source of ParklaneDev.exe and ParklaneAttach.exe (in the root)
└── docs/                           this documentation
```

## How the pieces connect

```
screen ──► feature hook ──► feature service ──► lib/http (fetch core) ──► backend route ──► repository / Home Assistant
   │             │                                lib/realtime ◄── backend /api/events (WebSocket)
   │             └─► feature context (EMS session, gateway, parking store)
   └─► components (common / ui / layout / feedback / forms) ──► theme tokens
```

- **Screens** compose components and call hooks. A screen never calls `fetch` and never imports another screen's files.
- **Feature hooks** hold React state over a feature's services and context, e.g. `useHomeDevices` (devices through the EMS backend), `useGatewayDevices` (devices through the CUBE gateway), `useLgPairing`.
- **Feature services** talk to one system each: `features/ems/services/emsHttp.ts` (the EMS backend), `features/gateway/services/gatewayHttp.ts` (a gateway), `features/assistant/services/assistantApi.ts` (the Parklane Assistant), `features/provisioning/services/deviceHttp.ts` (a device on its setup hotspot), `features/lg/services` (an LG appliance over TLS). All HTTP goes through `lib/http/request.ts`; both event channels extend `lib/realtime/ReconnectingSocket.ts`.
- **Contexts** that start at launch: `EmsProvider` (session, home, live device list), `GatewayProvider` (paired gateways, connection), `ParkingDemoProvider` (the on-device parking store), plus the UI contexts.
- **The backend** answers under `/api/...` (see [API_DOCUMENTATION.md](API_DOCUMENTATION.md)). Its routes call the domain modules in `ems/` and `ha/`, which use `repositories/` for SQLite and `ha/haClient.ts` / `haRest.ts` for each unit's Home Assistant.
- **The contract** (`shared/contracts`) is imported with `import type` by `frontend/src/types/home.types.ts` / `ems.types.ts` and by `backend/src/ha/types.ts`, `errors.ts` and friends. Types are erased on both sides, so nothing in `shared/` ever runs.

### Where each feature lives

| Feature | Screens | Domain code |
|---|---|---|
| Home, profile, my unit, services, settings | `HomeScreen`, `ProfileScreen`, `MyUnitScreen`, `ServicesScreen`, `SettingsScreen` | `data/demoResident.ts`, `features/documents` (PDFs) |
| Visitor access, maintenance, community, amenities | `VisitorAccessScreen`, `MaintenanceScreen`, `CommunityScreen`, `AmenitiesBookingScreen` | mock content in each screen's `.data.ts`; shared forms in `components/forms` |
| Parking demo | `ParkingScreen`, `ReserveParkingScreen`, `ReservationDetailsScreen`, `ReservationHistoryScreen`, `ParkingMapScreen`, `ChargingSessionScreen`, `GuestPassScreen`, `SecurityConsoleScreen`, `DemoControlsScreen` | `features/parking` (see [PARKING_DEMO.md](PARKING_DEMO.md)) |
| Smart home (EMS backend) | `SmartHomeScreen`, `EmsDevicesScreen`, `DeviceDetailScreen`, `ConnectAccountScreen` | `features/ems`, `features/home`; backend `routes/home.ts`, `routes/accounts.ts`, `ha/` |
| Smart home (CUBE gateway) | `GatewaySetupScreen`, `AddDeviceScreen`, `AddDeviceMethodScreen`, `DeviceDiscoveryScreen`, `DeviceProvisioningScreen`, `DeviceSetupScreen`, `AcControlScreen` | `features/gateway`, `features/provisioning`; `gateway/` |
| LG pairing | `LgPairingScreen` | `features/lg` |
| Assistant | `AssistantScreen` | `features/assistant` |

## Configuration

| Where | What |
|---|---|
| `frontend/.env.local` (from `.env.example`) | `EXPO_PUBLIC_DEVICE_BACKEND_URL`, `EXPO_PUBLIC_ASSISTANT_URL`, `EXPO_PUBLIC_DEMO_TOOLS`, `EXPO_PUBLIC_VISUAL_ROUTES` for development |
| `frontend/eas.json` | the same variables per build profile |
| `frontend/src/config/` | everything the app reads; `env.ts` is the only file that touches `process.env` |
| `backend/.env` (from `.env.example`) | every backend setting; `backend/src/config.ts` reads it |
| `gateway/` | `CUBE_*` environment variables (gateway/README.md) |
| `docker/rethink/.env` | `RETHINK_HOST_IP` |

## Conventions

- **Screens** live in `frontend/src/screens/<Name>Screen/` as `<Name>Screen.tsx`, `.styles.ts` (measured against `frontend/assets/Screens`), `.data.ts` (copy and mock content) and `index.ts`. Register a route in `navigation/AppNavigator.tsx` and type it in `types/navigation.types.ts`.
- **No raw colours or font sizes** outside `src/theme/`. The inner screens' rhythm is `layout.innerScreen`.
- **Domain code** goes in `features/<domain>/`: services without React, hooks with it. Code two domains share goes in `lib/` (infrastructure), `components/` (UI) or `utils/` (pure helpers).
- **Settings** go in `config/`; a new `EXPO_PUBLIC_*` variable is read in `config/env.ts`, written out in full.
- **Backend**: a route goes in the matching `routes/` module; its SQL in `repositories/`; its rules in `ems/` or `ha/`. Keep the backend one process.
- **API types** change in `shared/contracts` and are imported with `import type` only (CI checks this).

## Adding a feature: an example

Say residents can report a lost item:

1. **Contract**: add `LostItem` to a new `shared/contracts/lostItems.ts` and re-export it from `index.ts`.
2. **Backend**: a `lost_items` table in a new migration in `backend/src/ems/db.ts`; `backend/src/repositories/lostItems.ts` with its SQL; the rules in a domain module; `backend/src/routes/lostItems.ts` with `GET/POST /api/lost-items`, added to `API_ROUTES` in `app.ts`; HTTP-level tests in `backend/test/`.
3. **App**: `frontend/src/features/lostItems/services/lostItemsApi.ts` calling `call()` from `features/ems/services/emsHttp.ts`; a `useLostItems` hook; a `LostItemsScreen` folder; the route in `AppNavigator.tsx` and `navigation.types.ts`; build it on `InnerScreenFrame`, `NeonPanel`, `LoadingState`, `ErrorNotice`.
4. **Check**: `./scripts/dev.sh check`, then the visual-regression capture for any screen you touched.
