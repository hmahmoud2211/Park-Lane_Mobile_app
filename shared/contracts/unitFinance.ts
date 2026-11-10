/**
 * My Unit and Bills: GET /api/unit/overview, /api/unit/charges, /api/unit/payments, /api/unit/meters.
 * Money is integer piastres (EGP × 100); the app formats it. Dates are YYYY-MM-DD in the compound's time zone.
 * Finance (contract, charges, payments) is for the unit's owners; members see details, meters and documents.
 */

export type ChargeKind = 'down_payment' | 'installment' | 'service_charge' | 'electricity' | 'water' | 'gas' | 'other';
/** `overdue` is a due charge past its date; `void` was cancelled by management. */
export type ChargeStatus = 'paid' | 'partial' | 'due' | 'overdue' | 'void';
export type PaymentMethod = 'cash' | 'bank_transfer' | 'cheque' | 'card_at_office';
export type MeterKind = 'electricity' | 'water' | 'gas';

export interface UnitDetailsView {
  unitId: string;
  name: string;
  building: string | null;
  siteName: string;
  tower: string | null;
  floor: number | null;
  number: string | null;
  unitType: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  areaM2: number | null;
  parkingBay: string | null;
  handoverStatus: string | null;
  myRole: 'owner' | 'member';
}

export interface Charge {
  id: string;
  kind: ChargeKind;
  title: string;
  period: string | null;
  dueOn: string;
  amount: number;
  paid: number;
  outstanding: number;
  status: ChargeStatus;
  reference: string;
}

export interface Payment {
  id: string;
  chargeId: string | null;
  chargeTitle: string | null;
  amount: number;
  paidOn: string;
  method: PaymentMethod;
  receiptNo: string;
}

export interface ContractView {
  id: string;
  kind: 'sale' | 'lease';
  price: number;
  signedOn: string | null;
  handoverOn: string | null;
  paid: number;
  remaining: number;
  /** 0 to 1. */
  paidRatio: number;
}

export interface FinanceSummary {
  currency: 'EGP';
  contract: ContractView | null;
  nextInstallment: Charge | null;
  /** Counted from the charges themselves, so it always agrees with the balance. */
  remainingInstallments: number;
  serviceCharges: { year: number; total: number; paid: number; outstanding: number; nextDueOn: string | null };
}

export interface MeterReadingView {
  meter: MeterKind;
  period: string;
  value: number;
  readOn: string;
  source: 'manual' | 'live';
}

export interface MeterSummary {
  meter: MeterKind;
  unit: 'kWh' | 'm³';
  current: MeterReadingView | null;
  previous: MeterReadingView | null;
  /** Current against previous, in percent; null without both. */
  changePercent: number | null;
}

export interface UnitDocumentView {
  id: string;
  kind: 'floor_plan' | 'contract_scan' | 'other';
  title: string;
  mime: string;
  size: number;
  createdAt: string;
  /** Opens the file for two hours without a session. */
  url: string;
}

export interface UnitOverview {
  details: UnitDetailsView;
  /** Null for members: only owners see the unit's finance. */
  finance: FinanceSummary | null;
  meters: MeterSummary[];
  documents: UnitDocumentView[];
}
