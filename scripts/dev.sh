#!/usr/bin/env bash
# Runs the Parklane smart home in one command. See docs/SMART_HOME.md.
#
#   ./scripts/dev.sh fake      Mode 1: the backend with a pretend Home Assistant, then the app
#   ./scripts/dev.sh local     Mode 2: Home Assistant (in WSL), the backend, then the app
#   ./scripts/dev.sh check     App typecheck and lint, backend typecheck and tests
#   ./scripts/dev.sh attach --email you@example.com --token <long-lived token> [--url http://127.0.0.1:8123]
#                              Puts your EMS account in a test unit and attaches Home Assistant (once)
#   ./scripts/dev.sh server    Mode 3, on the Linux server: builds the backend image and starts it (backend/compose.yaml)
#
# Options for fake and local:
#   --web       open the app in the web browser straight away
#   --no-app    start everything except the app (Expo)
#   --host IP   the address the app uses to reach the backend (default: this PC's network address)
#
# Run it from Git Bash on Windows (or bash on Linux/macOS). Ctrl+C stops what this script started;
# a Home Assistant or backend that was already running is reused and left running.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP="$ROOT/frontend"
BACKEND="$ROOT/backend"
LOGS="$ROOT/.dev-logs"
BACKEND_PORT="${PORT:-8787}"
# The Parklane Assistant (Al_Atal_Voice), when it runs on this PC.
ASSISTANT_PORT="${ASSISTANT_PORT:-8001}"
HA_PORT=8123
WSL_DISTRO="${WSL_DISTRO:-Ubuntu-24.04}"
HA_START='source ~/ha-venv/bin/activate && exec hass -c ~/ha-config'

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
ok() { printf '  \033[32m✔\033[0m %s\n' "$*"; }
info() { printf '  • %s\n' "$*"; }
fail() {
  printf '  \033[31m✖ %s\033[0m\n' "$*" >&2
  exit 1
}

# ---- Helpers -----------------------------------------------------------------------------

STARTED_PIDS=()
STARTED_HA_IN_WSL=0

cleanup() {
  trap - INT TERM EXIT
  if [ "${#STARTED_PIDS[@]}" -gt 0 ] || [ "$STARTED_HA_IN_WSL" = 1 ]; then
    echo
    bold "Stopping what this script started…"
  fi
  for pid in "${STARTED_PIDS[@]:-}"; do
    [ -n "$pid" ] && kill "$pid" 2>/dev/null || true
  done
  if [ "$STARTED_HA_IN_WSL" = 1 ]; then
    wsl.exe -d "$WSL_DISTRO" -- pkill -INT -f "hass -c" 2>/dev/null || true
  fi
}

is_windows() { [[ "${OSTYPE:-}" == msys* || "${OSTYPE:-}" == cygwin* ]]; }

port_open() { curl -s -o /dev/null -m 2 "http://127.0.0.1:$1/" 2>/dev/null; }

# Waits until a URL answers (any HTTP status), or fails after $2 seconds.
wait_for() {
  local url="$1" seconds="$2" what="$3" log="${4:-}" waited=0
  while ! curl -s -o /dev/null -m 3 "$url" 2>/dev/null; do
    if [ "$waited" -ge "$seconds" ]; then
      [ -n "$log" ] && { echo "  Last lines of $log:"; tail -n 20 "$log" | sed 's/^/    /'; }
      fail "$what did not start within $seconds seconds."
    fi
    sleep 2
    waited=$((waited + 2))
    if [ $((waited % 30)) -eq 0 ]; then info "still waiting for $what (${waited}s)…"; fi
  done
}

# This PC's address on the local network, for a phone to reach the backend.
detect_host() {
  local ip=""
  if is_windows; then
    ip="$(powershell.exe -NoProfile -Command "(Get-NetIPConfiguration | Where-Object { \$_.IPv4DefaultGateway -ne \$null -and \$_.NetAdapter.Status -eq 'Up' } | Select-Object -First 1).IPv4Address.IPAddress" 2>/dev/null | tr -d '\r' | head -n1)"
  elif command -v ipconfig >/dev/null 2>&1; then
    ip="$(ipconfig getifaddr en0 2>/dev/null || true)"
  else
    ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
  fi
  echo "${ip:-127.0.0.1}"
}

require_node() {
  command -v node >/dev/null 2>&1 || fail "Node.js is not installed (need 22.18 or newer)."
  local major
  major="$(node -p 'process.versions.node.split(".")[0]')"
  [ "$major" -ge 22 ] || fail "Node.js $(node -v) is too old (need 22.18 or newer)."
  [ -d "$APP/node_modules" ] || { info "Installing the app's packages (first run)…"; (cd "$APP" && npm install); }
}

# A checkout from before the app moved to frontend/ and server/ became backend/ (git pull)
# keeps its untracked files where they were: settings in server/.env and .env.local, maybe a
# server/data/ folder and the app's node_modules. Moving secrets is left to you; this says what
# to run. With "strict", a missing backend/.env stops the script.
check_leftovers() {
  local strict="${1:-}"
  if [ -f "$ROOT/server/.env" ] && [ ! -f "$BACKEND/.env" ]; then
    printf '  \033[33m!\033[0m %s\n' "server/ is now backend/, but the settings are still in server/.env. Move them with:" >&2
    printf '      mv "%s" "%s"\n' "$ROOT/server/.env" "$BACKEND/.env" >&2
    [ "$strict" = strict ] && exit 1
  fi
  if [ -d "$ROOT/server/data" ]; then
    if [ -d "$BACKEND/data" ]; then
      info "server/data/ is left over from before the rename; the backend now reads backend/data/ (unless DATA_DIR says otherwise)."
    else
      info "server/data/ is left over from before the rename. Unless DATA_DIR points elsewhere, move it: mv \"$ROOT/server/data\" \"$BACKEND/data\""
    fi
  fi
  if [ -f "$ROOT/.env.local" ] && [ ! -f "$APP/.env.local" ]; then
    info "The app moved to frontend/, but its settings are still in .env.local at the top: mv \"$ROOT/.env.local\" \"$APP/.env.local\""
  fi
  if [ -d "$ROOT/node_modules" ]; then
    info "node_modules/ at the top is left over from before the app moved to frontend/ and can be deleted: rm -rf \"$ROOT/node_modules\""
  fi
}

start_app() {
  local host="$1" web="$2"
  bold "Starting the app (Expo)…"
  info "The app reaches the backend at http://$host:$BACKEND_PORT"
  info "In the app: Settings → My Devices, sign in with your EMS account."
  [ "$web" = 1 ] && info "Opening the web browser…" || info "Press w for the web browser, or scan the QR code with your phone."
  echo
  cd "$APP"
  # The variables win over .env.local, so a changed Wi-Fi address needs no file edit.
  local args=(expo start -c)
  [ "$web" = 1 ] && args+=(--web)
  if port_open "$ASSISTANT_PORT"; then
    info "The app reaches the assistant on this PC at http://$host:$ASSISTANT_PORT"
    export EXPO_PUBLIC_ASSISTANT_URL="http://$host:$ASSISTANT_PORT"
  fi
  EXPO_PUBLIC_DEVICE_BACKEND_URL="http://$host:$BACKEND_PORT" npx "${args[@]}"
}

wait_until_stopped() {
  bold "Running. Press Ctrl+C to stop."
  # `wait` returns as soon as a signal arrives, so Ctrl+C stops everything at once.
  while true; do
    sleep 86400 &
    wait $! || true
  done
}

parse_run_options() {
  WEB=0
  APP=1
  HOST=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --web) WEB=1 ;;
      --no-app) APP=0 ;;
      --host) HOST="${2:-}"; shift ;;
      *) fail "Unknown option: $1 (see the top of scripts/dev.sh)" ;;
    esac
    shift
  done
  [ -n "$HOST" ] || HOST="$(detect_host)"
}

# ---- Modes -------------------------------------------------------------------------------

mode_fake() {
  parse_run_options "$@"
  require_node
  check_leftovers
  mkdir -p "$LOGS"
  trap cleanup INT TERM EXIT

  bold "Mode 1: fake hub"
  if port_open "$BACKEND_PORT"; then
    fail "Port $BACKEND_PORT is busy: another backend is running. Stop it first (Ctrl+C in its window)."
  fi
  (cd "$BACKEND" && exec node scripts/fake-hub.ts) >"$LOGS/fake-hub.log" 2>&1 &
  STARTED_PIDS+=("$!")
  wait_for "http://127.0.0.1:$BACKEND_PORT/api/home" 60 "the fake hub" "$LOGS/fake-hub.log"
  ok "Fake hub ready on port $BACKEND_PORT (log: .dev-logs/fake-hub.log)"
  info "Sign in to My Devices as demo@parklane.test / correct horse battery"
  echo

  if [ "$APP" = 1 ]; then start_app "$HOST" "$WEB"; else wait_until_stopped; fi
}

mode_local() {
  parse_run_options "$@"
  require_node
  check_leftovers strict
  mkdir -p "$LOGS"
  trap cleanup INT TERM EXIT

  bold "Mode 2: real Home Assistant on this PC"
  grep -qE '^ADMIN_API_KEY=.+' "$BACKEND/.env" 2>/dev/null ||
    fail "Set ADMIN_API_KEY in backend/.env first (docs/SMART_HOME.md, step 2e)."

  # 1. Home Assistant
  if port_open "$HA_PORT"; then
    ok "Home Assistant already running on port $HA_PORT"
  else
    info "Starting Home Assistant… (the first start can take 5–10 minutes)"
    if is_windows; then
      command -v wsl.exe >/dev/null 2>&1 || fail "WSL is not available. Install Ubuntu: wsl --install -d $WSL_DISTRO"
      wsl.exe -d "$WSL_DISTRO" -- bash -lc 'test -f ~/ha-venv/bin/activate && test -d ~/ha-config' 2>/dev/null ||
        fail "Home Assistant is not installed in WSL ($WSL_DISTRO). Follow docs/SMART_HOME.md, steps 2a–2b."
      wsl.exe -d "$WSL_DISTRO" -- bash -lc "$HA_START" >"$LOGS/home-assistant.log" 2>&1 &
      STARTED_HA_IN_WSL=1
    else
      [ -f "$HOME/ha-venv/bin/activate" ] || fail "Home Assistant is not installed (~/ha-venv). See docs/SMART_HOME.md."
      bash -lc "$HA_START" >"$LOGS/home-assistant.log" 2>&1 &
    fi
    STARTED_PIDS+=("$!")
    wait_for "http://127.0.0.1:$HA_PORT/api/onboarding" 900 "Home Assistant" "$LOGS/home-assistant.log"
    ok "Home Assistant ready on port $HA_PORT (log: .dev-logs/home-assistant.log)"
  fi

  # 2. Backend
  if port_open "$BACKEND_PORT"; then
    ok "Backend already running on port $BACKEND_PORT"
  else
    info "Starting the backend…"
    (cd "$BACKEND" && exec node src/index.ts) >"$LOGS/backend.log" 2>&1 &
    STARTED_PIDS+=("$!")
    wait_for "http://127.0.0.1:$BACKEND_PORT/api/home" 60 "the backend" "$LOGS/backend.log"
    ok "Backend ready on port $BACKEND_PORT (log: .dev-logs/backend.log)"
  fi
  info "First time? Create your EMS account in the app, then double-click ParklaneAttach.exe"
  info "  (or run: ./scripts/dev.sh attach --email you@example.com --token <Home Assistant token>)"
  echo

  if [ "$APP" = 1 ]; then start_app "$HOST" "$WEB"; else wait_until_stopped; fi
}

mode_check() {
  require_node
  check_leftovers
  bold "App: typecheck"
  (cd "$APP" && npx tsc --noEmit) && ok "types"
  bold "App: lint"
  (cd "$APP" && npx expo lint) && ok "lint"
  bold "Backend: typecheck"
  # TypeScript is the backend's only package, and only for this check: it runs on plain Node.
  [ -d "$BACKEND/node_modules" ] || { info "Installing the backend's typecheck tools (first run)…"; (cd "$BACKEND" && npm ci); }
  (cd "$BACKEND" && npm run --silent typecheck) && ok "types"
  bold "Backend: tests"
  mkdir -p "$LOGS"
  # Node prints the summary as "ℹ pass 73" on a terminal and "# pass 73" into a file, depending on its
  # version. `|| true`: finding no line must not stop this script (set -e with pipefail).
  if (cd "$BACKEND" && npm test --silent) >"$LOGS/tests.log" 2>&1; then
    grep -E '^(ℹ|#) (tests|pass|fail)' "$LOGS/tests.log" | sed 's/^/  /' || true
    ok "tests"
  else
    grep -E '^(ℹ|#) (tests|pass|fail)|^not ok|✖' "$LOGS/tests.log" | sed 's/^/  /' || true
    fail "Backend tests failed: see .dev-logs/tests.log"
  fi
}

# Puts the resident in a test unit and attaches Home Assistant. Starts the backend for the moment
# if it is not running (and stops it again); Home Assistant itself must already be running.
mode_attach() {
  require_node
  check_leftovers strict
  local has_url=0
  for arg in "$@"; do [ "$arg" = "--url" ] && has_url=1; done
  grep -qE '^ADMIN_API_KEY=.+' "$BACKEND/.env" 2>/dev/null ||
    fail "Set ADMIN_API_KEY in backend/.env first (docs/SMART_HOME.md, step 2e)."
  if [ "$has_url" = 0 ] && ! port_open "$HA_PORT"; then
    fail "Home Assistant is not running on port $HA_PORT. Start it first (ParklaneDev.exe option 1, or ./scripts/dev.sh local)."
  fi

  if ! port_open "$BACKEND_PORT"; then
    mkdir -p "$LOGS"
    trap cleanup INT TERM EXIT
    info "Starting the backend for a moment…"
    (cd "$BACKEND" && exec node src/index.ts) >"$LOGS/backend.log" 2>&1 &
    STARTED_PIDS+=("$!")
    wait_for "http://127.0.0.1:$BACKEND_PORT/api/home" 60 "the backend" "$LOGS/backend.log"
  fi

  cd "$BACKEND"
  if [ "$has_url" = 1 ]; then
    node scripts/attach-hub.ts "$@"
  else
    node scripts/attach-hub.ts --url "http://127.0.0.1:$HA_PORT" "$@"
  fi
}

# A value from backend/.env, or nothing.
env_value() { grep -E "^$1=" "$BACKEND/.env" | tail -n 1 | cut -d= -f2-; }

# Mode 3 runs on the Linux server: see docs/production.md. Builds the backend image from backend/
# (tagged with the git commit) and starts it with backend/compose.yaml, settings from backend/.env.
mode_server() {
  command -v docker >/dev/null 2>&1 || fail "Docker is not installed on this machine."
  check_leftovers strict
  [ -f "$BACKEND/.env" ] || fail "Create backend/.env first (copy backend/.env.example and fill it in)."
  grep -qE '^ADMIN_API_KEY=.+' "$BACKEND/.env" || fail "Set ADMIN_API_KEY in backend/.env."
  grep -qE '^PARKLANE_DATA=/' "$BACKEND/.env" || fail "Set PARKLANE_DATA in backend/.env: the folder for the database and the units."
  grep -qE '^PUBLIC_URL=https://' "$BACKEND/.env" || info "PUBLIC_URL is not an https:// address; brands that sign in on their own page will stay off."

  local network data port version
  network="$(env_value HA_NETWORK)"
  network="${network:-parklane-ha}"
  data="$(env_value PARKLANE_DATA)"
  port="$(env_value PORT)"
  port="${port:-8787}"
  version="$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo latest)"
  [ -z "$(git -C "$ROOT" status --porcelain -- backend 2>/dev/null)" ] || version="$version-dirty"

  bold "Mode 3: production backend on Docker"
  docker network inspect "$network" >/dev/null 2>&1 || { docker network create "$network" >/dev/null && ok "Created network $network"; }
  # Created here, as this user: a folder Docker creates for a mount belongs to root.
  mkdir -p "$data"
  # The container earlier versions of this script started, before compose.yaml.
  if docker ps -a --format '{{.Names}}' | grep -qx parklane-backend &&
    [ -z "$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' parklane-backend)" ]; then
    info "Replacing the parklane-backend container started without compose…"
    docker rm -f parklane-backend >/dev/null
  fi
  info "Building parklane-backend:$version…"
  (cd "$BACKEND" && PARKLANE_VERSION="$version" DOCKER_GID="${DOCKER_GID:-$(stat -c %g /var/run/docker.sock)}" docker compose up -d --build)
  wait_for "http://127.0.0.1:$port/api/home" 60 "the backend"
  ok "Backend $version running on 127.0.0.1:$port (logs: docker logs -f parklane-backend)"
  info "Back to an earlier build: cd backend && PARKLANE_VERSION=<commit> docker compose up -d --no-build"
}

# ---- Main --------------------------------------------------------------------------------

command="${1:-}"
[ $# -gt 0 ] && shift
case "$command" in
  fake) mode_fake "$@" ;;
  local) mode_local "$@" ;;
  check) mode_check ;;
  attach) mode_attach "$@" ;;
  server) mode_server ;;
  *)
    sed -n '2,17p' "$0" | sed 's/^# \{0,1\}//'
    exit 1
    ;;
esac
