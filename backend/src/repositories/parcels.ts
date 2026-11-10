import { db } from '../ems/db.ts';

/** The parcels table (migration 15). */

export interface ParcelRow {
  id: string;
  unit_id: string;
  reference: string;
  carrier: string | null;
  description: string | null;
  status: 'waiting' | 'collected' | 'returned';
  received_at: string;
  received_by: string | null;
  closed_at: string | null;
  closed_by: string | null;
}

export function insertParcel(row: ParcelRow): void {
  db()
    .prepare(
      `INSERT INTO parcels (id, unit_id, reference, carrier, description, status, received_at, received_by, closed_at, closed_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)`,
    )
    .run(row.id, row.unit_id, row.reference, row.carrier, row.description, row.status, row.received_at, row.received_by);
}

export function findParcel(id: string): ParcelRow | undefined {
  return db().prepare('SELECT * FROM parcels WHERE id = ?').get(id) as ParcelRow | undefined;
}

/** Waiting parcels first, then the rest received since `since`, newest first. */
export function listUnitParcels(unitId: string, since: string): ParcelRow[] {
  return db()
    .prepare(
      `SELECT * FROM parcels WHERE unit_id = ? AND (status = 'waiting' OR received_at >= ?)
       ORDER BY status = 'waiting' DESC, received_at DESC`,
    )
    .all(unitId, since) as unknown as ParcelRow[];
}

export function listWaitingParcels(siteId: string): (ParcelRow & { unit_name: string })[] {
  return db()
    .prepare(
      `SELECT parcels.*, units.name AS unit_name FROM parcels JOIN units ON units.id = parcels.unit_id
       WHERE units.site_id = ? AND parcels.status = 'waiting' ORDER BY parcels.received_at`,
    )
    .all(siteId) as unknown as (ParcelRow & { unit_name: string })[];
}

export function closeParcel(id: string, status: 'collected' | 'returned', at: string, by: string | null): boolean {
  return Number(
    db().prepare("UPDATE parcels SET status = ?, closed_at = ?, closed_by = ? WHERE id = ? AND status = 'waiting'").run(status, at, by, id).changes,
  ) > 0;
}
