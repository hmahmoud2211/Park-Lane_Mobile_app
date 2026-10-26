import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { config } from '../config.ts';

/**
 * EMS accounts and their tokens, in DATA_DIR/ems.db (SQLite, built into
 * Node, so the backend stays dependency-free).
 *
 * Tokens are stored as SHA-256 hashes, never as issued. Other secrets are
 * sealed with secrets.ts before they are written.
 *
 * Append a migration to change the schema; never edit one that has shipped.
 */

const MIGRATIONS: readonly string[] = [
  `
  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  -- EMS-issued bearer tokens. kind: session (the app), alexa_access, alexa_refresh.
  CREATE TABLE tokens (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    client_id TEXT,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    revoked_at INTEGER
  );
  CREATE INDEX tokens_user ON tokens(user_id, kind);

  -- EMS authorization codes handed to Alexa (single use, short lived).
  CREATE TABLE oauth_codes (
    code_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    client_id TEXT NOT NULL,
    redirect_uri TEXT NOT NULL,
    code_challenge TEXT,
    expires_at INTEGER NOT NULL,
    used_at INTEGER
  );

  CREATE TABLE devices (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    room TEXT,
    type TEXT NOT NULL,
    protocol TEXT NOT NULL,
    -- The hardware's own id where it has one (a SONOFF plug's device id); not secret.
    external_id TEXT,
    -- Last state the adapter confirmed; never the requested one.
    online INTEGER NOT NULL DEFAULT 0,
    power TEXT NOT NULL DEFAULT 'unknown',
    -- A command in flight, so every client can show it as pending.
    pending_power TEXT,
    alexa_enabled INTEGER NOT NULL DEFAULT 1,
    is_default INTEGER NOT NULL DEFAULT 0,
    last_seen TEXT,
    last_error TEXT,
    -- Adapter settings, sealed (plug id, key, address).
    adapter_config TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX devices_owner ON devices(owner_id);
  CREATE UNIQUE INDEX devices_hardware ON devices(protocol, external_id) WHERE external_id IS NOT NULL;

  -- One Alexa link per EMS user. status: linked, unlinked, failed, expired.
  CREATE TABLE alexa_links (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL,
    amazon_refresh_token TEXT,
    amazon_access_token TEXT,
    amazon_access_expires_at INTEGER,
    api_endpoint TEXT,
    linked_at TEXT,
    checked_at INTEGER,
    last_error TEXT,
    updated_at TEXT NOT NULL
  );

  -- A linking attempt the app started, until Login with Amazon redirects back.
  CREATE TABLE link_states (
    state_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code_verifier TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  );
  `,
  // The CUBE / SONOFF device registry and the custom Alexa skill are gone.
  `
  DROP TABLE devices;
  DROP TABLE oauth_codes;
  DROP TABLE alexa_links;
  DROP TABLE link_states;
  DELETE FROM tokens WHERE kind <> 'session';
  `,
  // Units, their residents and the Home Assistant hub behind each (src/ha/).
  `
  CREATE TABLE units (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    building TEXT,
    created_at TEXT NOT NULL
  );

  -- One unit per resident for now. role: owner, member.
  CREATE TABLE unit_members (
    unit_id TEXT NOT NULL REFERENCES units(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (unit_id, user_id)
  );

  -- kind: container (provisioned here) or box (a hub in the unit, attached by an admin).
  -- status: provisioning, online, offline, auth_failed, failed.
  CREATE TABLE hubs (
    id TEXT PRIMARY KEY,
    unit_id TEXT NOT NULL UNIQUE REFERENCES units(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    base_url TEXT,
    -- The facade's long-lived Home Assistant token, sealed.
    token_sealed TEXT,
    -- The facade user's password, sealed, to issue a new token if one is lost.
    admin_password_sealed TEXT,
    container_name TEXT,
    ha_version TEXT,
    status TEXT NOT NULL,
    last_seen TEXT,
    last_error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT,
    hub_id TEXT,
    action TEXT NOT NULL,
    target TEXT,
    at TEXT NOT NULL
  );
  `,
];

let instance: DatabaseSync | null = null;

export function db(): DatabaseSync {
  if (instance) {
    return instance;
  }
  mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
  const database = new DatabaseSync(join(config.dataDir, 'ems.db'));
  database.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;');
  database.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)');
  const row = database.prepare('SELECT version FROM schema_version').get() as { version: number } | undefined;
  let version = row?.version ?? 0;
  if (!row) {
    database.prepare('INSERT INTO schema_version (version) VALUES (0)').run();
  }
  while (version < MIGRATIONS.length) {
    database.exec('BEGIN');
    try {
      database.exec(MIGRATIONS[version]);
      version += 1;
      database.prepare('UPDATE schema_version SET version = ?').run(version);
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  }
  instance = database;
  return database;
}

/** For tests that reopen the database, as after a restart. */
export function closeDb(): void {
  instance?.close();
  instance = null;
}

export function transaction<T>(work: () => T): T {
  const database = db();
  database.exec('BEGIN IMMEDIATE');
  try {
    const result = work();
    database.exec('COMMIT');
    return result;
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}
