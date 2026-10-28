#!/bin/sh
# The DNS redirect rethink needs: LG's cloud (every *.lgthinq.com name) and
# rethink.lan (config.json's hostname) answer with the LAN address of the
# machine running rethink; everything else goes to public DNS. LG appliances
# only find rethink when they use this server, so the router's DHCP hands it
# out as the network's DNS (see docker-compose.yml).
set -eu
: "${RETHINK_HOST_IP:?Set RETHINK_HOST_IP in .env to the LAN address of the machine running rethink}"

cat > /etc/dnsmasq.conf <<CONF
no-resolv
no-hosts
server=${UPSTREAM_DNS_1:-1.1.1.1}
server=${UPSTREAM_DNS_2:-8.8.8.8}
address=/lgthinq.com/${RETHINK_HOST_IP}
address=/rethink.lan/${RETHINK_HOST_IP}
# rethink's wiki: redirects need a non-zero TTL.
local-ttl=300
cache-size=1000
log-queries
log-facility=-
CONF

exec dnsmasq --keep-in-foreground --conf-file=/etc/dnsmasq.conf
