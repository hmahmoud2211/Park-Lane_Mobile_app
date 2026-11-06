# Development guide

## Requirements

- **Node.js 22** (22.18 or newer; the backend runs TypeScript with Node's type stripping). The app's `engines` field asks for 22.x.
- **npm 10** for anything that writes `frontend/package-lock.json`: EAS builds run `npm ci` with npm 10, and npm 11 writes a lockfile it rejects. After installing a package, run `npx -y npm@10.9.9 install` in `frontend/`.
- Git Bash on Windows, or any bash, for `scripts/dev.sh`.
- Optional: Docker (production backend, rethink, the gateway), Python 3.12+ (the gateway), Expo Go or a development build on a phone.

## Install

```bash
cd frontend && npm ci          # the app (patch-package runs on install)
cd ../backend && npm ci        # only TypeScript, for the typecheck; the backend has no runtime packages
cd ../gateway && python -m venv .venv && .venv/bin/pip install -e '.[test]'   # optional: the CUBE gateway (gateway/README.md)
```

There is no install at the repository root. `./scripts/dev.sh check` installs what is missing.

## Configure

| File | Copy from | Holds |
|---|---|---|
| `frontend/.env.local` | `frontend/.env.example` | `EXPO_PUBLIC_DEVICE_BACKEND_URL` (the backend; on a phone use your computer's LAN address), `EXPO_PUBLIC_ASSISTANT_URL` (unset: the hosted demo), `EXPO_PUBLIC_HEALTH_API` and `EXPO_PUBLIC_HEALTH_API_URL` (unset: the mock in development; `http` to use the real backend), `EXPO_PUBLIC_DEMO_TOOLS`, `EXPO_PUBLIC_VISUAL_ROUTES` |
| `backend/.env` | `backend/.env.example` | `PORT`, `ADMIN_API_KEY`, `PUBLIC_URL`, `DATA_DIR`, `EMS_ENCRYPTION_KEY`, the `HA_*` settings; each is documented in the example |

**In development, a value in `.env.local` beats the same variable set in the shell**, so `EXPO_PUBLIC_DEVICE_BACKEND_URL=… npx expo start` is ignored when the file sets it too. Change the file. Web exports and EAS builds work the other way round: there the shell or build profile wins.

`EXPO_PUBLIC_*` values are built into the app, so never put a secret in one. Both env files are git-ignored. `frontend/src/config/env.ts` is the only place the app reads them.

## Run

### Everything at once

```bash
./scripts/dev.sh fake     # the backend against a stand-in Home Assistant, then the app (sign in as demo@parklane.test / correct horse battery)
./scripts/dev.sh local    # Home Assistant (WSL on Windows), the backend, then the app
./scripts/dev.sh check    # app typecheck and lint, backend typecheck and tests
./scripts/dev.sh attach --email you@example.com --token <HA token>   # put an account in a test unit with your Home Assistant
./scripts/dev.sh server   # on the Linux server: build and start the production backend (docs/production.md)
```

Options for `fake` and `local`: `--web` (open the browser), `--no-app`, `--host <ip>`. On Windows you can double-click `ParklaneDev.exe` in the repository root for a menu.

### The app alone

```bash
cd frontend
npx expo start            # press w for web, or scan the QR code with Expo Go / a development build
npx expo start --web
```

Native modules outside Expo Go (`react-native-tcp-socket` for LG pairing, `react-native-wifi-reborn` for joining setup hotspots) need a development build: `npx expo run:android|ios`, or `npx eas-cli@latest build --profile development`.

### The backend alone

```bash
cd backend
npm start                 # node src/index.ts, port 8787
npm run fake-hub          # with a stand-in Home Assistant and a demo unit; nothing is kept
npm run attach-hub -- --email you@example.com --url http://127.0.0.1:8123 --token <long-lived token>
```

The whole backend also runs as one Docker image: see [Run it in Docker](../backend/README.md#run-it-in-docker).

The database is SQLite in `DATA_DIR` (default `backend/data/ems.db`), created and migrated on start (`backend/src/ems/db.ts`). To look inside: `sqlite3 backend/data/ems.db`. **Keep the backend one process**: live state (hub connections, the event bus, rate limits) is in memory.

### The gateway and rethink

See [gateway/README.md](../gateway/README.md) and [CUBE_GATEWAY.md](CUBE_GATEWAY.md). rethink (the local LG ThinQ server used for LG ACs) runs from `docker/rethink` with `docker compose up -d`. Set `RETHINK_HOST_IP` in `docker/rethink/.env` first.

## Test

| What | Command (folder) |
|---|---|
| App typecheck | `npx tsc --noEmit` (`frontend/`) |
| App lint | `npx expo lint` (`frontend/`; add `--no-cache` if it reports stale unresolved imports) |
| Parking demo rules (23 checks) | `npm run check:parking` (`frontend/`) |
| HTTP and realtime clients (35 checks) | `npm run check:transport` (`frontend/`) |
| Health Passport (25 checks) | `npm run check:health` (`frontend/`) |
| Gateway pairing codes (11 checks) | `npm run check:pairing` (`frontend/`) |
| Web build | `npx expo export --platform web` (`frontend/`) |
| Backend typecheck | `npm run typecheck` (`backend/`) |
| Backend tests (HTTP level, including routing rules) | `npm test` (`backend/`) |
| Shared contracts | `backend/node_modules/.bin/tsc -p shared` (root) |
| Gateway | `.venv/bin/pytest -q` (`gateway/`) |

CI (`.github/workflows/ci.yml`) runs the app and backend checks on every pull request, plus a Docker build of the backend that must start and answer. The gateway has its own workflow.

### Visual regression

Screens are measured against their Figma exports, so a refactor must not move a pixel. To compare two states of the app:

```bash
cd frontend
# build each state (git stash / checkout between them)
EXPO_PUBLIC_VISUAL_ROUTES=1 EXPO_PUBLIC_DEVICE_BACKEND_URL= EXPO_PUBLIC_ASSISTANT_URL=http://127.0.0.1:9 \
  npx expo export -p web --output-dir /tmp/web-before
node scripts/visual-regression.mjs capture --dist /tmp/web-before --out /tmp/shots-before
node scripts/visual-regression.mjs capture --profile interactions --dist /tmp/web-before --out /tmp/shots-before
# … the same for "after" …
node scripts/visual-regression.mjs compare /tmp/shots-before /tmp/shots-after
```

It drives headless Chrome (macOS path by default; `--chrome <path>` elsewhere) and compares with ImageMagick's `magick`. Each screen is captured at 390×844 and 1280×800, top and bottom, with a dump of every painted box. Clock and randomness are fixed, so two captures of the same build are identical. The `ems` profile captures signed-in device screens against `npm run fake-hub` (`--backend http://127.0.0.1:<port>`). The `health` profile walks through Health Passport on its mock; build with `EXPO_PUBLIC_HEALTH_API=mock` as well.

## Build for production

| What | How |
|---|---|
| Android / iOS | Actions → "App build (EAS)" → Run workflow, or `cd frontend && npx eas-cli@latest build --profile preview --platform android` |
| Web | Vercel project `park-lane-mobile-app` (production from Master) has Root Directory `frontend` and reads `frontend/vercel.json`. `park-lane_mobile_app_2` builds from the repository root and reads the root `vercel.json`, which runs the same build in `frontend/`. Keep the two files' rewrites and headers the same |
| Backend | `./scripts/dev.sh server` on the server (Docker compose, one container). See [production.md](production.md) |
| Gateway image | the "CUBE Gateway" workflow publishes `ghcr.io/<owner>/cube-os-gateway` |

## Add a feature

Follow the example at the end of [PROJECT_STRUCTURE.md](PROJECT_STRUCTURE.md#adding-a-feature-an-example). In short:
- API types in `shared/contracts`.
- Backend: the route in `backend/src/routes`, SQL in `backend/src/repositories`, tests in `backend/test`.
- App: a client and hook in `frontend/src/features/<domain>`, a screen folder registered in `AppNavigator.tsx` and `navigation.types.ts`, built from `components/`.

## Troubleshooting

| Problem | Fix |
|---|---|
| `dev.sh` stops with "server/ is now backend/…" | A checkout from before the rename: run the `mv` it prints (your `.env` stays out of git). |
| The app says the EMS backend is not configured | Set `EXPO_PUBLIC_DEVICE_BACKEND_URL` in `frontend/.env.local` (moved there from the repository root), then restart Expo with `-c`. |
| EAS fails in "Install dependencies" | The lockfile was written by npm 11. Run `npx -y npm@10.9.9 install` in `frontend/` and commit `package-lock.json`. |
| `npm run typecheck` in `backend/` cannot find TypeScript | Run `npm ci` in `backend/` (TypeScript is the backend's own dev dependency now). |
| A phone cannot reach the backend | Use the computer's LAN address in `EXPO_PUBLIC_DEVICE_BACKEND_URL`, not `localhost`, and make sure both are on the same network. |
| LG pairing or hotspot joining does nothing | It needs a development build (native modules), and runs on a phone, not the web. |
| Every request fails after LG pairing | The phone stayed bound to the appliance's hotspot; see `features/lg/services/lgSetupService.ts` (`unbindProcessNetwork`). |
| The web build calls a gateway and fails | A page served over HTTPS cannot call a gateway on plain HTTP; on the web only a relay address works. |
| A stale bundle in the browser | Restart Expo with `npx expo start -c`. |
