import { randomUUID } from 'node:crypto';

import { ApiError } from '../errors.ts';
import { getUser } from '../ems/auth.ts';
import { seal, unseal } from '../ems/secrets.ts';
import { findConsent, upsertConsent } from '../repositories/healthConsents.ts';
import { deleteProfileDocuments } from '../repositories/healthDocuments.ts';
import {
  deleteHealthItem,
  deleteProfileHealthItems,
  findHealthItem,
  insertHealthItem,
  listHealthItems,
  updateHealthItemData,
  type ItemRow,
  type Section,
} from '../repositories/healthItems.ts';
import {
  clearProfileBloodType,
  deleteFamilyProfiles,
  deleteHealthProfile,
  findHealthProfile,
  findSelfProfileId,
  insertHealthProfile,
  insertSelfProfile,
  listHealthProfiles,
  touchHealthProfile,
  updateProfileFields,
  type ProfileRow,
  type Relation,
} from '../repositories/healthProfiles.ts';
import { deleteProfileSummaries } from '../repositories/healthSummaries.ts';

/**
 * Health Passport's storage: consent, the resident's profiles (themself and
 * family) and each profile's record. The shapes are the app's own
 * (src/services/health/health.types.ts), snake_case included, so the HTTP
 * routes pass them through untouched.
 *
 * Every record item is sealed before it is written; only ids, the section
 * and the item's source are readable in the database. Functions here never
 * open a transaction of their own, so callers (the routes, the clinic's
 * finalize) can make several changes atomically.
 */

export type HealthLang = 'en' | 'ar';
export type { Relation, Section };

export const SECTIONS: readonly Section[] = ['allergies', 'medications', 'conditions', 'labs', 'procedures', 'visits'];
const RELATIONS: readonly Relation[] = ['self', 'child', 'parent', 'spouse', 'other'];
const SEXES = ['male', 'female'] as const;
const BLOOD_TYPES = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] as const;
const SEVERITIES = ['mild', 'moderate', 'severe'] as const;
const CONDITION_STATUS = ['active', 'resolved'] as const;

export interface Consent {
  given: boolean;
  given_at: string | null;
}

export interface Profile {
  id: string;
  name: string;
  sex: (typeof SEXES)[number] | null;
  date_of_birth: string | null;
  blood_type: (typeof BLOOD_TYPES)[number] | null;
  relation: Relation;
}

/** An item as the app sees it: its fields, its id, and where it came from. */
export type Item = Record<string, unknown> & { id: string; source: string | null };

export type RecordSections = Record<Section, Item[]>;

const now = () => new Date().toISOString();

// ---- Validation ---------------------------------------------------------------------------

function invalid(field: string, message: string): never {
  throw new ApiError('invalid', message, field);
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function text(fields: Record<string, unknown>, key: string, required: boolean, max = 200): string | null {
  const value = fields[key];
  if (value === undefined || value === null || value === '') {
    if (required) invalid(key, `${key} is required.`);
    return null;
  }
  if (typeof value !== 'string') invalid(key, `${key} must be text.`);
  const trimmed = value.trim();
  if (!trimmed) {
    if (required) invalid(key, `${key} is required.`);
    return null;
  }
  return trimmed.slice(0, max);
}

function date(fields: Record<string, unknown>, key: string, required: boolean): string | null {
  const value = fields[key];
  if (value === undefined || value === null || value === '') {
    if (required) invalid(key, `${key} is required.`);
    return null;
  }
  if (typeof value !== 'string' || !ISO_DATE.test(value) || Number.isNaN(Date.parse(value))) {
    invalid(key, `${key} must be a date (YYYY-MM-DD).`);
  }
  return value;
}

function choice<T extends string>(fields: Record<string, unknown>, key: string, options: readonly T[], required: boolean): T | null {
  const value = fields[key];
  if (value === undefined || value === null || value === '') {
    if (required) invalid(key, `${key} is required.`);
    return null;
  }
  if (!options.includes(value as T)) invalid(key, `${key} must be one of ${options.join(', ')}.`);
  return value as T;
}

function number(fields: Record<string, unknown>, key: string, required: boolean): number | null {
  const value = fields[key];
  if (value === undefined || value === null || value === '') {
    if (required) invalid(key, key === 'value' ? 'A lab value must be a number.' : `${key} is required.`);
    return null;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    invalid(key, key === 'value' ? 'A lab value must be a number.' : `${key} must be a number.`);
  }
  return value;
}

/** Only the section's own fields are kept, so nothing else is ever stored. */
export function cleanItem(section: Section, input: Record<string, unknown>): Record<string, unknown> {
  switch (section) {
    case 'allergies':
      return {
        substance: text(input, 'substance', true),
        reaction: text(input, 'reaction', false),
        severity: choice(input, 'severity', SEVERITIES, true),
      };
    case 'medications':
      return {
        name: text(input, 'name', true),
        dose: text(input, 'dose', false),
        frequency: text(input, 'frequency', false),
        start: date(input, 'start', false),
        end: date(input, 'end', false),
      };
    case 'conditions':
      return {
        name: text(input, 'name', true),
        diagnosed: date(input, 'diagnosed', false),
        status: choice(input, 'status', CONDITION_STATUS, true),
      };
    case 'procedures':
      return { name: text(input, 'name', true), date: date(input, 'date', false) };
    case 'labs':
      return {
        test: text(input, 'test', true),
        value: number(input, 'value', true),
        unit: text(input, 'unit', false, 40),
        date: date(input, 'date', true),
        ref_low: number(input, 'ref_low', false),
        ref_high: number(input, 'ref_high', false),
      };
    case 'visits':
      return {
        date: date(input, 'date', true),
        specialty: text(input, 'specialty', false),
        reason: text(input, 'reason', false, 400),
      };
  }
}

export function isSection(value: string): value is Section {
  return (SECTIONS as readonly string[]).includes(value);
}

function cleanProfile(input: Record<string, unknown>): Omit<Profile, 'id' | 'relation'> {
  const name = text(input, 'name', true, 64) as string;
  const dob = date(input, 'date_of_birth', false);
  if (dob && Date.parse(dob) > Date.now()) invalid('date_of_birth', 'Date of birth is in the future.');
  return {
    name,
    sex: choice(input, 'sex', SEXES, false),
    date_of_birth: dob,
    blood_type: choice(input, 'blood_type', BLOOD_TYPES, false),
  };
}

// ---- Consent ------------------------------------------------------------------------------

export function getConsent(userId: string): Consent {
  const row = findConsent(userId);
  return { given: row?.given === 1, given_at: row?.given === 1 ? row.given_at : null };
}

export const consentGiven = (userId: string) => getConsent(userId).given;

export function requireConsent(userId: string): void {
  if (!consentGiven(userId)) {
    throw new ApiError('invalid', 'Health data consent has not been given.');
  }
}

/**
 * Giving consent makes sure the resident has their own profile. Withdrawing
 * it deletes the health data: family profiles go, and the resident's own
 * stays, emptied. Clinic appointments keep the patient's name as booked.
 */
export function setConsent(userId: string, given: boolean): Consent {
  const at = now();
  upsertConsent(userId, given ? 1 : 0, given ? at : null, at);
  const selfId = findSelfProfileId(userId);
  if (given) {
    if (!selfId) {
      const user = getUser(userId);
      insertSelfProfile(randomUUID(), userId, user?.name ?? 'Me', at);
    }
  } else {
    deleteFamilyProfiles(userId);
    if (selfId) emptyProfile(selfId, at);
  }
  return getConsent(userId);
}

/**
 * The resident's own profile with its health data gone: record items,
 * documents and summaries. The profile itself stays. Files left behind are
 * removed by the caller (files.ts, sweepOrphanFiles).
 */
function emptyProfile(profileId: string, at = now()): void {
  deleteProfileHealthItems(profileId);
  deleteProfileDocuments(profileId);
  deleteProfileSummaries(profileId);
  clearProfileBloodType(profileId, at);
}

// ---- Profiles -----------------------------------------------------------------------------

function present(row: ProfileRow): Profile {
  return {
    id: row.id,
    name: row.name,
    sex: row.sex,
    date_of_birth: row.date_of_birth,
    blood_type: row.blood_type,
    relation: row.relation,
  };
}

export function listProfiles(userId: string): Profile[] {
  return listHealthProfiles(userId).map(present);
}

/** Any profile, whoever owns it; for the clinic, which checks access itself. */
export function profileById(profileId: string): (Profile & { owner_id: string; record_updated_at: string }) | null {
  const row = findHealthProfile(profileId);
  return row ? { ...present(row), owner_id: row.owner_id, record_updated_at: row.record_updated_at } : null;
}

/** The resident's own profile, or 404: someone else's is indistinguishable from none. */
export function ownedProfile(userId: string, profileId: string) {
  const profile = profileById(profileId);
  if (!profile || profile.owner_id !== userId) {
    throw new ApiError('not_found', 'Profile not found.');
  }
  return profile;
}

export function addProfile(userId: string, input: Record<string, unknown>): Profile {
  const fields = cleanProfile(input);
  const relation = choice(input, 'relation', RELATIONS, true) as Relation;
  if (relation === 'self' && listProfiles(userId).some((p) => p.relation === 'self')) {
    invalid('relation', 'You already have your own profile.');
  }
  if (listProfiles(userId).length >= 20) invalid('relation', 'A Health Passport holds up to 20 profiles.');
  const id = randomUUID();
  const at = now();
  insertHealthProfile(id, userId, relation, fields, at);
  return { id, relation, ...fields };
}

/** The relation stays as created, as in the app. */
export function updateProfile(userId: string, profileId: string, input: Record<string, unknown>): Profile {
  const existing = ownedProfile(userId, profileId);
  const fields = cleanProfile(input);
  updateProfileFields(profileId, fields, now());
  return { id: profileId, relation: existing.relation, ...fields };
}

/** A family member's profile goes with its record, documents and summaries; the resident's own is emptied instead. */
export function deleteProfile(userId: string, profileId: string): void {
  const profile = ownedProfile(userId, profileId);
  if (profile.relation === 'self') {
    emptyProfile(profileId);
  } else {
    deleteHealthProfile(profileId);
  }
}

// ---- Record items -------------------------------------------------------------------------

function toItem(row: ItemRow): Item {
  return { ...(JSON.parse(unseal(row.data)) as Record<string, unknown>), id: row.id, source: row.source };
}

export function touch(profileId: string): void {
  touchHealthProfile(profileId, now());
}

export function readSections(profileId: string): RecordSections {
  const rows = listHealthItems(profileId);
  const sections = Object.fromEntries(SECTIONS.map((section) => [section, [] as Item[]])) as RecordSections;
  for (const row of rows) {
    if (isSection(row.section)) sections[row.section].push(toItem(row));
  }
  return sections;
}

/** Inserts an item that has already passed `cleanItem`. */
export function insertItem(profileId: string, section: Section, data: Record<string, unknown>, source: string | null): Item {
  const id = randomUUID();
  const at = now();
  insertHealthItem({ id, profileId, section, data: seal(JSON.stringify(data)), source, at });
  return { ...data, id, source };
}

export function createItem(userId: string, profileId: string, section: Section, input: Record<string, unknown>): Item {
  ownedProfile(userId, profileId);
  const item = insertItem(profileId, section, cleanItem(section, input), null);
  touch(profileId);
  return item;
}

function ownedItem(userId: string, profileId: string, section: Section, itemId: string): ItemRow {
  ownedProfile(userId, profileId);
  const row = findHealthItem(itemId, profileId, section);
  if (!row) throw new ApiError('not_found', 'Item not found.');
  return row;
}

/** The item keeps its source: an edit does not make a document's item hand-typed. */
export function updateItem(userId: string, profileId: string, section: Section, itemId: string, input: Record<string, unknown>): Item {
  const row = ownedItem(userId, profileId, section, itemId);
  const data = cleanItem(section, input);
  updateHealthItemData(itemId, seal(JSON.stringify(data)), now());
  touch(profileId);
  return { ...data, id: itemId, source: row.source };
}

export function deleteItem(userId: string, profileId: string, section: Section, itemId: string): void {
  ownedItem(userId, profileId, section, itemId);
  deleteHealthItem(itemId);
  touch(profileId);
}

// ---- Gaps ---------------------------------------------------------------------------------

/** The app's own wording (src/services/health/mockData.ts), in the request's language. */
const GAP_TEXT = {
  missing_blood_type: { en: 'Blood type is not recorded.', ar: 'فصيلة الدم غير مسجلة.' },
  no_allergies_recorded: {
    en: 'No allergies are recorded. Add any you know of, even mild ones.',
    ar: 'لا توجد حساسية مسجلة. أضف أي حساسية تعرفها، حتى البسيطة.',
  },
  no_recent_labs: { en: 'No lab results in the last 12 months.', ar: 'لا توجد نتائج تحاليل خلال آخر ١٢ شهرًا.' },
  stale_lab: {
    en: (test: string, on: string) => `Last ${test} result is from ${on} (over 2 years ago).`,
    ar: (test: string, on: string) => `آخر نتيجة لتحليل ${test} بتاريخ ${on} (منذ أكثر من سنتين).`,
  },
} as const;

const YEAR_MS = 365.25 * 24 * 3600_000;

export interface Gap {
  kind: 'missing_blood_type' | 'stale_lab' | 'no_recent_labs' | 'no_allergies_recorded';
  text: string;
  test?: string;
}

export function gapsFor(profile: Profile, sections: RecordSections, lang: HealthLang): Gap[] {
  const gaps: Gap[] = [];
  if (!profile.blood_type) gaps.push({ kind: 'missing_blood_type', text: GAP_TEXT.missing_blood_type[lang] });
  if (sections.allergies.length === 0) gaps.push({ kind: 'no_allergies_recorded', text: GAP_TEXT.no_allergies_recorded[lang] });
  const at = Date.now();
  const labs = sections.labs as unknown as { test: string; date: string }[];
  if (!labs.some((lab) => at - Date.parse(lab.date) < YEAR_MS)) {
    gaps.push({ kind: 'no_recent_labs', text: GAP_TEXT.no_recent_labs[lang] });
  }
  const latest = new Map<string, string>();
  for (const lab of labs) {
    if ((latest.get(lab.test) ?? '') < lab.date) latest.set(lab.test, lab.date);
  }
  for (const [test, on] of latest) {
    if (at - Date.parse(on) > 2 * YEAR_MS) gaps.push({ kind: 'stale_lab', text: GAP_TEXT.stale_lab[lang](test, on), test });
  }
  return gaps;
}

export function readRecord(profileId: string, lang: HealthLang) {
  const profile = profileById(profileId);
  if (!profile) throw new ApiError('not_found', 'Profile not found.');
  const sections = readSections(profileId);
  const { relation: _relation, owner_id: _owner, record_updated_at, ...patient } = profile;
  return { patient, record_updated_at, ...sections, gaps: gapsFor(profile, sections, lang) };
}
