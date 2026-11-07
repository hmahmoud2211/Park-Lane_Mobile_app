import { db } from '../ems/db.ts';
import type { MemberRole } from './units.ts';

/** The gateways and gateway_signing_key tables: the CUBE gateway of each unit, and the key that signs passes. */

export interface Gateway {
  id: string;
  unitId: string;
  url: string | null;
  lastSync: string | null;
  createdAt: string;
}

interface GatewayRow {
  id: string;
  unit_id: string;
  url: string | null;
  secret_hash: string;
  last_sync: string | null;
  created_at: string;
}

const COLUMNS = 'id, unit_id, url, secret_hash, last_sync, created_at';
const toGateway = (row: GatewayRow): Gateway => ({ id: row.id, unitId: row.unit_id, url: row.url, lastSync: row.last_sync, createdAt: row.created_at });

/** Attaches a gateway to a unit, replacing whatever the unit or the gateway was attached to before. */
export function upsertGateway(id: string, unitId: string, url: string | null, secretHash: string, at: string): void {
  db().prepare('DELETE FROM gateways WHERE (unit_id = ? OR id = ?) AND NOT (id = ? AND unit_id = ?)').run(unitId, id, id, unitId);
  db()
    .prepare(
      `INSERT INTO gateways (id, unit_id, url, secret_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET url = excluded.url, secret_hash = excluded.secret_hash, updated_at = excluded.updated_at`,
    )
    .run(id, unitId, url, secretHash, at, at);
}

export function findGatewayOfUnit(unitId: string): Gateway | null {
  const row = db().prepare(`SELECT ${COLUMNS} FROM gateways WHERE unit_id = ?`).get(unitId) as GatewayRow | undefined;
  return row ? toGateway(row) : null;
}

export function findGatewayWithSecret(id: string): (Gateway & { secretHash: string }) | null {
  const row = db().prepare(`SELECT ${COLUMNS} FROM gateways WHERE id = ?`).get(id) as GatewayRow | undefined;
  return row ? { ...toGateway(row), secretHash: row.secret_hash } : null;
}

export function listGateways(): Gateway[] {
  return (db().prepare(`SELECT ${COLUMNS} FROM gateways ORDER BY created_at`).all() as unknown as GatewayRow[]).map(toGateway);
}

export function deleteGateway(id: string): boolean {
  return Number(db().prepare('DELETE FROM gateways WHERE id = ?').run(id).changes) > 0;
}

export function markSynced(id: string, at: string): void {
  db().prepare('UPDATE gateways SET last_sync = ? WHERE id = ?').run(at, id);
}

/** The residents of the unit a gateway serves, with their role there. */
export function membersOfGateway(id: string): { userId: string; role: MemberRole }[] {
  const rows = db()
    .prepare('SELECT unit_members.user_id, unit_members.role FROM gateways JOIN unit_members ON unit_members.unit_id = gateways.unit_id WHERE gateways.id = ? ORDER BY unit_members.created_at, unit_members.user_id')
    .all(id) as unknown as { user_id: string; role: MemberRole }[];
  return rows.map((row) => ({ userId: row.user_id, role: row.role === 'member' ? 'member' : 'owner' }));
}

export function findSigningKey(): { privateSealed: string; publicKey: string } | null {
  const row = db().prepare('SELECT private_sealed, public_key FROM gateway_signing_key WHERE id = 1').get() as
    | { private_sealed: string; public_key: string }
    | undefined;
  return row ? { privateSealed: row.private_sealed, publicKey: row.public_key } : null;
}

export function insertSigningKey(privateSealed: string, publicKey: string, at: string): void {
  db().prepare('INSERT OR IGNORE INTO gateway_signing_key (id, private_sealed, public_key, created_at) VALUES (1, ?, ?, ?)').run(privateSealed, publicKey, at);
}
