import { randomBytes, randomUUID } from 'node:crypto';

import type { GateCheck, NewVisitorPass, VisitorPass, VisitorPassStatus } from '../../../shared/contracts/visitors.ts';
import { addDays, clinicDate, clinicInstant, clinicTime } from '../clinic/time.ts';
import type { User } from '../ems/auth.ts';
import { publishToUnit } from '../ems/broadcast.ts';
import { notify } from '../ems/notifications.ts';
import { seal, sha256, unseal } from '../ems/secrets.ts';
import { requireSite, requireSiteById, requireUnit, siteSettings } from '../ems/sites.ts';
import { ApiError } from '../errors.ts';
import { listSites } from '../repositories/sites.ts';
import { findUnit, memberIdsOfUnit } from '../repositories/units.ts';
import {
  deletePassesEndedBefore,
  findPass,
  findPassByTokenHash,
  insertEntry,
  insertPass,
  listEntries,
  listSitePasses,
  listUnitPasses,
  moveStatus,
  revokePass,
  type PassRow,
} from '../repositories/visitors.ts';

/**
 * Visitor passes. A resident makes one for a visit; the QR code holds `PLV1.<pass id>.<random token>`, which
 * the gate checks online (so revoking works at once). The visitor's name and phone are sealed, and past passes are
 * removed after the site's retention. Gate staff (`security`) and admins check visitors in and out.
 */

const CODE = /^PLV1\.([0-9a-f-]{36})\.([A-Za-z0-9_-]{20,40})$/;
const PHONE = /^\+?[0-9][0-9 ()-]{6,19}$/;
const PLATE = /^[A-Z0-9؀-ۿ ]{2,12}$/;
/** A pass opens this long before the expected arrival, and a single-use one closes this long after it. */
const OPENS_BEFORE_MS = 2 * 3600_000;
const SINGLE_USE_MS = 6 * 3600_000;

function invalid(field: string, message: string): never {
  throw new ApiError('invalid', message, field);
}

function statusOf(row: PassRow, nowMs: number): VisitorPassStatus {
  if (row.status === 'revoked') return 'revoked';
  if (row.status === 'arrived') return 'arrived';
  if (row.status === 'left' && row.uses === 'single') return 'left';
  return Date.parse(row.valid_to) < nowMs ? 'expired' : row.status === 'left' ? 'left' : 'scheduled';
}

function present(row: PassRow, user: User, nowMs: number, entries: { kind: 'entry' | 'exit'; at: string }[]): VisitorPass {
  return {
    id: row.id,
    visitorName: unseal(row.visitor_name),
    visitorPhone: row.visitor_phone ? unseal(row.visitor_phone) : null,
    plate: row.plate,
    guests: row.guests,
    arrivesAt: row.arrives_at,
    validFrom: row.valid_from,
    validTo: row.valid_to,
    uses: row.uses,
    status: statusOf(row, nowMs),
    code: unseal(row.token_sealed),
    createdAt: row.created_at,
    createdByMe: row.created_by === user.id,
    entries,
  };
}

/** The resident's unit's passes: upcoming ones and those of the last week. */
export function listPasses(user: User, nowMs = Date.now()): VisitorPass[] {
  const unit = requireUnit(user);
  const rows = listUnitPasses(unit.id, new Date(nowMs - 7 * 86_400_000).toISOString());
  const entries = listEntries(rows.map((row) => row.id));
  return rows.map((row) =>
    present(row, user, nowMs, entries.filter((entry) => entry.pass_id === row.id).map((entry) => ({ kind: entry.kind, at: entry.at }))),
  );
}

export function createPass(user: User, body: Partial<NewVisitorPass> & Record<string, unknown>, nowMs = Date.now()): VisitorPass {
  const unit = requireUnit(user);
  const site = requireSite(user);
  const rules = siteSettings(site.id).visitors;
  const name = typeof body.visitorName === 'string' ? body.visitorName.trim() : '';
  if (name.length < 2 || name.length > 60) invalid('visitorName', 'Enter the visitor\'s name.');
  const phoneInput = typeof body.visitorPhone === 'string' ? body.visitorPhone.trim() : '';
  if (phoneInput && (!PHONE.test(phoneInput) || phoneInput.replace(/\D/g, '').length < 8)) invalid('visitorPhone', 'Enter a phone number with at least 8 digits.');
  const plateInput = typeof body.plate === 'string' ? body.plate.trim().toUpperCase() : '';
  if (plateInput && !PLATE.test(plateInput)) invalid('plate', 'Use 2 to 12 letters and numbers for the plate.');
  if (typeof body.guests !== 'number' || !Number.isInteger(body.guests) || body.guests < 1 || body.guests > rules.maxGuests) {
    invalid('guests', `Choose 1 to ${rules.maxGuests} guests.`);
  }
  const arrives = typeof body.arrivesAt === 'string' ? Date.parse(body.arrivesAt) : Number.NaN;
  if (Number.isNaN(arrives)) invalid('arrivesAt', 'Choose the arrival time.');
  const today = clinicDate(nowMs, site.timezone);
  const arrivalDay = clinicDate(arrives, site.timezone);
  const arrivalTime = clinicTime(arrives, site.timezone);
  if (arrivalDay < today || arrivalDay > addDays(today, rules.windowDays - 1)) invalid('arrivesAt', `Choose a day from today to ${rules.windowDays - 1} days ahead.`);
  if (arrivalTime < rules.earliest || arrivalTime > rules.latest) invalid('arrivesAt', `Visitors can arrive from ${rules.earliest} to ${rules.latest}.`);
  if (arrives < nowMs - 15 * 60_000) invalid('arrivesAt', 'That time has passed.');
  const uses = body.uses === 'multi' ? 'multi' : 'single';
  let validTo = arrives + SINGLE_USE_MS;
  if (uses === 'multi') {
    const lastDay = typeof body.lastDay === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.lastDay) ? body.lastDay : invalid('lastDay', 'Choose the last day the pass works.');
    if (lastDay < arrivalDay || lastDay > addDays(arrivalDay, rules.windowDays - 1)) invalid('lastDay', `The pass can last up to ${rules.windowDays} days.`);
    validTo = clinicInstant(lastDay, '23:59', site.timezone) + 59_000;
  }
  const id = randomUUID();
  const code = `PLV1.${id}.${randomBytes(18).toString('base64url')}`;
  const at = new Date(nowMs).toISOString();
  const row: PassRow = {
    id,
    unit_id: unit.id,
    created_by: user.id,
    visitor_name: seal(name),
    visitor_phone: phoneInput ? seal(phoneInput) : null,
    plate: plateInput || null,
    guests: body.guests as number,
    arrives_at: new Date(arrives).toISOString(),
    valid_from: new Date(arrives - OPENS_BEFORE_MS).toISOString(),
    valid_to: new Date(validTo).toISOString(),
    uses,
    status: 'scheduled',
    token_hash: sha256(code),
    token_sealed: seal(code),
    created_at: at,
    updated_at: at,
    revoked_at: null,
  };
  insertPass(row);
  publishToUnit(unit.id, { type: 'visitor.updated', passId: id });
  return present(row, user, nowMs, []);
}

/** Any resident of the unit may cancel its passes, until the visitor has left. */
export function cancelPass(user: User, passId: string, nowMs = Date.now()): VisitorPass {
  const unit = requireUnit(user);
  const row = findPass(passId);
  if (!row || row.unit_id !== unit.id) throw new ApiError('not_found', 'No such pass.');
  if (!revokePass(row.id, new Date(nowMs).toISOString())) throw new ApiError('invalid_transition', 'This pass can no longer be cancelled.');
  publishToUnit(unit.id, { type: 'visitor.updated', passId });
  return present(findPass(passId) as PassRow, user, nowMs, []);
}

// ---- the gate ------------------------------------------------------------------------------------------

function decide(row: PassRow, nowMs: number): GateCheck['decision'] {
  if (row.status === 'revoked') return 'revoked';
  if (row.status === 'arrived') return 'exit';
  if (row.status === 'left' && row.uses === 'single') return 'used';
  if (nowMs < Date.parse(row.valid_from)) return 'too_early';
  if (nowMs > Date.parse(row.valid_to)) return 'expired';
  return 'admit';
}

function gateView(row: PassRow, nowMs: number): NonNullable<GateCheck['pass']> {
  return {
    id: row.id,
    visitorName: unseal(row.visitor_name),
    guests: row.guests,
    plate: row.plate,
    unitName: findUnit(row.unit_id)?.name ?? '—',
    arrivesAt: row.arrives_at,
    validTo: row.valid_to,
    status: statusOf(row, nowMs),
  };
}

/** What the gate should do with a scanned or typed code. Records nothing. */
export function checkCode(codeInput: unknown, nowMs = Date.now()): GateCheck {
  const code = typeof codeInput === 'string' ? codeInput.trim() : '';
  const row = CODE.test(code) ? findPassByTokenHash(sha256(code)) : undefined;
  if (!row) return { decision: 'unknown', pass: null };
  return { decision: decide(row, nowMs), pass: gateView(row, nowMs) };
}

/** Lets the visitor in (or out). Two gates acting at once: only one succeeds. Tells the unit on entry. */
export function recordMovement(staff: User | null, passId: string, kind: 'entry' | 'exit', gateInput: unknown, nowMs = Date.now()): GateCheck {
  const row = findPass(passId);
  if (!row) throw new ApiError('not_found', 'No such pass.');
  const decision = decide(row, nowMs);
  const at = new Date(nowMs).toISOString();
  const gate = typeof gateInput === 'string' && gateInput.trim() ? gateInput.trim().slice(0, 40) : null;
  if (kind === 'entry') {
    if (decision !== 'admit') throw new ApiError('invalid_transition', `This pass can't be used to enter now (${decision.replace('_', ' ')}).`);
    if (!moveStatus(row.id, row.status, 'arrived', at)) throw new ApiError('version_conflict', 'The pass changed meanwhile. Scan it again.');
  } else {
    if (decision !== 'exit') throw new ApiError('invalid_transition', 'This visitor is not inside.');
    if (!moveStatus(row.id, 'arrived', 'left', at)) throw new ApiError('version_conflict', 'The pass changed meanwhile. Scan it again.');
  }
  insertEntry({ id: randomUUID(), pass_id: row.id, kind, gate, at, by_user: staff?.id ?? null });
  publishToUnit(row.unit_id, { type: 'visitor.updated', passId: row.id });
  if (kind === 'entry') {
    notify(memberIdsOfUnit(row.unit_id), {
      kind: 'visitors',
      title: `${unseal(row.visitor_name)} arrived`,
      body: gate ? `At ${gate}.` : null,
      ref: { type: 'visitor_pass', id: row.id },
    });
  }
  const updated = findPass(row.id) as PassRow;
  return { decision: decide(updated, nowMs), pass: gateView(updated, nowMs) };
}

/** Today's expected and present visitors on a site, for the gate's list. */
export function todaysVisitors(siteId: string, nowMs = Date.now()) {
  const site = requireSiteById(siteId);
  const today = clinicDate(nowMs, site.timezone);
  const from = new Date(clinicInstant(today, '00:00', site.timezone)).toISOString();
  const to = new Date(clinicInstant(addDays(today, 1), '00:00', site.timezone)).toISOString();
  return listSitePasses(site.id, from, to).map((row) => ({ ...gateView(row, nowMs), decision: decide(row, nowMs) }));
}

/** Hourly upkeep: each site's past passes after its retention. */
export function purgeOldPasses(nowMs = Date.now()): number {
  let removed = 0;
  for (const site of listSites()) {
    const days = siteSettings(site.id).visitors.retentionDays;
    removed += deletePassesEndedBefore(site.id, new Date(nowMs - days * 86_400_000).toISOString());
  }
  return removed;
}
