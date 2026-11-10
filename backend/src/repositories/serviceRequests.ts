import { db } from '../ems/db.ts';

/**
 * The technicians, service_categories, service_requests, service_request_events and service_request_photos tables
 * (migration 16). requests/serviceRequests.ts seals and unseals the details, notes and technicians' phones.
 */

export type ServiceKindRow = 'maintenance' | 'housekeeping' | 'moving';
export type RequestStatusRow = 'submitted' | 'assigned' | 'in_progress' | 'completed' | 'cancelled';

export interface CategoryRow {
  site_id: string;
  kind: ServiceKindRow;
  id: string;
  title: string;
  sort: number;
  active: number;
}

export interface TechnicianRow {
  id: string;
  site_id: string;
  name: string;
  phone: string | null;
  trades: string;
  active: number;
  created_at: string;
  updated_at: string;
}

export interface RequestRow {
  id: string;
  unit_id: string;
  created_by: string | null;
  kind: ServiceKindRow;
  category: string;
  title: string;
  details: string | null;
  priority: 'normal' | 'urgent';
  preferred_date: string;
  preferred_window: string;
  scheduled_date: string | null;
  scheduled_window: string | null;
  technician_id: string | null;
  status: RequestStatusRow;
  reference: string;
  created_at: string;
  updated_at: string;
}

export interface RequestEventRow {
  id: string;
  request_id: string;
  kind: 'status' | 'comment';
  status: RequestStatusRow | null;
  note: string | null;
  by_user: string | null;
  by_staff: number;
  at: string;
}

export interface PhotoRow {
  id: string;
  request_id: string;
  file: string;
  mime: string;
  size: number;
  created_at: string;
}

// ---- categories ---------------------------------------------------------------------------------------

export function listCategories(siteId: string, kind?: ServiceKindRow, includeInactive = false): CategoryRow[] {
  const where = ['site_id = ?'];
  const args: string[] = [siteId];
  if (kind) {
    where.push('kind = ?');
    args.push(kind);
  }
  if (!includeInactive) where.push('active = 1');
  return db().prepare(`SELECT * FROM service_categories WHERE ${where.join(' AND ')} ORDER BY kind, sort`).all(...args) as unknown as CategoryRow[];
}

export function countCategories(siteId: string): number {
  return (db().prepare('SELECT COUNT(*) AS n FROM service_categories WHERE site_id = ?').get(siteId) as { n: number }).n;
}

export function insertCategories(rows: readonly Omit<CategoryRow, 'active'>[]): void {
  const statement = db().prepare('INSERT OR IGNORE INTO service_categories (site_id, kind, id, title, sort, active) VALUES (?, ?, ?, ?, ?, 1)');
  for (const row of rows) statement.run(row.site_id, row.kind, row.id, row.title, row.sort);
}

export function findCategory(siteId: string, kind: ServiceKindRow, id: string): CategoryRow | undefined {
  return db().prepare('SELECT * FROM service_categories WHERE site_id = ? AND kind = ? AND id = ?').get(siteId, kind, id) as CategoryRow | undefined;
}

export function setCategoryActive(siteId: string, kind: ServiceKindRow, id: string, active: boolean): boolean {
  return Number(db().prepare('UPDATE service_categories SET active = ? WHERE site_id = ? AND kind = ? AND id = ?').run(active ? 1 : 0, siteId, kind, id).changes) > 0;
}

// ---- technicians --------------------------------------------------------------------------------------

export function listTechnicians(siteId: string): TechnicianRow[] {
  return db().prepare('SELECT * FROM technicians WHERE site_id = ? ORDER BY active DESC, name').all(siteId) as unknown as TechnicianRow[];
}

export function findTechnician(id: string): TechnicianRow | undefined {
  return db().prepare('SELECT * FROM technicians WHERE id = ?').get(id) as TechnicianRow | undefined;
}

export function insertTechnician(row: TechnicianRow): void {
  db()
    .prepare('INSERT INTO technicians (id, site_id, name, phone, trades, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(row.id, row.site_id, row.name, row.phone, row.trades, row.active, row.created_at, row.updated_at);
}

export function updateTechnician(row: TechnicianRow): void {
  db()
    .prepare('UPDATE technicians SET name = ?, phone = ?, trades = ?, active = ?, updated_at = ? WHERE id = ?')
    .run(row.name, row.phone, row.trades, row.active, row.updated_at, row.id);
}

// ---- requests -----------------------------------------------------------------------------------------

export function insertRequest(row: RequestRow): void {
  db()
    .prepare(
      `INSERT INTO service_requests (id, unit_id, created_by, kind, category, title, details, priority, preferred_date, preferred_window,
         scheduled_date, scheduled_window, technician_id, status, reference, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      row.id, row.unit_id, row.created_by, row.kind, row.category, row.title, row.details, row.priority, row.preferred_date,
      row.preferred_window, row.scheduled_date, row.scheduled_window, row.technician_id, row.status, row.reference, row.created_at,
      row.updated_at,
    );
}

export function findRequest(id: string): RequestRow | undefined {
  return db().prepare('SELECT * FROM service_requests WHERE id = ?').get(id) as RequestRow | undefined;
}

/** The unit's requests, newest first. */
export function listUnitRequests(unitId: string, limit = 100): RequestRow[] {
  return db().prepare('SELECT * FROM service_requests WHERE unit_id = ? ORDER BY created_at DESC LIMIT ?').all(unitId, limit) as unknown as RequestRow[];
}

/** Building management's queue: open requests first (urgent ones on top), then the recently closed. */
export function listSiteRequests(
  siteId: string,
  filter: { status?: RequestStatusRow | 'open'; kind?: ServiceKindRow; limit: number },
): (RequestRow & { unit_name: string })[] {
  const where = ['units.site_id = ?'];
  const args: (string | number)[] = [siteId];
  if (filter.status === 'open') where.push("service_requests.status IN ('submitted', 'assigned', 'in_progress')");
  else if (filter.status) {
    where.push('service_requests.status = ?');
    args.push(filter.status);
  }
  if (filter.kind) {
    where.push('service_requests.kind = ?');
    args.push(filter.kind);
  }
  args.push(filter.limit);
  return db()
    .prepare(
      `SELECT service_requests.*, units.name AS unit_name FROM service_requests JOIN units ON units.id = service_requests.unit_id
       WHERE ${where.join(' AND ')}
       ORDER BY service_requests.status IN ('completed', 'cancelled'), service_requests.priority = 'normal', service_requests.created_at DESC
       LIMIT ?`,
    )
    .all(...args) as unknown as (RequestRow & { unit_name: string })[];
}

/** Moves the request only if it is still in one of `from`, so two people acting at once can't both win. */
export function moveRequest(
  id: string,
  from: readonly RequestStatusRow[],
  to: RequestStatusRow,
  at: string,
  booking?: { technicianId: string | null; date: string | null; window: string | null },
): boolean {
  const placeholders = from.map(() => '?').join(', ');
  if (booking) {
    return (
      Number(
        db()
          .prepare(
            `UPDATE service_requests SET status = ?, technician_id = ?, scheduled_date = ?, scheduled_window = ?, updated_at = ?
             WHERE id = ? AND status IN (${placeholders})`,
          )
          .run(to, booking.technicianId, booking.date, booking.window, at, id, ...from).changes,
      ) > 0
    );
  }
  return Number(db().prepare(`UPDATE service_requests SET status = ?, updated_at = ? WHERE id = ? AND status IN (${placeholders})`).run(to, at, id, ...from).changes) > 0;
}

export function touchRequest(id: string, at: string): void {
  db().prepare('UPDATE service_requests SET updated_at = ? WHERE id = ?').run(at, id);
}

// ---- events and photos --------------------------------------------------------------------------------

export function insertRequestEvent(row: RequestEventRow): void {
  db()
    .prepare('INSERT INTO service_request_events (id, request_id, kind, status, note, by_user, by_staff, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(row.id, row.request_id, row.kind, row.status, row.note, row.by_user, row.by_staff, row.at);
}

export function listRequestEvents(requestIds: readonly string[]): RequestEventRow[] {
  if (requestIds.length === 0) return [];
  const placeholders = requestIds.map(() => '?').join(', ');
  return db().prepare(`SELECT * FROM service_request_events WHERE request_id IN (${placeholders}) ORDER BY at, rowid`).all(...requestIds) as unknown as RequestEventRow[];
}

export function insertPhoto(row: PhotoRow): void {
  db()
    .prepare('INSERT INTO service_request_photos (id, request_id, file, mime, size, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(row.id, row.request_id, row.file, row.mime, row.size, row.created_at);
}

export function findPhoto(id: string): (PhotoRow & { unit_id: string }) | undefined {
  return db()
    .prepare(
      `SELECT service_request_photos.*, service_requests.unit_id AS unit_id FROM service_request_photos
       JOIN service_requests ON service_requests.id = service_request_photos.request_id WHERE service_request_photos.id = ?`,
    )
    .get(id) as (PhotoRow & { unit_id: string }) | undefined;
}

export function listPhotos(requestIds: readonly string[]): PhotoRow[] {
  if (requestIds.length === 0) return [];
  const placeholders = requestIds.map(() => '?').join(', ');
  return db().prepare(`SELECT * FROM service_request_photos WHERE request_id IN (${placeholders}) ORDER BY created_at`).all(...requestIds) as unknown as PhotoRow[];
}

export function countPhotos(requestId: string): number {
  return (db().prepare('SELECT COUNT(*) AS n FROM service_request_photos WHERE request_id = ?').get(requestId) as { n: number }).n;
}

/** Every stored photo file still referred to, for sweeping files whose request was removed with its unit. */
export function referencedPhotoFiles(): Set<string> {
  return new Set((db().prepare('SELECT file FROM service_request_photos').all() as { file: string }[]).map((row) => row.file));
}
