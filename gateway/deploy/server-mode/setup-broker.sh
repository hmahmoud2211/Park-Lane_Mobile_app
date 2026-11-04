#!/usr/bin/env bash
# Sets up the device MQTT broker for server-hosted mode (no box in the apartments), on the company server.
#
#   sudo ./setup-broker.sh mqtt-cube.ems-iot.com
#
# Creates, once, in $ROOT (default /home/ems-server/EMS/cube-mqtt):
#   certs/ca.crt, ca.key     CUBE's own device CA (devices and gateways trust only this)
#   certs/server.crt, .key   the broker's certificate for <hostname>, signed by that CA
#   config/mosquitto.conf    TLS listener 0.0.0.0:8885 for devices, plain 127.0.0.1:1886 for this server only
#   data/                    dynamic-security.json (per-device logins) and persistence
#   admin.env                the broker admin login, for the relay only (mode 0600)
# Then (re)starts the container "cube-mqtt". Re-running keeps the CA, certificates and logins.
set -euo pipefail

HOST="${1:?usage: setup-broker.sh <public hostname, e.g. mqtt-cube.ems-iot.com>}"
ROOT="${ROOT:-/home/ems-server/EMS/cube-mqtt}"
IMAGE="${IMAGE:-eclipse-mosquitto:2}"
PUBLIC_PORT="${PUBLIC_PORT:-8885}"
LOCAL_PORT="${LOCAL_PORT:-1886}"

mkdir -p "$ROOT"/{certs,config,data}
chmod 700 "$ROOT"
cd "$ROOT"

if [ ! -f certs/ca.key ]; then
  echo "Creating CUBE's device CA (10 years)"
  # Strict verifiers (Python 3.13+, recent device TLS stacks) need a CA marked as one, with key usage set.
  openssl req -x509 -newkey rsa:2048 -nodes -days 3650 -sha256 \
    -subj "/O=EMS/CN=CUBE Device CA" -keyout certs/ca.key -out certs/ca.crt \
    -addext "basicConstraints=critical,CA:TRUE" -addext "keyUsage=critical,keyCertSign,cRLSign" \
    -addext "subjectKeyIdentifier=hash" 2>/dev/null
fi
if [ ! -f certs/server.crt ]; then
  echo "Creating the broker certificate for $HOST"
  openssl req -newkey rsa:2048 -nodes -subj "/O=EMS/CN=$HOST" -keyout certs/server.key -out certs/server.csr 2>/dev/null
  printf 'subjectAltName=DNS:%s\nbasicConstraints=CA:FALSE\nextendedKeyUsage=serverAuth\nkeyUsage=critical,digitalSignature,keyEncipherment\nsubjectKeyIdentifier=hash\nauthorityKeyIdentifier=keyid,issuer\n' "$HOST" > certs/server.ext
  openssl x509 -req -in certs/server.csr -CA certs/ca.crt -CAkey certs/ca.key -CAcreateserial -days 3650 -sha256 \
    -extfile certs/server.ext -out certs/server.crt 2>/dev/null
  rm -f certs/server.csr certs/server.ext
fi

cat > config/mosquitto.conf <<EOF
# CUBE device broker (server-hosted mode). Every login comes from the dynamic security plugin:
# the relay creates one per gateway and one per device, each limited to its own topics.
per_listener_settings false
allow_anonymous false
plugin /usr/lib/mosquitto_dynamic_security.so
plugin_opt_config_file /mosquitto/data/dynamic-security.json
persistence true
persistence_location /mosquitto/data/
log_dest stdout
log_type error
log_type warning
log_type notice
connection_messages true

# This server only (the relay and the apartments' gateways).
listener $LOCAL_PORT 127.0.0.1

# Devices, over the internet: TLS only.
listener $PUBLIC_PORT 0.0.0.0
certfile /mosquitto/certs/server.crt
keyfile /mosquitto/certs/server.key
tls_version tlsv1.2
EOF

if [ ! -f admin.env ]; then
  ADMIN_PASSWORD="$(openssl rand -base64 32 | tr -d '=+/' | cut -c1-40)"
  docker run --rm -v "$ROOT/data:/mosquitto/data" "$IMAGE" \
    mosquitto_ctrl dynsec init /mosquitto/data/dynamic-security.json cube-admin "$ADMIN_PASSWORD" >/dev/null
  ( umask 077; printf 'CUBE_MQTT_ADMIN_URL=mqtt://127.0.0.1:%s\nCUBE_MQTT_ADMIN_USER=cube-admin\nCUBE_MQTT_ADMIN_PASSWORD=%s\nCUBE_MQTT_PUBLIC_SERVER=%s:%s\nCUBE_MQTT_GATEWAY_URL=mqtts://%s:%s\nCUBE_MQTT_CA_FILE=/ca/ca.crt\n' \
    "$LOCAL_PORT" "$ADMIN_PASSWORD" "$HOST" "$PUBLIC_PORT" "$HOST" "$PUBLIC_PORT" > admin.env )
fi

# The broker runs as the image's mosquitto user; the CA key never needs to be readable by it.
docker run --rm -v "$ROOT/certs:/c" -v "$ROOT/data:/d" "$IMAGE" sh -c \
  'chown mosquitto:mosquitto /c/server.key /c/server.crt /d /d/* && chmod 600 /c/server.key && chmod 644 /c/server.crt /c/ca.crt && chmod 600 /c/ca.key'

docker rm -f cube-mqtt >/dev/null 2>&1 || true
docker run -d --name cube-mqtt --restart unless-stopped --network host \
  -v "$ROOT/config:/mosquitto/config:ro" -v "$ROOT/certs:/mosquitto/certs:ro" -v "$ROOT/data:/mosquitto/data" \
  "$IMAGE" >/dev/null

echo "Broker running: devices -> $HOST:$PUBLIC_PORT (TLS), this server -> 127.0.0.1:$LOCAL_PORT"
echo "Relay settings to add: $ROOT/admin.env (mount $ROOT/certs/ca.crt into the relay at /ca/ca.crt)"
