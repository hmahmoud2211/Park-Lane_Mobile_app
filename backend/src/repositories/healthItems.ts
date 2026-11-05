import { db } from '../ems/db.ts';

/** The health_items table: one entry of a Health Passport record. `data` is sealed by the caller; this module only sees the sealed text. */

export type Section = 'allergies' | 'medications' | 'conditions' | 'procedures' | 'labs' | 'visits';

export interface ItemRow {
  id: string;
  section: Section;
  data: string;
  source: string | null;
}

/** In the order they were saved: `created_at` alone ties within a millisecond, and ids are random. */
export function listHealthItems(profileId: string): ItemRow[] {
  return db()
    .prepare('SELECT id, section, data, source FROM health_items WHERE profile_id = ? ORDER BY created_at, rowid')
    .all(profileId) as unknown as ItemRow[];
}

export function findHealthItem(id: string, profileId: string, section: Section): ItemRow | undefined {
  return db()
    .prepare('SELECT id, section, data, source FROM health_items WHERE id = ? AND profile_id = ? AND section = ?')
    .get(id, profileId, section) as ItemRow | undefined;
}

export function insertHealthItem(item: { id: string; profileId: string; section: Section; data: string; source: string | null; at: string }): void {
  db()
    .prepare('INSERT INTO health_items (id, profile_id, section, data, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(item.id, item.profileId, item.section, item.data, item.source, item.at, item.at);
}

export function updateHealthItemData(id: string, data: string, updatedAt: string): void {
  db().prepare('UPDATE health_items SET data = ?, updated_at = ? WHERE id = ?').run(data, updatedAt, id);
}

/** A document's item takes the place of one already recorded. False when that item is gone. */
export function replaceHealthItem(item: { id: string; profileId: string; section: Section; data: string; source: string; updatedAt: string }): boolean {
  const result = db()
    .prepare('UPDATE health_items SET data = ?, source = ?, updated_at = ? WHERE id = ? AND profile_id = ? AND section = ?')
    .run(item.data, item.source, item.updatedAt, item.id, item.profileId, item.section);
  return Number(result.changes) === 1;
}

export function deleteHealthItem(id: string): void {
  db().prepare('DELETE FROM health_items WHERE id = ?').run(id);
}

export function deleteProfileHealthItems(profileId: string): void {
  db().prepare('DELETE FROM health_items WHERE profile_id = ?').run(profileId);
}

export function deleteHealthItemsFromSource(source: string, profileId: string): void {
  db().prepare('DELETE FROM health_items WHERE source = ? AND profile_id = ?').run(source, profileId);
}

/** The items stay, as if typed in. */
export function clearHealthItemsSource(source: string, profileId: string): void {
  db().prepare('UPDATE health_items SET source = NULL WHERE source = ? AND profile_id = ?').run(source, profileId);
}

export function countHealthItemsFromSource(source: string): number {
  return (db().prepare('SELECT COUNT(*) AS count FROM health_items WHERE source = ?').get(source) as { count: number }).count;
}
