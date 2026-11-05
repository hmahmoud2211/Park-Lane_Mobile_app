import { randomUUID } from 'node:crypto';

import { config } from '../config.ts';
import { ApiError } from '../errors.ts';
import type { Role, User } from '../ems/auth.ts';
import { db, transaction } from '../ems/db.ts';
import { normalize } from '../lib/text.ts';
import { seal, unseal } from '../ems/secrets.ts';
import { consentGiven, ownedProfile } from '../health/passport.ts';
import { audit } from './audit.ts';
import { activeDoctor, bookableSlot, doctorRow, presentDoctor, type DoctorProfile, type DoctorRow } from './doctors.ts';
import { broadcast } from './events.ts';
import { ageAt, clinicDate, clinicDayBounds, clinicTime, ISO_DATE } from './time.ts';

/**
 * Appointments: booking, the status machine, and the doctor's queue.
 *
 *   scheduled ─check_in─▶ checked_in ─mark_ready─▶ waiting ─start─▶ in_consultation ─(finalize)─▶ completed
 *       │                     │  └────────start────────────┘ ▲            │
 *       │                     │                              └─return_to_queue─┘
 *       ├─cancel / no_show    ├─cancel / no_show (left without being seen)
 *       └─(reschedule)─▶ rescheduled            no_show ─check_in (same day)─▶ checked_in
 *
 * Every change goes through `transition`, which checks the move, who may
 * make it and when, inside one transaction. `completed` is reached only by
 * finalizing the consultation (consultations.ts).
 */

export type Status =
  | 'scheduled'
  | 'checked_in'
  | 'waiting'
  | 'in_consultation'
  | 'completed'
  | 'cancelled'
  | 'no_show'
  | 'rescheduled';

export type Action = 'check_in' | 'mark_ready' | 'start' | 'return_to_queue' | 'no_show' | 'cancel';

interface Rule {
  from: readonly Status[];
  to: Status;
  roles: readonly Role[];
}

export const TRANSITIONS: Record<Action, Rule> = {
  check_in: { from: ['scheduled', 'no_show'], to: 'checked_in', roles: ['doctor', 'clinic_staff'] },
  mark_ready: { from: ['checked_in'], to: 'waiting', roles: ['doctor', 'clinic_staff'] },
  start: { from: ['checked_in', 'waiting'], to: 'in_consultation', roles: ['doctor'] },
  return_to_queue: { from: ['in_consultation'], to: 'waiting', roles: ['doctor'] },
  no_show: { from: ['scheduled', 'checked_in', 'waiting'], to: 'no_show', roles: ['doctor', 'clinic_staff'] },
  cancel: { from: ['scheduled', 'checked_in', 'waiting'], to: 'cancelled', roles: ['doctor', 'clinic_staff', 'resident'] },
};

const ACTIVE: readonly Status[] = ['scheduled', 'checked_in', 'waiting', 'in_consultation'];
export const IN_CLINIC: readonly Status[] = ['checked_in', 'waiting'];

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
  status: Status;
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

const now = () => new Date().toISOString();
const graceMs = () => config.clinic.lateGraceMinutes * 60_000;

export function appointmentRow(id: string): AppointmentRow | null {
  return (db().prepare('SELECT * FROM clinic_appointments WHERE id = ?').get(id) as AppointmentRow | undefined) ?? null;
}

export const reasonOf = (row: AppointmentRow) => (row.reason ? unseal(row.reason) : null);

// ---- Views --------------------------------------------------------------------------------

/** How the appointment looks on the doctor's and the desk's screens. */
export interface StaffAppointment {
  id: string;
  doctor_id: string;
  starts_at: string;
  ends_at: string;
  date: string;
  time: string;
  status: Status;
  patient: { profile_id: string | null; name: string; sex: string | null; age: number | null };
  reason: string | null;
  share_history: boolean;
  ai_consent: boolean;
  /** 'resident' when given in the app, 'in_person' when the doctor recorded it at the visit. */
  ai_consent_source: 'resident' | 'in_person' | null;
  checked_in_at: string | null;
  ready_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  /** Checked in after the slot's start plus the grace period: queued by arrival. */
  arrived_late: boolean;
  /** Not here yet, and the slot started more than the grace period ago. */
  overdue: boolean;
  consultation: { id: string; status: 'draft' | 'final' } | null;
}

function consultationRef(appointmentId: string): StaffAppointment['consultation'] {
  return (
    (db().prepare('SELECT id, status FROM clinic_consultations WHERE appointment_id = ?').get(appointmentId) as
      | StaffAppointment['consultation']
      | undefined) ?? null
  );
}

function arrivedLate(row: AppointmentRow): boolean {
  return Boolean(row.checked_in_at && Date.parse(row.checked_in_at) > Date.parse(row.starts_at) + graceMs());
}

export function staffView(row: AppointmentRow, nowMs = Date.now()): StaffAppointment {
  const start = Date.parse(row.starts_at);
  return {
    id: row.id,
    doctor_id: row.doctor_id,
    starts_at: row.starts_at,
    ends_at: row.ends_at,
    date: clinicDate(start),
    time: clinicTime(start),
    status: row.status,
    patient: {
      profile_id: row.patient_profile_id,
      name: row.patient_name,
      sex: row.patient_sex,
      age: ageAt(row.patient_dob, start),
    },
    reason: reasonOf(row),
    share_history: row.share_history === 1,
    ai_consent: row.ai_consent === 1,
    ai_consent_source: row.ai_consent !== 1 ? null : row.ai_consent_by === 'resident' ? 'resident' : 'in_person',
    checked_in_at: row.checked_in_at,
    ready_at: row.ready_at,
    started_at: row.started_at,
    completed_at: row.completed_at,
    cancelled_at: row.cancelled_at,
    cancel_reason: row.cancel_reason,
    arrived_late: arrivedLate(row),
    overdue: row.status === 'scheduled' && nowMs > start + graceMs(),
    consultation: consultationRef(row.id),
  };
}

/** How the resident sees their own appointment. */
export interface ResidentAppointment {
  id: string;
  doctor: Pick<DoctorProfile, 'id' | 'name' | 'title' | 'specialty' | 'photo_url' | 'consultation_minutes'>;
  starts_at: string;
  ends_at: string;
  date: string;
  time: string;
  status: Status;
  patient: { profile_id: string | null; name: string };
  reason: string | null;
  share_history: boolean;
  ai_consent: boolean;
  can_cancel: boolean;
  can_reschedule: boolean;
  can_change_consent: boolean;
  /** Set once the doctor has finalized the visit: the record in Health Passport. */
  consultation_id: string | null;
  rescheduled_to: string | null;
}

export function residentView(row: AppointmentRow, nowMs = Date.now()): ResidentAppointment {
  const doctor = presentDoctor(doctorRow(row.doctor_id) as DoctorRow);
  const start = Date.parse(row.starts_at);
  const upcoming = row.status === 'scheduled' && start > nowMs;
  const consultation = consultationRef(row.id);
  return {
    id: row.id,
    doctor: {
      id: doctor.id,
      name: doctor.name,
      title: doctor.title,
      specialty: doctor.specialty,
      photo_url: doctor.photo_url,
      consultation_minutes: doctor.consultation_minutes,
    },
    starts_at: row.starts_at,
    ends_at: row.ends_at,
    date: clinicDate(start),
    time: clinicTime(start),
    status: row.status,
    patient: { profile_id: row.patient_profile_id, name: row.patient_name },
    reason: reasonOf(row),
    share_history: row.share_history === 1,
    ai_consent: row.ai_consent === 1,
    can_cancel: upcoming,
    can_reschedule: upcoming,
    can_change_consent: ACTIVE.includes(row.status),
    consultation_id: consultation?.status === 'final' ? consultation.id : null,
    rescheduled_to: row.rescheduled_to,
  };
}

// ---- Booking ------------------------------------------------------------------------------

function flag(value: unknown, field: string): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value !== 'boolean') throw new ApiError('invalid', `${field} must be true or false.`, field);
  return value;
}

function reasonText(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw new ApiError('invalid', 'reason must be text.', 'reason');
  return value.trim().slice(0, 500) || null;
}

function isUniqueViolation(error: unknown) {
  return /UNIQUE/.test((error as Error).message ?? '');
}

/**
 * Books a slot for one of the resident's Health Passport profiles, or moves
 * an existing booking there (`reschedule_of`). The slot is checked against
 * the doctor's grid and current bookings inside the transaction, and the
 * database's unique indexes refuse a second live booking of the same slot
 * or of the same patient at the same time, however requests interleave.
 */
export function book(user: User, body: Record<string, unknown>, nowMs = Date.now()): ResidentAppointment {
  const doctor = activeDoctor(String(body.doctor_id ?? ''));
  if (typeof body.starts_at !== 'string') throw new ApiError('invalid', 'starts_at is required.', 'starts_at');
  if (typeof body.patient_profile_id !== 'string') {
    throw new ApiError('invalid', 'Choose who the appointment is for.', 'patient_profile_id');
  }
  if (!consentGiven(user.id)) {
    throw new ApiError('consent_required', 'Set up Health Passport first: clinic visits are saved to it.');
  }
  const profile = ownedProfile(user.id, body.patient_profile_id);
  const reason = reasonText(body.reason);
  const shareHistory = flag(body.share_history, 'share_history');
  const aiConsent = flag(body.ai_consent, 'ai_consent');
  const rescheduleOf = typeof body.reschedule_of === 'string' ? body.reschedule_of : null;

  const id = randomUUID();
  const created = transaction(() => {
    const slot = bookableSlot(doctor, body.starts_at as string, nowMs);
    let previous: AppointmentRow | null = null;
    if (rescheduleOf) {
      previous = appointmentRow(rescheduleOf);
      if (!previous || previous.booked_by !== user.id) throw new ApiError('not_found', 'Appointment not found.');
      if (previous.status !== 'scheduled' || Date.parse(previous.starts_at) <= nowMs) {
        throw new ApiError('invalid_transition', 'Only an upcoming appointment can be rescheduled.');
      }
      if (previous.patient_profile_id !== profile.id) {
        throw new ApiError('invalid', 'A rescheduled visit stays with the same patient.', 'patient_profile_id');
      }
    } else {
      const upcoming = db()
        .prepare("SELECT COUNT(*) AS count FROM clinic_appointments WHERE booked_by = ? AND status = 'scheduled' AND starts_at > ?")
        .get(user.id, new Date(nowMs).toISOString()) as { count: number };
      if (upcoming.count >= config.clinic.maxUpcomingPerResident) {
        throw new ApiError('invalid', 'You have the most upcoming appointments allowed. Cancel one to book another.');
      }
    }
    // The same patient cannot be in two consultations at once, with any doctor.
    const overlap = db()
      .prepare(
        `SELECT COUNT(*) AS count FROM clinic_appointments
         WHERE patient_profile_id = ? AND status IN ('scheduled', 'checked_in', 'waiting', 'in_consultation')
           AND starts_at < ? AND ends_at > ? AND id != ?`,
      )
      .get(profile.id, slot.ends_at, slot.starts_at, rescheduleOf ?? '') as { count: number };
    if (overlap.count > 0) {
      throw new ApiError('slot_taken', `${profile.name} already has an appointment at that time.`);
    }

    const at = new Date(nowMs).toISOString();
    if (previous) {
      // Frees the old slot first, so moving within the same day cannot collide with itself.
      db()
        .prepare("UPDATE clinic_appointments SET status = 'rescheduled', rescheduled_to = ?, updated_at = ? WHERE id = ?")
        .run(id, at, previous.id);
    }
    try {
      db()
        .prepare(
          `INSERT INTO clinic_appointments (
             id, doctor_id, patient_profile_id, patient_name, patient_sex, patient_dob, booked_by,
             starts_at, ends_at, status, reason, share_history, share_history_at, ai_consent, ai_consent_at, ai_consent_by,
             rescheduled_from, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'scheduled', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          doctor.id,
          profile.id,
          profile.name,
          profile.sex,
          profile.date_of_birth,
          user.id,
          slot.starts_at,
          slot.ends_at,
          reason ? seal(reason) : null,
          shareHistory ? 1 : 0,
          shareHistory ? at : null,
          aiConsent ? 1 : 0,
          aiConsent ? at : null,
          aiConsent ? 'resident' : null,
          previous?.id ?? null,
          at,
          at,
        );
    } catch (error) {
      if (isUniqueViolation(error)) throw new ApiError('slot_taken', 'That slot was just booked. Pick another time.');
      throw error;
    }
    audit({
      actor: user,
      action: previous ? 'appointment.rescheduled' : 'appointment.booked',
      appointmentId: id,
      patientProfileId: profile.id,
      detail: { doctor_id: doctor.id, share_history: shareHistory, ai_consent: aiConsent, from: previous?.id ?? null },
    });
    return appointmentRow(id) as AppointmentRow;
  });

  if (rescheduleOf) {
    broadcast({ kind: 'appointment', appointment_id: rescheduleOf, doctor_id: doctor.id, status: 'rescheduled' }, recipientsOf(created));
  }
  broadcast({ kind: 'appointment', appointment_id: id, doctor_id: doctor.id, status: 'scheduled' }, recipientsOf(created));
  return residentView(created, nowMs);
}

function recipientsOf(row: AppointmentRow) {
  return { doctorUserId: (doctorRow(row.doctor_id) as DoctorRow).user_id, residentId: row.booked_by };
}

// ---- Status changes -----------------------------------------------------------------------

export interface Actor {
  user: User;
  /** Set when the actor is a doctor: they may only act on their own appointments. */
  doctorId?: string;
}

/** The appointment, if this actor may see it at all; 404 otherwise, so ids reveal nothing. */
export function appointmentFor(actor: Actor, id: string): AppointmentRow {
  const row = appointmentRow(id);
  const allowed =
    row &&
    (actor.user.role === 'clinic_staff' ||
      (actor.user.role === 'doctor' && row.doctor_id === actor.doctorId) ||
      (actor.user.role === 'resident' && row.booked_by === actor.user.id));
  if (!row || !allowed) throw new ApiError('not_found', 'Appointment not found.');
  return row;
}

/** One status change, checked and applied atomically; then the queue and notices are brought up to date. */
export function transition(actor: Actor, id: string, action: Action, options: { reason?: unknown } = {}, nowMs = Date.now()): AppointmentRow {
  const rule = TRANSITIONS[action];
  if (!rule) throw new ApiError('bad_request', 'Unknown action.');
  const updated = transaction(() => {
    const row = appointmentFor(actor, id);
    if (!rule.roles.includes(actor.user.role)) {
      throw new ApiError('forbidden', 'This account cannot make that change.');
    }
    if (!rule.from.includes(row.status)) {
      throw new ApiError('invalid_transition', `A ${row.status.replace('_', ' ')} appointment cannot ${action.replace(/_/g, ' ')}.`);
    }
    const start = Date.parse(row.starts_at);
    const today = clinicDate(nowMs);
    const at = new Date(nowMs).toISOString();

    if (action === 'check_in' && clinicDate(start) !== today) {
      throw new ApiError('invalid_transition', 'Patients can only be checked in on the day of their appointment.');
    }
    if (action === 'no_show' && row.status === 'scheduled' && nowMs < start + graceMs()) {
      throw new ApiError('invalid_transition', 'A patient can be marked as a no-show only after their slot has started.');
    }
    if (actor.user.role === 'resident' && (row.status !== 'scheduled' || start <= nowMs)) {
      throw new ApiError('invalid_transition', 'Only upcoming appointments can be cancelled from the app. Call the clinic.');
    }
    if (action === 'start') {
      const busy = db()
        .prepare("SELECT id FROM clinic_appointments WHERE doctor_id = ? AND status = 'in_consultation' AND id != ?")
        .get(row.doctor_id, row.id) as { id: string } | undefined;
      if (busy) {
        throw new ApiError('invalid_transition', 'Finish the current consultation, or return that patient to the queue, first.');
      }
    }

    const sets: Record<string, string | null> = { status: rule.to, updated_at: at };
    if (action === 'check_in') Object.assign(sets, { checked_in_at: at, checked_in_by: actor.user.id, no_show_at: null });
    if (action === 'mark_ready') sets.ready_at = at;
    if (action === 'start') sets.started_at = row.started_at ?? at;
    if (action === 'no_show') sets.no_show_at = at;
    if (action === 'cancel') {
      const reason = typeof options.reason === 'string' ? options.reason.trim().slice(0, 300) : '';
      Object.assign(sets, { cancelled_at: at, cancelled_by: actor.user.id, cancel_reason: reason || null });
    }
    const columns = Object.keys(sets);
    const result = db()
      .prepare(`UPDATE clinic_appointments SET ${columns.map((column) => `${column} = ?`).join(', ')} WHERE id = ? AND status = ?`)
      .run(...columns.map((column) => sets[column]), row.id, row.status);
    if (Number(result.changes) !== 1) throw new ApiError('version_conflict', 'The appointment changed meanwhile. Refresh and try again.');
    audit({
      actor: actor.user,
      action: 'appointment.status',
      appointmentId: row.id,
      patientProfileId: row.patient_profile_id,
      detail: { from: row.status, to: rule.to, action },
    });
    return appointmentRow(row.id) as AppointmentRow;
  });
  afterChange(updated);
  return updated;
}

/** Publishes the change, then tells the doctor about a new next patient, once. */
export function afterChange(row: AppointmentRow, nowMs = Date.now()): void {
  const recipients = recipientsOf(row);
  broadcast({ kind: 'appointment', appointment_id: row.id, doctor_id: row.doctor_id, status: row.status }, recipients);
  const next = queueRows(row.doctor_id, clinicDate(nowMs))[0];
  if (!next || next.next_notified_at) return;
  // Claimed atomically, so two changes at once cannot both announce the same patient.
  const claimed = db()
    .prepare('UPDATE clinic_appointments SET next_notified_at = ? WHERE id = ? AND next_notified_at IS NULL')
    .run(new Date(nowMs).toISOString(), next.id);
  if (Number(claimed.changes) === 1) {
    broadcast(
      { kind: 'next_patient', appointment_id: next.id, doctor_id: next.doctor_id, patient_name: next.patient_name, starts_at: next.starts_at },
      { doctorUserId: recipients.doctorUserId },
    );
  }
}

/** Records the patient's agreement to AI assistance at the visit, as the doctor heard it. Never withdraws. */
export function recordInPersonAiConsent(actor: Actor, id: string): AppointmentRow {
  const row = appointmentFor(actor, id);
  if (!ACTIVE.includes(row.status)) throw new ApiError('invalid_transition', 'This appointment is closed.');
  if (row.ai_consent !== 1) {
    const at = now();
    db().prepare('UPDATE clinic_appointments SET ai_consent = 1, ai_consent_at = ?, ai_consent_by = ?, updated_at = ? WHERE id = ?').run(at, actor.user.id, at, id);
    audit({ actor: actor.user, action: 'appointment.consent', appointmentId: id, patientProfileId: row.patient_profile_id, detail: { ai_consent: true, source: 'in_person' } });
  }
  return appointmentRow(id) as AppointmentRow;
}

/** The resident changes what this visit may use, until it is over. Withdrawing takes effect at once. */
export function updateResidentConsents(user: User, id: string, body: Record<string, unknown>): ResidentAppointment {
  const row = appointmentFor({ user }, id);
  if (!ACTIVE.includes(row.status)) throw new ApiError('invalid_transition', 'This appointment is closed.');
  const at = now();
  const changes: Record<string, string | number | null> = { updated_at: at };
  if (body.share_history !== undefined) {
    const share = flag(body.share_history, 'share_history');
    Object.assign(changes, { share_history: share ? 1 : 0, share_history_at: share ? at : null });
  }
  if (body.ai_consent !== undefined) {
    const consent = flag(body.ai_consent, 'ai_consent');
    Object.assign(changes, { ai_consent: consent ? 1 : 0, ai_consent_at: consent ? at : null, ai_consent_by: consent ? 'resident' : null });
  }
  const columns = Object.keys(changes);
  db()
    .prepare(`UPDATE clinic_appointments SET ${columns.map((column) => `${column} = ?`).join(', ')} WHERE id = ?`)
    .run(...columns.map((column) => changes[column]), id);
  if (changes.share_history === 0 || changes.ai_consent === 0) {
    // Nothing made from data the resident just withdrew stays behind.
    db().prepare('DELETE FROM clinic_history_summaries WHERE appointment_id = ?').run(id);
    db().prepare('DELETE FROM clinic_spoken_summaries WHERE appointment_id = ?').run(id);
  }
  audit({
    actor: user,
    action: 'appointment.consent',
    appointmentId: id,
    patientProfileId: row.patient_profile_id,
    detail: {
      share_history: body.share_history === undefined ? null : Boolean(body.share_history),
      ai_consent: body.ai_consent === undefined ? null : Boolean(body.ai_consent),
      source: 'resident',
    },
  });
  const updated = appointmentRow(id) as AppointmentRow;
  broadcast({ kind: 'appointment', appointment_id: id, doctor_id: row.doctor_id, status: updated.status }, recipientsOf(updated));
  return residentView(updated);
}

// ---- Lists, queue and dashboard -------------------------------------------------------------

export function residentAppointments(user: User): ResidentAppointment[] {
  const rows = db()
    .prepare("SELECT * FROM clinic_appointments WHERE booked_by = ? AND status != 'rescheduled' ORDER BY starts_at DESC LIMIT 200")
    .all(user.id) as unknown as AppointmentRow[];
  return rows.map((row) => residentView(row));
}

/**
 * Patients who are here, in the order they will be seen: by appointment
 * time, except that someone who arrived after their slot plus the grace
 * period is placed by when they arrived. Early arrivals keep their slot's
 * place. Only checked-in patients are ever "next".
 */
export function queueRows(doctorId: string, date: string): AppointmentRow[] {
  const bounds = clinicDayBounds(date);
  const rows = db()
    .prepare(
      `SELECT * FROM clinic_appointments WHERE doctor_id = ? AND starts_at >= ? AND starts_at < ?
       AND status IN ('checked_in', 'waiting')`,
    )
    .all(doctorId, bounds.from, bounds.to) as unknown as AppointmentRow[];
  const key = (row: AppointmentRow) => (arrivedLate(row) ? Date.parse(row.checked_in_at as string) : Date.parse(row.starts_at));
  return rows.sort((a, b) => key(a) - key(b) || a.starts_at.localeCompare(b.starts_at) || a.id.localeCompare(b.id));
}

export interface Dashboard {
  date: string;
  timezone: string;
  counts: Record<'total' | 'upcoming' | 'waiting' | 'in_consultation' | 'completed' | 'cancelled' | 'no_show', number>;
  current: StaffAppointment | null;
  next: StaffAppointment | null;
  queue: StaffAppointment[];
  appointments: StaffAppointment[];
  /** The next appointments after today, for the "Upcoming" panel. */
  upcoming: StaffAppointment[];
}

function dayRows(doctorId: string | null, date: string): AppointmentRow[] {
  const bounds = clinicDayBounds(date);
  const sql = `SELECT * FROM clinic_appointments WHERE starts_at >= ? AND starts_at < ? AND status != 'rescheduled'
               ${doctorId ? 'AND doctor_id = ?' : ''} ORDER BY starts_at, id`;
  return db()
    .prepare(sql)
    .all(...(doctorId ? [bounds.from, bounds.to, doctorId] : [bounds.from, bounds.to])) as unknown as AppointmentRow[];
}

export function dashboard(doctorId: string, date: string | null, nowMs = Date.now()): Dashboard {
  const day = date && ISO_DATE.test(date) ? date : clinicDate(nowMs);
  const rows = dayRows(doctorId, day);
  const views = rows.map((row) => staffView(row, nowMs));
  const queue = queueRows(doctorId, day).map((row) => staffView(row, nowMs));
  const count = (...statuses: Status[]) => views.filter((view) => statuses.includes(view.status)).length;
  const after = clinicDayBounds(day).to;
  const upcoming = (
    db()
      .prepare(
        "SELECT * FROM clinic_appointments WHERE doctor_id = ? AND starts_at >= ? AND status = 'scheduled' ORDER BY starts_at LIMIT 8",
      )
      .all(doctorId, after) as unknown as AppointmentRow[]
  ).map((row) => staffView(row, nowMs));
  return {
    date: day,
    timezone: config.clinic.timezone,
    counts: {
      total: views.filter((view) => view.status !== 'cancelled').length,
      upcoming: count('scheduled'),
      waiting: count('checked_in', 'waiting'),
      in_consultation: count('in_consultation'),
      completed: count('completed'),
      cancelled: count('cancelled'),
      no_show: count('no_show'),
    },
    current: views.find((view) => view.status === 'in_consultation') ?? null,
    next: queue[0] ?? null,
    queue,
    appointments: views,
    upcoming,
  };
}

/** The front desk's day: every doctor's appointments, grouped by doctor. */
export function deskDay(date: string | null, nowMs = Date.now()) {
  const day = date && ISO_DATE.test(date) ? date : clinicDate(nowMs);
  const rows = dayRows(null, day);
  const doctors = new Map<string, { doctor: DoctorProfile; appointments: StaffAppointment[]; next_id: string | null }>();
  for (const row of rows) {
    if (!doctors.has(row.doctor_id)) {
      const doctor = presentDoctor(doctorRow(row.doctor_id) as DoctorRow);
      doctors.set(row.doctor_id, { doctor, appointments: [], next_id: queueRows(row.doctor_id, day)[0]?.id ?? null });
    }
    doctors.get(row.doctor_id)?.appointments.push(staffView(row, nowMs));
  }
  return { date: day, timezone: config.clinic.timezone, doctors: [...doctors.values()] };
}

/** A doctor's appointments over a range, filtered by status and patient name. */
export function doctorAppointments(
  doctorId: string,
  filters: { from?: string | null; to?: string | null; status?: string | null; q?: string | null },
  nowMs = Date.now(),
): StaffAppointment[] {
  const from = filters.from && ISO_DATE.test(filters.from) ? clinicDayBounds(filters.from).from : '0000';
  const to = filters.to && ISO_DATE.test(filters.to) ? clinicDayBounds(filters.to).to : '9999';
  const rows = db()
    .prepare(
      `SELECT * FROM clinic_appointments WHERE doctor_id = ? AND starts_at >= ? AND starts_at < ? AND status != 'rescheduled'
       ORDER BY starts_at DESC LIMIT 500`,
    )
    .all(doctorId, from, to) as unknown as AppointmentRow[];
  const statuses = filters.status ? filters.status.split(',') : null;
  const query = normalize(filters.q ?? '');
  return rows
    .filter((row) => !statuses || statuses.includes(row.status))
    .filter((row) => !query || normalize(row.patient_name).includes(query))
    .map((row) => staffView(row, nowMs));
}

/** Patients this doctor has appointments with: the only patients they can look up. */
export function doctorPatients(doctorId: string, q: string | null) {
  const rows = db()
    .prepare(
      `SELECT patient_profile_id, patient_name, patient_sex, patient_dob, MAX(starts_at) AS last_at, COUNT(*) AS visits
       FROM clinic_appointments WHERE doctor_id = ? AND patient_profile_id IS NOT NULL AND status NOT IN ('rescheduled')
       GROUP BY patient_profile_id ORDER BY last_at DESC LIMIT 300`,
    )
    .all(doctorId) as {
    patient_profile_id: string;
    patient_name: string;
    patient_sex: string | null;
    patient_dob: string | null;
    last_at: string;
    visits: number;
  }[];
  const query = normalize(q ?? '');
  return rows
    .filter((row) => !query || normalize(row.patient_name).includes(query))
    .map((row) => ({
      profile_id: row.patient_profile_id,
      name: row.patient_name,
      sex: row.patient_sex,
      age: ageAt(row.patient_dob, Date.now()),
      last_appointment_at: row.last_at,
      appointments: row.visits,
    }));
}
