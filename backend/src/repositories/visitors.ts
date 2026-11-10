import { db } from '../ems/db.ts';

/** The visitor_passes and visitor_entries tables (migration 15); visitors/passes.ts seals and unseals. */

export interface PassRow {
  id: string;
  unit_id: string;
  created_by: string | null;
  visitor_name: string;
  visitor_phone: string | null;
  plate: string | null;
  guests: number;
  arrives_at: string;
  valid_from: string;
  valid_to: string;
  uses: 'single' | 'multi';
  status: 'scheduled' | 'arrived' | 'left' | 'revoked';
  token_hash: string;
  token_sealed: string;
  created_at: string;
  updated_at: string;
  revoked_at: string | null;
}

export interface EntryRow {
  id: string;
  pass_id: string;
  kind: 'entry' | 'exit';
  gate: string | null;
  at: string;
  by_user: string | null;
}

export function insertPass(row: PassRow): void {
  db()
    .prepare(
      `INSERT INTO visitor_passes (id, unit_id, created_by, visitor_name, visitor_phone, plate, guests, arrives_at, valid_from, valid_to, uses,
         status, token_hash, token_sealed, created_at, updated_at, revoked_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    )
    .run(
      row.id, row.unit_id, row.created_by, row.visitor_name, row.visitor_phone, row.plate, row.guests, row.arrives_at, row.valid_from,
      row.valid_to, row.uses, row.status, row.token_hash, row.token_sealed, row.created_at, row.updated_at,
    );
}

export function findPass(id: string): PassRow | undefined {
  return db().prepare('SELECT * FROM visitor_passes WHERE id = ?').get(id) as PassRow | undefined;
}

export function findPassByTokenHash(hash: string): PassRow | undefined {
  return db().prepare('SELECT * FROM visitor_passes WHERE token_hash = ?').get(hash) as PassRow | undefined;
}

/** The unit's passes whose window ends after `since`, soonest arrival first. */
export function listUnitPasses(unitId: string, since: string): PassRow[] {
  return db().prepare('SELECT * FROM visitor_passes WHERE unit_id = ? AND valid_to >= ? ORDER BY arrives_at').all(unitId, since) as unknown as PassRow[];
}

/** Passes on the site whose window overlaps [from, to), for the gate's list. */
export function listSitePasses(siteId: string, from: string, to: string): (PassRow & { unit_name: string })[] {
  return db()
    .prepare(
      `SELECT visitor_passes.*, units.name AS unit_name FROM visitor_passes JOIN units ON units.id = visitor_passes.unit_id
       WHERE units.site_id = ? AND visitor_passes.valid_from < ? AND visitor_passes.valid_to >= ? ORDER BY visitor_passes.arrives_at`,
    )
    .all(siteId, to, from) as unknown as (PassRow & { unit_name: string })[];
}

/** Changes the status only if it is still `from`, so two gates can't both admit the same visitor. */
export function moveStatus(id: string, from: PassRow['status'], to: PassRow['status'], at: string): boolean {
  return Number(db().prepare('UPDATE visitor_passes SET status = ?, updated_at = ? WHERE id = ? AND status = ?').run(to, at, id, from).changes) > 0;
}

export function revokePass(id: string, at: string): boolean {
  return Number(
    db().prepare("UPDATE visitor_passes SET status = 'revoked', revoked_at = ?, updated_at = ? WHERE id = ? AND status IN ('scheduled', 'arrived')").run(at, at, id).changes,
  ) > 0;
}

export function insertEntry(row: EntryRow): void {
  db().prepare('INSERT INTO visitor_entries (id, pass_id, kind, gate, at, by_user) VALUES (?, ?, ?, ?, ?, ?)').run(row.id, row.pass_id, row.kind, row.gate, row.at, row.by_user);
}

export function listEntries(passIds: readonly string[]): EntryRow[] {
  if (passIds.length === 0) return [];
  return db()
    .prepare(`SELECT * FROM visitor_entries WHERE pass_id IN (${passIds.map(() => '?').join(', ')}) ORDER BY at`)
    .all(...passIds) as unknown as EntryRow[];
}

/** Past passes hold visitors' names and phones: removed after the site's retention (hourly upkeep). */
export function deletePassesEndedBefore(siteId: string, before: string): number {
  return Number(
    db()
      .prepare('DELETE FROM visitor_passes WHERE valid_to < ? AND unit_id IN (SELECT id FROM units WHERE site_id = ?)')
      .run(before, siteId).changes,
  );
}
