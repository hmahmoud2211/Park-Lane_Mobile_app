import { db } from '../ems/db.ts';

/** The unit_contracts, unit_charges, unit_payments, meter_readings and unit_documents tables (migration 15). */

export interface ContractRow {
  id: string;
  unit_id: string;
  kind: 'sale' | 'lease';
  price: number;
  signed_on: string | null;
  handover_on: string | null;
  created_at: string;
  updated_at: string;
}

export interface ChargeRow {
  id: string;
  unit_id: string;
  contract_id: string | null;
  kind: string;
  title: string;
  period: string | null;
  due_on: string;
  amount: number;
  status: 'due' | 'void';
  reference: string;
  created_at: string;
  updated_at: string;
  /** Summed from unit_payments by the queries below. */
  paid: number;
}

export interface PaymentRow {
  id: string;
  unit_id: string;
  charge_id: string | null;
  charge_title: string | null;
  amount: number;
  paid_on: string;
  method: string;
  receipt_no: string;
  note: string | null;
  recorded_by: string | null;
  created_at: string;
}

export interface MeterRow {
  unit_id: string;
  meter: 'electricity' | 'water' | 'gas';
  period: string;
  value: number;
  read_on: string;
  source: 'manual' | 'live';
}

export interface DocumentRow {
  id: string;
  unit_id: string;
  kind: 'floor_plan' | 'contract_scan' | 'other';
  title: string;
  file: string;
  mime: string;
  size: number;
  uploaded_by: string | null;
  created_at: string;
}

// ---- contracts ----

export function insertContract(row: ContractRow): void {
  db()
    .prepare('INSERT INTO unit_contracts (id, unit_id, kind, price, signed_on, handover_on, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(row.id, row.unit_id, row.kind, row.price, row.signed_on, row.handover_on, row.created_at, row.updated_at);
}

export function listContracts(unitId: string): ContractRow[] {
  return db().prepare('SELECT * FROM unit_contracts WHERE unit_id = ? ORDER BY created_at').all(unitId) as unknown as ContractRow[];
}

// ---- charges ----

const CHARGE_SELECT = `SELECT unit_charges.*, COALESCE((SELECT SUM(amount) FROM unit_payments WHERE charge_id = unit_charges.id), 0) AS paid
  FROM unit_charges`;

export function insertCharge(row: Omit<ChargeRow, 'paid'>): void {
  db()
    .prepare(
      `INSERT INTO unit_charges (id, unit_id, contract_id, kind, title, period, due_on, amount, status, reference, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(row.id, row.unit_id, row.contract_id, row.kind, row.title, row.period, row.due_on, row.amount, row.status, row.reference, row.created_at, row.updated_at);
}

export function listCharges(unitId: string): ChargeRow[] {
  return db().prepare(`${CHARGE_SELECT} WHERE unit_id = ? ORDER BY due_on, created_at`).all(unitId) as unknown as ChargeRow[];
}

export function findCharge(id: string): ChargeRow | undefined {
  return db().prepare(`${CHARGE_SELECT} WHERE id = ?`).get(id) as ChargeRow | undefined;
}

export function voidCharge(id: string, at: string): boolean {
  return Number(db().prepare("UPDATE unit_charges SET status = 'void', updated_at = ? WHERE id = ? AND status = 'due'").run(at, id).changes) > 0;
}

// ---- payments ----

export function insertPayment(row: Omit<PaymentRow, 'charge_title'>): void {
  db()
    .prepare(
      `INSERT INTO unit_payments (id, unit_id, charge_id, amount, paid_on, method, receipt_no, note, recorded_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(row.id, row.unit_id, row.charge_id, row.amount, row.paid_on, row.method, row.receipt_no, row.note, row.recorded_by, row.created_at);
}

export function listPayments(unitId: string): PaymentRow[] {
  return db()
    .prepare(
      `SELECT unit_payments.*, unit_charges.title AS charge_title FROM unit_payments
       LEFT JOIN unit_charges ON unit_charges.id = unit_payments.charge_id
       WHERE unit_payments.unit_id = ? ORDER BY unit_payments.paid_on DESC, unit_payments.created_at DESC`,
    )
    .all(unitId) as unknown as PaymentRow[];
}

// ---- meters ----

export function upsertMeterReading(row: MeterRow): void {
  db()
    .prepare(
      `INSERT INTO meter_readings (unit_id, meter, period, value, read_on, source) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(unit_id, meter, period) DO UPDATE SET value = excluded.value, read_on = excluded.read_on, source = excluded.source`,
    )
    .run(row.unit_id, row.meter, row.period, row.value, row.read_on, row.source);
}

/** Newest first. */
export function listMeterReadings(unitId: string, limit: number): MeterRow[] {
  return db().prepare('SELECT * FROM meter_readings WHERE unit_id = ? ORDER BY period DESC LIMIT ?').all(unitId, limit) as unknown as MeterRow[];
}

// ---- documents ----

export function insertDocument(row: DocumentRow): void {
  db()
    .prepare('INSERT INTO unit_documents (id, unit_id, kind, title, file, mime, size, uploaded_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(row.id, row.unit_id, row.kind, row.title, row.file, row.mime, row.size, row.uploaded_by, row.created_at);
}

export function listDocuments(unitId: string): DocumentRow[] {
  return db().prepare('SELECT * FROM unit_documents WHERE unit_id = ? ORDER BY created_at DESC').all(unitId) as unknown as DocumentRow[];
}

export function findDocument(id: string): DocumentRow | undefined {
  return db().prepare('SELECT * FROM unit_documents WHERE id = ?').get(id) as DocumentRow | undefined;
}

export function deleteDocument(id: string): DocumentRow | undefined {
  const row = findDocument(id);
  if (row) db().prepare('DELETE FROM unit_documents WHERE id = ?').run(id);
  return row;
}
