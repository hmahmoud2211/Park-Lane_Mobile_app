import { randomUUID } from 'node:crypto';

import type {
  AdminServiceRequest,
  NewServiceRequest,
  ServiceKind,
  ServiceRequest,
  ServiceRequestOptions,
  ServiceRequestStatus,
  Technician,
} from '../../../shared/contracts/serviceRequests.ts';
import { addDays, clinicDate } from '../clinic/time.ts';
import type { User } from '../ems/auth.ts';
import { publishToUnit } from '../ems/broadcast.ts';
import { transaction } from '../ems/db.ts';
import { notify } from '../ems/notifications.ts';
import { seal, unseal } from '../ems/secrets.ts';
import { requireSite, requireSiteById, requireUnit, siteSettings, yearlyReference } from '../ems/sites.ts';
import { ApiError } from '../errors.ts';
import { signedUrl } from '../health/files.ts';
import { sealedFolder } from '../lib/sealedFiles.ts';
import {
  countCategories,
  countPhotos,
  findCategory,
  findPhoto,
  findRequest,
  findTechnician,
  insertCategories,
  insertPhoto,
  insertRequest,
  insertRequestEvent,
  insertTechnician,
  listCategories,
  listPhotos,
  listRequestEvents,
  listSiteRequests,
  listTechnicians,
  listUnitRequests,
  moveRequest,
  referencedPhotoFiles,
  setCategoryActive,
  touchRequest,
  updateTechnician,
  type PhotoRow,
  type RequestEventRow,
  type RequestRow,
  type TechnicianRow,
} from '../repositories/serviceRequests.ts';
import { findUnit, memberIdsOfUnit } from '../repositories/units.ts';

/**
 * Maintenance, housekeeping and moving requests. A resident asks for a visit (a category, a day and a window from
 * the site's rules); building management assigns a technician and a booked slot, moves it along and can write to
 * the resident. The unit's residents see every step and get an inbox message when management acts. Details,
 * notes and technicians' phones are sealed; photos are sealed files behind two-hour signed links.
 */

const KINDS: readonly ServiceKind[] = ['maintenance', 'housekeeping', 'moving'];
const OPEN: readonly ServiceRequestStatus[] = ['submitted', 'assigned', 'in_progress'];
const WINDOW = /^(([01]\d|2[0-3]):[0-5]\d)-(([01]\d|2[0-3]):[0-5]\d)$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const PHONE = /^\+?[0-9][0-9 ()-]{6,19}$/;
/** How far ahead management may book a visit. */
const BOOKING_HORIZON_DAYS = 90;
const MAX_PHOTOS = 4;
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
export const photosFolder = sealedFolder('requests', 'photos');

const photoPath = (id: string) => `/api/requests/photos/${id}/file`;

function invalid(field: string, message: string): never {
  throw new ApiError('invalid', message, field);
}

function text(value: unknown, field: string, min: number, max: number, message: string): string {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (trimmed.length < min || trimmed.length > max) invalid(field, message);
  return trimmed;
}

function optionalNote(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  return text(value, field, 1, 500, 'Keep the note under 500 characters.');
}

const kindOf = (value: unknown): ServiceKind => (KINDS.includes(value as ServiceKind) ? (value as ServiceKind) : invalid('kind', 'Use maintenance, housekeeping or moving.'));

const windowsOf = (siteId: string) => siteSettings(siteId).maintenance.windows.map((window) => `${window.from}-${window.to}`);

/** The categories a compound starts with (migration 16 gave Park Lane the same); management can switch any off. */
const DEFAULT_CATEGORIES: readonly [ServiceKind, string, string][] = [
  ['maintenance', 'hvac', 'AC / HVAC'], ['maintenance', 'electrical', 'Electrical'], ['maintenance', 'plumbing', 'Plumbing'],
  ['maintenance', 'appliances', 'Appliances'], ['maintenance', 'doors', 'Doors & Locks'], ['maintenance', 'other', 'Other'],
  ['maintenance', 'painting', 'Painting'], ['maintenance', 'pest', 'Pest Control'], ['maintenance', 'carpentry', 'Carpentry'],
  ['housekeeping', 'standard', 'Standard cleaning'], ['housekeeping', 'deep', 'Deep cleaning'], ['housekeeping', 'windows', 'Windows & glass'],
  ['moving', 'move_in', 'Moving in'], ['moving', 'move_out', 'Moving out'],
];

/** A compound added after migration 16 gets the default categories the first time they are needed. */
function ensureCategories(siteId: string): void {
  if (countCategories(siteId) > 0) return;
  const sortOf = new Map<ServiceKind, number>();
  insertCategories(
    DEFAULT_CATEGORIES.map(([kind, id, title]) => {
      const sort = (sortOf.get(kind) ?? 0) + 1;
      sortOf.set(kind, sort);
      return { site_id: siteId, kind, id, title, sort };
    }),
  );
}

// ---- presenting ---------------------------------------------------------------------------------------

interface Lookups {
  titles: Map<string, string>;
  technicians: Map<string, TechnicianRow>;
  events: RequestEventRow[];
  photos: PhotoRow[];
  base: string;
}

function lookups(siteId: string, rows: readonly RequestRow[], base: string): Lookups {
  const ids = rows.map((row) => row.id);
  return {
    titles: new Map(listCategories(siteId, undefined, true).map((category) => [`${category.kind}:${category.id}`, category.title])),
    technicians: new Map(listTechnicians(siteId).map((technician) => [technician.id, technician])),
    events: listRequestEvents(ids),
    photos: listPhotos(ids),
    base,
  };
}

function presentCommon(row: RequestRow, found: Lookups): Omit<ServiceRequest, 'createdByMe'> {
  const technician = row.technician_id ? found.technicians.get(row.technician_id) : undefined;
  return {
    id: row.id,
    reference: row.reference,
    kind: row.kind,
    category: row.category,
    categoryTitle: found.titles.get(`${row.kind}:${row.category}`) ?? row.category,
    title: row.title,
    details: row.details ? unseal(row.details) : null,
    priority: row.priority,
    preferredDate: row.preferred_date,
    preferredWindow: row.preferred_window,
    scheduledDate: row.scheduled_date,
    scheduledWindow: row.scheduled_window,
    technician: technician ? { name: technician.name, phone: technician.phone ? unseal(technician.phone) : null } : null,
    status: row.status,
    createdAt: row.created_at,
    events: found.events
      .filter((event) => event.request_id === row.id)
      .map((event) => ({ kind: event.kind, status: event.status, note: event.note ? unseal(event.note) : null, byStaff: event.by_staff === 1, at: event.at })),
    photos: found.photos.filter((photo) => photo.request_id === row.id).map((photo) => ({ id: photo.id, url: signedUrl(found.base, photoPath(photo.id)) })),
  };
}

function presentForResident(row: RequestRow, user: User, found: Lookups): ServiceRequest {
  return { ...presentCommon(row, found), createdByMe: row.created_by === user.id };
}

function presentForStaff(row: RequestRow & { unit_name?: string }, found: Lookups): AdminServiceRequest {
  return { ...presentCommon(row, found), unitId: row.unit_id, unitName: row.unit_name ?? findUnit(row.unit_id)?.name ?? '—', technicianId: row.technician_id };
}

function residentView(requestId: string, user: User, base: string): ServiceRequest {
  const row = findRequest(requestId) as RequestRow;
  return presentForResident(row, user, lookups(requireSite(user).id, [row], base));
}

function staffView(requestId: string, base: string): AdminServiceRequest {
  const row = findRequest(requestId) as RequestRow;
  return presentForStaff(row, lookups(requireUnitSite(row.unit_id), [row], base));
}

function requireUnitSite(unitId: string): string {
  const unit = findUnit(unitId);
  if (!unit?.siteId) throw new ApiError('not_found', 'No such unit.');
  return unit.siteId;
}

function addEvent(requestId: string, kind: 'status' | 'comment', by: User | null, staff: boolean, at: string, status: ServiceRequestStatus | null, note: string | null): void {
  insertRequestEvent({ id: randomUUID(), request_id: requestId, kind, status, note: note ? seal(note) : null, by_user: by?.id ?? null, by_staff: staff ? 1 : 0, at });
}

// ---- residents ----------------------------------------------------------------------------------------

export function requestOptions(user: User, kindInput: unknown, nowMs = Date.now()): ServiceRequestOptions {
  const unit = requireUnit(user);
  const site = requireSite(user);
  const kind = kindOf(kindInput ?? 'maintenance');
  ensureCategories(site.id);
  const settings = siteSettings(site.id);
  const today = clinicDate(nowMs, site.timezone);
  return {
    kind,
    categories: listCategories(site.id, kind).map((category) => ({ kind: category.kind, id: category.id, title: category.title })),
    windows: windowsOf(site.id),
    firstDate: addDays(today, settings.maintenance.leadDays),
    lastDate: addDays(today, settings.maintenance.horizonDays),
    emergencyPhone: settings.emergencyPhone,
    timezone: site.timezone,
    unitName: unit.name,
  };
}

export function listRequests(user: User, base: string): ServiceRequest[] {
  const unit = requireUnit(user);
  const rows = listUnitRequests(unit.id);
  const found = lookups(unit.siteId, rows, base);
  return rows.map((row) => presentForResident(row, user, found));
}

export function createRequest(user: User, body: Partial<NewServiceRequest> & Record<string, unknown>, base: string, nowMs = Date.now()): ServiceRequest {
  const unit = requireUnit(user);
  const site = requireSite(user);
  const kind = kindOf(body.kind);
  ensureCategories(site.id);
  const categoryId = typeof body.category === 'string' ? body.category : '';
  const category = findCategory(site.id, kind, categoryId);
  if (!category || category.active !== 1) invalid('category', 'Choose a category.');
  const title = text(body.title, 'title', 3, 60, 'Describe the issue in 3 to 60 characters.');
  const details = body.details === undefined || body.details === null || body.details === '' ? null : text(body.details, 'details', 1, 500, 'Keep the details under 500 characters.');
  const priority = body.priority === 'urgent' ? 'urgent' : 'normal';
  const options = requestOptions(user, kind, nowMs);
  const preferredDate = typeof body.preferredDate === 'string' && DATE.test(body.preferredDate) ? body.preferredDate : invalid('preferredDate', 'Choose a day.');
  if (preferredDate < options.firstDate || preferredDate > options.lastDate) invalid('preferredDate', `Choose a day from ${options.firstDate} to ${options.lastDate}.`);
  const preferredWindow = typeof body.preferredWindow === 'string' && options.windows.includes(body.preferredWindow) ? body.preferredWindow : invalid('preferredWindow', 'Choose a visit window.');
  const at = new Date(nowMs).toISOString();
  const row: RequestRow = {
    id: randomUUID(),
    unit_id: unit.id,
    created_by: user.id,
    kind,
    category: categoryId,
    title,
    details: details ? seal(details) : null,
    priority,
    preferred_date: preferredDate,
    preferred_window: preferredWindow,
    scheduled_date: null,
    scheduled_window: null,
    technician_id: null,
    status: 'submitted',
    reference: yearlyReference(site, 'request', 'REQ', nowMs),
    created_at: at,
    updated_at: at,
  };
  transaction(() => {
    insertRequest(row);
    addEvent(row.id, 'status', user, false, at, 'submitted', null);
  });
  publishToUnit(unit.id, { type: 'request.updated', requestId: row.id });
  return residentView(row.id, user, base);
}

function unitRequest(user: User, requestId: string): RequestRow {
  const unit = requireUnit(user);
  const row = findRequest(requestId);
  if (!row || row.unit_id !== unit.id) throw new ApiError('not_found', 'No such request.');
  return row;
}

/** Any resident of the unit may cancel until a technician has started. */
export function cancelRequest(user: User, requestId: string, base: string, nowMs = Date.now()): ServiceRequest {
  const row = unitRequest(user, requestId);
  const at = new Date(nowMs).toISOString();
  transaction(() => {
    if (!moveRequest(row.id, ['submitted', 'assigned'], 'cancelled', at)) throw new ApiError('invalid_transition', 'This request can no longer be cancelled. Please write to building management.');
    addEvent(row.id, 'status', user, false, at, 'cancelled', null);
  });
  publishToUnit(row.unit_id, { type: 'request.updated', requestId: row.id });
  return residentView(row.id, user, base);
}

export function residentComment(user: User, requestId: string, body: Record<string, unknown>, base: string, nowMs = Date.now()): ServiceRequest {
  const row = unitRequest(user, requestId);
  if (row.status === 'cancelled') throw new ApiError('invalid_transition', 'This request was cancelled.');
  const note = text(body.note, 'note', 1, 500, 'Write a message of up to 500 characters.');
  const at = new Date(nowMs).toISOString();
  transaction(() => {
    addEvent(row.id, 'comment', user, false, at, null, note);
    touchRequest(row.id, at);
  });
  publishToUnit(row.unit_id, { type: 'request.updated', requestId: row.id });
  return residentView(row.id, user, base);
}

/** The file's real type, from its first bytes. */
function sniffImage(bytes: Buffer): 'image/png' | 'image/jpeg' | null {
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  return null;
}

export function addRequestPhoto(user: User, requestId: string, bytes: Buffer, base: string, nowMs = Date.now()): ServiceRequest {
  const row = unitRequest(user, requestId);
  if (!OPEN.includes(row.status)) throw new ApiError('invalid_transition', 'Photos can be added while the request is open.');
  if (bytes.length === 0) invalid('file', 'The photo is empty.');
  const mime = sniffImage(bytes) ?? invalid('file', 'Send a JPEG or PNG photo.');
  if (countPhotos(row.id) >= MAX_PHOTOS) invalid('file', `A request can have up to ${MAX_PHOTOS} photos.`);
  insertPhoto({ id: randomUUID(), request_id: row.id, file: photosFolder.store(bytes), mime, size: bytes.length, created_at: new Date(nowMs).toISOString() });
  publishToUnit(row.unit_id, { type: 'request.updated', requestId: row.id });
  return residentView(row.id, user, base);
}

export function memberMayOpenPhoto(user: User, photoId: string): boolean {
  const photo = findPhoto(photoId);
  if (!photo) return false;
  if (user.role === 'admin') return true;
  return memberIdsOfUnit(photo.unit_id).includes(user.id);
}

export function photoFile(photoId: string): { mime: string; bytes: Buffer } | null {
  const photo = findPhoto(photoId);
  const bytes = photo ? photosFolder.read(photo.file) : null;
  return photo && bytes ? { mime: photo.mime, bytes } : null;
}

/** Hourly upkeep: photo files whose request went with its unit. */
export function sweepOrphanPhotos(): number {
  const kept = referencedPhotoFiles();
  const orphans = photosFolder.list().filter((name) => !kept.has(name));
  photosFolder.remove(orphans);
  return orphans.length;
}

// ---- building management ------------------------------------------------------------------------------

export function adminRequests(siteId: string, query: URLSearchParams, base: string): AdminServiceRequest[] {
  const site = requireSiteById(siteId);
  const statusInput = query.get('status');
  const status = statusInput === 'open' || (statusInput && ['submitted', 'assigned', 'in_progress', 'completed', 'cancelled'].includes(statusInput)) ? (statusInput as ServiceRequestStatus | 'open') : undefined;
  const kindInput = query.get('kind');
  const kind = kindInput && KINDS.includes(kindInput as ServiceKind) ? (kindInput as ServiceKind) : undefined;
  const limit = Math.min(Math.max(Number(query.get('limit')) || 200, 1), 500);
  const rows = listSiteRequests(site.id, { status, kind, limit });
  const found = lookups(site.id, rows, base);
  return rows.map((row) => presentForStaff(row, found));
}

const windowLabel = (window: string) => window.replace('-', '–');

function tellUnit(row: RequestRow, title: string, body: string | null): void {
  notify(memberIdsOfUnit(row.unit_id), { kind: 'requests', title, body, ref: { type: 'service_request', id: row.id } });
  publishToUnit(row.unit_id, { type: 'request.updated', requestId: row.id });
}

function staffRequest(requestId: string): RequestRow {
  const row = findRequest(requestId);
  if (!row) throw new ApiError('not_found', 'No such request.');
  return row;
}

/** Books a technician and a slot (or changes them) while the request has not started. */
export function assignRequest(staff: User | null, requestId: string, body: Record<string, unknown>, base: string, nowMs = Date.now()): AdminServiceRequest {
  const row = staffRequest(requestId);
  const siteId = requireUnitSite(row.unit_id);
  const site = requireSiteById(siteId);
  const technician = typeof body.technicianId === 'string' ? findTechnician(body.technicianId) : undefined;
  if (!technician || technician.site_id !== siteId || technician.active !== 1) invalid('technicianId', 'Choose an active technician.');
  const today = clinicDate(nowMs, site.timezone);
  const date = typeof body.scheduledDate === 'string' && DATE.test(body.scheduledDate) ? body.scheduledDate : invalid('scheduledDate', 'Choose the visit day.');
  if (date < today || date > addDays(today, BOOKING_HORIZON_DAYS)) invalid('scheduledDate', `Choose a day from today to ${BOOKING_HORIZON_DAYS} days ahead.`);
  const window = typeof body.scheduledWindow === 'string' ? WINDOW.exec(body.scheduledWindow) : null;
  if (!window || window[3] <= window[1]) invalid('scheduledWindow', 'Give the window as HH:MM-HH:MM.');
  const note = optionalNote(body.note, 'note');
  const at = new Date(nowMs).toISOString();
  transaction(() => {
    const booking = { technicianId: technician.id, date, window: window[0] };
    if (!moveRequest(row.id, ['submitted', 'assigned'], 'assigned', at, booking)) throw new ApiError('invalid_transition', 'Only a request that has not started can be assigned.');
    addEvent(row.id, 'status', staff, true, at, 'assigned', note);
  });
  tellUnit(row, `${row.reference}: technician booked`, `${technician.name} will visit on ${date}, ${windowLabel(window[0])}.`);
  return staffView(row.id, base);
}

const NEXT: Record<'in_progress' | 'completed' | 'cancelled', readonly ServiceRequestStatus[]> = {
  in_progress: ['assigned'],
  completed: ['assigned', 'in_progress'],
  cancelled: ['submitted', 'assigned', 'in_progress'],
};

const STATUS_TITLE: Record<keyof typeof NEXT, string> = {
  in_progress: 'work started',
  completed: 'completed',
  cancelled: 'cancelled by building management',
};

export function setRequestStatus(staff: User | null, requestId: string, body: Record<string, unknown>, base: string, nowMs = Date.now()): AdminServiceRequest {
  const row = staffRequest(requestId);
  const status = body.status === 'in_progress' || body.status === 'completed' || body.status === 'cancelled' ? body.status : invalid('status', 'Use in_progress, completed or cancelled.');
  const note = optionalNote(body.note, 'note');
  if (status === 'cancelled' && !note) invalid('note', 'Tell the resident why the request is cancelled.');
  const at = new Date(nowMs).toISOString();
  transaction(() => {
    if (!moveRequest(row.id, NEXT[status], status, at)) throw new ApiError('invalid_transition', `A ${row.status.replace('_', ' ')} request can't become ${status.replace('_', ' ')}.`);
    addEvent(row.id, 'status', staff, true, at, status, note);
  });
  tellUnit(row, `${row.reference}: ${STATUS_TITLE[status]}`, note);
  return staffView(row.id, base);
}

export function staffComment(staff: User | null, requestId: string, body: Record<string, unknown>, base: string, nowMs = Date.now()): AdminServiceRequest {
  const row = staffRequest(requestId);
  const note = text(body.note, 'note', 1, 500, 'Write a message of up to 500 characters.');
  const at = new Date(nowMs).toISOString();
  transaction(() => {
    addEvent(row.id, 'comment', staff, true, at, null, note);
    touchRequest(row.id, at);
  });
  tellUnit(row, `${row.reference}: message from building management`, note.length > 140 ? `${note.slice(0, 139)}…` : note);
  return staffView(row.id, base);
}

// ---- technicians and categories -----------------------------------------------------------------------

function presentTechnician(row: TechnicianRow): Technician {
  return { id: row.id, name: row.name, phone: row.phone ? unseal(row.phone) : null, trades: JSON.parse(row.trades) as string[], active: row.active === 1 };
}

export function technicians(siteId: string): Technician[] {
  return listTechnicians(requireSiteById(siteId).id).map(presentTechnician);
}

function technicianFields(body: Record<string, unknown>, current?: TechnicianRow): Pick<TechnicianRow, 'name' | 'phone' | 'trades' | 'active'> {
  const name = body.name === undefined && current ? current.name : text(body.name, 'name', 2, 60, 'Give the technician\'s name.');
  let phone = current?.phone ?? null;
  if (body.phone !== undefined) {
    const input = typeof body.phone === 'string' ? body.phone.trim() : '';
    if (input && (!PHONE.test(input) || input.replace(/\D/g, '').length < 8)) invalid('phone', 'Enter a phone number with at least 8 digits.');
    phone = input ? seal(input) : null;
  }
  let trades = current?.trades ?? '[]';
  if (body.trades !== undefined) {
    if (!Array.isArray(body.trades) || body.trades.length > 12 || !body.trades.every((trade) => typeof trade === 'string' && /^[a-z_]{2,30}$/.test(trade))) {
      invalid('trades', 'List up to 12 trades, such as plumbing or housekeeping.');
    }
    trades = JSON.stringify([...new Set(body.trades as string[])]);
  }
  const active = body.active === undefined ? (current?.active ?? 1) : body.active === true ? 1 : body.active === false ? 0 : invalid('active', 'Use true or false.');
  return { name, phone, trades, active };
}

export function addTechnician(siteId: string, body: Record<string, unknown>, nowMs = Date.now()): Technician {
  const site = requireSiteById(siteId);
  const at = new Date(nowMs).toISOString();
  const row: TechnicianRow = { id: randomUUID(), site_id: site.id, ...technicianFields(body), created_at: at, updated_at: at };
  insertTechnician(row);
  return presentTechnician(row);
}

export function editTechnician(technicianId: string, body: Record<string, unknown>, nowMs = Date.now()): Technician {
  const current = findTechnician(technicianId);
  if (!current) throw new ApiError('not_found', 'No such technician.');
  const row: TechnicianRow = { ...current, ...technicianFields(body, current), updated_at: new Date(nowMs).toISOString() };
  updateTechnician(row);
  return presentTechnician(row);
}

export function adminCategories(siteId: string): { kind: ServiceKind; id: string; title: string; active: boolean }[] {
  ensureCategories(requireSiteById(siteId).id);
  return listCategories(requireSiteById(siteId).id, undefined, true).map((category) => ({ kind: category.kind, id: category.id, title: category.title, active: category.active === 1 }));
}

export function toggleCategory(siteId: string, kindInput: unknown, id: string, body: Record<string, unknown>): { kind: ServiceKind; id: string; active: boolean } {
  const kind = kindOf(kindInput);
  if (typeof body.active !== 'boolean') invalid('active', 'Use true or false.');
  if (!setCategoryActive(requireSiteById(siteId).id, kind, id, body.active)) throw new ApiError('not_found', 'No such category.');
  return { kind, id, active: body.active };
}
