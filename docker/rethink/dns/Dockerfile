# dnsmasq for rethink's DNS redirect (see entrypoint.sh).
FROM alpine:3.20
RUN apk add --no-cache dnsmasq
COPY entrypoint.sh /entrypoint.sh
ENTRYPOINT ["/bin/sh", "/entrypoint.sh"]
