"""SQLite storage for one gateway: clients, rooms, devices, candidates, sessions, audit log.

One connection in WAL mode, used from a single worker thread so the event loop never blocks on disk.
Migrations are numbered and run in order on start; the database is created on first boot.
"""

from __future__ import annotations

import asyncio
import json
import sqlite3
import time
from collections.abc import Callable, Iterable
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any, TypeVar

T = TypeVar("T")

MIGRATIONS: list[str] = [
    # 1: the first schema
    """
    CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE clients (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('owner', 'member')),
      token_hash TEXT NOT NULL UNIQUE,
      pin_key_sealed TEXT NOT NULL,
      created_at REAL NOT NULL,
      last_seen REAL,
      revoked_at REAL
    );
    CREATE TABLE invites (
      code_hash TEXT PRIMARY KEY,
      role TEXT NOT NULL,
      created_by TEXT NOT NULL,
      expires_at REAL NOT NULL,
      used_at REAL
    );
    CREATE TABLE rooms (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, created_at REAL NOT NULL);
    CREATE TABLE devices (
      id TEXT PRIMARY KEY,
      adapter_id TEXT NOT NULL,
      brand TEXT NOT NULL,
      unique_id TEXT NOT NULL,
      name TEXT NOT NULL,
      model TEXT,
      category TEXT NOT NULL,
      room_id TEXT REFERENCES rooms(id) ON DELETE SET NULL,
      host TEXT,
      port INTEGER,
      mac TEXT,
      protocol TEXT,
      params TEXT NOT NULL DEFAULT '{}',
      credentials_sealed TEXT,
      dashboard INTEGER NOT NULL DEFAULT 1,
      experimental INTEGER NOT NULL DEFAULT 0,
      state TEXT NOT NULL DEFAULT '{}',
      created_at REAL NOT NULL,
      updated_at REAL NOT NULL,
      last_seen REAL,
      UNIQUE (adapter_id, unique_id)
    );
    CREATE TABLE candidates (
      id TEXT PRIMARY KEY,
      adapter_id TEXT NOT NULL,
      data TEXT NOT NULL,
      first_seen REAL NOT NULL,
      last_seen REAL NOT NULL
    );
    CREATE TABLE provisioning_sessions (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      created_at REAL NOT NULL,
      expires_at REAL NOT NULL
    );
    CREATE TABLE audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at REAL NOT NULL,
      client_id TEXT,
      action TEXT NOT NULL,
      target TEXT,
      detail TEXT
    );
    CREATE INDEX audit_log_at ON audit_log(at);
    """,
    # 2: phones that got their token through an EMS account (accounts.py), and the passes already used
    """
    ALTER TABLE clients ADD COLUMN account_id TEXT;
    ALTER TABLE clients ADD COLUMN session_id TEXT;
    CREATE INDEX clients_account ON clients(account_id);
    CREATE TABLE used_passes (jti TEXT PRIMARY KEY, expires_at REAL NOT NULL);
    -- EMS sessions whose phone was removed here: their passes are refused, and the backend is told to end them
    CREATE TABLE ended_sessions (session_id TEXT PRIMARY KEY, at REAL NOT NULL, reported INTEGER NOT NULL DEFAULT 0);
    """,
]


class Database:
    def __init__(self, path: Path):
        self.path = path
        self._executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="db")
        self._conn: sqlite3.Connection | None = None

    def _connect(self) -> sqlite3.Connection:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(self.path, check_same_thread=False, isolation_level=None)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA foreign_keys=ON")
        conn.execute("PRAGMA busy_timeout=5000")
        return conn

    def _migrate(self, conn: sqlite3.Connection) -> int:
        conn.execute("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)")
        row = conn.execute("SELECT version FROM schema_version").fetchone()
        current = row[0] if row else 0
        for number, sql in enumerate(MIGRATIONS[current:], start=current + 1):
            conn.execute("BEGIN")
            try:
                for statement in _statements(sql):
                    conn.execute(statement)
                if current == 0 and number == 1:
                    conn.execute("INSERT INTO schema_version (version) VALUES (?)", (number,))
                else:
                    conn.execute("UPDATE schema_version SET version = ?", (number,))
                conn.execute("COMMIT")
            except Exception:
                conn.execute("ROLLBACK")
                raise
            current = number
        return current

    async def open(self) -> int:
        def work() -> int:
            self._conn = self._connect()
            return self._migrate(self._conn)

        return await asyncio.get_running_loop().run_in_executor(self._executor, work)

    async def close(self) -> None:
        def work() -> None:
            if self._conn is not None:
                self._conn.close()
                self._conn = None

        await asyncio.get_running_loop().run_in_executor(self._executor, work)
        self._executor.shutdown(wait=True)

    async def run(self, fn: Callable[[sqlite3.Connection], T]) -> T:
        def work() -> T:
            if self._conn is None:
                raise RuntimeError("database is not open")
            return fn(self._conn)

        return await asyncio.get_running_loop().run_in_executor(self._executor, work)

    async def execute(self, sql: str, params: Iterable[Any] = ()) -> int:
        return await self.run(lambda conn: conn.execute(sql, tuple(params)).rowcount)

    async def fetchone(self, sql: str, params: Iterable[Any] = ()) -> dict[str, Any] | None:
        def work(conn: sqlite3.Connection) -> dict[str, Any] | None:
            row = conn.execute(sql, tuple(params)).fetchone()
            return dict(row) if row else None

        return await self.run(work)

    async def fetchall(self, sql: str, params: Iterable[Any] = ()) -> list[dict[str, Any]]:
        return await self.run(lambda conn: [dict(row) for row in conn.execute(sql, tuple(params)).fetchall()])

    async def transaction(self, fn: Callable[[sqlite3.Connection], T]) -> T:
        def work(conn: sqlite3.Connection) -> T:
            conn.execute("BEGIN IMMEDIATE")
            try:
                result = fn(conn)
            except Exception:
                conn.execute("ROLLBACK")
                raise
            conn.execute("COMMIT")
            return result

        return await self.run(work)

    # ---- small key/value store -------------------------------------------------------------

    async def get_meta(self, key: str) -> str | None:
        row = await self.fetchone("SELECT value FROM meta WHERE key = ?", (key,))
        return row["value"] if row else None

    async def set_meta(self, key: str, value: str) -> None:
        await self.execute(
            "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (key, value),
        )

    async def delete_meta(self, key: str) -> None:
        await self.execute("DELETE FROM meta WHERE key = ?", (key,))

    async def audit(self, action: str, client_id: str | None = None, target: str | None = None, **detail: Any) -> None:
        await self.execute(
            "INSERT INTO audit_log (at, client_id, action, target, detail) VALUES (?, ?, ?, ?, ?)",
            (time.time(), client_id, action, target, json.dumps(detail, default=str) if detail else None),
        )


def _statements(script: str) -> list[str]:
    return [part.strip() for part in script.split(";") if part.strip()]
