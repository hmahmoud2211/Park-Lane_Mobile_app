#!/usr/bin/env bash
# Starts a server-hosted CUBE gateway for one apartment on the company server.
#
#   ./new-apartment.sh tower-a-1203 18701                       # no box: devices that connect out to the server
#   ./new-apartment.sh tower-a-1203 18701 192.168.1.0/24 51821   # plus a tunnel box: every home-network device
#
# With a home subnet and a UDP port, the gateway gets its own WireGuard tunnel to a small box in the apartment
# (cube_gateway/tunnel.py). It then runs in its own network namespace (not --network host), so apartments with the
# same home subnet don't clash, and the script writes the box's config to <name>-tunnel.conf. The UDP port must be
# forwarded to this server, and TUNNEL_HOST must resolve to its public address (DNS only, not proxied).
#
# With UNIT_ID (the apartment's id in the EMS backend, from GET /api/admin/units) and ADMIN_API_KEY, the gateway is
# also attached to that unit: its residents connect by signing in to the app with their EMS account, and the setup
# code is only for the installer. The sync secret is kept across re-runs.
#
# The gateway listens on 127.0.0.1:<port> only, enrols itself with the relay, gets its broker login from the
# relay, uses the shared ReThink for LG appliances (seeing only the ones it sets up), and prints the pairing
# link and setup code to hand to the resident. Re-running restarts it with the same data.
set -euo pipefail

NAME="${1:?usage: new-apartment.sh <apartment name, e.g. tower-a-1203> <local port, e.g. 18701>}"
PORT="${2:?usage: new-apartment.sh <name> <port>}"
SUBNET="${3:-}"
UDP_PORT="${4:-}"
TUNNEL_HOST="${TUNNEL_HOST:-vpn.ems-iot.com}"
UNIT_ID="${UNIT_ID:-}"
EMS_URL="${EMS_URL:-https://api-iot-2.ems-iot.com}"
MQTT_HOST="${MQTT_HOST:-mqtt-cube.ems-iot.com}"
IMAGE="${IMAGE:-hmahmoud2211/cube-os-gateway:latest}"
RELAY_URL="${RELAY_URL:-https://cube-relay.ems-iot.com}"
RELAY_ENV="${RELAY_ENV:-/home/ems-server/EMS/cube-relay/relay.env}"
RETHINK_MQTT="${RETHINK_MQTT:-mqtt://127.0.0.1:1885}"
RETHINK_API="${RETHINK_API:-https://lg.ems-iot.com:4443}"
RETHINK_MQTTS="${RETHINK_MQTTS:-ssl://lg.ems-iot.com:8884}"

[[ "$NAME" =~ ^[a-z0-9][a-z0-9-]{1,40}$ ]] || { echo "Use lower-case letters, digits and dashes for the name."; exit 1; }
if [ -n "$SUBNET" ]; then
  [[ "$SUBNET" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}/[0-9]{1,2}$ ]] || { echo "The home subnet looks like 192.168.1.0/24."; exit 1; }
  [[ "$UDP_PORT" =~ ^[0-9]{4,5}$ ]] || { echo "Give a UDP port for the tunnel too, e.g. 51821 (one per apartment)."; exit 1; }
fi
ENROLL="$(grep '^CUBE_RELAY_ENROLL_TOKEN=' "$RELAY_ENV" | cut -d= -f2-)"
EMS_ARGS=()
if [ -n "$UNIT_ID" ]; then
  [ -n "${ADMIN_API_KEY:-}" ] || { echo "Attaching to EMS unit $UNIT_ID needs ADMIN_API_KEY (the backend's admin key)."; exit 1; }
  # Reuse the secret of a container being replaced, so the backend's copy stays valid.
  EMS_SECRET="$(docker inspect "cube-gw-$NAME" --format '{{range .Config.Env}}{{println .}}{{end}}' 2>/dev/null | sed -n 's/^CUBE_EMS_SECRET=//p' || true)"
  [ -n "$EMS_SECRET" ] || EMS_SECRET="$(openssl rand -hex 32)"
  EMS_ARGS=(-e CUBE_EMS_URL="$EMS_URL" -e CUBE_EMS_SECRET="$EMS_SECRET")
fi

docker rm -f "cube-gw-$NAME" >/dev/null 2>&1 || true
if [ -n "$SUBNET" ]; then
  # Its own namespace for its own wg0. Root only to create wg0: the gateway then drops to its normal user.
  # Services on this host are reached through host-gateway: the device broker over its TLS listener (as the relay
  # hands it out), and ReThink's MQTT, which must then listen on more than 127.0.0.1.
  docker run -d --name "cube-gw-$NAME" --restart unless-stopped \
    --user 0 --cap-add NET_ADMIN -p "127.0.0.1:$PORT:$PORT" -p "$UDP_PORT:51820/udp" \
    --add-host host.docker.internal:host-gateway --add-host "$MQTT_HOST:host-gateway" \
    -e CUBE_SERVER_HOSTED=1 -e CUBE_HOST=0.0.0.0 -e CUBE_PORT="$PORT" -e CUBE_MDNS_ADVERTISE=0 \
    -e CUBE_TUNNEL_SUBNETS="$SUBNET" -e CUBE_TUNNEL_ENDPOINT="$TUNNEL_HOST:$UDP_PORT" \
    -e CUBE_GATEWAY_NAME="CUBE $NAME" ${EMS_ARGS[@]+"${EMS_ARGS[@]}"} \
    -e CUBE_RELAY_URL="$RELAY_URL" -e CUBE_RELAY_ENROLL_TOKEN="$ENROLL" \
    -e CUBE_RETHINK_MQTT_URL="${RETHINK_MQTT/127.0.0.1/host.docker.internal}" -e CUBE_RETHINK_API_SERVER="$RETHINK_API" -e CUBE_RETHINK_MQTT_SERVER="$RETHINK_MQTTS" \
    -v "cube-gw-$NAME:/data" "$IMAGE" >/dev/null
else
docker run -d --name "cube-gw-$NAME" --restart unless-stopped --network host \
  -e CUBE_SERVER_HOSTED=1 -e CUBE_HOST=127.0.0.1 -e CUBE_PORT="$PORT" -e CUBE_MDNS_ADVERTISE=0 -e CUBE_SUBNET_SCAN=0 \
  -e CUBE_GATEWAY_NAME="CUBE $NAME" ${EMS_ARGS[@]+"${EMS_ARGS[@]}"} \
  -e CUBE_RELAY_URL="$RELAY_URL" -e CUBE_RELAY_ENROLL_TOKEN="$ENROLL" \
  -e CUBE_CLOUD_MQTT_URL=mqtt://127.0.0.1:1886 \
  -e CUBE_RETHINK_MQTT_URL="$RETHINK_MQTT" -e CUBE_RETHINK_API_SERVER="$RETHINK_API" -e CUBE_RETHINK_MQTT_SERVER="$RETHINK_MQTTS" \
  -v "cube-gw-$NAME:/data" "$IMAGE" >/dev/null
fi

echo "Waiting for cube-gw-$NAME to enrol with the relay..."
# Note: no `grep -q`/`head` on pipes here. They close the pipe early, and with pipefail that counts as a failure.
ID=""
for _ in $(seq 1 60); do
  ID="$(curl -sf "http://127.0.0.1:$PORT/api/v1/health" 2>/dev/null | python3 -c 'import sys,json; print(json.load(sys.stdin)["data"]["gateway_id"])' 2>/dev/null || true)"
  LOGS="$(docker logs "cube-gw-$NAME" 2>&1 || true)"
  if [ -n "$ID" ] && grep -qE "enrolled with the relay|relay tunnel open" <<<"$LOGS"; then break; fi
  sleep 2
done
if [ -z "$ID" ] || ! grep -qE "enrolled with the relay|relay tunnel open" <<<"$LOGS"; then
  echo "The gateway did not enrol with the relay within 2 minutes. Its log: docker logs cube-gw-$NAME"
  exit 1
fi
CODE="$(docker exec "cube-gw-$NAME" cube-gateway setup-code 2>/dev/null | awk 'NR == 1 && /Setup code/ {print $3}' || true)"
URL="$RELAY_URL/relay/v1/g/$ID"
if [ -n "$UNIT_ID" ]; then
  if ! curl -sf -X POST "$EMS_URL/api/admin/gateways" -H "Authorization: Bearer $ADMIN_API_KEY" -H 'Content-Type: application/json' \
      -d "{\"unitId\":\"$UNIT_ID\",\"gatewayId\":\"$ID\",\"secret\":\"$EMS_SECRET\",\"url\":\"$URL\"}" >/dev/null; then
    echo "The gateway runs, but EMS refused to attach it to unit $UNIT_ID. Check UNIT_ID (GET $EMS_URL/api/admin/units) and ADMIN_API_KEY, then re-run."
    exit 1
  fi
fi
echo
echo "Apartment:   $NAME"
echo "Gateway:     $ID  (local http://127.0.0.1:$PORT)"
echo "Relay URL:   $URL"
if [ -n "$UNIT_ID" ]; then
  echo "Residents:   members of EMS unit $UNIT_ID connect by signing in to the app. No code to hand out."
  if [ -n "$CODE" ]; then echo "Installer setup code (keep it, don't give it to residents): $CODE"; fi
elif [ -n "$CODE" ]; then
  echo "Setup code:  $CODE   (give this to the resident; it works once)"
  echo "Pairing link (QR): cubegw://pair?url=$URL&id=$ID&code=$CODE"
  docker run --rm --entrypoint python "$IMAGE" -c "import qrcode,sys; q=qrcode.QRCode(border=1); q.add_data(sys.argv[1]); q.print_ascii(invert=True)" "cubegw://pair?url=$URL&id=$ID&code=$CODE" 2>/dev/null || true
else
  echo "Already paired. New code: docker exec cube-gw-$NAME cube-gateway reset-owner"
fi
if [ -n "$SUBNET" ]; then
  ( umask 077; docker exec "cube-gw-$NAME" cube-gateway tunnel-config > "$NAME-tunnel.conf" )
  echo
  echo "Tunnel box:  $NAME-tunnel.conf  (holds the box's key: copy it to the box, then delete it here)"
  echo "             On the box at home: sudo ./tunnel-box.sh $NAME-tunnel.conf"
  echo "             The tunnel listens on UDP $UDP_PORT; $TUNNEL_HOST must point at this server and that port be forwarded to it."
fi
