import { db } from '../ems/db.ts';

/** The clinic_doctors, clinic_schedules and clinic_time_off tables: the clinic's doctors, their weekly hours and their time away. */

export interface ScheduleBlock {
  weekday: number;
  start: string;
  end: string;
}

export interface ScheduleRow {
  weekday: number;
  start_time: string;
  end_time: string;
}

export interface DoctorRow {
  id: string;
  user_id: string;
  specialty_id: string;
  display_name: string;
  display_name_ar: string | null;
  title: string | null;
  title_ar: string | null;
  bio: string | null;
  bio_ar: string | null;
  years_experience: number | null;
  consultation_minutes: number;
  fee_egp: number | null;
  languages: string | null;
  photo: string | null;
  active: number;
  specialty_en: string;
  specialty_ar: string;
}

export interface DoctorAccountRow {
  id: string;
  display_name: string;
  specialty_id: string;
  consultation_minutes: number;
  active: number;
  email: string;
}

/** Columns updateDoctorColumns() may set, besides updated_at. */
export type DoctorColumn =
  | 'display_name'
  | 'display_name_ar'
  | 'title'
  | 'title_ar'
  | 'bio'
  | 'bio_ar'
  | 'years_experience'
  | 'fee_egp'
  | 'languages'
  | 'specialty_id'
  | 'consultation_minutes'
  | 'photo';

const DOCTOR_SELECT = `
  SELECT d.*, s.name_en AS specialty_en, s.name_ar AS specialty_ar
  FROM clinic_doctors d JOIN clinic_specialties s ON s.id = d.specialty_id`;

export function findDoctor(id: string): DoctorRow | null {
  return (db().prepare(`${DOCTOR_SELECT} WHERE d.id = ?`).get(id) as DoctorRow | undefined) ?? null;
}

export function findDoctorForUser(userId: string): DoctorRow | null {
  return (db().prepare(`${DOCTOR_SELECT} WHERE d.user_id = ?`).get(userId) as DoctorRow | undefined) ?? null;
}

/** By name; with a specialty, only that specialty's. */
export function listActiveDoctors(specialtyId?: string | null): DoctorRow[] {
  return (
    specialtyId
      ? db().prepare(`${DOCTOR_SELECT} WHERE d.active = 1 AND d.specialty_id = ? ORDER BY d.display_name`).all(specialtyId)
      : db().prepare(`${DOCTOR_SELECT} WHERE d.active = 1 ORDER BY d.display_name`).all()
  ) as unknown as DoctorRow[];
}

/** Every doctor with their sign-in email, active or not, for the clinic CLI. */
export function listDoctorAccounts(): DoctorAccountRow[] {
  return db()
    .prepare(
      `SELECT d.id, d.display_name, d.specialty_id, d.consultation_minutes, d.active, u.email FROM clinic_doctors d
       JOIN users u ON u.id = d.user_id ORDER BY d.display_name`,
    )
    .all() as unknown as DoctorAccountRow[];
}

/** An active doctor without a photo yet; the photo is stored once the doctor has an id. */
export function insertDoctor(doctor: {
  id: string;
  userId: string;
  specialtyId: string;
  displayName: string;
  displayNameAr: string | null;
  title: string | null;
  titleAr: string | null;
  bio: string | null;
  bioAr: string | null;
  yearsExperience: number | null;
  consultationMinutes: number;
  feeEgp: number | null;
  languages: string | null;
  at: string;
}): void {
  db()
    .prepare(
      `INSERT INTO clinic_doctors (id, user_id, specialty_id, display_name, display_name_ar, title, title_ar, bio, bio_ar,
         years_experience, consultation_minutes, fee_egp, languages, photo, active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 1, ?, ?)`,
    )
    .run(
      doctor.id,
      doctor.userId,
      doctor.specialtyId,
      doctor.displayName,
      doctor.displayNameAr,
      doctor.title,
      doctor.titleAr,
      doctor.bio,
      doctor.bioAr,
      doctor.yearsExperience,
      doctor.consultationMinutes,
      doctor.feeEgp,
      doctor.languages,
      doctor.at,
      doctor.at,
    );
}

/** The clinic CLI's sample doctors, who have no Arabic title or biography. */
export function insertDemoDoctor(doctor: {
  id: string;
  userId: string;
  specialtyId: string;
  displayName: string;
  displayNameAr: string;
  title: string;
  bio: string;
  yearsExperience: number;
  consultationMinutes: number;
  feeEgp: number;
  languages: string;
  at: string;
}): void {
  db()
    .prepare(
      `INSERT INTO clinic_doctors (id, user_id, specialty_id, display_name, display_name_ar, title, bio, years_experience,
         consultation_minutes, fee_egp, languages, active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    )
    .run(
      doctor.id,
      doctor.userId,
      doctor.specialtyId,
      doctor.displayName,
      doctor.displayNameAr,
      doctor.title,
      doctor.bio,
      doctor.yearsExperience,
      doctor.consultationMinutes,
      doctor.feeEgp,
      doctor.languages,
      doctor.at,
      doctor.at,
    );
}

export function setDoctorPhoto(id: string, photo: string): void {
  db().prepare('UPDATE clinic_doctors SET photo = ? WHERE id = ?').run(photo, id);
}

/** Sets the given columns, in order, and updated_at. */
export function updateDoctorColumns(id: string, changes: Partial<Record<DoctorColumn, string | number | null>>, updatedAt: string): void {
  const columns = Object.keys(changes) as DoctorColumn[];
  db()
    .prepare(`UPDATE clinic_doctors SET ${columns.map((column) => `${column} = ?`).join(', ')}, updated_at = ? WHERE id = ?`)
    .run(...columns.map((column) => changes[column] as string | number | null), updatedAt, id);
}

export function setDoctorActive(id: string, active: 0 | 1, updatedAt: string): void {
  db().prepare('UPDATE clinic_doctors SET active = ?, updated_at = ? WHERE id = ?').run(active, updatedAt, id);
}

/** A doctor's weekly hours, in the shape the app and the slot grid use. */
export function listScheduleBlocks(doctorId: string): ScheduleBlock[] {
  return db()
    .prepare('SELECT weekday, start_time AS start, end_time AS end FROM clinic_schedules WHERE doctor_id = ? ORDER BY weekday, start_time')
    .all(doctorId) as unknown as ScheduleBlock[];
}

export function listScheduleRows(doctorId: string): ScheduleRow[] {
  return db().prepare('SELECT weekday, start_time, end_time FROM clinic_schedules WHERE doctor_id = ? ORDER BY weekday, start_time').all(doctorId) as unknown as ScheduleRow[];
}

export function deleteDoctorSchedule(doctorId: string): void {
  db().prepare('DELETE FROM clinic_schedules WHERE doctor_id = ?').run(doctorId);
}

export function insertScheduleBlock(id: string, doctorId: string, block: ScheduleBlock): void {
  db()
    .prepare('INSERT INTO clinic_schedules (id, doctor_id, weekday, start_time, end_time) VALUES (?, ?, ?, ?, ?)')
    .run(id, doctorId, block.weekday, block.start, block.end);
}

/** Time away that overlaps the range. */
export function listTimeOff(doctorId: string, from: string, to: string): { starts_at: string; ends_at: string }[] {
  return db()
    .prepare('SELECT starts_at, ends_at FROM clinic_time_off WHERE doctor_id = ? AND ends_at > ? AND starts_at < ?')
    .all(doctorId, from, to) as { starts_at: string; ends_at: string }[];
}

export function insertTimeOff(id: string, doctorId: string, startsAt: string, endsAt: string, reason: string | null): void {
  db().prepare('INSERT INTO clinic_time_off (id, doctor_id, starts_at, ends_at, reason) VALUES (?, ?, ?, ?, ?)').run(id, doctorId, startsAt, endsAt, reason);
}
