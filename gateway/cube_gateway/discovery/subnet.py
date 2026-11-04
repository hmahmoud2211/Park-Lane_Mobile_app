"""Authorized subnet host discovery: TCP connect checks on the ports the selected adapters need, for
devices that do not advertise. Only private networks from netutil.scan_subnets() are probed, never more
than a few /24s, with bounded concurrency and short timeouts so a scan stays polite on a home network."""

from __future__ import annotations

import asyncio
import contextlib
import ipaddress

MAX_HOSTS = 1024
CONCURRENCY = 96
CONNECT_TIMEOUT = 0.35


async def _open(ip: str, port: int) -> bool:
    try:
        _reader, writer = await asyncio.wait_for(asyncio.open_connection(ip, port), timeout=CONNECT_TIMEOUT)
    except (OSError, TimeoutError):
        return False
    writer.close()
    with contextlib.suppress(Exception):
        await writer.wait_closed()
    return True


async def probe(
    subnets: list[ipaddress.IPv4Network], ports: list[int], cancelled: asyncio.Event, exclude: set[str] | None = None
) -> dict[int, set[str]]:
    hosts: list[str] = []
    for subnet in subnets:
        if not subnet.is_private:
            continue
        for host in subnet.hosts():
            hosts.append(str(host))
            if len(hosts) >= MAX_HOSTS:
                break
    hosts = [h for h in hosts if h not in (exclude or set())]
    found: dict[int, set[str]] = {port: set() for port in ports}
    semaphore = asyncio.Semaphore(CONCURRENCY)

    async def check(ip: str, port: int) -> None:
        if cancelled.is_set():
            return
        async with semaphore:
            if not cancelled.is_set() and await _open(ip, port):
                found[port].add(ip)

    await asyncio.gather(*(check(ip, port) for ip in hosts for port in ports))
    return found
