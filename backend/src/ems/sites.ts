import type { DayWindow, SiteSettings, SiteSettingsPatch, SiteView } from '../../../shared/contracts/sites.ts';
import { ApiError } from '../errors.ts';
import { findSite, readSiteSettings, takeReferenceNumber, writeSiteSettings, type Site } from '../repositories/sites.ts';
import { DEFAULT_SITE_ID, findUnitOfUser, type Unit } from '../repositories/units.ts';
import type { User } from './auth.ts';

/**
 * Sites (compounds), the unit and site a resident belongs to, the rules building management sets per site, and
 * the references people quote (REQ-2026-00124).
 */

export type { Site };

export const presentSite = (site: Site): SiteView => ({ id: site.id, name: site.name, timezone: site.timezone, kind: site.kind });

/** The resident's unit, or 404 `no_home` with the message the app shows. */
export function requireUnit(user: User): Unit & { siteId: string } {
  const unit = findUnitOfUser(user.id);
  if (!unit) {
    throw new ApiError('no_home', 'Your account is not linked to an apartment yet. Ask building management to add you.');
  }
  return { ...unit, siteId: unit.siteId ?? DEFAULT_SITE_ID };
}

/** The site the resident lives on. */
export function requireSite(user: User): Site {
  const site = findSite(requireUnit(user).siteId);
  if (!site) throw new ApiError('not_found', 'This apartment\'s compound is not set up.');
  return site;
}

export function requireSiteById(siteId: string): Site {
  const site = findSite(siteId);
  if (!site) throw new ApiError('not_found', 'No such site.');
  return site;
}

// ---- settings ------------------------------------------------------------------------------------------

/** Today's rules in the app (the sample screens' own limits), used until management changes them. */
export const DEFAULT_SETTINGS: SiteSettings = {
  emergencyPhone: null,
  managementPhone: null,
  managementEmail: null,
  visitors: { earliest: '08:00', latest: '22:00', stepMinutes: 30, windowDays: 14, maxGuests: 10, retentionDays: 90 },
  maintenance: {
    windows: [
      { from: '09:00', to: '12:00' },
      { from: '12:00', to: '15:00' },
      { from: '15:00', to: '18:00' },
    ],
    leadDays: 1,
    horizonDays: 14,
  },
  amenities: { windowDays: 14, maxGuests: 6 },
};

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const PHONE = /^\+?[0-9][0-9 ()-]{5,19}$/;
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

function invalid(field: string, message: string): never {
  throw new ApiError('invalid', message, field);
}

const time = (value: unknown, field: string): string => (typeof value === 'string' && HHMM.test(value) ? value : invalid(field, 'Use a time as HH:MM.'));

function integer(value: unknown, field: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) invalid(field, `Use a whole number from ${min} to ${max}.`);
  return value as number;
}

function contact(value: unknown, field: string, pattern: RegExp, message: string): string | null {
  if (value === null || value === '') return null;
  if (typeof value !== 'string' || !pattern.test(value.trim())) invalid(field, message);
  return (value as string).trim();
}

const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));

function windows(value: unknown): DayWindow[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 8) invalid('maintenance.windows', 'Give 1 to 8 visit windows.');
  return (value as unknown[]).map((entry, index) => {
    const raw = (entry ?? {}) as Record<string, unknown>;
    const from = time(raw.from, `maintenance.windows.${index}.from`);
    const to = time(raw.to, `maintenance.windows.${index}.to`);
    if (minutes(to) <= minutes(from)) invalid(`maintenance.windows.${index}`, 'A window must end after it starts.');
    return { from, to };
  });
}

/** The settings as stored, over the defaults; anything stored that no longer validates falls back to its default. */
export function siteSettings(siteId: string): SiteSettings {
  const stored = readSiteSettings(siteId);
  if (!stored) return structuredClone(DEFAULT_SETTINGS);
  try {
    return mergeSettings(DEFAULT_SETTINGS, JSON.parse(stored) as SiteSettingsPatch);
  } catch {
    return structuredClone(DEFAULT_SETTINGS);
  }
}

function mergeSettings(base: SiteSettings, patch: SiteSettingsPatch): SiteSettings {
  const next = structuredClone(base);
  if (patch === null || typeof patch !== 'object') invalid('settings', 'Send the settings as an object.');
  if ('emergencyPhone' in patch) next.emergencyPhone = contact(patch.emergencyPhone, 'emergencyPhone', PHONE, 'Enter a phone number.');
  if ('managementPhone' in patch) next.managementPhone = contact(patch.managementPhone, 'managementPhone', PHONE, 'Enter a phone number.');
  if ('managementEmail' in patch) next.managementEmail = contact(patch.managementEmail, 'managementEmail', EMAIL, 'Enter an email address.');
  if (patch.visitors) {
    const v = { ...next.visitors, ...patch.visitors };
    next.visitors = {
      earliest: time(v.earliest, 'visitors.earliest'),
      latest: time(v.latest, 'visitors.latest'),
      stepMinutes: integer(v.stepMinutes, 'visitors.stepMinutes', 5, 120),
      windowDays: integer(v.windowDays, 'visitors.windowDays', 1, 90),
      maxGuests: integer(v.maxGuests, 'visitors.maxGuests', 1, 50),
      retentionDays: integer(v.retentionDays, 'visitors.retentionDays', 7, 730),
    };
    if (minutes(next.visitors.latest) <= minutes(next.visitors.earliest)) invalid('visitors.latest', 'The last arrival time must be after the first.');
  }
  if (patch.maintenance) {
    const m = { ...next.maintenance, ...patch.maintenance };
    next.maintenance = {
      windows: windows(m.windows),
      leadDays: integer(m.leadDays, 'maintenance.leadDays', 0, 14),
      horizonDays: integer(m.horizonDays, 'maintenance.horizonDays', 1, 90),
    };
  }
  if (patch.amenities) {
    const a = { ...next.amenities, ...patch.amenities };
    next.amenities = { windowDays: integer(a.windowDays, 'amenities.windowDays', 1, 90), maxGuests: integer(a.maxGuests, 'amenities.maxGuests', 0, 50) };
  }
  return next;
}

/** Management changes part of a site's rules; returns all of them. */
export function updateSiteSettings(siteId: string, patch: unknown, at = new Date().toISOString()): SiteSettings {
  requireSiteById(siteId);
  const next = mergeSettings(siteSettings(siteId), patch as SiteSettingsPatch);
  writeSiteSettings(siteId, JSON.stringify(next), at);
  return next;
}

// ---- references ----------------------------------------------------------------------------------------

/**
 * References are unique across every compound (the tables say so), so their numbers come from one counter per kind
 * and year, shared by all compounds (scope '*', migration 20).
 */
const REFERENCE_SCOPE = '*';

/** `REQ-2026-00124`: a prefix, the year in the site's time zone, and a counter that is never repeated. */
export function yearlyReference(site: Pick<Site, 'id' | 'timezone'>, kind: string, prefix: string, nowMs = Date.now()): string {
  const year = Number(new Intl.DateTimeFormat('en-GB', { timeZone: site.timezone, year: 'numeric' }).format(nowMs));
  return `${prefix}-${year}-${String(takeReferenceNumber(REFERENCE_SCOPE, kind, year)).padStart(5, '0')}`;
}

/** `BK-01001`: a prefix and a counter that never restarts. */
export function runningReference(_siteId: string, kind: string, prefix: string): string {
  return `${prefix}-${String(takeReferenceNumber(REFERENCE_SCOPE, kind, 0)).padStart(5, '0')}`;
}
