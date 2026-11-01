#!/usr/bin/env bash
# Runs the Parklane smart home in one command. See docs/SMART_HOME.md.
#
#   ./scripts/dev.sh fake      Mode 1: the backend with a pretend Home Assistant, then the app
#   ./scripts/dev.sh local     Mode 2: Home Assistant (in WSL), the backend, then the app
#   ./scripts/dev.sh check     App typecheck and lint, backend typecheck and tests
#   ./scripts/dev.sh attach --email you@example.com --token <long-lived token> [--url http://127.0.0.1:8123]
#                              Puts your EMS account in a test unit and attaches Home Assistant (once)
#   ./scripts/dev.sh server    Mode 3, on the Linux server: the Docker network and the backend container
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
SERVER="$ROOT/server"
LOGS="$ROOT/.dev-logs"
BACKEND_PORT="${PORT:-8787}"
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
  [ -d "$ROOT/node_modules" ] || { info "Installing the app's packages (first run)…"; (cd "$ROOT" && npm install); }
}

start_app() {
  local host="$1" web="$2"
  bold "Starting the app (Expo)…"
  info "The app reaches the backend at http://$host:$BACKEND_PORT"
  info "In the app: Settings → My Devices, sign in with your EMS account."
  [ "$web" = 1 ] && info "Opening the web browser…" || info "Press w for the web browser, or scan the QR code with your phone."
  echo
  cd "$ROOT"
  # The variable wins over .env.local, so a changed Wi-Fi address needs no file edit.
  local args=(expo start -c)
  [ "$web" = 1 ] && args+=(--web)
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
  mkdir -p "$LOGS"
  trap cleanup INT TERM EXIT

  bold "Mode 1: fake hub"
  if port_open "$BACKEND_PORT"; then
    fail "Port $BACKEND_PORT is busy: another backend is running. Stop it first (Ctrl+C in its window)."
  fi
  (cd "$SERVER" && exec node scripts/fake-hub.ts) >"$LOGS/fake-hub.log" 2>&1 &
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
  mkdir -p "$LOGS"
  trap cleanup INT TERM EXIT

  bold "Mode 2: real Home Assistant on this PC"
  grep -qE '^ADMIN_API_KEY=.+' "$SERVER/.env" 2>/dev/null ||
    fail "Set ADMIN_API_KEY in server/.env first (docs/SMART_HOME.md, step 2e)."

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
    (cd "$SERVER" && exec node src/index.ts) >"$LOGS/backend.log" 2>&1 &
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
  bold "App: typecheck"
  (cd "$ROOT" && npx tsc --noEmit) && ok "types"
  bold "App: lint"
  (cd "$ROOT" && npx expo lint) && ok "lint"
  bold "Backend: typecheck"
  (cd "$SERVER" && npm run --silent typecheck) && ok "types"
  bold "Backend: tests"
  mkdir -p "$LOGS"
  if (cd "$SERVER" && npm test --silent) >"$LOGS/tests.log" 2>&1; then
    grep -E '^ℹ (tests|pass|fail)' "$LOGS/tests.log" | sed 's/^/  /'
    ok "tests"
  else
    grep -E '^ℹ (tests|pass|fail)|✖' "$LOGS/tests.log" | sed 's/^/  /'
    fail "Backend tests failed: see .dev-logs/tests.log"
  fi
}

# Puts the resident in a test unit and attaches Home Assistant. Starts the backend for the moment
# if it is not running (and stops it again); Home Assistant itself must already be running.
mode_attach() {
  require_node
  local has_url=0
  for arg in "$@"; do [ "$arg" = "--url" ] && has_url=1; done
  grep -qE '^ADMIN_API_KEY=.+' "$SERVER/.env" 2>/dev/null ||
    fail "Set ADMIN_API_KEY in server/.env first (docs/SMART_HOME.md, step 2e)."
  if [ "$has_url" = 0 ] && ! port_open "$HA_PORT"; then
    fail "Home Assistant is not running on port $HA_PORT. Start it first (ParklaneDev.exe option 1, or ./scripts/dev.sh local)."
  fi

  if ! port_open "$BACKEND_PORT"; then
    mkdir -p "$LOGS"
    trap cleanup INT TERM EXIT
    info "Starting the backend for a moment…"
    (cd "$SERVER" && exec node src/index.ts) >"$LOGS/backend.log" 2>&1 &
    STARTED_PIDS+=("$!")
    wait_for "http://127.0.0.1:$BACKEND_PORT/api/home" 60 "the backend" "$LOGS/backend.log"
  fi

  cd "$SERVER"
  if [ "$has_url" = 1 ]; then
    node scripts/attach-hub.ts "$@"
  else
    node scripts/attach-hub.ts --url "http://127.0.0.1:$HA_PORT" "$@"
  fi
}

# Mode 3 runs on the Linux server: see docs/SMART_HOME.md, "Mode 3". Expects this repo's server/
# folder there with its .env filled in, and Docker installed.
mode_server() {
  command -v docker >/dev/null 2>&1 || fail "Docker is not installed on this machine."
  [ -f "$SERVER/.env" ] || fail "Create server/.env first (copy server/.env.example and fill it in)."
  grep -qE '^ADMIN_API_KEY=.+' "$SERVER/.env" || fail "Set ADMIN_API_KEY in server/.env."
  grep -qE '^PUBLIC_URL=https://' "$SERVER/.env" || info "PUBLIC_URL is not an https:// address; brands that sign in on their own page will stay off."

  local network data
  network="$(grep -E '^HA_NETWORK=' "$SERVER/.env" | cut -d= -f2-)"
  network="${network:-parklane-ha}"
  data="${PARKLANE_DATA:-/srv/parklane}"

  bold "Mode 3: production backend on Docker"
  docker network inspect "$network" >/dev/null 2>&1 || { docker network create "$network" >/dev/null && ok "Created network $network"; }
  mkdir -p "$data"
  if docker ps -a --format '{{.Names}}' | grep -qx parklane-backend; then
    info "Replacing the existing parklane-backend container…"
    docker rm -f parklane-backend >/dev/null
  fi
  docker run -d --name parklane-backend --restart unless-stopped \
    --network "$network" \
    --env-file "$SERVER/.env" \
    -v "$SERVER":/app -w /app \
    -v /var/run/docker.sock:/var/run/docker.sock \
    -v "$data":"$data" \
    -p "127.0.0.1:$BACKEND_PORT:$BACKEND_PORT" \
    node:22 node src/index.ts >/dev/null
  wait_for "http://127.0.0.1:$BACKEND_PORT/api/home" 60 "the backend"
  ok "Backend running in Docker on 127.0.0.1:$BACKEND_PORT (logs: docker logs -f parklane-backend)"
  info "Put HTTPS in front (e.g. Caddy: reverse_proxy 127.0.0.1:$BACKEND_PORT), then create units with the admin API."
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
