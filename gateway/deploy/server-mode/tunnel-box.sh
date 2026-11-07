#!/usr/bin/env bash
# Makes a small Linux machine in the apartment (Raspberry Pi OS, Debian or Ubuntu) the CUBE tunnel box: it connects
# out to this apartment's gateway on the company server and passes the gateway's traffic onto the home network.
#
#   sudo ./tunnel-box.sh tower-a-1203-tunnel.conf
#
# The config comes from new-apartment.sh (or: docker exec cube-gw-<name> cube-gateway tunnel-config). The box needs
# nothing opened on the home router, only internet access, and must stay on: without it the gateway can't reach
# this home's devices. Re-running with a new config replaces the old one.
set -euo pipefail
CONF="${1:?usage: sudo ./tunnel-box.sh <name>-tunnel.conf}"
[ "$(id -u)" = 0 ] || { echo "Run it with sudo."; exit 1; }
[ -f "$CONF" ] || { echo "No such file: $CONF"; exit 1; }
grep -q '^\[Peer\]' "$CONF" || { echo "$CONF is not a CUBE tunnel config."; exit 1; }

echo "Installing WireGuard..."
apt-get update -qq
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq wireguard-tools iptables >/dev/null

install -d -m 0700 /etc/wireguard
install -m 0600 "$CONF" /etc/wireguard/cube.conf
systemctl enable wg-quick@cube >/dev/null 2>&1
systemctl restart wg-quick@cube

echo "Waiting for the server to answer..."
for _ in $(seq 1 15); do
  # A handshake time other than 0 means the server accepted this box's key.
  if [ "$(wg show cube latest-handshakes | awk '{print $2}')" != "0" ]; then
    echo "Tunnel box ready: the apartment's gateway on the server can now reach this home network."
    echo "Check it any time with: sudo wg show cube"
    exit 0
  fi
  sleep 2
done
echo "No answer from the server yet. Check this box has internet access, and on the server that the apartment's"
echo "UDP port is forwarded and the gateway is running (docker logs cube-gw-<name> | grep tunnel)."
exit 1
