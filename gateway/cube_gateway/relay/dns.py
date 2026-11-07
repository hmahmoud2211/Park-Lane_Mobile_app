"""DNS records for gateway certificates, through Cloudflare's API.

Two kinds of record, both in zones the operator controls:
- `<gateway id>.<lan zone>` A -> the gateway's private home address, so the app can reach it at home over HTTPS by a
  name its certificate covers (Plex does the same with plex.direct). Some routers drop DNS answers that point at
  private addresses; the app then falls back to plain HTTP with the identity check.
- `_acme-challenge.<name>` TXT, briefly, while Let's Encrypt validates a certificate order.

The API token needs Zone -> DNS -> Edit on the zone(s), and nothing else. Records are never proxied: a proxied
(orange-cloud) record would end TLS at Cloudflare.
"""

from __future__ import annotations

import asyncio
import ipaddress
import logging
from dataclasses import dataclass
from typing import Any

import httpx

log = logging.getLogger("cube.relay.dns")
API = "https://api.cloudflare.com/client/v4"
LAN_TTL = 300


class DnsError(Exception):
    pass


@dataclass(frozen=True)
class Record:
    zone_id: str
    record_id: str


class CloudflareDns:
    def __init__(self, token: str, http: httpx.AsyncClient, *, zone_id: str = "", propagation_wait: float = 20.0, api: str = API):
        self.token = token
        self.http = http
        self.zone_id = zone_id
        self.propagation_wait = propagation_wait
        self.api = api.rstrip("/")
        self._zones: dict[str, str] = {}

    async def _call(self, method: str, path: str, **kwargs: Any) -> Any:
        try:
            response = await self.http.request(method, f"{self.api}{path}", headers={"Authorization": f"Bearer {self.token}"}, timeout=20, **kwargs)
            body = response.json()
        except (httpx.HTTPError, ValueError) as error:
            raise DnsError(f"Cloudflare could not be reached: {error}") from error
        if not body.get("success"):
            errors = "; ".join(str(e.get("message")) for e in body.get("errors", [])) or f"HTTP {response.status_code}"
            raise DnsError(f"Cloudflare refused: {errors}")
        return body.get("result")

    async def zone_for(self, name: str) -> str:
        """The zone holding `name`: the configured zone id, or the longest zone suffix the token can see."""
        if self.zone_id:
            return self.zone_id
        labels = name.rstrip(".").split(".")
        for start in range(len(labels) - 1):
            candidate = ".".join(labels[start:])
            if candidate in self._zones:
                return self._zones[candidate]
            zones = await self._call("GET", "/zones", params={"name": candidate})
            if zones:
                self._zones[candidate] = zones[0]["id"]
                return zones[0]["id"]
        raise DnsError(f"No Cloudflare zone this token can edit holds {name}.")

    async def set_txt(self, name: str, value: str) -> Record:
        zone = await self.zone_for(name)
        result = await self._call("POST", f"/zones/{zone}/dns_records", json={"type": "TXT", "name": name, "content": value, "ttl": 60})
        return Record(zone, result["id"])

    async def delete(self, record: Record) -> None:
        await self._call("DELETE", f"/zones/{record.zone_id}/dns_records/{record.record_id}")

    async def wait_visible(self) -> None:
        # Cloudflare's own nameservers answer within seconds; Let's Encrypt asks them directly, not a cache.
        await asyncio.sleep(self.propagation_wait)

    async def upsert_a(self, name: str, address: str) -> None:
        """Points `name` at `address` (private IPv4 only), creating or updating the one A record."""
        ip = ipaddress.ip_address(address)
        if ip.version != 4 or not ip.is_private or ip.is_loopback or ip.is_link_local:
            raise DnsError(f"{address} is not a private home address.")
        zone = await self.zone_for(name)
        existing = await self._call("GET", f"/zones/{zone}/dns_records", params={"type": "A", "name": name})
        record = {"type": "A", "name": name, "content": str(ip), "ttl": LAN_TTL, "proxied": False}
        if existing:
            if existing[0].get("content") != str(ip):
                await self._call("PUT", f"/zones/{zone}/dns_records/{existing[0]['id']}", json=record)
        else:
            await self._call("POST", f"/zones/{zone}/dns_records", json=record)
