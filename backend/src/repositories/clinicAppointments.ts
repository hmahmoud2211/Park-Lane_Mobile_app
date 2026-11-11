import { db } from '../ems/db.ts';

/** The clinic_appointments table: bookings and where each one stands. `reason` is sealed by the caller; this module only sees the sealed text. */

export type AppointmentStatus =
  | 'scheduled'
  | 'checked_in'
  | 'waiting'
  | 'in_consultation'
  | 'completed'
  | 'cancelled'
  | 'no_show'
  | 'rescheduled';

export interface AppointmentRow {
  id: string;
  doctor_id: string;
  patient_profile_id: string | null;
  patient_name: string;
  patient_sex: string | null;
  patient_dob: string | null;
  booked_by: string;
  starts_at: string;
  ends_at: string;
  status: AppointmentStatus;
  reason: string | null;
  share_history: number;
  share_history_at: string | null;
  ai_consent: number;
  ai_consent_at: string | null;
  ai_consent_by: string | null;
  checked_in_at: string | null;
  checked_in_by: string | null;
  ready_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  cancelled_by: string | null;
  cancel_reason: string | null;
  no_show_at: string | null;
  rescheduled_from: string | null;
  rescheduled_to: string | null;
  next_notified_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface DoctorPatientRow {
  patient_profile_id: string;
  patient_name: string;
  patient_sex: string | null;
  patient_dob: string | null;
  last_at: string;
  visits: number;
}

export interface PastVisitRow {
  id: string;
  starts_at: string;
  status: string;
  display_name: string;
  name_en: string;
}

/** Columns updateAppointmentColumns() and updateAppointmentIfStatus() may set. */
export type AppointmentColumn =
  | 'status'
  | 'updated_at'
  | 'checked_in_at'
  | 'checked_in_by'
  | 'ready_at'
  | 'started_at'
  | 'no_show_at'
  | 'cancelled_at'
  | 'cancelled_by'
  | 'cancel_reason'
  | 'share_history'
  | 'share_history_at'
  | 'ai_consent'
  | 'ai_consent_at'
  | 'ai_consent_by';

export type AppointmentChanges = Partial<Record<AppointmentColumn, string | number | null>>;

function assignments(changes: AppointmentChanges): { sets: string; values: (string | number | null)[] } {
  const columns = Object.keys(changes) as AppointmentColumn[];
  return {
    sets: columns.map((column) => `${column} = ?`).join(', '),
    values: columns.map((column) => changes[column] as string | number | null),
  };
}

export function findAppointment(id: string): AppointmentRow | null {
  return (db().prepare('SELECT * FROM clinic_appointments WHERE id = ?').get(id) as AppointmentRow | undefined) ?? null;
}

/** A new `scheduled` booking. Throws SQLite's UNIQUE error when the slot, or the patient at that time, is taken. */
export function insertAppointment(appointment: {
  id: string;
  doctorId: string;
  patientProfileId: string;
  patientName: string;
  patientSex: string | null;
  patientDob: string | null;
  bookedBy: string;
  startsAt: string;
  endsAt: string;
  reason: string | null;
  shareHistory: 0 | 1;
  shareHistoryAt: string | null;
  aiConsent: 0 | 1;
  aiConsentAt: string | null;
  aiConsentBy: string | null;
  rescheduledFrom: string | null;
  at: string;
}): void {
  db()
    .prepare(
      `INSERT INTO clinic_appointments (
         id, doctor_id, patient_profile_id, patient_name, patient_sex, patient_dob, booked_by,
         starts_at, ends_at, status, reason, share_history, share_history_at, ai_consent, ai_consent_at, ai_consent_by,
         rescheduled_from, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'scheduled', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      appointment.id,
      appointment.doctorId,
      appointment.patientProfileId,
      appointment.patientName,
      appointment.patientSex,
      appointment.patientDob,
      appointment.bookedBy,
      appointment.startsAt,
      appointment.endsAt,
      appointment.reason,
      appointment.shareHistory,
      appointment.shareHistoryAt,
      appointment.aiConsent,
      appointment.aiConsentAt,
      appointment.aiConsentBy,
      appointment.rescheduledFrom,
      appointment.at,
      appointment.at,
    );
}

export function markAppointmentRescheduled(id: string, rescheduledTo: string, updatedAt: string): void {
  db()
    .prepare("UPDATE clinic_appointments SET status = 'rescheduled', rescheduled_to = ?, updated_at = ? WHERE id = ?")
    .run(rescheduledTo, updatedAt, id);
}

/** Sets the given columns, in order. */
export function updateAppointmentColumns(id: string, changes: AppointmentChanges): void {
  const { sets, values } = assignments(changes);
  db()
    .prepare(`UPDATE clinic_appointments SET ${sets} WHERE id = ?`)
    .run(...values, id);
}

/** Sets the given columns, in order, if the appointment is still in `status`. False when it has moved on. */
export function updateAppointmentIfStatus(id: string, status: AppointmentStatus, changes: AppointmentChanges): boolean {
  const { sets, values } = assignments(changes);
  const result = db()
    .prepare(`UPDATE clinic_appointments SET ${sets} WHERE id = ? AND status = ?`)
    .run(...values, id, status);
  return Number(result.changes) === 1;
}

export function completeAppointment(id: string, at: string): void {
  db()
    .prepare("UPDATE clinic_appointments SET status = 'completed', completed_at = ?, updated_at = ? WHERE id = ? AND status = 'in_consultation'")
    .run(at, at, id);
}

/** Claims the "next patient" notice for this appointment. False when it was already claimed. */
export function claimNextNotification(id: string, at: string): boolean {
  const result = db().prepare('UPDATE clinic_appointments SET next_notified_at = ? WHERE id = ? AND next_notified_at IS NULL').run(at, id);
  return Number(result.changes) === 1;
}

/** Who gave the AI consent: 'resident', or the doctor's user id when given in person. */
export function setAppointmentAiConsent(id: string, by: string, at: string): void {
  db().prepare('UPDATE clinic_appointments SET ai_consent = 1, ai_consent_at = ?, ai_consent_by = ?, updated_at = ? WHERE id = ?').run(at, by, at, id);
}

export function countUpcomingBookings(userId: string, after: string): number {
  const row = db()
    .prepare("SELECT COUNT(*) AS count FROM clinic_appointments WHERE booked_by = ? AND status = 'scheduled' AND starts_at > ?")
    .get(userId, after) as { count: number };
  return row.count;
}

/** The patient's live appointments that overlap the time, other than `excludingId`. */
export function countOverlappingAppointments(profileId: string, endsAt: string, startsAt: string, excludingId: string): number {
  const row = db()
    .prepare(
      `SELECT COUNT(*) AS count FROM clinic_appointments
       WHERE patient_profile_id = ? AND status IN ('scheduled', 'checked_in', 'waiting', 'in_consultation')
         AND starts_at < ? AND ends_at > ? AND id != ?`,
    )
    .get(profileId, endsAt, startsAt, excludingId) as { count: number };
  return row.count;
}

/** The doctor's other appointment in consultation among those starting in the range, if any. */
export function findOtherConsultationInProgress(doctorId: string, appointmentId: string, from: string, to: string): string | undefined {
  const row = db()
    .prepare("SELECT id FROM clinic_appointments WHERE doctor_id = ? AND status = 'in_consultation' AND id != ? AND starts_at >= ? AND starts_at < ?")
    .get(doctorId, appointmentId, from, to) as { id: string } | undefined;
  return row?.id;
}

/** The doctor's consultations still open from before `before`, oldest first. */
export function listUnfinishedConsultations(doctorId: string, before: string): AppointmentRow[] {
  return db()
    .prepare("SELECT * FROM clinic_appointments WHERE doctor_id = ? AND starts_at < ? AND status = 'in_consultation' ORDER BY starts_at, id")
    .all(doctorId, before) as unknown as AppointmentRow[];
}

/** The start times in the range held by an appointment in one of `statuses`. */
export function listBookedStarts(doctorId: string, from: string, to: string, statuses: readonly AppointmentStatus[]): string[] {
  const placeholders = statuses.map(() => '?').join(', ');
  const rows = db()
    .prepare(
      `SELECT starts_at FROM clinic_appointments
       WHERE doctor_id = ? AND starts_at >= ? AND starts_at < ? AND status IN (${placeholders})`,
    )
    .all(doctorId, from, to, ...statuses) as { starts_at: string }[];
  return rows.map((row) => row.starts_at);
}

export function listResidentAppointments(userId: string): AppointmentRow[] {
  return db()
    .prepare("SELECT * FROM clinic_appointments WHERE booked_by = ? AND status != 'rescheduled' ORDER BY starts_at DESC LIMIT 200")
    .all(userId) as unknown as AppointmentRow[];
}

/** Patients at the clinic for a doctor in the range, in no particular order. */
export function listQueueAppointments(doctorId: string, from: string, to: string): AppointmentRow[] {
  return db()
    .prepare(
      `SELECT * FROM clinic_appointments WHERE doctor_id = ? AND starts_at >= ? AND starts_at < ?
       AND status IN ('checked_in', 'waiting')`,
    )
    .all(doctorId, from, to) as unknown as AppointmentRow[];
}

/** A day's appointments; `doctorId` keeps only that doctor's. */
export function listDayAppointments(doctorId: string | null, from: string, to: string): AppointmentRow[] {
  const sql = `SELECT * FROM clinic_appointments WHERE starts_at >= ? AND starts_at < ? AND status != 'rescheduled'
               ${doctorId ? 'AND doctor_id = ?' : ''} ORDER BY starts_at, id`;
  return db()
    .prepare(sql)
    .all(...(doctorId ? [from, to, doctorId] : [from, to])) as unknown as AppointmentRow[];
}

/** The doctor's next few scheduled appointments from `after`. */
export function listUpcomingAppointments(doctorId: string, after: string): AppointmentRow[] {
  return db()
    .prepare("SELECT * FROM clinic_appointments WHERE doctor_id = ? AND starts_at >= ? AND status = 'scheduled' ORDER BY starts_at LIMIT 8")
    .all(doctorId, after) as unknown as AppointmentRow[];
}

/** Newest first. */
export function listDoctorAppointments(doctorId: string, from: string, to: string): AppointmentRow[] {
  return db()
    .prepare(
      `SELECT * FROM clinic_appointments WHERE doctor_id = ? AND starts_at >= ? AND starts_at < ? AND status != 'rescheduled'
       ORDER BY starts_at DESC LIMIT 500`,
    )
    .all(doctorId, from, to) as unknown as AppointmentRow[];
}

/** One row per patient, most recently seen first. */
export function listDoctorPatients(doctorId: string): DoctorPatientRow[] {
  return db()
    .prepare(
      `SELECT patient_profile_id, patient_name, patient_sex, patient_dob, MAX(starts_at) AS last_at, COUNT(*) AS visits
       FROM clinic_appointments WHERE doctor_id = ? AND patient_profile_id IS NOT NULL AND status NOT IN ('rescheduled')
       GROUP BY patient_profile_id ORDER BY last_at DESC LIMIT 300`,
    )
    .all(doctorId) as unknown as DoctorPatientRow[];
}

/** The patient's finished visits before `before`, newest first; `doctorId` keeps only that doctor's. */
export function listPastVisits(profileId: string, doctorId: string | null, before: string): PastVisitRow[] {
  return db()
    .prepare(
      `SELECT a.id, a.starts_at, a.status, d.display_name, s.name_en
       FROM clinic_appointments a JOIN clinic_doctors d ON d.id = a.doctor_id JOIN clinic_specialties s ON s.id = d.specialty_id
       WHERE a.patient_profile_id = ? AND a.starts_at < ? AND a.status IN ('completed', 'no_show')
       ${doctorId ? 'AND a.doctor_id = ?' : ''} ORDER BY a.starts_at DESC LIMIT 30`,
    )
    .all(...(doctorId ? [profileId, before, doctorId] : [profileId, before])) as unknown as PastVisitRow[];
}
