"""`cube-gateway` command line: serve (default), relay, setup-code, reset-owner, healthcheck."""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
import urllib.request

from . import __version__
from .config import load_settings
from .logs import configure


def _serve() -> None:
    import uvicorn

    from .api import create_app

    settings = load_settings()
    configure(settings.log_level, settings.log_format)
    uvicorn.run(
        create_app(settings),
        host=settings.host,
        port=settings.port,
        log_config=None,
        access_log=False,
        ws="websockets-sansio",
        proxy_headers=False,
        timeout_graceful_shutdown=10,
    )


def _relay() -> None:
    import uvicorn

    from .relay.server import create_relay_app

    settings = load_settings()
    configure(settings.log_level, settings.log_format)
    # The relay runs behind a TLS reverse proxy on the same host; it reads X-Forwarded-For for rate limits.
    uvicorn.run(create_relay_app(settings), host=settings.host, port=settings.relay_port, log_config=None, access_log=False, ws="websockets-sansio", proxy_headers=True, forwarded_allow_ips="127.0.0.1")


def _setup_code() -> int:
    settings = load_settings()
    path = settings.data_dir / "setup-code.txt"
    if not path.exists():
        print("This gateway is already paired. To start over: cube-gateway reset-owner")
        return 1
    code = path.read_text().strip()
    print(f"Setup code: {code}")
    _print_pairing_qr(settings, code)
    return 0


def _print_pairing_qr(settings, code: str) -> None:
    from .security import pairing_target, render_qr, setup_payload

    try:
        gateway_id = _gateway_id(settings)
    except Exception:  # noqa: BLE001 - the code on its own is enough
        return
    print(render_qr(setup_payload(gateway_id, code, pairing_target(settings, gateway_id))))


def _gateway_id(settings) -> str:
    import sqlite3

    with sqlite3.connect(settings.db_path) as conn:
        row = conn.execute("SELECT value FROM meta WHERE key = 'gateway_id'").fetchone()
    return row[0] if row else ""


def _reset_owner() -> int:
    from .crypto import Sealer
    from .db import Database
    from .security import Security

    settings = load_settings()

    async def run() -> str:
        db = Database(settings.db_path)
        await db.open()
        security = Security(db, Sealer.from_file(settings.key_path), code_file=settings.data_dir / "setup-code.txt")
        try:
            return await security.reset_owner()
        finally:
            await db.close()

    code = asyncio.run(run())
    print("Every paired phone was removed. Devices and rooms are kept.")
    print(f"New setup code: {code}")
    _print_pairing_qr(settings, code)
    print("Restart the gateway so open sessions end at once: docker restart cube-os-gateway")
    return 0


def _healthcheck() -> int:
    """Healthy when the gateway API or, in relay mode, the relay answers on this host (one image, two modes)."""
    settings = load_settings()
    for url in (f"http://127.0.0.1:{settings.port}/api/v1/health", f"http://127.0.0.1:{settings.relay_port}/relay/v1/health"):
        try:
            with urllib.request.urlopen(url, timeout=4) as response:  # noqa: S310 - fixed local URLs
                if json.loads(response.read()).get("ok"):
                    return 0
        except Exception:  # noqa: BLE001 - try the other mode
            continue
    return 1


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="cube-gateway", description="CUBE Gateway: local smart home discovery and control.")
    parser.add_argument("--version", action="version", version=f"cube-gateway {__version__}")
    sub = parser.add_subparsers(dest="command")
    sub.add_parser("serve", help="run the gateway (default)")
    sub.add_parser("relay", help="run the optional remote relay (public server)")
    sub.add_parser("setup-code", help="print the setup code for pairing the first phone")
    sub.add_parser("reset-owner", help="unpair every phone and print a new setup code")
    sub.add_parser("healthcheck", help="exit 0 when the local API answers")
    args = parser.parse_args(argv)
    command = args.command or "serve"
    if command == "serve":
        _serve()
    elif command == "relay":
        _relay()
    elif command == "setup-code":
        sys.exit(_setup_code())
    elif command == "reset-owner":
        sys.exit(_reset_owner())
    elif command == "healthcheck":
        sys.exit(_healthcheck())


if __name__ == "__main__":
    main()
