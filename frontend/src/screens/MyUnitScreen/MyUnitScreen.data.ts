import type { StatItemData } from '../../components/ui/StatItem';
import type { IconSet } from '../../types/icons.types';
import type { FinanceSummary, MeterSummary, UnitDetailsView, UnitDocumentView, UnitOverview } from '../../../../shared/contracts/unitFinance';
import { day, egp, month } from '../../features/unitFinance/format';

/**
 * The My Unit screen's copy and how its cards read the unit's records (GET /api/unit/overview). Labels, icons and
 * wording match the Figma reference (assets/Screens/screen4.png); the figures come from building management's
 * records, worked out by the server, and read "—" where something isn't recorded yet.
 */

export interface SectionMeta {
  title: string;
  iconSet: IconSet;
  iconName: string;
}

/** A tile under Documents: a PDF the app makes from the records, or a file management uploaded. */
export interface DocumentItem {
  id: string;
  kind: 'contract' | 'receipts' | 'uploaded';
  title: string;
  subtitle: string;
  iconSet: IconSet;
  iconName: string;
  /** Uploaded files open from here. */
  url?: string;
}

export const myUnitCopy = {
  title: 'My Unit',
  /** Not in the design: the documents' menu, and the tile while its PDF is made. */
  viewDocument: 'View',
  downloadDocument: 'Download',
  preparingDocument: 'Preparing…',
  documentFailedTitle: "Couldn't create the document",
  documentFailedBody: 'Please try again in a moment.',
  loadFailed: 'Couldn’t load your unit',
  retry: 'Try again',
  noHomeTitle: 'Not linked to an apartment yet',
  noHomeBody: 'Ask building management to add your account to your apartment. Your unit’s details then appear here.',
  memberNote: 'Payments and the contract are shown to the apartment’s owner.',
  noDocuments: 'No documents yet. Building management adds them here.',
  notSet: '—',
} as const;

export const sections = {
  overview: { title: 'Unit Overview', iconSet: 'material', iconName: 'file-document-outline' },
  financial: { title: 'Financial Status', iconSet: 'ionicons', iconName: 'card-outline' },
  maintenance: { title: 'Maintenance Fees', iconSet: 'ionicons', iconName: 'construct-outline' },
  utilities: { title: 'Utility Consumption', iconSet: 'ionicons', iconName: 'bar-chart-outline' },
  documents: { title: 'Documents', iconSet: 'ionicons', iconName: 'document-text-outline' },
} as const satisfies Record<string, SectionMeta>;

const or = (value: string | number | null | undefined) => (value === null || value === undefined || value === '' ? myUnitCopy.notSet : String(value));

export function heroFrom(details: UnitDetailsView): { title: string; meta: string; stats: StatItemData[] } {
  const meta = [
    details.bedrooms !== null ? `${details.bedrooms} Bedrooms` : null,
    details.tower ? `Tower ${details.tower}` : details.building,
    details.floor !== null ? `Floor ${details.floor}` : null,
  ].filter(Boolean);
  return {
    title: details.name,
    meta: meta.length ? meta.join(' • ') : details.siteName,
    stats: [
      { id: 'area', label: 'Area', value: details.areaM2 !== null ? `${details.areaM2} m²` : myUnitCopy.notSet, iconSet: 'material', iconName: 'crop-free' },
      { id: 'bathrooms', label: 'Bathrooms', value: or(details.bathrooms), valueFirst: true, iconSet: 'material', iconName: 'bathtub-outline' },
      { id: 'parking', label: 'Parking Slot', value: details.parkingBay ? '1' : '0', valueFirst: true, iconSet: 'ionicons', iconName: 'car-outline' },
      { id: 'ownership', label: 'Ownership', value: details.myRole === 'owner' ? 'Owner' : 'Member', iconSet: 'ionicons', iconName: 'shield-checkmark-outline' },
    ],
  };
}

/** Three columns, read top to bottom. */
export function overviewColumnsFrom(details: UnitDetailsView): StatItemData[][] {
  const handedOver = details.handoverStatus ? /handed|active|delivered/i.test(details.handoverStatus) : false;
  return [
    [
      { id: 'building', label: 'Building', value: details.tower ? `Tower ${details.tower}` : or(details.building), iconSet: 'ionicons', iconName: 'business-outline' },
      { id: 'unit-type', label: 'Unit Type', value: or(details.unitType), iconSet: 'ionicons', iconName: 'home-outline' },
      { id: 'parking', label: 'Parking', value: or(details.parkingBay), iconSet: 'ionicons', iconName: 'car-outline' },
    ],
    [
      { id: 'floor', label: 'Floor', value: or(details.floor), iconSet: 'ionicons', iconName: 'layers-outline' },
      { id: 'bathrooms', label: 'Bathrooms', value: or(details.bathrooms), iconSet: 'material', iconName: 'toilet' },
    ],
    [
      { id: 'bedrooms', label: 'Bedrooms', value: or(details.bedrooms), iconSet: 'ionicons', iconName: 'bed-outline' },
      {
        id: 'handover',
        label: 'Handover Status',
        value: or(details.handoverStatus),
        status: handedOver ? 'success' : undefined,
        iconSet: 'ionicons',
        iconName: 'document-text-outline',
      },
    ],
  ];
}

/** Cards show whole pounds; the Bills screen and receipts show exact amounts. */
const WHOLE = { whole: true } as const;

export function financialFrom(finance: FinanceSummary) {
  const contract = finance.contract;
  const percent = contract ? Math.round(contract.paidRatio * 100) : 0;
  return {
    summary: [
      { id: 'price', label: 'Unit Price', value: contract ? egp(contract.price, WHOLE) : myUnitCopy.notSet },
      { id: 'paid', label: 'Amount Paid', value: contract ? egp(contract.paid, WHOLE) : myUnitCopy.notSet },
      { id: 'remaining', label: 'Remaining Balance', value: contract ? egp(contract.remaining, WHOLE) : myUnitCopy.notSet },
    ] satisfies StatItemData[],
    paidRatio: contract?.paidRatio ?? 0,
    paidLabel: contract ? `${percent}% Paid` : 'No contract recorded',
    schedule: [
      { id: 'next-installment', label: 'Next Installment', value: finance.nextInstallment ? egp(finance.nextInstallment.outstanding, WHOLE) : myUnitCopy.notSet, iconSet: 'ionicons', iconName: 'calendar-outline' },
      { id: 'due-date', label: 'Due Date', value: finance.nextInstallment ? day(finance.nextInstallment.dueOn) : myUnitCopy.notSet, iconSet: 'ionicons', iconName: 'calendar-outline' },
      { id: 'remaining-installments', label: 'Remaining Installments', value: String(finance.remainingInstallments), iconSet: 'ionicons', iconName: 'list-outline' },
    ] satisfies StatItemData[],
  };
}

export function maintenanceFeesFrom(finance: FinanceSummary): StatItemData[] {
  const fees = finance.serviceCharges;
  return [
    { id: 'annual', label: 'Annual Fee', value: egp(fees.total, WHOLE) },
    { id: 'paid', label: 'Paid', value: egp(fees.paid, WHOLE) },
    { id: 'outstanding', label: 'Outstanding', value: egp(fees.outstanding, WHOLE) },
    { id: 'next-due', label: 'Next Due', value: fees.nextDueOn ? day(fees.nextDueOn) : myUnitCopy.notSet, iconSet: 'ionicons', iconName: 'calendar-outline' },
  ];
}

const METER_LOOK = {
  electricity: { label: 'Electricity', iconName: 'flash-outline' },
  water: { label: 'Water', iconName: 'water-outline' },
  gas: { label: 'Gas', iconName: 'flame-outline' },
} as const;

/** Falling consumption is good news, so a drop is the positive tone. */
export function utilitiesFrom(meters: readonly MeterSummary[]): StatItemData[] {
  return meters.map((meter) => ({
    id: meter.meter,
    label: METER_LOOK[meter.meter].label,
    value: meter.current ? `${meter.current.value} ${meter.unit}` : myUnitCopy.notSet,
    caption: meter.current ? month(meter.current.period) : 'No reading yet',
    iconSet: 'ionicons' as const,
    iconName: METER_LOOK[meter.meter].iconName,
    trend:
      meter.changePercent === null
        ? undefined
        : {
            direction: meter.changePercent < 0 ? ('down' as const) : ('up' as const),
            change: `${Math.abs(meter.changePercent)}%`,
            comparison: 'vs. last month',
            tone: meter.changePercent <= 0 ? ('positive' as const) : ('negative' as const),
          },
  }));
}

const UPLOADED_LOOK: Record<UnitDocumentView['kind'], { iconSet: IconSet; iconName: string }> = {
  floor_plan: { iconSet: 'material', iconName: 'floor-plan' },
  contract_scan: { iconSet: 'ionicons', iconName: 'document-attach-outline' },
  other: { iconSet: 'ionicons', iconName: 'document-outline' },
};

/** Owners get the contract summary and receipts the app makes from the records; everyone gets uploaded files. */
export function documentTilesFrom(overview: UnitOverview): DocumentItem[] {
  const made: DocumentItem[] = overview.finance?.contract
    ? [
        { id: 'contract', kind: 'contract', title: 'Contract', subtitle: 'View & download', iconSet: 'ionicons', iconName: 'document-text-outline' },
        { id: 'receipts', kind: 'receipts', title: 'Receipts', subtitle: 'View & download', iconSet: 'ionicons', iconName: 'receipt-outline' },
      ]
    : [];
  const uploaded: DocumentItem[] = overview.documents.map((document) => ({
    id: document.id,
    kind: 'uploaded',
    title: document.title,
    subtitle: 'View',
    url: document.url,
    ...UPLOADED_LOOK[document.kind],
  }));
  return [...made, ...uploaded];
}
