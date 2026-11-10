import { db } from '../ems/db.ts';

/** The amenities and amenity_bookings tables (migration 17). */

export interface AmenityRow {
  id: string;
  site_id: string;
  title: string;
  location: string;
  opens: string;
  closes: string;
  slot_minutes: number;
  capacity: number;
  max_people: number;
  exclusive: number;
  categories: string;
  picture: string | null;
  cancel_cutoff_hours: number;
  active: number;
  sort: number;
  created_at: string;
  updated_at: string;
}

export interface BookingRow {
  id: string;
  amenity_id: string;
  unit_id: string;
  user_id: string | null;
  starts_at: string;
  ends_at: string;
  people: number;
  exclusive: number;
  status: 'booked' | 'cancelled';
  reference: string;
  created_at: string;
  updated_at: string;
  cancelled_at: string | null;
}

export function listAmenities(siteId: string, includeInactive = false): AmenityRow[] {
  return db()
    .prepare(`SELECT * FROM amenities WHERE site_id = ? ${includeInactive ? '' : 'AND active = 1'} ORDER BY sort, title`)
    .all(siteId) as unknown as AmenityRow[];
}

export function findAmenity(id: string): AmenityRow | undefined {
  return db().prepare('SELECT * FROM amenities WHERE id = ?').get(id) as AmenityRow | undefined;
}

export function saveAmenity(row: AmenityRow): void {
  db()
    .prepare(
      `INSERT INTO amenities (id, site_id, title, location, opens, closes, slot_minutes, capacity, max_people, exclusive, categories, picture,
         cancel_cutoff_hours, active, sort, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET title = excluded.title, location = excluded.location, opens = excluded.opens, closes = excluded.closes,
         slot_minutes = excluded.slot_minutes, capacity = excluded.capacity, max_people = excluded.max_people, exclusive = excluded.exclusive,
         categories = excluded.categories, picture = excluded.picture, cancel_cutoff_hours = excluded.cancel_cutoff_hours,
         active = excluded.active, sort = excluded.sort, updated_at = excluded.updated_at`,
    )
    .run(
      row.id, row.site_id, row.title, row.location, row.opens, row.closes, row.slot_minutes, row.capacity, row.max_people, row.exclusive,
      row.categories, row.picture, row.cancel_cutoff_hours, row.active, row.sort, row.created_at, row.updated_at,
    );
}

/** People already booked per slot start, for slots starting in [from, to). */
export function bookedPeople(amenityId: string, from: string, to: string): Map<string, number> {
  const rows = db()
    .prepare("SELECT starts_at, SUM(people) AS n FROM amenity_bookings WHERE amenity_id = ? AND status = 'booked' AND starts_at >= ? AND starts_at < ? GROUP BY starts_at")
    .all(amenityId, from, to) as { starts_at: string; n: number }[];
  return new Map(rows.map((row) => [row.starts_at, row.n]));
}

export function unitSlotStarts(amenityId: string, unitId: string, from: string, to: string): Set<string> {
  const rows = db()
    .prepare("SELECT starts_at FROM amenity_bookings WHERE amenity_id = ? AND unit_id = ? AND status = 'booked' AND starts_at >= ? AND starts_at < ?")
    .all(amenityId, unitId, from, to) as { starts_at: string }[];
  return new Set(rows.map((row) => row.starts_at));
}

/** Throws SQLite's constraint error if the slot is taken (exclusive) or the unit already has it. */
export function insertBooking(row: BookingRow): void {
  db()
    .prepare(
      `INSERT INTO amenity_bookings (id, amenity_id, unit_id, user_id, starts_at, ends_at, people, exclusive, status, reference, created_at, updated_at, cancelled_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    )
    .run(row.id, row.amenity_id, row.unit_id, row.user_id, row.starts_at, row.ends_at, row.people, row.exclusive, row.status, row.reference, row.created_at, row.updated_at);
}

export function findBooking(id: string): BookingRow | undefined {
  return db().prepare('SELECT * FROM amenity_bookings WHERE id = ?').get(id) as BookingRow | undefined;
}

export function listUnitBookings(unitId: string, since: string): (BookingRow & { amenity_title: string })[] {
  return db()
    .prepare(
      `SELECT amenity_bookings.*, amenities.title AS amenity_title FROM amenity_bookings JOIN amenities ON amenities.id = amenity_bookings.amenity_id
       WHERE amenity_bookings.unit_id = ? AND amenity_bookings.ends_at >= ? ORDER BY amenity_bookings.starts_at LIMIT 100`,
    )
    .all(unitId, since) as unknown as (BookingRow & { amenity_title: string })[];
}

export function listAmenityBookings(amenityId: string, from: string, to: string): (BookingRow & { unit_name: string })[] {
  return db()
    .prepare(
      `SELECT amenity_bookings.*, units.name AS unit_name FROM amenity_bookings JOIN units ON units.id = amenity_bookings.unit_id
       WHERE amenity_bookings.amenity_id = ? AND amenity_bookings.starts_at >= ? AND amenity_bookings.starts_at < ? ORDER BY amenity_bookings.starts_at`,
    )
    .all(amenityId, from, to) as unknown as (BookingRow & { unit_name: string })[];
}

export function cancelBookingRow(id: string, at: string): boolean {
  return Number(db().prepare("UPDATE amenity_bookings SET status = 'cancelled', cancelled_at = ?, updated_at = ? WHERE id = ? AND status = 'booked'").run(at, at, id).changes) > 0;
}
