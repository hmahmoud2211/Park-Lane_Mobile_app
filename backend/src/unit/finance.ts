import { randomUUID } from 'node:crypto';

import type {
  Charge,
  ChargeKind,
  ChargeStatus,
  ContractView,
  FinanceSummary,
  MeterKind,
  MeterSummary,
  Payment,
  PaymentMethod,
  UnitDetailsView,
  UnitDocumentView,
  UnitOverview,
} from '../../../shared/contracts/unitFinance.ts';
import { addDays, clinicDate } from '../clinic/time.ts';
import type { User } from '../ems/auth.ts';
import { transaction } from '../ems/db.ts';
import { notify } from '../ems/notifications.ts';
import { requireSite, requireSiteById, requireUnit as requireResidentUnit, yearlyReference, type Site } from '../ems/sites.ts';
import { ApiError } from '../errors.ts';
import { signedUrl } from '../health/files.ts';
import { sealedFolder } from '../lib/sealedFiles.ts';
import { trimmedText } from '../lib/text.ts';
import {
  deleteDocument,
  findCharge,
  findDocument,
  insertCharge,
  insertContract,
  insertDocument,
  insertPayment,
  listCharges,
  listContracts,
  listDocuments,
  listMeterReadings,
  listPayments,
  upsertMeterReading,
  voidCharge,
  type ChargeRow,
  type DocumentRow,
  type MeterRow,
} from '../repositories/unitFinance.ts';
import { findUnit, findUnitDetails, findUnitOfUser, listMembers, memberIdsOfUnit, memberRole, updateUnitDetails, type UnitDetails } from '../repositories/units.ts';

/**
 * My Unit and Bills: what building management records about a unit (details, contract, charges, payments,
 * meters, documents) and what its residents see. Every figure the app shows is worked out here from those records,
 * so a balance and a count of remaining installments can never disagree. Owners see the money; members see the rest.
 */

export const documentsFolder = sealedFolder('units', 'files');

const CONTRACT_KINDS: ChargeKind[] = ['down_payment', 'installment'];
const CHARGE_KINDS: readonly ChargeKind[] = ['down_payment', 'installment', 'service_charge', 'electricity', 'water', 'gas', 'other'];
const PAYMENT_METHODS: readonly PaymentMethod[] = ['cash', 'bank_transfer', 'cheque', 'card_at_office'];
const METERS: readonly MeterKind[] = ['electricity', 'water', 'gas'];
const METER_UNITS: Record<MeterKind, 'kWh' | 'm³'> = { electricity: 'kWh', water: 'm³', gas: 'm³' };
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;
/** 10 MB, like Health Passport's pages. */
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
const MAX_AMOUNT = 10_000_000_000_00; // EGP 10 billion, in piastres

function invalid(field: string, message: string): never {
  throw new ApiError('invalid', message, field);
}

const day = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || !ISO_DAY.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) invalid(field, 'Use a date as YYYY-MM-DD.');
  return value as string;
};
const optionalDay = (value: unknown, field: string) => (value === undefined || value === null || value === '' ? null : day(value, field));
const amount = (value: unknown, field: string): number => {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0 || value > MAX_AMOUNT) invalid(field, 'Give the amount in piastres, a whole number above 0.');
  return value as number;
};

const todayIn = (site: Site, nowMs = Date.now()) => clinicDate(nowMs, site.timezone);

function chargeStatus(row: ChargeRow, today: string): ChargeStatus {
  if (row.status === 'void') return 'void';
  if (row.paid >= row.amount) return 'paid';
  if (row.paid > 0) return row.due_on < today ? 'overdue' : 'partial';
  return row.due_on < today ? 'overdue' : 'due';
}

const presentCharge = (row: ChargeRow, today: string): Charge => ({
  id: row.id,
  kind: row.kind as ChargeKind,
  title: row.title,
  period: row.period,
  dueOn: row.due_on,
  amount: row.amount,
  paid: Math.min(row.paid, row.amount),
  outstanding: row.status === 'void' ? 0 : Math.max(row.amount - row.paid, 0),
  status: chargeStatus(row, today),
  reference: row.reference,
});

function presentDetails(unitId: string, site: Site, role: 'owner' | 'member'): UnitDetailsView {
  const unit = findUnit(unitId);
  const details = findUnitDetails(unitId);
  if (!unit || !details) throw new ApiError('not_found', 'No such unit.');
  return { unitId, name: unit.name, building: unit.building, siteName: site.name, ...details, myRole: role };
}

/** The owners' figures, from the unit's records. */
export function financeOf(unitId: string, site: Site, nowMs = Date.now()): FinanceSummary {
  const today = todayIn(site, nowMs);
  const charges = listCharges(unitId).map((row) => ({ row, view: presentCharge(row, today) }));
  const contractRow = listContracts(unitId).at(-1) ?? null;
  let contract: ContractView | null = null;
  if (contractRow) {
    const paid = charges
      .filter(({ row }) => row.contract_id === contractRow.id && CONTRACT_KINDS.includes(row.kind as ChargeKind))
      .reduce((sum, { view }) => sum + view.paid, 0);
    contract = {
      id: contractRow.id,
      kind: contractRow.kind,
      price: contractRow.price,
      signedOn: contractRow.signed_on,
      handoverOn: contractRow.handover_on,
      paid,
      remaining: Math.max(contractRow.price - paid, 0),
      paidRatio: contractRow.price > 0 ? Math.min(paid / contractRow.price, 1) : 0,
    };
  }
  const openInstallments = charges
    .filter(({ view }) => CONTRACT_KINDS.includes(view.kind) && view.status !== 'void' && view.outstanding > 0)
    .map(({ view }) => view);
  const year = Number(today.slice(0, 4));
  const service = charges.filter(({ view }) => view.kind === 'service_charge' && view.status !== 'void' && view.dueOn.startsWith(`${year}-`)).map(({ view }) => view);
  const nextService = service.filter((charge) => charge.outstanding > 0).sort((a, b) => a.dueOn.localeCompare(b.dueOn))[0];
  return {
    currency: 'EGP',
    contract,
    nextInstallment: openInstallments.sort((a, b) => a.dueOn.localeCompare(b.dueOn))[0] ?? null,
    remainingInstallments: openInstallments.filter((charge) => charge.kind === 'installment').length,
    serviceCharges: {
      year,
      total: service.reduce((sum, charge) => sum + charge.amount, 0),
      paid: service.reduce((sum, charge) => sum + charge.paid, 0),
      outstanding: service.reduce((sum, charge) => sum + charge.outstanding, 0),
      nextDueOn: nextService?.dueOn ?? null,
    },
  };
}

function metersOf(unitId: string): MeterSummary[] {
  const rows = listMeterReadings(unitId, 72);
  return METERS.map((meter) => {
    const [current, previous] = rows.filter((row) => row.meter === meter);
    const view = (row: MeterRow | undefined) => (row ? { meter, period: row.period, value: row.value, readOn: row.read_on, source: row.source } : null);
    const changePercent = current && previous && previous.value > 0 ? Math.round(((current.value - previous.value) / previous.value) * 1000) / 10 : null;
    return { meter, unit: METER_UNITS[meter], current: view(current), previous: view(previous), changePercent };
  });
}

const documentPath = (id: string) => `/api/unit/documents/${id}/file`;

function presentDocument(row: DocumentRow, base: string): UnitDocumentView {
  return { id: row.id, kind: row.kind, title: row.title, mime: row.mime, size: row.size, createdAt: row.created_at, url: signedUrl(base, documentPath(row.id)) };
}

/** One call for the My Unit screen. */
export function unitOverview(user: User, base: string): UnitOverview {
  const site = requireSite(user);
  const unitId = userUnitId(user);
  const role = memberRole(user.id) ?? 'member';
  return {
    details: presentDetails(unitId, site, role),
    finance: role === 'owner' ? financeOf(unitId, site) : null,
    meters: metersOf(unitId),
    documents: listDocuments(unitId).map((row) => presentDocument(row, base)),
  };
}

/** The resident's unit id, or 404 `no_home`. */
const userUnitId = (user: User): string => requireResidentUnit(user).id;

function requireOwner(user: User): { unitId: string; site: Site } {
  const site = requireSite(user);
  if (memberRole(user.id) !== 'owner') throw new ApiError('forbidden', 'Only the apartment\'s owner can see its payments.');
  return { unitId: userUnitId(user), site };
}

/** `group`: bills (service and utility charges), installments (the contract), or all. */
export function unitCharges(user: User, group: string | null): Charge[] {
  const { unitId, site } = requireOwner(user);
  const today = todayIn(site);
  const kinds: readonly ChargeKind[] =
    group === 'bills' ? ['service_charge', 'electricity', 'water', 'gas', 'other'] : group === 'installments' ? CONTRACT_KINDS : CHARGE_KINDS;
  return listCharges(unitId)
    .filter((row) => kinds.includes(row.kind as ChargeKind))
    .map((row) => presentCharge(row, today))
    .sort((a, b) => b.dueOn.localeCompare(a.dueOn));
}

export function unitPayments(user: User): Payment[] {
  const { unitId } = requireOwner(user);
  return listPayments(unitId).map((row) => ({
    id: row.id,
    chargeId: row.charge_id,
    chargeTitle: row.charge_title,
    amount: row.amount,
    paidOn: row.paid_on,
    method: row.method as PaymentMethod,
    receiptNo: row.receipt_no,
  }));
}

export function unitMeterHistory(user: User, months: number) {
  const unitId = userUnitId(user);
  return listMeterReadings(unitId, Math.min(Math.max(months, 1), 36) * METERS.length).map((row) => ({
    meter: row.meter,
    period: row.period,
    value: row.value,
    readOn: row.read_on,
    source: row.source,
  }));
}

/** A document's bytes, for a member of its unit or a valid signed link (checked by the route). */
export function documentFile(id: string): { row: DocumentRow; bytes: Buffer } | null {
  const row = findDocument(id);
  const bytes = row ? documentsFolder.read(row.file) : null;
  return row && bytes ? { row, bytes } : null;
}

export function memberMayOpenDocument(user: User, id: string): boolean {
  const row = findDocument(id);
  return Boolean(row && findUnitOfUser(user.id)?.id === row.unit_id);
}

// ---- building management ---------------------------------------------------------------------------------

function requireUnit(unitId: string) {
  const unit = findUnit(unitId);
  if (!unit) throw new ApiError('not_found', 'No such unit.');
  return { unit, site: requireSiteById(unit.siteId ?? 'park-lane') };
}

const ownersOf = (unitId: string) => listMembers(unitId).filter((member) => member.role === 'owner').map((member) => member.userId);

const optionalText = (value: unknown, max: number) => {
  const text = trimmedText(value);
  return text ? text.slice(0, max) : null;
};
const optionalInt = (value: unknown, field: string, min: number, max: number) => {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) invalid(field, `Use a whole number from ${min} to ${max}.`);
  return value as number;
};

export function setUnitDetails(unitId: string, body: Record<string, unknown>): UnitDetails {
  requireUnit(unitId);
  const area = body.areaM2;
  if (area !== undefined && area !== null && area !== '' && (typeof area !== 'number' || area <= 0 || area > 100_000)) invalid('areaM2', 'Give the area in square metres.');
  const details: UnitDetails = {
    tower: optionalText(body.tower, 40),
    floor: optionalInt(body.floor, 'floor', -10, 200),
    number: optionalText(body.number, 20),
    unitType: optionalText(body.unitType, 40),
    bedrooms: optionalInt(body.bedrooms, 'bedrooms', 0, 50),
    bathrooms: optionalInt(body.bathrooms, 'bathrooms', 0, 50),
    areaM2: area === undefined || area === null || area === '' ? null : (area as number),
    parkingBay: optionalText(body.parkingBay, 20),
    handoverStatus: optionalText(body.handoverStatus, 40),
  };
  updateUnitDetails(unitId, details);
  return details;
}

export function adminFinance(unitId: string, base: string) {
  const { site } = requireUnit(unitId);
  const today = todayIn(site);
  return {
    details: findUnitDetails(unitId),
    contracts: listContracts(unitId),
    charges: listCharges(unitId).map((row) => presentCharge(row, today)),
    payments: listPayments(unitId),
    meters: listMeterReadings(unitId, 36),
    documents: listDocuments(unitId).map((row) => presentDocument(row, base)),
    summary: financeOf(unitId, site),
  };
}

function monthsLater(isoDay: string, months: number): string {
  const [year, month, dayOfMonth] = isoDay.split('-').map(Number);
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  return `${target.getUTCFullYear()}-${String(target.getUTCMonth() + 1).padStart(2, '0')}-${String(Math.min(dayOfMonth, lastDay)).padStart(2, '0')}`;
}

/**
 * A contract, and its payment schedule when one is given: an optional down payment, then `installments` equal
 * installments every `everyMonths` from `firstDueOn` (the last takes the rounding remainder). Notifies the owners.
 */
export function addContract(unitId: string, body: Record<string, unknown>, nowMs = Date.now()) {
  const { site } = requireUnit(unitId);
  const kind = body.kind === 'lease' ? 'lease' : body.kind === 'sale' ? 'sale' : invalid('kind', 'Choose sale or lease.');
  const price = amount(body.price, 'price');
  const at = new Date(nowMs).toISOString();
  const contractId = randomUUID();
  const schedule = (body.schedule ?? null) as Record<string, unknown> | null;
  const charges: Omit<ChargeRow, 'paid'>[] = [];
  if (schedule) {
    const down = schedule.downPayment === undefined || schedule.downPayment === null ? 0 : amount(schedule.downPayment, 'schedule.downPayment');
    const count = optionalInt(schedule.installments, 'schedule.installments', 0, 600) ?? 0;
    const every = optionalInt(schedule.everyMonths, 'schedule.everyMonths', 1, 24) ?? 1;
    if (down > price) invalid('schedule.downPayment', 'The down payment is more than the price.');
    if (down === price && count > 0) invalid('schedule.installments', 'Nothing is left for installments.');
    if (down < price && count === 0) invalid('schedule.installments', 'Give the number of installments for the rest of the price.');
    const charge = (chargeKind: ChargeKind, title: string, dueOn: string, value: number) =>
      charges.push({
        id: randomUUID(), unit_id: unitId, contract_id: contractId, kind: chargeKind, title, period: null, due_on: dueOn, amount: value,
        status: 'due', reference: yearlyReference(site, 'charge', 'INV', nowMs), created_at: at, updated_at: at,
      });
    if (down > 0) charge('down_payment', 'Down payment', day(schedule.downPaymentDueOn ?? schedule.firstDueOn, 'schedule.downPaymentDueOn'), down);
    if (count > 0) {
      const first = day(schedule.firstDueOn, 'schedule.firstDueOn');
      // Whole pounds per installment, as payment plans are written; the last one takes the remainder.
      const each = Math.floor((price - down) / count / 100) * 100;
      for (let index = 0; index < count; index += 1) {
        const value = index === count - 1 ? price - down - each * (count - 1) : each;
        charge('installment', `Installment ${index + 1} of ${count}`, monthsLater(first, index * every), value);
      }
    }
  }
  transaction(() => {
    insertContract({ id: contractId, unit_id: unitId, kind, price, signed_on: optionalDay(body.signedOn, 'signedOn'), handover_on: optionalDay(body.handoverOn, 'handoverOn'), created_at: at, updated_at: at });
    for (const row of charges) insertCharge(row);
  });
  notify(ownersOf(unitId), { kind: 'bills', title: 'Your payment schedule is in the app', body: `${charges.length} payments added by building management.` });
  return { contractId, charges: charges.length };
}

export function addCharge(unitId: string, body: Record<string, unknown>, nowMs = Date.now()): Charge {
  const { site } = requireUnit(unitId);
  const kind = typeof body.kind === 'string' && (CHARGE_KINDS as readonly string[]).includes(body.kind) ? (body.kind as ChargeKind) : invalid('kind', 'Unknown kind of charge.');
  const title = optionalText(body.title, 80) ?? invalid('title', 'Give the charge a title.');
  const period = body.period === undefined || body.period === null || body.period === '' ? null : typeof body.period === 'string' && PERIOD.test(body.period) ? body.period : invalid('period', 'Use a month as YYYY-MM.');
  const at = new Date(nowMs).toISOString();
  const row = {
    id: randomUUID(), unit_id: unitId, contract_id: null, kind, title, period, due_on: day(body.dueOn, 'dueOn'), amount: amount(body.amount, 'amount'),
    status: 'due' as const, reference: yearlyReference(site, 'charge', 'INV', nowMs), created_at: at, updated_at: at,
  };
  insertCharge(row);
  notify(ownersOf(unitId), { kind: 'bills', title: `New bill: ${title}`, body: `Due ${row.due_on}.`, ref: { type: 'charge', id: row.id } });
  return presentCharge({ ...row, paid: 0 }, todayIn(site, nowMs));
}

export function cancelCharge(chargeId: string): { voided: boolean } {
  const row = findCharge(chargeId);
  if (!row) throw new ApiError('not_found', 'No such charge.');
  if (row.paid > 0) throw new ApiError('conflict', 'A charge with payments against it cannot be cancelled.');
  return { voided: voidCharge(chargeId, new Date().toISOString()) };
}

/** A payment management received; the server issues its receipt number. Notifies the owners. */
export function recordPayment(unitId: string, body: Record<string, unknown>, recordedBy: User | null, nowMs = Date.now()): Payment {
  const { site } = requireUnit(unitId);
  const value = amount(body.amount, 'amount');
  const method = typeof body.method === 'string' && (PAYMENT_METHODS as readonly string[]).includes(body.method) ? (body.method as PaymentMethod) : invalid('method', 'Unknown payment method.');
  const paidOn = day(body.paidOn, 'paidOn');
  if (paidOn > addDays(todayIn(site, nowMs), 1)) invalid('paidOn', 'A payment can\'t be in the future.');
  let chargeId: string | null = null;
  let chargeTitle: string | null = null;
  if (body.chargeId !== undefined && body.chargeId !== null && body.chargeId !== '') {
    const charge = typeof body.chargeId === 'string' ? findCharge(body.chargeId) : undefined;
    if (!charge || charge.unit_id !== unitId) invalid('chargeId', 'That charge is not this unit\'s.');
    if (charge.status === 'void') invalid('chargeId', 'That charge was cancelled.');
    if (value > charge.amount - charge.paid) invalid('amount', 'That is more than what is left to pay on this charge.');
    chargeId = charge.id;
    chargeTitle = charge.title;
  }
  const at = new Date(nowMs).toISOString();
  const row = {
    id: randomUUID(), unit_id: unitId, charge_id: chargeId, amount: value, paid_on: paidOn, method,
    receipt_no: yearlyReference(site, 'receipt', 'RCP', nowMs), note: optionalText(body.note, 200), recorded_by: recordedBy?.id ?? null, created_at: at,
  };
  insertPayment(row);
  notify(ownersOf(unitId), { kind: 'bills', title: 'Payment received', body: `Receipt ${row.receipt_no}${chargeTitle ? ` for ${chargeTitle}` : ''}.`, ref: { type: 'payment', id: row.id } });
  return { id: row.id, chargeId, chargeTitle, amount: value, paidOn, method, receiptNo: row.receipt_no };
}

/** `{ readings: [{ meter, period, value, readOn? }] }`, e.g. from a spreadsheet; each replaces that month's reading. */
export function saveMeterReadings(unitId: string, body: Record<string, unknown>, nowMs = Date.now()): { saved: number } {
  const { site } = requireUnit(unitId);
  const readings = Array.isArray(body.readings) ? body.readings : invalid('readings', 'Send { readings: [...] }.');
  if (readings.length === 0 || readings.length > 240) invalid('readings', 'Send 1 to 240 readings.');
  const rows: MeterRow[] = readings.map((entry, index) => {
    const raw = (entry ?? {}) as Record<string, unknown>;
    const meter = typeof raw.meter === 'string' && (METERS as readonly string[]).includes(raw.meter) ? (raw.meter as MeterKind) : invalid(`readings.${index}.meter`, 'Use electricity, water or gas.');
    const period = typeof raw.period === 'string' && PERIOD.test(raw.period) ? raw.period : invalid(`readings.${index}.period`, 'Use a month as YYYY-MM.');
    if (typeof raw.value !== 'number' || !Number.isFinite(raw.value) || raw.value < 0 || raw.value > 10_000_000) invalid(`readings.${index}.value`, 'Give the reading as a number.');
    return { unit_id: unitId, meter, period, value: raw.value as number, read_on: optionalDay(raw.readOn, `readings.${index}.readOn`) ?? todayIn(site, nowMs), source: 'manual' };
  });
  transaction(() => rows.forEach(upsertMeterReading));
  return { saved: rows.length };
}

/** The file's real type, from its first bytes; the declared type must agree. */
function sniffMime(bytes: Buffer): 'application/pdf' | 'image/png' | 'image/jpeg' | null {
  if (bytes.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  return null;
}

export function addDocument(unitId: string, input: { kind: unknown; title: unknown; bytes: Buffer }, uploadedBy: User | null, base: string): UnitDocumentView {
  requireUnit(unitId);
  const kind = input.kind === 'floor_plan' || input.kind === 'contract_scan' || input.kind === 'other' ? input.kind : invalid('kind', 'Use floor_plan, contract_scan or other.');
  const title = optionalText(input.title, 80) ?? invalid('title', 'Give the document a title.');
  if (input.bytes.length === 0) invalid('file', 'The file is empty.');
  const mime = sniffMime(input.bytes) ?? invalid('file', 'Upload a PDF, PNG or JPEG file.');
  const row: DocumentRow = {
    id: randomUUID(), unit_id: unitId, kind, title, file: documentsFolder.store(input.bytes), mime, size: input.bytes.length,
    uploaded_by: uploadedBy?.id ?? null, created_at: new Date().toISOString(),
  };
  insertDocument(row);
  return presentDocument(row, base);
}

export function removeDocument(documentId: string): { removed: boolean } {
  const row = deleteDocument(documentId);
  if (row) documentsFolder.remove([row.file]);
  return { removed: Boolean(row) };
}

export const unitMemberIds = memberIdsOfUnit;
