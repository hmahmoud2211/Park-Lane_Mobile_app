import { db } from '../ems/db.ts';

/** The health_profiles table: a resident's own Health Passport profile, and their family's. */

export type Relation = 'self' | 'child' | 'parent' | 'spouse' | 'other';

export interface ProfileRow {
  id: string;
  owner_id: string;
  relation: Relation;
  name: string;
  sex: 'male' | 'female' | null;
  date_of_birth: string | null;
  blood_type: 'A+' | 'A-' | 'B+' | 'B-' | 'AB+' | 'AB-' | 'O+' | 'O-' | null;
  record_updated_at: string;
}

/** The fields a resident edits. */
export type ProfileFields = Pick<ProfileRow, 'name' | 'sex' | 'date_of_birth' | 'blood_type'>;

const COLUMNS = 'id, owner_id, relation, name, sex, date_of_birth, blood_type, record_updated_at';

export function findHealthProfile(id: string): ProfileRow | undefined {
  return db().prepare(`SELECT ${COLUMNS} FROM health_profiles WHERE id = ?`).get(id) as ProfileRow | undefined;
}

/** The resident's own profile first, then their family in the order they were added. */
export function listHealthProfiles(ownerId: string): ProfileRow[] {
  return db()
    .prepare(
      `SELECT ${COLUMNS} FROM health_profiles WHERE owner_id = ?
       ORDER BY CASE relation WHEN 'self' THEN 0 ELSE 1 END, created_at`,
    )
    .all(ownerId) as unknown as ProfileRow[];
}

export function findSelfProfileId(ownerId: string): string | undefined {
  const row = db().prepare("SELECT id FROM health_profiles WHERE owner_id = ? AND relation = 'self'").get(ownerId) as { id: string } | undefined;
  return row?.id;
}

/** The profile made when consent is given: a name, and nothing else yet. */
export function insertSelfProfile(id: string, ownerId: string, name: string, at: string): void {
  db()
    .prepare(
      `INSERT INTO health_profiles (id, owner_id, relation, name, record_updated_at, created_at)
       VALUES (?, ?, 'self', ?, ?, ?)`,
    )
    .run(id, ownerId, name, at, at);
}

export function insertHealthProfile(id: string, ownerId: string, relation: Relation, fields: ProfileFields, at: string): void {
  db()
    .prepare(
      `INSERT INTO health_profiles (id, owner_id, relation, name, sex, date_of_birth, blood_type, record_updated_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, ownerId, relation, fields.name, fields.sex, fields.date_of_birth, fields.blood_type, at, at);
}

export function updateProfileFields(id: string, fields: ProfileFields, recordUpdatedAt: string): void {
  db()
    .prepare('UPDATE health_profiles SET name = ?, sex = ?, date_of_birth = ?, blood_type = ?, record_updated_at = ? WHERE id = ?')
    .run(fields.name, fields.sex, fields.date_of_birth, fields.blood_type, recordUpdatedAt, id);
}

/** Leaves record_updated_at alone; for the clinic CLI's demo data. */
export function setProfileSexAndBirthDate(id: string, sex: NonNullable<ProfileRow['sex']>, dateOfBirth: string): void {
  db().prepare('UPDATE health_profiles SET sex = ?, date_of_birth = ? WHERE id = ?').run(sex, dateOfBirth, id);
}

export function clearProfileBloodType(id: string, recordUpdatedAt: string): void {
  db().prepare('UPDATE health_profiles SET blood_type = NULL, record_updated_at = ? WHERE id = ?').run(recordUpdatedAt, id);
}

/** Marks the record as changed, which also makes any spoken summary of it out of date. */
export function touchHealthProfile(id: string, recordUpdatedAt: string): void {
  db().prepare('UPDATE health_profiles SET record_updated_at = ? WHERE id = ?').run(recordUpdatedAt, id);
}

export function deleteHealthProfile(id: string): void {
  db().prepare('DELETE FROM health_profiles WHERE id = ?').run(id);
}

/** Everyone but the resident themself. */
export function deleteFamilyProfiles(ownerId: string): void {
  db().prepare("DELETE FROM health_profiles WHERE owner_id = ? AND relation != 'self'").run(ownerId);
}
