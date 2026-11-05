import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { config } from '../config.ts';
import { ApiError } from '../errors.ts';
import { normalize } from '../lib/text.ts';
import { listBookedStarts } from '../repositories/clinicAppointments.ts';
import {
  findDoctor,
  findDoctorForUser,
  listActiveDoctors,
  listScheduleBlocks,
  listTimeOff,
  type DoctorRow,
  type ScheduleBlock,
} from '../repositories/clinicDoctors.ts';
import { listSpecialtiesWithActiveDoctors } from '../repositories/clinicSpecialties.ts';
import { addDays, clinicDate, clinicDayBounds, clinicInstant, ISO_DATE, minutesOf, timeOf, weekdayOf } from './time.ts';

/**
 * The clinic's doctors, their specialties and weekly hours, and the slots
 * those make. Everything is read from the database (the clinic CLI writes
 * it); nothing here assumes which specialties or doctors exist.
 */

export interface Localized {
  en: string;
  ar: string;
}

export interface Specialty {
  id: string;
  name: Localized;
  doctor_count: number;
}

export type { DoctorRow, ScheduleBlock };

/** What residents see of a doctor. */
export interface DoctorProfile {
  id: string;
  name: Localized;
  title: Localized | null;
  specialty: { id: string; name: Localized };
  bio: Localized | null;
  years_experience: number | null;
  consultation_minutes: number;
  fee_egp: number | null;
  languages: string[];
  photo_url: string | null;
  schedule: ScheduleBlock[];
}

export function listSpecialties(): Specialty[] {
  return listSpecialtiesWithActiveDoctors().map((row) => ({ id: row.id, name: { en: row.name_en, ar: row.name_ar }, doctor_count: row.doctor_count }));
}

const pair = (en: string | null, ar: string | null): Localized | null => (en || ar ? { en: en ?? ar ?? '', ar: ar ?? en ?? '' } : null);

export function presentDoctor(row: DoctorRow): DoctorProfile {
  return {
    id: row.id,
    name: { en: row.display_name, ar: row.display_name_ar ?? row.display_name },
    title: pair(row.title, row.title_ar),
    specialty: { id: row.specialty_id, name: { en: row.specialty_en, ar: row.specialty_ar } },
    bio: pair(row.bio, row.bio_ar),
    years_experience: row.years_experience,
    consultation_minutes: row.consultation_minutes,
    fee_egp: row.fee_egp,
    languages: row.languages ? (JSON.parse(row.languages) as string[]) : [],
    photo_url: row.photo ? `/api/clinic/doctors/${row.id}/photo` : null,
    schedule: listScheduleBlocks(row.id),
  };
}

export function doctorRow(doctorId: string): DoctorRow | null {
  return findDoctor(doctorId);
}

export function doctorForUser(userId: string): DoctorRow | null {
  return findDoctorForUser(userId);
}

/** An active doctor, or 404. */
export function activeDoctor(doctorId: string): DoctorRow {
  const row = doctorRow(doctorId);
  if (!row || row.active !== 1) throw new ApiError('not_found', 'Doctor not found.');
  return row;
}

/** Residents' directory: filtered by specialty, and searched by name, title or specialty in either language. */
export function listDoctors(filters: { specialty?: string | null; q?: string | null }): DoctorProfile[] {
  const rows = listActiveDoctors(filters.specialty);
  const query = normalize(filters.q ?? '');
  const matching = query
    ? rows.filter((row) =>
        normalize(
          [row.display_name, row.display_name_ar, row.title, row.title_ar, row.specialty_en, row.specialty_ar].filter(Boolean).join(' '),
        ).includes(query),
      )
    : rows;
  return matching.map(presentDoctor);
}

const PHOTO_TYPES: Record<string, string> = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };

export const photoDir = () => join(config.dataDir, 'clinic', 'photos');

export function doctorPhoto(doctorId: string): { type: string; body: Buffer } {
  const row = activeDoctor(doctorId);
  const file = row.photo ? join(photoDir(), row.photo) : '';
  const type = PHOTO_TYPES[file.slice(file.lastIndexOf('.')).toLowerCase()];
  if (!file || !type || !existsSync(file)) throw new ApiError('not_found', 'This doctor has no photo.');
  return { type, body: readFileSync(file) };
}

// ---- Slots --------------------------------------------------------------------------------

export type SlotState = 'available' | 'booked' | 'past';

export interface Slot {
  starts_at: string;
  ends_at: string;
  /** Clinic wall-clock time, e.g. "15:30", for display. */
  time: string;
  state: SlotState;
}

/** Statuses that hold a slot. Cancelled and rescheduled bookings free it. */
export const HOLDING_STATUSES = ['scheduled', 'checked_in', 'waiting', 'in_consultation', 'completed', 'no_show'] as const;

function bookedStarts(doctorId: string, from: string, to: string): Set<string> {
  return new Set(listBookedStarts(doctorId, from, to, HOLDING_STATUSES));
}

function timeOff(doctorId: string, from: string, to: string): { start: number; end: number }[] {
  return listTimeOff(doctorId, from, to).map((row) => ({ start: Date.parse(row.starts_at), end: Date.parse(row.ends_at) }));
}

/** The first and last bookable clinic dates, from today. */
export function bookingWindow(nowMs = Date.now()): { first: string; last: string } {
  const first = clinicDate(nowMs);
  return { first, last: addDays(first, config.clinic.bookingHorizonDays) };
}

/**
 * One day's slots for a doctor: their weekly hours cut into consultations,
 * minus time off. Slots already booked, or too soon to book, are shown as
 * such rather than hidden, so the day's shape stays readable.
 */
export function slotsFor(doctor: DoctorRow, date: string, nowMs = Date.now()): Slot[] {
  if (!ISO_DATE.test(date) || Number.isNaN(Date.parse(date))) {
    throw new ApiError('bad_request', 'date must be YYYY-MM-DD.');
  }
  const window = bookingWindow(nowMs);
  if (date < window.first || date > window.last) return [];
  const blocks = listScheduleBlocks(doctor.id).filter((block) => block.weekday === weekdayOf(date));
  if (blocks.length === 0) return [];
  const bounds = clinicDayBounds(date);
  const booked = bookedStarts(doctor.id, bounds.from, bounds.to);
  const away = timeOff(doctor.id, bounds.from, bounds.to);
  const opensAt = nowMs + config.clinic.bookingLeadMinutes * 60_000;
  const length = doctor.consultation_minutes;
  const slots: Slot[] = [];
  for (const block of blocks) {
    for (let minute = minutesOf(block.start); minute + length <= minutesOf(block.end); minute += length) {
      const time = timeOf(minute);
      const start = clinicInstant(date, time);
      const end = start + length * 60_000;
      if (away.some((span) => start < span.end && end > span.start)) continue;
      const startsAt = new Date(start).toISOString();
      slots.push({
        starts_at: startsAt,
        ends_at: new Date(end).toISOString(),
        time,
        state: booked.has(startsAt) ? 'booked' : start < opensAt ? 'past' : 'available',
      });
    }
  }
  return slots;
}

/** Which of the coming days have free slots, for the resident's date strip. */
export function availability(doctor: DoctorRow, days: number, nowMs = Date.now()): { date: string; available: number }[] {
  const window = bookingWindow(nowMs);
  const result: { date: string; available: number }[] = [];
  for (let offset = 0; offset < Math.min(days, config.clinic.bookingHorizonDays + 1); offset += 1) {
    const date = addDays(window.first, offset);
    result.push({ date, available: slotsFor(doctor, date, nowMs).filter((slot) => slot.state === 'available').length });
  }
  return result;
}

/** The slot a booking asks for, if it is on the doctor's grid and free right now. */
export function bookableSlot(doctor: DoctorRow, startsAt: string, nowMs = Date.now()): Slot {
  const instant = Date.parse(startsAt);
  if (Number.isNaN(instant)) throw new ApiError('bad_request', 'starts_at must be an ISO time.');
  const iso = new Date(instant).toISOString();
  const slot = slotsFor(doctor, clinicDate(instant), nowMs).find((entry) => entry.starts_at === iso);
  if (!slot) throw new ApiError('invalid', 'That time is not one of the doctor’s appointment slots.', 'starts_at');
  if (slot.state === 'booked') throw new ApiError('slot_taken', 'That slot was just booked. Pick another time.');
  if (slot.state === 'past') throw new ApiError('invalid', 'That slot can no longer be booked.', 'starts_at');
  return slot;
}
