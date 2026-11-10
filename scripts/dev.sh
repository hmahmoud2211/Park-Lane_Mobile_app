#!/usr/bin/env bash
# Runs the Parklane smart home in one command. See docs/SMART_HOME.md.
#
#   ./scripts/dev.sh fake      Mode 1: the backend with a pretend Home Assistant, then the app
#   ./scripts/dev.sh local     Mode 2: Home Assistant (in WSL), the backend, then the app
#   ./scripts/dev.sh check     App typecheck and lint, backend typecheck and tests
#   ./scripts/dev.sh attach --email you@example.com --token <long-lived token> [--url http://127.0.0.1:8123]
#                              Puts your EMS account in a test unit and attaches Home Assistant (once)
#   ./scripts/dev.sh server    Mode 3, on the Linux server: builds the backend image and starts it (backend/compose.yaml),
#                              with the CUBE relay when backend/.env has COMPOSE_PROFILES=relay
#   ./scripts/dev.sh server --pull [<commit>]
#                              The same with the image from Docker Hub instead of a build (default: latest)
#   ./scripts/dev.sh push      Checks the backend, builds its image (amd64 + arm64) and pushes it to Docker Hub
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
  info "In the app: sign in on the login screen with your EMS account, or create one there."
  [ "$web" = 1 ] && info "Opening the web browser…" || info "Press w for the web browser, or scan the QR code with your phone."
  echo
  cd "$APP"
  # In development Expo lets .env files beat variables set here (expo/virtual/env), so an address
  # in .env.local would win over this one. Say so, rather than quietly use another backend.
  local pinned
  pinned="$(sed -nE 's/^[[:space:]]*EXPO_PUBLIC_DEVICE_BACKEND_URL=//p' "$APP/.env.local" 2>/dev/null | tail -1 || true)"
  if [ -n "$pinned" ] && [ "$pinned" != "http://$host:$BACKEND_PORT" ]; then
    info "frontend/.env.local sets the backend to $pinned, and that beats http://$host:$BACKEND_PORT."
    info "Change or remove that line to use this backend."
  fi
  local args=(expo start -c)
  [ "$web" = 1 ] && args+=(--web)
  if port_open "$ASSISTANT_PORT"; then
    info "The app reaches the assistant on this PC at http://$host:$ASSISTANT_PORT"
    export EXPO_PUBLIC_ASSISTANT_URL="http://$host:$ASSISTANT_PORT"
  fi
  # Health Passport follows the backend too, or the clinic would book against one record and
  # the app show another. EXPO_PUBLIC_HEALTH_API=mock asks for the sample data instead.
  EXPO_PUBLIC_DEVICE_BACKEND_URL="http://$host:$BACKEND_PORT" \
    EXPO_PUBLIC_HEALTH_API="${EXPO_PUBLIC_HEALTH_API:-http}" npx "${args[@]}"
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
  info "Sign in as demo@parklane.test / correct horse battery"
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
  check_backend
}

# The backend's typecheck and tests (check mode, and push before anything leaves this machine).
check_backend() {
  require_node
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

# A value from a settings file (backend/.env by default), or nothing. Never fails: under
# `set -e -o pipefail` a missing setting would otherwise end the script without a word.
env_value() { { grep -E "^$1=" "${2:-$BACKEND/.env}" 2>/dev/null || true; } | tail -n 1 | cut -d= -f2-; }

# The CUBE relay runs with the backend when COMPOSE_PROFILES (backend/.env, or the shell) names it.
relay_on() {
  case ",${COMPOSE_PROFILES:-$(env_value COMPOSE_PROFILES)}," in *,relay,*) return 0 ;; esac
  return 1
}

# Before the build, so a missing relay setting stops here and not halfway. Sets RELAY_ENV, and
# RELAY_BY_HAND=1 when a cube-relay started with `docker run` is there for compose to take over.
check_relay() {
  local ca image pin
  RELAY_ENV="$(env_value RELAY_ENV_FILE)"
  RELAY_ENV="${RELAY_ENV:-/home/ems-server/EMS/cube-relay/relay.env}"
  RELAY_BY_HAND=0
  [ -r "$RELAY_ENV" ] || fail "COMPOSE_PROFILES=relay needs the relay's settings file: $RELAY_ENV is missing or unreadable (RELAY_ENV_FILE in backend/.env)."
  [ -n "$(env_value CUBE_RELAY_ENROLL_TOKEN "$RELAY_ENV")" ] || fail "$RELAY_ENV has no CUBE_RELAY_ENROLL_TOKEN: without it any gateway could enrol."
  ca="$(env_value RELAY_CA_FILE)"
  if [ -n "$(env_value CUBE_MQTT_CA_FILE "$RELAY_ENV")" ] && [ -z "$ca" ]; then
    fail "The relay manages the device broker: set RELAY_CA_FILE in backend/.env to its CA certificate (/home/ems-server/EMS/cube-mqtt/certs/ca.crt)."
  fi
  [ -z "$ca" ] || [ -f "$ca" ] || fail "RELAY_CA_FILE in backend/.env: $ca does not exist."
  if docker ps -a --format '{{.Names}}' | grep -qx cube-relay &&
    [ -z "$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' cube-relay)" ]; then
    # Compose would otherwise start whatever RELAY_IMAGE defaults to, a version nobody chose. The
    # exact build it runs, by digest when it came from a registry, since a tag such as :latest moves.
    image="$(docker inspect -f '{{.Image}}' cube-relay)"
    pin="$(docker image inspect -f '{{if .RepoDigests}}{{index .RepoDigests 0}}{{end}}' "$image" 2>/dev/null || true)"
    pin="${pin:-$(docker inspect -f '{{.Config.Image}}' cube-relay)}"
    [ -n "$(env_value RELAY_IMAGE)" ] || fail "cube-relay was started by hand. To keep the build it runs, set RELAY_IMAGE=$pin in backend/.env, then run this again."
    RELAY_BY_HAND=1
  fi
  docker volume inspect cube-relay-data >/dev/null 2>&1 || { docker volume create cube-relay-data >/dev/null && ok "Created volume cube-relay-data"; }
}

# The backend image's name, without a tag: BACKEND_IMAGE (shell or backend/.env), else the Docker Hub one.
backend_image() {
  local name="${BACKEND_IMAGE:-$(env_value BACKEND_IMAGE)}"
  echo "${name:-hmahmoud2211/parklane-backend}"
}

# Mode 3 runs on the Linux server: see docs/production.md. Gets the backend image, built here from
# backend/ or with --pull from Docker Hub, tagged with the git commit, and starts it with
# backend/compose.yaml, settings from backend/.env, with the CUBE relay when backend/.env has
# COMPOSE_PROFILES=relay.
mode_server() {
  local pull=""
  while [ $# -gt 0 ]; do
    case "$1" in
      # --pull alone means latest; --pull <tag> a pushed commit (./scripts/dev.sh push prints it).
      --pull)
        pull=latest
        if [ -n "${2:-}" ] && [ "${2#-}" = "$2" ]; then pull="$2"; shift; fi
        ;;
      *) fail "Unknown option: $1 (see the top of scripts/dev.sh)" ;;
    esac
    shift
  done
  command -v docker >/dev/null 2>&1 || fail "Docker is not installed on this machine."
  check_leftovers strict
  [ -f "$BACKEND/.env" ] || fail "Create backend/.env first (copy backend/.env.example and fill it in)."
  grep -qE '^ADMIN_API_KEY=.+' "$BACKEND/.env" || fail "Set ADMIN_API_KEY in backend/.env."
  grep -qE '^PARKLANE_DATA=/' "$BACKEND/.env" || fail "Set PARKLANE_DATA in backend/.env: the folder for the database and the units."
  grep -qE '^PUBLIC_URL=https://' "$BACKEND/.env" || info "PUBLIC_URL is not an https:// address; brands that sign in on their own page will stay off."

  local network data port version gid image revision relay=0 relay_image relay_port
  relay_on && relay=1
  image="$(backend_image)"
  network="$(env_value HA_NETWORK)"
  network="${network:-parklane-ha}"
  data="$(env_value PARKLANE_DATA)"
  port="$(env_value PORT)"
  port="${port:-8787}"
  if [ -n "$pull" ]; then
    version="$pull"
  else
    version="$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo latest)"
    [ -z "$(git -C "$ROOT" status --porcelain -- backend 2>/dev/null)" ] || version="$version-dirty"
  fi

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
  if [ "$relay" = 1 ]; then
    check_relay
  elif docker ps --format '{{.Names}}' | grep -qx cube-relay; then
    info "cube-relay runs on its own, untouched. To start it with the backend: COMPOSE_PROFILES=relay in backend/.env (docs/production.md)."
  fi
  gid="${DOCKER_GID:-$(stat -c %g /var/run/docker.sock)}"
  # Pulled or built before anything stops, so a failure leaves the running backend and relay as they are.
  if [ -n "$pull" ]; then
    # A commit's tag never changes, so a copy already here is that same image; this also starts an
    # earlier version again. latest moves, so it is always downloaded.
    if [ "$version" != latest ] && docker image inspect "$image:$version" >/dev/null 2>&1; then
      info "Using ${image}:${version}, already on this machine"
    else
      info "Pulling ${image}:${version}…"
      docker pull -q "$image:$version" >/dev/null ||
        fail "Could not pull $image:$version. Is that tag on Docker Hub (./scripts/dev.sh push prints it)? A private repository needs \`docker login\` on this server first."
    fi
  else
    info "Building ${image}:${version}…"
    (cd "$BACKEND" && BACKEND_IMAGE="$image" PARKLANE_VERSION="$version" DOCKER_GID="$gid" docker compose build backend)
  fi
  revision="$(docker image inspect -f '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$image:$version" 2>/dev/null || true)"
  if [ "$relay" = 1 ] && [ "$RELAY_BY_HAND" = 1 ]; then
    relay_image="$(env_value RELAY_IMAGE)"
    # Fetched first, so the old relay stops only when the new one can start at once.
    docker image inspect "$relay_image" >/dev/null 2>&1 || docker pull "$relay_image" >/dev/null
    info "Moving cube-relay into compose, same data and version ($relay_image); remote access pauses for a few seconds…"
    docker rm -f cube-relay >/dev/null
  fi
  # --no-build: the image is here now, and a pulled one must not be replaced by a build of this checkout.
  (cd "$BACKEND" && BACKEND_IMAGE="$image" PARKLANE_VERSION="$version" DOCKER_GID="$gid" docker compose up -d --no-build)
  wait_for "http://127.0.0.1:$port/api/home" 60 "the backend"
  ok "Backend $image:$version${revision:+ (commit $revision)} running on 127.0.0.1:$port (logs: docker logs -f parklane-backend)"
  if [ "$relay" = 1 ]; then
    relay_port="$(env_value CUBE_RELAY_PORT "$RELAY_ENV")"
    relay_port="${relay_port:-8687}"
    wait_for "http://127.0.0.1:$relay_port/relay/v1/health" 60 "the relay"
    ok "Relay running on 127.0.0.1:$relay_port (logs: docker logs -f cube-relay)"
  fi
  info "Back to an earlier version: ./scripts/dev.sh server --pull <commit> (uses the copy on this machine when there is one)"
}

# Builds the backend image from the committed code, for the server (linux/amd64) and ARM machines
# (linux/arm64), and pushes it to Docker Hub as <image>:<commit> and <image>:latest. Runs where you
# are signed in to Docker Hub (`docker login`), such as a developer's Mac; no CI needed. The server
# then takes it with ./scripts/dev.sh server --pull <commit>.
mode_push() {
  command -v docker >/dev/null 2>&1 || fail "Docker is not installed on this machine."
  docker buildx version >/dev/null 2>&1 || fail "docker buildx is missing (Docker Desktop includes it)."
  local image commit platforms
  image="$(backend_image)"
  commit="$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null)" || fail "This is not a git checkout: the image is tagged with its commit."
  # The tag names a commit, so the image (backend/) and the types it was checked with (shared/) must
  # be exactly that commit, untracked files included.
  [ -z "$(git -C "$ROOT" status --porcelain -- backend shared)" ] ||
    fail "backend/ or shared/ has changes that are not committed. Commit them first: the image is tagged $commit and must be exactly that code."
  check_backend
  bold "Pushing $image:$commit and :latest (linux/amd64, linux/arm64)"
  (cd "$BACKEND" && docker buildx build --platform linux/amd64,linux/arm64 --build-arg REVISION="$commit" \
    -t "$image:$commit" -t "$image:latest" --push .) ||
    fail "The push failed. Signed in to Docker Hub as ${image%%/*}? Run docker login, then this again."
  platforms="$(docker buildx imagetools inspect "$image:$commit" | awk '/Platform:/ && !/unknown/ {print $2}' | paste -sd ' ' -)"
  ok "Pushed $image:$commit ($platforms)"
  info "On the server: cd /opt/parklane && git pull && ./scripts/dev.sh server --pull $commit"
}

# ---- Main --------------------------------------------------------------------------------

command="${1:-}"
[ $# -gt 0 ] && shift
case "$command" in
  fake) mode_fake "$@" ;;
  local) mode_local "$@" ;;
  check) mode_check ;;
  attach) mode_attach "$@" ;;
  server) mode_server "$@" ;;
  push) mode_push ;;
  *)
    # The comment block at the top, however long it grows.
    awk 'NR == 1 { next } /^#/ { sub(/^# ?/, ""); print; next } { exit }' "$0"
    exit 1
    ;;
esac
