import { randomUUID } from 'node:crypto';

import type { Parcel, StaffParcel } from '../../../shared/contracts/parcels.ts';
import type { User } from '../ems/auth.ts';
import { publishToUnit } from '../ems/broadcast.ts';
import { notify } from '../ems/notifications.ts';
import { requireSiteById, requireUnit, yearlyReference } from '../ems/sites.ts';
import { ApiError } from '../errors.ts';
import { trimmedText } from '../lib/text.ts';
import { closeParcel, findParcel, insertParcel, listUnitParcels, listWaitingParcels, type ParcelRow } from '../repositories/parcels.ts';
import { findUnit, listUnits, memberIdsOfUnit } from '../repositories/units.ts';

/**
 * Parcels. Gate or lobby staff log what arrives for a unit; its residents are told at once and see what waits for
 * them; staff mark each one collected (or returned to the courier).
 */

const present = (row: ParcelRow): Parcel => ({
  id: row.id,
  reference: row.reference,
  carrier: row.carrier,
  description: row.description,
  status: row.status,
  receivedAt: row.received_at,
  closedAt: row.closed_at,
});

/** The resident's unit's parcels: everything waiting, and the last 30 days. */
export function unitParcels(user: User, nowMs = Date.now()): Parcel[] {
  const unit = requireUnit(user);
  return listUnitParcels(unit.id, new Date(nowMs - 30 * 86_400_000).toISOString()).map(present);
}

const optionalText = (value: unknown, max: number) => {
  const text = trimmedText(value);
  return text ? text.slice(0, max) : null;
};

export function logParcel(staff: User | null, body: Record<string, unknown>, nowMs = Date.now()): StaffParcel {
  const unit = typeof body.unitId === 'string' ? findUnit(body.unitId) : null;
  if (!unit) throw new ApiError('invalid', 'Choose the apartment the parcel is for.', 'unitId');
  const site = requireSiteById(unit.siteId ?? 'park-lane');
  const row: ParcelRow = {
    id: randomUUID(),
    unit_id: unit.id,
    reference: yearlyReference(site, 'parcel', 'PCL', nowMs),
    carrier: optionalText(body.carrier, 40),
    description: optionalText(body.description, 120),
    status: 'waiting',
    received_at: new Date(nowMs).toISOString(),
    received_by: staff?.id ?? null,
    closed_at: null,
    closed_by: null,
  };
  insertParcel(row);
  publishToUnit(unit.id, { type: 'parcel.updated', parcelId: row.id });
  notify(memberIdsOfUnit(unit.id), {
    kind: 'parcels',
    title: 'A parcel is waiting for you',
    body: [row.carrier, row.description].filter(Boolean).join(' · ') || `Reference ${row.reference}.`,
    ref: { type: 'parcel', id: row.id },
  });
  return { ...present(row), unitId: unit.id, unitName: unit.name };
}

export function closeParcelAs(staff: User | null, parcelId: string, status: 'collected' | 'returned', nowMs = Date.now()): Parcel {
  const row = findParcel(parcelId);
  if (!row) throw new ApiError('not_found', 'No such parcel.');
  if (!closeParcel(row.id, status, new Date(nowMs).toISOString(), staff?.id ?? null)) {
    throw new ApiError('invalid_transition', 'This parcel was already handed over.');
  }
  publishToUnit(row.unit_id, { type: 'parcel.updated', parcelId: row.id });
  return present(findParcel(row.id) as ParcelRow);
}

export function waitingParcels(siteId: string): StaffParcel[] {
  return listWaitingParcels(siteId).map((row) => ({ ...present(row), unitId: row.unit_id, unitName: row.unit_name }));
}

/** The apartments gate staff can choose from: names only, no residents. */
export function siteUnitsForStaff(siteId: string): { id: string; name: string }[] {
  return listUnits()
    .filter((unit) => (unit.siteId ?? 'park-lane') === siteId)
    .map((unit) => ({ id: unit.id, name: unit.name }));
}
