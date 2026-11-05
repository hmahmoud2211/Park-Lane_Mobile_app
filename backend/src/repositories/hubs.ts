import { db } from '../ems/db.ts';
import type { HubStatus } from '../ha/types.ts';

/**
 * The hubs table: one Home Assistant per unit. The token and admin password are stored
 * sealed (ems/secrets.ts); this module only sees the sealed text.
 */

export type HubKind = 'container' | 'box';

export interface Hub {
  id: string;
  unitId: string;
  kind: HubKind;
  baseUrl: string | null;
  containerName: string | null;
  haVersion: string | null;
  status: HubStatus;
  lastSeen: string | null;
  lastError: string | null;
}

export interface HubRow {
  id: string;
  unit_id: string;
  kind: HubKind;
  base_url: string | null;
  token_sealed: string | null;
  container_name: string | null;
  ha_version: string | null;
  status: HubStatus;
  last_seen: string | null;
  last_error: string | null;
}

/** Columns updateHub() may set, besides updated_at. */
export type HubColumn = 'base_url' | 'token_sealed' | 'admin_password_sealed' | 'status' | 'ha_version' | 'last_error' | 'last_seen';

const COLUMNS = 'id, unit_id, kind, base_url, token_sealed, container_name, ha_version, status, last_seen, last_error';

export const toHub = (row: HubRow): Hub => ({
  id: row.id,
  unitId: row.unit_id,
  kind: row.kind,
  baseUrl: row.base_url,
  containerName: row.container_name,
  haVersion: row.ha_version,
  status: row.status,
  lastSeen: row.last_seen,
  lastError: row.last_error,
});

export function findHubRow(where: 'id' | 'unit_id', value: string): HubRow | undefined {
  return db().prepare(`SELECT ${COLUMNS} FROM hubs WHERE ${where} = ?`).get(value) as HubRow | undefined;
}

export function listHubs(): Hub[] {
  return (db().prepare(`SELECT ${COLUMNS} FROM hubs ORDER BY created_at`).all() as unknown as HubRow[]).map(toHub);
}

/** A hub in `provisioning`, before it has an address or a token. */
export function insertHub(id: string, unitId: string, kind: HubKind, containerName: string | null, now: string): void {
  db()
    .prepare(
      `INSERT INTO hubs (id, unit_id, kind, container_name, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'provisioning', ?, ?)`,
    )
    .run(id, unitId, kind, containerName, now, now);
}

/** Sets the given columns (in order) and updated_at. */
export function updateHub(id: string, columns: readonly [HubColumn, string | null][], updatedAt: string): void {
  const sets = ['updated_at = ?', ...columns.map(([column]) => `${column} = ?`)];
  const values = [updatedAt, ...columns.map(([, value]) => value)];
  db()
    .prepare(`UPDATE hubs SET ${sets.join(', ')} WHERE id = ?`)
    .run(...values, id);
}
