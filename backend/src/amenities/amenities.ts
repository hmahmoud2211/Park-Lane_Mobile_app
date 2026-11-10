import { randomUUID } from 'node:crypto';

import type { AmenityBookingView, AmenityCategory, AmenityOptions, AmenitySlot, AmenityView, NewAmenityBooking } from '../../../shared/contracts/amenities.ts';
import { addDays, clinicDate, clinicInstant, clinicTime } from '../clinic/time.ts';
import type { User } from '../ems/auth.ts';
import { publishToSite } from '../ems/broadcast.ts';
import { transaction } from '../ems/db.ts';
import { notify } from '../ems/notifications.ts';
import { requireSite, requireSiteById, requireUnit, runningReference, siteSettings } from '../ems/sites.ts';
import { ApiError } from '../errors.ts';
import { pictureOf } from '../lib/pictures.ts';
import {
  bookedPeople,
  cancelBookingRow,
  findAmenity,
  findBooking,
  insertBooking,
  listAmenities,
  listAmenityBookings,
  listUnitBookings,
  saveAmenity,
  unitSlotStarts,
  type AmenityRow,
  type BookingRow,
} from '../repositories/amenities.ts';
import { memberIdsOfUnit } from '../repositories/units.ts';

/**
 * Amenity bookings. Building management keeps the catalogue (hours, slot length, capacity, whether one apartment
 * takes the whole slot); residents book a slot for some people, from today to the compound's booking window.
 * Two guards stop double booking: places are counted inside one transaction, and the database refuses a second
 * booking of an exclusive slot, or a second booking of the same slot by one apartment, whatever the code does.
 */

const CATEGORIES: readonly AmenityCategory[] = ['sports', 'leisure', 'family'];
const SLOT_LENGTHS = [30, 60, 90, 120];
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function invalid(field: string, message: string): never {
  throw new ApiError('invalid', message, field);
}

const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const hhmm = (total: number) => `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;

function presentAmenity(row: AmenityRow): AmenityView {
  return {
    id: row.id,
    title: row.title,
    location: row.location,
    opens: row.opens,
    closes: row.closes,
    slotMinutes: row.slot_minutes,
    capacity: row.capacity,
    maxPeople: Math.min(row.max_people, row.capacity),
    exclusive: row.exclusive === 1,
    categories: JSON.parse(row.categories) as AmenityCategory[],
    picture: row.picture,
    cancelCutoffHours: row.cancel_cutoff_hours,
    active: row.active === 1,
  };
}

function presentBooking(row: BookingRow & { amenity_title?: string }, user: User | null, timezone: string, cutoffHours: number, nowMs: number): AmenityBookingView {
  const start = Date.parse(row.starts_at);
  return {
    id: row.id,
    reference: row.reference,
    amenityId: row.amenity_id,
    amenityTitle: row.amenity_title ?? findAmenity(row.amenity_id)?.title ?? '—',
    date: clinicDate(start, timezone),
    start: clinicTime(start, timezone),
    end: clinicTime(Date.parse(row.ends_at), timezone),
    startsAt: row.starts_at,
    people: row.people,
    status: row.status,
    cancellable: row.status === 'booked' && start - cutoffHours * 3600_000 > nowMs,
    bookedByMe: user !== null && row.user_id === user.id,
  };
}

/** The slot starts across a day's opening hours. */
function slotStarts(amenity: AmenityRow): number[] {
  const starts: number[] = [];
  for (let start = minutes(amenity.opens); start + amenity.slot_minutes <= minutes(amenity.closes); start += amenity.slot_minutes) starts.push(start);
  return starts;
}

function bookingWindow(site: { id: string; timezone: string }, nowMs: number) {
  const today = clinicDate(nowMs, site.timezone);
  return { firstDate: today, lastDate: addDays(today, siteSettings(site.id).amenities.windowDays - 1) };
}

function siteAmenity(user: User, amenityId: string) {
  const unit = requireUnit(user);
  const site = requireSite(user);
  const amenity = findAmenity(amenityId);
  if (!amenity || amenity.site_id !== site.id || amenity.active !== 1) throw new ApiError('not_found', 'No such amenity.');
  return { unit, site, amenity };
}

const dayBounds = (date: string, timezone: string) => ({
  from: new Date(clinicInstant(date, '00:00', timezone)).toISOString(),
  to: new Date(clinicInstant(addDays(date, 1), '00:00', timezone)).toISOString(),
});

// ---- residents ----------------------------------------------------------------------------------------

export function amenityOptions(user: User, nowMs = Date.now()): AmenityOptions {
  requireUnit(user);
  const site = requireSite(user);
  return { amenities: listAmenities(site.id).map(presentAmenity), ...bookingWindow(site, nowMs), timezone: site.timezone };
}

export function amenitySlots(user: User, amenityId: string, dateInput: unknown, nowMs = Date.now()): AmenitySlot[] {
  const { unit, site, amenity } = siteAmenity(user, amenityId);
  const window = bookingWindow(site, nowMs);
  const date = typeof dateInput === 'string' && DATE.test(dateInput) ? dateInput : invalid('date', 'Give the day as YYYY-MM-DD.');
  if (date < window.firstDate || date > window.lastDate) invalid('date', `Choose a day from ${window.firstDate} to ${window.lastDate}.`);
  const { from, to } = dayBounds(date, site.timezone);
  const taken = bookedPeople(amenity.id, from, to);
  const mine = unitSlotStarts(amenity.id, unit.id, from, to);
  return slotStarts(amenity).map((start) => {
    const startsAt = new Date(clinicInstant(date, hhmm(start), site.timezone)).toISOString();
    const people = taken.get(startsAt) ?? 0;
    return {
      start: hhmm(start),
      end: hhmm(start + amenity.slot_minutes),
      left: amenity.exclusive === 1 ? (people > 0 ? 0 : 1) : Math.max(0, amenity.capacity - people),
      mine: mine.has(startsAt),
      past: Date.parse(startsAt) <= nowMs,
    };
  });
}

export function bookAmenity(user: User, amenityId: string, body: Partial<NewAmenityBooking> & Record<string, unknown>, nowMs = Date.now()): AmenityBookingView {
  const { unit, site, amenity } = siteAmenity(user, amenityId);
  const window = bookingWindow(site, nowMs);
  const date = typeof body.date === 'string' && DATE.test(body.date) ? body.date : invalid('date', 'Choose a day.');
  if (date < window.firstDate || date > window.lastDate) invalid('date', `Choose a day from ${window.firstDate} to ${window.lastDate}.`);
  const start = typeof body.start === 'string' && HHMM.test(body.start) ? minutes(body.start) : invalid('start', 'Choose a time.');
  if (!slotStarts(amenity).includes(start)) invalid('start', 'Choose one of the listed times.');
  const startMs = clinicInstant(date, hhmm(start), site.timezone);
  if (startMs <= nowMs) invalid('start', 'That time has passed.');
  const maxPeople = Math.min(amenity.max_people, amenity.capacity);
  if (typeof body.people !== 'number' || !Number.isInteger(body.people) || body.people < 1 || body.people > maxPeople) invalid('people', `Choose 1 to ${maxPeople} people.`);
  const people = body.people as number;
  const at = new Date(nowMs).toISOString();
  const row: BookingRow = {
    id: randomUUID(),
    amenity_id: amenity.id,
    unit_id: unit.id,
    user_id: user.id,
    starts_at: new Date(startMs).toISOString(),
    ends_at: new Date(startMs + amenity.slot_minutes * 60_000).toISOString(),
    people,
    exclusive: amenity.exclusive,
    status: 'booked',
    reference: '',
    created_at: at,
    updated_at: at,
    cancelled_at: null,
  };
  try {
    transaction(() => {
      if (amenity.exclusive !== 1) {
        const taken = bookedPeople(amenity.id, row.starts_at, row.ends_at).get(row.starts_at) ?? 0;
        if (taken + people > amenity.capacity) {
          const left = Math.max(0, amenity.capacity - taken);
          throw new ApiError('slot_taken', left === 0 ? 'That time is full.' : `Only ${left} place${left === 1 ? '' : 's'} left at that time.`);
        }
      }
      row.reference = runningReference(site.id, 'amenity_booking', 'BK');
      insertBooking(row);
    });
  } catch (error) {
    const message = (error as Error).message ?? '';
    if (message.includes('UNIQUE constraint failed')) {
      throw new ApiError('slot_taken', message.includes('unit_id') ? 'Your apartment already booked that time.' : 'Someone else booked that time.');
    }
    throw error;
  }
  const others = memberIdsOfUnit(unit.id).filter((id) => id !== user.id);
  notify(others, { kind: 'bookings', title: `${amenity.title} booked`, body: `${date}, ${hhmm(start)}–${hhmm(start + amenity.slot_minutes)} · ${people} ${people === 1 ? 'person' : 'people'}`, ref: { type: 'amenity_booking', id: row.id } }, at);
  publishToSite(site.id, { type: 'amenity.updated', amenityId: amenity.id });
  return presentBooking({ ...row, amenity_title: amenity.title }, user, site.timezone, amenity.cancel_cutoff_hours, nowMs);
}

/** The apartment's bookings from the last week on. */
export function unitBookings(user: User, nowMs = Date.now()): AmenityBookingView[] {
  const unit = requireUnit(user);
  const site = requireSite(user);
  const cutoffs = new Map(listAmenities(site.id, true).map((amenity) => [amenity.id, amenity.cancel_cutoff_hours]));
  return listUnitBookings(unit.id, new Date(nowMs - 7 * 86_400_000).toISOString()).map((row) =>
    presentBooking(row, user, site.timezone, cutoffs.get(row.amenity_id) ?? 0, nowMs),
  );
}

/** Anyone in the apartment may cancel its booking, until the amenity's cut-off before the start. */
export function cancelBooking(user: User, bookingId: string, nowMs = Date.now()): AmenityBookingView {
  const unit = requireUnit(user);
  const site = requireSite(user);
  const row = findBooking(bookingId);
  if (!row || row.unit_id !== unit.id) throw new ApiError('not_found', 'No such booking.');
  const amenity = findAmenity(row.amenity_id) as AmenityRow;
  if (Date.parse(row.starts_at) - amenity.cancel_cutoff_hours * 3600_000 <= nowMs) {
    throw new ApiError('invalid_transition', `Bookings can be cancelled up to ${amenity.cancel_cutoff_hours} hours before.`);
  }
  if (!cancelBookingRow(row.id, new Date(nowMs).toISOString())) throw new ApiError('invalid_transition', 'This booking was already cancelled.');
  publishToSite(site.id, { type: 'amenity.updated', amenityId: amenity.id });
  return presentBooking({ ...(findBooking(row.id) as BookingRow), amenity_title: amenity.title }, user, site.timezone, amenity.cancel_cutoff_hours, nowMs);
}

// ---- building management ------------------------------------------------------------------------------

export const adminAmenities = (siteId: string): AmenityView[] => listAmenities(requireSiteById(siteId).id, true).map(presentAmenity);

function amenityFields(body: Record<string, unknown>, siteId: string) {
  const title = typeof body.title === 'string' && body.title.trim().length >= 2 && body.title.trim().length <= 60 ? body.title.trim() : invalid('title', 'Title: 2 to 60 characters.');
  const location = typeof body.location === 'string' && body.location.trim().length >= 2 && body.location.trim().length <= 80 ? body.location.trim() : invalid('location', 'Location: 2 to 80 characters.');
  const opens = typeof body.opens === 'string' && HHMM.test(body.opens) ? body.opens : invalid('opens', 'Use a time as HH:MM.');
  const closes = typeof body.closes === 'string' && HHMM.test(body.closes) ? body.closes : invalid('closes', 'Use a time as HH:MM.');
  const slot = body.slotMinutes === undefined ? 60 : SLOT_LENGTHS.includes(body.slotMinutes as number) ? (body.slotMinutes as number) : invalid('slotMinutes', `Use ${SLOT_LENGTHS.join(', ')} minutes.`);
  if (minutes(closes) - minutes(opens) < slot) invalid('closes', 'The amenity must be open for at least one slot.');
  const integer = (value: unknown, field: string, min: number, max: number) =>
    typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max ? value : invalid(field, `Use a whole number from ${min} to ${max}.`);
  const capacity = integer(body.capacity, 'capacity', 1, 500);
  const maxPeople = body.maxPeople === undefined ? Math.min(siteSettings(siteId).amenities.maxGuests, capacity) : integer(body.maxPeople, 'maxPeople', 1, 50);
  if (!Array.isArray(body.categories) || body.categories.length === 0 || !body.categories.every((category) => CATEGORIES.includes(category as AmenityCategory))) {
    invalid('categories', 'Choose one or more of sports, leisure and family.');
  }
  return {
    title,
    location,
    opens,
    closes,
    slot_minutes: slot,
    capacity,
    max_people: maxPeople,
    exclusive: body.exclusive === true ? 1 : 0,
    categories: JSON.stringify([...new Set(body.categories as AmenityCategory[])]),
    picture: pictureOf(body.picture, 'picture'),
    cancel_cutoff_hours: body.cancelCutoffHours === undefined ? 2 : integer(body.cancelCutoffHours, 'cancelCutoffHours', 0, 72),
    active: body.active === false ? 0 : 1,
    sort: body.sort === undefined ? 0 : integer(body.sort, 'sort', 0, 1000),
  };
}

export function createAmenity(siteId: string, body: Record<string, unknown>, nowMs = Date.now()): AmenityView {
  const site = requireSiteById(siteId);
  const at = new Date(nowMs).toISOString();
  const row: AmenityRow = { id: randomUUID(), site_id: site.id, ...amenityFields(body, site.id), created_at: at, updated_at: at };
  saveAmenity(row);
  publishToSite(site.id, { type: 'amenity.updated', amenityId: row.id });
  return presentAmenity(row);
}

/** Changes the catalogue entry. Bookings already made keep their times; switching it off stops new ones. */
export function editAmenity(id: string, body: Record<string, unknown>, nowMs = Date.now()): AmenityView {
  const current = findAmenity(id);
  if (!current) throw new ApiError('not_found', 'No such amenity.');
  const merged = { ...presentAmenity(current), maxPeople: current.max_people, sort: current.sort, ...body };
  const row: AmenityRow = { ...current, ...amenityFields(merged, current.site_id), updated_at: new Date(nowMs).toISOString() };
  saveAmenity(row);
  publishToSite(row.site_id, { type: 'amenity.updated', amenityId: row.id });
  return presentAmenity(row);
}

export function amenityDay(amenityId: string, dateInput: unknown, nowMs = Date.now()) {
  const amenity = findAmenity(amenityId);
  if (!amenity) throw new ApiError('not_found', 'No such amenity.');
  const site = requireSiteById(amenity.site_id);
  const date = typeof dateInput === 'string' && DATE.test(dateInput) ? dateInput : clinicDate(nowMs, site.timezone);
  const { from, to } = dayBounds(date, site.timezone);
  return {
    date,
    bookings: listAmenityBookings(amenity.id, from, to).map((row) => ({ ...presentBooking({ ...row, amenity_title: amenity.title }, null, site.timezone, 0, nowMs), unitName: row.unit_name })),
  };
}

export function staffCancelBooking(bookingId: string, body: Record<string, unknown>, nowMs = Date.now()): AmenityBookingView {
  const row = findBooking(bookingId);
  if (!row) throw new ApiError('not_found', 'No such booking.');
  const amenity = findAmenity(row.amenity_id) as AmenityRow;
  const site = requireSiteById(amenity.site_id);
  const note = typeof body.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 300) : invalid('note', 'Tell the residents why.');
  const at = new Date(nowMs).toISOString();
  if (!cancelBookingRow(row.id, at)) throw new ApiError('invalid_transition', 'This booking was already cancelled.');
  const view = presentBooking({ ...(findBooking(row.id) as BookingRow), amenity_title: amenity.title }, null, site.timezone, 0, nowMs);
  notify(memberIdsOfUnit(row.unit_id), { kind: 'bookings', title: `${amenity.title} on ${view.date} at ${view.start} was cancelled`, body: note, ref: { type: 'amenity_booking', id: row.id } }, at);
  publishToSite(site.id, { type: 'amenity.updated', amenityId: amenity.id });
  return view;
}
