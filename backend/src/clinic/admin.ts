import { randomUUID } from 'node:crypto';

import { prepareTemporaryAccount, saveTemporaryAccount } from '../ems/auth.ts';
import { transaction } from '../ems/db.ts';
import { ApiError } from '../errors.ts';
import {
  deleteDoctorSchedule,
  findDoctorForAdmin,
  insertDoctor,
  insertScheduleBlock,
  listDoctorsForAdmin,
  listScheduleBlocks,
  setDoctorActive,
  updateDoctorColumns,
  type AdminDoctorRow,
  type DoctorColumn,
  type ScheduleBlock,
} from '../repositories/clinicDoctors.ts';
import { insertSpecialtyIfMissing, listSpecialtiesWithDoctorCounts, specialtyExists } from '../repositories/clinicSpecialties.ts';
import { setUserName } from '../repositories/users.ts';
import { HH_MM, minutesOf } from './time.ts';

/**
 * Building management's side of the clinic: the admin dashboard's Clinic tab (admin/pages/clinic.js). It adds
 * specialties, and doctors with their sign-in, profile and weekly hours in one step. A doctor's account gets a
 * temporary password, shown once, which they replace at their first sign-in to the clinic web app. The clinic
 * CLI (scripts/clinic.ts) does the same on the server, and still handles photos and time off.
 */

export interface AdminSpecialty {
  id: string;
  en: string;
  ar: string;
  /** Doctors who practise it, active or not. */
  doctors: number;
}

export interface AdminDoctor {
  id: string;
  /** Their sign-in. */
  email: string;
  name: string;
  nameAr: string | null;
  title: string | null;
  titleAr: string | null;
  bio: string | null;
  bioAr: string | null;
  specialtyId: string;
  specialty: { en: string; ar: string };
  consultationMinutes: number;
  yearsExperience: number | null;
  feeEgp: number | null;
  languages: string[];
  hasPhoto: boolean;
  /** Residents can book them and they can use the clinic web app. */
  active: boolean;
  /** They have not yet replaced the temporary password. */
  mustChangePassword: boolean;
  /** Weekly hours in clinic time. weekday: 0 Sunday .. 6 Saturday. */
  schedule: ScheduleBlock[];
}

export interface AdminClinic {
  specialties: AdminSpecialty[];
  doctors: AdminDoctor[];
}

type Body = Record<string, unknown>;

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
/** The slot grid steps by the visit length, so it must stay positive; four hours is the longest visit. */
const VISIT_MINUTES = { min: 5, max: 240, default: 20 };
const NAME_MAX = 80;
const BIO_MAX = 600;
/** Seven days of up to six blocks each is far more than any clinic needs. */
const MAX_BLOCKS = 42;

function present(row: AdminDoctorRow): AdminDoctor {
  return {
    id: row.id,
    email: row.email,
    name: row.display_name,
    nameAr: row.display_name_ar,
    title: row.title,
    titleAr: row.title_ar,
    bio: row.bio,
    bioAr: row.bio_ar,
    specialtyId: row.specialty_id,
    specialty: { en: row.specialty_en, ar: row.specialty_ar },
    consultationMinutes: row.consultation_minutes,
    yearsExperience: row.years_experience,
    feeEgp: row.fee_egp,
    languages: row.languages ? (JSON.parse(row.languages) as string[]) : [],
    hasPhoto: Boolean(row.photo),
    active: row.active === 1,
    mustChangePassword: row.must_change_password === 1,
    schedule: listScheduleBlocks(row.id),
  };
}

function adminDoctor(id: string): AdminDoctor {
  const row = findDoctorForAdmin(id);
  if (!row) throw new ApiError('not_found', 'No such doctor.');
  return present(row);
}

export function clinicOverview(): AdminClinic {
  return {
    specialties: listSpecialtiesWithDoctorCounts().map((row) => ({ id: row.id, en: row.name_en, ar: row.name_ar, doctors: row.doctor_count })),
    doctors: listDoctorsForAdmin().map(present),
  };
}

// ---- reading the request ---------------------------------------------------------------------

function requiredText(body: Body, key: string, label: string, max: number): string {
  const text = optionalText(body, key, label, max);
  if (!text) throw new ApiError('invalid', `Enter ${label}.`, key);
  return text;
}

/** Trimmed text, or null when empty. Too long is refused rather than cut. */
function optionalText(body: Body, key: string, label: string, max: number): string | null {
  const value = body[key];
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new ApiError('invalid', `${label} must be text.`, key);
  const text = value.trim();
  if (text.length > max) throw new ApiError('invalid', `${label} can be at most ${max} characters.`, key);
  return text || null;
}

/** A whole number in range, or null when empty. */
function optionalWhole(body: Body, key: string, label: string, max: number): number | null {
  const value = body[key];
  if (value === undefined || value === null || value === '') return null;
  const number = typeof value === 'string' ? Number(value) : value;
  if (typeof number !== 'number' || !Number.isInteger(number) || number < 0 || number > max) {
    throw new ApiError('invalid', `${label} must be a whole number from 0 to ${max}.`, key);
  }
  return number;
}

function visitMinutes(value: unknown): number {
  const number = typeof value === 'string' ? Number(value) : value;
  if (typeof number !== 'number' || !Number.isInteger(number) || number < VISIT_MINUTES.min || number > VISIT_MINUTES.max) {
    throw new ApiError('invalid', `A visit must last ${VISIT_MINUTES.min} to ${VISIT_MINUTES.max} minutes.`, 'consultationMinutes');
  }
  return number;
}

function existingSpecialty(value: unknown): string {
  if (typeof value !== 'string' || !specialtyExists(value)) {
    throw new ApiError('invalid', 'Pick one of the clinic’s specialties, or add the specialty first.', 'specialtyId');
  }
  return value;
}

/** Language codes such as "en" and "ar", stored as a JSON list; null when there are none. */
function languagesOf(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value) || value.length > 8 || value.some((code) => typeof code !== 'string' || !/^[a-z]{2,3}$/.test(code))) {
    throw new ApiError('invalid', 'Languages must be a list of language codes such as "en" and "ar".', 'languages');
  }
  const codes = [...new Set(value as string[])];
  return codes.length ? JSON.stringify(codes) : null;
}

/** Weekly hours: each block a day and a start before its end, long enough for one visit, none overlapping. */
function scheduleOf(value: unknown, minutes: number): ScheduleBlock[] {
  if (!Array.isArray(value) || value.length > MAX_BLOCKS) {
    throw new ApiError('invalid', `The weekly hours must be a list of at most ${MAX_BLOCKS} blocks.`, 'schedule');
  }
  const blocks = value.map((entry: unknown) => {
    const block = (entry ?? {}) as Record<string, unknown>;
    const { weekday, start, end } = block;
    if (typeof weekday !== 'number' || !Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
      throw new ApiError('invalid', 'Each block of hours needs a day.', 'schedule');
    }
    const day = DAY_NAMES[weekday];
    if (typeof start !== 'string' || typeof end !== 'string' || !HH_MM.test(start) || !HH_MM.test(end)) {
      throw new ApiError('invalid', `Write the ${day} hours as times, e.g. 09:00 to 13:00.`, 'schedule');
    }
    if (minutesOf(end) - minutesOf(start) < minutes) {
      throw new ApiError('invalid', `${day} ${start}–${end} is shorter than one ${minutes}-minute visit (or ends before it starts).`, 'schedule');
    }
    return { weekday, start, end };
  });
  blocks.sort((a, b) => a.weekday - b.weekday || minutesOf(a.start) - minutesOf(b.start));
  for (let index = 1; index < blocks.length; index += 1) {
    const [before, block] = [blocks[index - 1], blocks[index]];
    if (before.weekday === block.weekday && minutesOf(block.start) < minutesOf(before.end)) {
      throw new ApiError('invalid', `On ${DAY_NAMES[block.weekday]}, ${before.start}–${before.end} and ${block.start}–${block.end} overlap.`, 'schedule');
    }
  }
  return blocks;
}

function saveSchedule(doctorId: string, blocks: ScheduleBlock[]): void {
  deleteDoctorSchedule(doctorId);
  for (const block of blocks) insertScheduleBlock(randomUUID(), doctorId, block);
}

// ---- specialties -------------------------------------------------------------------------------

/** "General Medicine" → "general-medicine": the id the app filters by. */
function specialtyId(english: string): string {
  return english
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
}

/** A new specialty. Without an Arabic name, Arabic speakers see the English one. */
export function addSpecialty(body: Body): AdminSpecialty {
  const en = requiredText(body, 'en', 'the specialty’s English name', NAME_MAX);
  const ar = optionalText(body, 'ar', 'The Arabic name', NAME_MAX) ?? en;
  const id = specialtyId(en);
  if (!/^[a-z][a-z0-9-]{1,40}$/.test(id)) {
    throw new ApiError('invalid', 'Write the English name in letters, e.g. Cardiology.', 'en');
  }
  if (specialtyExists(id)) throw new ApiError('conflict', `The clinic already has the specialty "${en}".`);
  insertSpecialtyIfMissing(id, en, ar, new Date().toISOString());
  return { id, en, ar, doctors: 0 };
}

// ---- doctors -----------------------------------------------------------------------------------

/**
 * A doctor: their account (role `doctor`, temporary password), their profile in the residents' directory and
 * their weekly hours, saved together or not at all. Returns the temporary password once.
 */
export async function addDoctor(body: Body): Promise<{ doctor: AdminDoctor; temporaryPassword: string }> {
  const name = requiredText(body, 'name', 'the doctor’s name', NAME_MAX);
  const specialty = existingSpecialty(body.specialtyId);
  const minutes = body.consultationMinutes === undefined ? VISIT_MINUTES.default : visitMinutes(body.consultationMinutes);
  const profile = {
    displayNameAr: optionalText(body, 'nameAr', 'The Arabic name', NAME_MAX),
    title: optionalText(body, 'title', 'The title', NAME_MAX),
    titleAr: optionalText(body, 'titleAr', 'The Arabic title', NAME_MAX),
    bio: optionalText(body, 'bio', 'The biography', BIO_MAX),
    bioAr: optionalText(body, 'bioAr', 'The Arabic biography', BIO_MAX),
    yearsExperience: optionalWhole(body, 'yearsExperience', 'Years of experience', 70),
    feeEgp: optionalWhole(body, 'feeEgp', 'The fee', 100_000),
    languages: languagesOf(body.languages),
  };
  const schedule = body.schedule === undefined ? [] : scheduleOf(body.schedule, minutes);
  const account = await prepareTemporaryAccount(body.email, name, 'doctor', NAME_MAX);
  const id = randomUUID();
  transaction(() => {
    saveTemporaryAccount(account);
    insertDoctor({ id, userId: account.user.id, specialtyId: specialty, displayName: name, consultationMinutes: minutes, at: new Date().toISOString(), ...profile });
    saveSchedule(id, schedule);
  });
  return { doctor: adminDoctor(id), temporaryPassword: account.temporaryPassword };
}

/** Optional profile fields: body key → column, and how each is read. */
const OPTIONAL_FIELDS: [key: string, column: DoctorColumn, read: (body: Body) => string | number | null][] = [
  ['nameAr', 'display_name_ar', (body) => optionalText(body, 'nameAr', 'The Arabic name', NAME_MAX)],
  ['title', 'title', (body) => optionalText(body, 'title', 'The title', NAME_MAX)],
  ['titleAr', 'title_ar', (body) => optionalText(body, 'titleAr', 'The Arabic title', NAME_MAX)],
  ['bio', 'bio', (body) => optionalText(body, 'bio', 'The biography', BIO_MAX)],
  ['bioAr', 'bio_ar', (body) => optionalText(body, 'bioAr', 'The Arabic biography', BIO_MAX)],
  ['yearsExperience', 'years_experience', (body) => optionalWhole(body, 'yearsExperience', 'Years of experience', 70)],
  ['feeEgp', 'fee_egp', (body) => optionalWhole(body, 'feeEgp', 'The fee', 100_000)],
  ['languages', 'languages', (body) => languagesOf(body.languages)],
];

/**
 * Changes the fields the body names (others stay). New weekly hours replace the old ones; booked appointments
 * are not moved. The sign-in email does not change here.
 */
export function editDoctor(id: string, body: Body): AdminDoctor {
  const current = findDoctorForAdmin(id);
  if (!current) throw new ApiError('not_found', 'No such doctor.');
  const changes: Partial<Record<DoctorColumn, string | number | null>> = {};
  if ('name' in body) changes.display_name = requiredText(body, 'name', 'the doctor’s name', NAME_MAX);
  if ('specialtyId' in body) changes.specialty_id = existingSpecialty(body.specialtyId);
  if ('consultationMinutes' in body) changes.consultation_minutes = visitMinutes(body.consultationMinutes);
  for (const [key, column, read] of OPTIONAL_FIELDS) {
    if (key in body) changes[column] = read(body);
  }
  const minutes = (changes.consultation_minutes as number | undefined) ?? current.consultation_minutes;
  const schedule = 'schedule' in body ? scheduleOf(body.schedule, minutes) : null;
  if (Object.keys(changes).length === 0 && !schedule) throw new ApiError('bad_request', 'Nothing to change.');
  transaction(() => {
    if (Object.keys(changes).length > 0) updateDoctorColumns(id, changes, new Date().toISOString());
    if (typeof changes.display_name === 'string') setUserName(current.user_id, changes.display_name);
    if (schedule) saveSchedule(id, schedule);
  });
  return adminDoctor(id);
}

/**
 * On or off. An inactive doctor leaves the residents' directory and cannot use the clinic web app; their booked
 * appointments stay, for the front desk to move or cancel.
 */
export function setDoctorActiveState(id: string, body: Body): AdminDoctor {
  if (typeof body.active !== 'boolean') throw new ApiError('bad_request', 'active must be true or false.');
  if (!findDoctorForAdmin(id)) throw new ApiError('not_found', 'No such doctor.');
  setDoctorActive(id, body.active ? 1 : 0, new Date().toISOString());
  return adminDoctor(id);
}
