#!/usr/bin/env bash
# Starts a server-hosted CUBE gateway for one apartment on the company server (no box in the apartment).
#
#   ./new-apartment.sh tower-a-1203 18701
#
# The gateway listens on 127.0.0.1:<port> only, enrols itself with the relay, gets its broker login from the
# relay, uses the shared ReThink for LG appliances (seeing only the ones it sets up), and prints the pairing
# link and setup code to hand to the resident. Re-running restarts it with the same data.
set -euo pipefail

NAME="${1:?usage: new-apartment.sh <apartment name, e.g. tower-a-1203> <local port, e.g. 18701>}"
PORT="${2:?usage: new-apartment.sh <name> <port>}"
IMAGE="${IMAGE:-ghcr.io/hmahmoud2211/cube-os-gateway:latest}"
RELAY_URL="${RELAY_URL:-https://cube-relay.ems-iot.com}"
RELAY_ENV="${RELAY_ENV:-/home/ems-server/EMS/cube-relay/relay.env}"
RETHINK_MQTT="${RETHINK_MQTT:-mqtt://127.0.0.1:1885}"
RETHINK_API="${RETHINK_API:-https://lg.ems-iot.com:4443}"
RETHINK_MQTTS="${RETHINK_MQTTS:-ssl://lg.ems-iot.com:8884}"

[[ "$NAME" =~ ^[a-z0-9][a-z0-9-]{1,40}$ ]] || { echo "Use lower-case letters, digits and dashes for the name."; exit 1; }
ENROLL="$(grep '^CUBE_RELAY_ENROLL_TOKEN=' "$RELAY_ENV" | cut -d= -f2-)"

docker rm -f "cube-gw-$NAME" >/dev/null 2>&1 || true
docker run -d --name "cube-gw-$NAME" --restart unless-stopped --network host \
  -e CUBE_SERVER_HOSTED=1 -e CUBE_HOST=127.0.0.1 -e CUBE_PORT="$PORT" -e CUBE_MDNS_ADVERTISE=0 -e CUBE_SUBNET_SCAN=0 \
  -e CUBE_GATEWAY_NAME="CUBE $NAME" \
  -e CUBE_RELAY_URL="$RELAY_URL" -e CUBE_RELAY_ENROLL_TOKEN="$ENROLL" \
  -e CUBE_CLOUD_MQTT_URL=mqtt://127.0.0.1:1886 \
  -e CUBE_RETHINK_MQTT_URL="$RETHINK_MQTT" -e CUBE_RETHINK_API_SERVER="$RETHINK_API" -e CUBE_RETHINK_MQTT_SERVER="$RETHINK_MQTTS" \
  -v "cube-gw-$NAME:/data" "$IMAGE" >/dev/null

echo "Waiting for cube-gw-$NAME to enrol with the relay..."
for _ in $(seq 1 60); do
  ID="$(curl -sf "http://127.0.0.1:$PORT/api/v1/health" | python3 -c 'import sys,json; print(json.load(sys.stdin)["data"]["gateway_id"])' 2>/dev/null || true)"
  if [ -n "$ID" ] && docker logs "cube-gw-$NAME" 2>&1 | grep -q "enrolled with the relay\|relay tunnel open"; then break; fi
  sleep 2
done
CODE="$(docker exec "cube-gw-$NAME" cube-gateway setup-code 2>/dev/null | head -1 | awk '{print $3}')"
URL="$RELAY_URL/relay/v1/g/$ID"
echo
echo "Apartment:   $NAME"
echo "Gateway:     $ID  (local http://127.0.0.1:$PORT)"
echo "Relay URL:   $URL"
if [ -n "$CODE" ]; then
  echo "Setup code:  $CODE   (give this to the resident; it works once)"
  echo "Pairing link (QR): cubegw://pair?url=$URL&id=$ID&code=$CODE"
  docker run --rm --entrypoint python "$IMAGE" -c "import qrcode,sys; q=qrcode.QRCode(border=1); q.add_data(sys.argv[1]); q.print_ascii(invert=True)" "cubegw://pair?url=$URL&id=$ID&code=$CODE" 2>/dev/null || true
else
  echo "Already paired. New code: docker exec cube-gw-$NAME cube-gateway reset-owner"
fi
