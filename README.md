# Parklane

The resident app for the Park Lane compound: one codebase for iOS, Android and the web, with a backend for the smart home and a gateway for devices in the home. The UI follows a dark "glass" design language (frosted panels with a blue-to-pink hairline), driven entirely by design tokens.

## What it does

- **Home, profile and my unit**: the resident's unit, payments and documents (receipts and passes as PDFs).
- **Visitor access**: invite visitors and share a QR pass.
- **Parking**: a working demo of visitor bookings, QR gate entry and exit, directions to the exact bay, EV charging, a security console and demo controls. It runs on the device; see [docs/PARKING_DEMO.md](docs/PARKING_DEMO.md).
- **Health Passport**: a family's medical records, documents read and checked item by item, and a spoken summary for the doctor, in English and Arabic. See [docs/HEALTH_PASSPORT.md](docs/HEALTH_PASSPORT.md).
- **Clinical Appointment**: book a doctor at the compound's clinic; the visit they approve lands in the patient's Health Passport. See [docs/CLINIC.md](docs/CLINIC.md).
- **Maintenance, community and amenities**: requests, announcements, polls, feedback and bookings (mock content until their backends exist).
- **Smart home**: devices from brand clouds through the EMS backend, and local devices through the CUBE Gateway, with add-device wizards (soft-AP Wi-Fi setup for Shelly, SONOFF and LG ACs), live updates and full controls.
- **Parklane Assistant**: chat and voice, able to read and control the resident's devices.

## Technologies

| Part | Stack |
|---|---|
| App ([`frontend/`](frontend)) | [Expo SDK 58](https://docs.expo.dev/versions/v58.0.0/), React Native 0.88, React 19.3, TypeScript, React Navigation (native stack), `expo-blur` / `expo-linear-gradient`, Inter |
| Backend ([`backend/`](backend)) | Node 22 running TypeScript directly (no runtime packages), SQLite (`node:sqlite`), WebSocket, one Home Assistant container per unit via the Docker API |
| Shared contract ([`shared/`](shared)) | Type-only TypeScript used by both |
| Gateway ([`gateway/`](gateway)) | Python, FastAPI, one Docker image (home box, relay or server-hosted) |
| Builds and hosting | EAS (app), Vercel (web, root directory `frontend`), Docker (backend, gateway), GitHub Actions |

## Repository layout

```
frontend/   the app            backend/   the EMS device backend      shared/   API types
gateway/    the CUBE Gateway   docker/    rethink for LG ACs          scripts/  dev.sh
docs/       documentation      tools/     Windows launcher source
```

[docs/PROJECT_STRUCTURE.md](docs/PROJECT_STRUCTURE.md) walks through every folder.

## Quick start

```bash
# the app
cd frontend
npm ci
cp .env.example .env.local      # point EXPO_PUBLIC_DEVICE_BACKEND_URL at a backend
npx expo start                  # w for the web, or scan the QR code

# the backend with a stand-in Home Assistant, plus the app, in one command (repository root)
./scripts/dev.sh fake           # sign in as ems / 5002, or demo@parklane.test / correct horse battery

# before you push
./scripts/dev.sh check          # app typecheck and lint, backend typecheck and tests
```

Use Node 22, and npm 10 for anything that writes the app's lockfile (EAS runs `npm ci` with npm 10). The [development guide](docs/DEVELOPMENT_GUIDE.md) covers configuration, every command, tests, builds and troubleshooting.

## Architecture in brief

```
app (frontend/) ──HTTPS + WebSocket──► EMS backend (backend/) ──► Home Assistant per unit ──► brand clouds
      │ ──────────HTTP (LAN / relay)──► CUBE Gateway (gateway/) ──► local devices
      └─────────chat / voice──────────► Parklane Assistant ──(assistant token)──► EMS backend
```

In the app, screens compose shared components and call feature hooks. Hooks use feature services, which reach every system through one fetch core and one reconnecting socket (`frontend/src/lib`). Settings live in `frontend/src/config`.

The backend layers its HTTP plumbing, route modules, domain modules and repositories, and runs as a single process. The API types the app and the backend share are in `shared/contracts`.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the diagrams and flows, and [docs/API_DOCUMENTATION.md](docs/API_DOCUMENTATION.md) for the API.

## Design system

- **Tokens** (`frontend/src/theme`): colours, typography, spacing, radius, shadows, glass, layout, breakpoints and motion. No raw colour or font size appears outside that folder; components read tokens with `useAppTheme()`.
- **The Glass frame** (`frontend/src/components/common/GlassSurface.tsx`): a blur backdrop, a translucent 20% `#4F7BFF → #FF5CCB` gradient and a white hairline or glowing ring. New cards, fields and buttons are built on it.
- **Screens** are measured against their Figma exports in `frontend/assets/Screens`. The inner screens share one rhythm, `layout.innerScreen`.
- [docs/COMPONENTS.md](docs/COMPONENTS.md) lists every shared component and how to compose them.

### Responsive layout

Four device classes (`frontend/src/theme/breakpoints.ts`): mobile (< 768), tablet (768–1023), laptop (1024–1439) and desktop (1440+). Phones keep the Figma-measured layouts exactly. From tablet up, `AppShell` replaces each screen's bottom bar with a side rail (`SideNav`, built from the same tab list in `navigation/navTabs.ts`), and pages reflow:

- `useScreenLayout()` gives a screen its frame width (the window minus the rail), gutter, column count, and a `contentStyle` for its scroll content. Use it instead of `useWindowDimensions()`; pass `columnFrameWidth` to scale helpers.
- `ResponsiveColumns` sets a page's sections side by side when there is room for two phone-width columns, and stacks them otherwise.
- `ResponsiveGrid` fits as many tiles per row as the width allows, never fewer than the phone design's count.
- A screen with app navigation calls `useSideNav()` (`BottomBar` does it for you). Screens without navigation (onboarding, login, a visitor's pass) get no rail.

## Documentation

| Document | For |
|---|---|
| [docs/PROJECT_STRUCTURE.md](docs/PROJECT_STRUCTURE.md) | Every folder, where things go, adding a feature |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System, app and backend architecture, auth, realtime |
| [docs/COMPONENTS.md](docs/COMPONENTS.md) | The component system and design conventions |
| [docs/API_DOCUMENTATION.md](docs/API_DOCUMENTATION.md) | The EMS backend's API and realtime events |
| [docs/DATABASE_SCHEMA.md](docs/DATABASE_SCHEMA.md) | The backend's one database: every table, how they connect, the clinic's place in it |
| [docs/DEVELOPMENT_GUIDE.md](docs/DEVELOPMENT_GUIDE.md) | Setup, running, testing, building, troubleshooting |
| [docs/REFACTOR_REPORT.md](docs/REFACTOR_REPORT.md) | The November 2026 restructuring: what changed and why |
| [docs/SMART_HOME.md](docs/SMART_HOME.md) | The smart home through the EMS backend and Home Assistant |
| [docs/CUBE_GATEWAY.md](docs/CUBE_GATEWAY.md), [gateway/API.md](gateway/API.md) | The CUBE Gateway |
| [docs/PARKING_DEMO.md](docs/PARKING_DEMO.md) | The parking demo |
| [docs/HEALTH_PASSPORT.md](docs/HEALTH_PASSPORT.md) | Health Passport, its API and what is still open |
| [docs/CLINIC.md](docs/CLINIC.md) | The clinic: booking, consultations, AI, access rules, setting up doctors |
| [docs/production.md](docs/production.md) | Running the backend in production |
| [AGENTS.md](AGENTS.md) | Rules for coding agents working in this repository |
