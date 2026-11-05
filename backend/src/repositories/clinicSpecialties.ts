import { db } from '../ems/db.ts';

/** The clinic_specialties table: what the clinic's doctors practise, named in both languages. */

export interface SpecialtyRow {
  id: string;
  name_en: string;
  name_ar: string;
}

/** Only specialties an active doctor practises, each with how many do. */
export function listSpecialtiesWithActiveDoctors(): (SpecialtyRow & { doctor_count: number })[] {
  return db()
    .prepare(
      `SELECT s.id, s.name_en, s.name_ar, COUNT(d.id) AS doctor_count
       FROM clinic_specialties s JOIN clinic_doctors d ON d.specialty_id = s.id AND d.active = 1
       GROUP BY s.id ORDER BY s.name_en`,
    )
    .all() as unknown as (SpecialtyRow & { doctor_count: number })[];
}

/** Every specialty, for the clinic CLI. */
export function listAllSpecialties(): SpecialtyRow[] {
  return db().prepare('SELECT id, name_en, name_ar FROM clinic_specialties ORDER BY id').all() as unknown as SpecialtyRow[];
}

export function specialtyExists(id: string): boolean {
  return db().prepare('SELECT id FROM clinic_specialties WHERE id = ?').get(id) !== undefined;
}

export function insertSpecialtyIfMissing(id: string, nameEn: string, nameAr: string, createdAt: string): void {
  db().prepare('INSERT OR IGNORE INTO clinic_specialties (id, name_en, name_ar, created_at) VALUES (?, ?, ?, ?)').run(id, nameEn, nameAr, createdAt);
}

/** Adds the specialty, or renames it if it exists. */
export function upsertSpecialty(id: string, nameEn: string, nameAr: string, createdAt: string): void {
  db()
    .prepare(
      `INSERT INTO clinic_specialties (id, name_en, name_ar, created_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name_en = excluded.name_en, name_ar = excluded.name_ar`,
    )
    .run(id, nameEn, nameAr, createdAt);
}
