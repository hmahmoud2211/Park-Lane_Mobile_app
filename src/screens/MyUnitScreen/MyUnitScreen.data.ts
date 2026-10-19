import type { StatItemData } from '../../components/ui/StatItem';
import type { IconSet } from '../../components/ui/ServiceTile';
import { unit } from '../HomeScreen/HomeScreen.data';

/**
 * Mock content for the My Unit screen, shaped like a future API response so
 * wiring it to a backend replaces this module rather than the screen. Wording
 * matches the Figma reference (assets/Screens/screen4.png) exactly.
 */

export interface SectionMeta {
  title: string;
  iconSet: IconSet;
  iconName: string;
}

/** The unit documents the screen can generate (see MyUnitScreen.documents.ts). */
export type DocumentId = 'contract' | 'receipts' | 'floor-plan';

export interface DocumentItem {
  id: DocumentId;
  title: string;
  subtitle: string;
  iconSet: IconSet;
  iconName: string;
}

export const myUnitCopy = {
  title: 'My Unit',
  /** Not in the design: the documents' menu, and the tile while its PDF is made. */
  viewDocument: 'View',
  downloadDocument: 'Download',
  preparingDocument: 'Preparing…',
  documentFailedTitle: "Couldn't create the document",
  documentFailedBody: 'Please try again in a moment.',
} as const;

export const unitHero = {
  // Shared with the home screen's card, so the two never disagree.
  title: unit.title,
  meta: '3 Bedrooms • Tower A • Floor 3',
  stats: [
    { id: 'area', label: 'Area', value: '186 m²', iconSet: 'material', iconName: 'crop-free' },
    {
      id: 'bathrooms',
      label: 'Bathrooms',
      value: '2',
      valueFirst: true,
      iconSet: 'material',
      iconName: 'bathtub-outline',
    },
    {
      id: 'parking',
      label: 'Parking Slot',
      value: '1',
      valueFirst: true,
      iconSet: 'ionicons',
      iconName: 'car-outline',
    },
    {
      id: 'ownership',
      label: 'Ownership',
      value: 'Verified',
      iconSet: 'ionicons',
      iconName: 'shield-checkmark-outline',
    },
  ],
} as const satisfies { title: string; meta: string; stats: readonly StatItemData[] };

export const sections = {
  overview: { title: 'Unit Overview', iconSet: 'material', iconName: 'file-document-outline' },
  financial: { title: 'Financial Status', iconSet: 'ionicons', iconName: 'card-outline' },
  maintenance: { title: 'Maintenance Fees', iconSet: 'ionicons', iconName: 'construct-outline' },
  utilities: { title: 'Utility Consumption', iconSet: 'ionicons', iconName: 'bar-chart-outline' },
  documents: { title: 'Documents', iconSet: 'ionicons', iconName: 'document-text-outline' },
} as const satisfies Record<string, SectionMeta>;

/** Three columns, read top to bottom. */
export const overviewColumns: readonly (readonly StatItemData[])[] = [
  [
    { id: 'building', label: 'Building', value: 'Tower A', iconSet: 'ionicons', iconName: 'business-outline' },
    { id: 'unit-type', label: 'Unit Type', value: 'Apartment', iconSet: 'ionicons', iconName: 'home-outline' },
    { id: 'parking', label: 'Parking', value: 'P1-27', iconSet: 'ionicons', iconName: 'car-outline' },
  ],
  [
    { id: 'floor', label: 'Floor', value: '3', iconSet: 'ionicons', iconName: 'layers-outline' },
    { id: 'bathrooms', label: 'Bathrooms', value: '2', iconSet: 'material', iconName: 'toilet' },
  ],
  [
    { id: 'bedrooms', label: 'Bedrooms', value: '3', iconSet: 'ionicons', iconName: 'bed-outline' },
    {
      id: 'handover',
      label: 'Handover Status',
      value: 'Active',
      status: 'success',
      iconSet: 'ionicons',
      iconName: 'document-text-outline',
    },
  ],
];

export const financial = {
  summary: [
    { id: 'price', label: 'Unit Price', value: 'EGP 8,500,000' },
    { id: 'paid', label: 'Amount Paid', value: 'EGP 5,525,000' },
    { id: 'remaining', label: 'Remaining Balance', value: 'EGP 2,975,000' },
  ],
  /** Share of the unit price paid so far. */
  paidRatio: 0.65,
  paidLabel: '65% Paid',
  schedule: [
    {
      id: 'next-installment',
      label: 'Next Installment',
      value: 'EGP 145,000',
      iconSet: 'ionicons',
      iconName: 'calendar-outline',
    },
    {
      id: 'due-date',
      label: 'Due Date',
      value: '05 Oct 2026',
      iconSet: 'ionicons',
      iconName: 'calendar-outline',
    },
    {
      id: 'remaining-installments',
      label: 'Remaining Installments',
      value: '18',
      iconSet: 'ionicons',
      iconName: 'list-outline',
    },
  ],
} as const satisfies {
  summary: readonly StatItemData[];
  paidRatio: number;
  paidLabel: string;
  schedule: readonly StatItemData[];
};

export const maintenanceFees: readonly StatItemData[] = [
  { id: 'annual', label: 'Annual Fee', value: 'EGP 18,000' },
  { id: 'paid', label: 'Paid', value: 'EGP 9,000' },
  { id: 'outstanding', label: 'Outstanding', value: 'EGP 9,000' },
  {
    id: 'next-due',
    label: 'Next Due',
    value: '15 Oct 2026',
    iconSet: 'ionicons',
    iconName: 'calendar-outline',
  },
];

/** Falling consumption is good news, so a drop is the positive tone. */
export const utilities: readonly StatItemData[] = [
  {
    id: 'electricity',
    label: 'Electricity',
    value: '428 kWh',
    caption: 'This Month',
    iconSet: 'ionicons',
    iconName: 'flash-outline',
    trend: { direction: 'down', change: '12%', comparison: 'vs. last month', tone: 'positive' },
  },
  {
    id: 'water',
    label: 'Water',
    value: '31 m³',
    caption: 'This Month',
    iconSet: 'ionicons',
    iconName: 'water-outline',
    trend: { direction: 'up', change: '5%', comparison: 'vs. last month', tone: 'negative' },
  },
  {
    id: 'gas',
    label: 'Gas',
    value: '54 m³',
    caption: 'This Month',
    iconSet: 'ionicons',
    iconName: 'flame-outline',
    trend: { direction: 'down', change: '8%', comparison: 'vs. last month', tone: 'positive' },
  },
];

export const documents: readonly DocumentItem[] = [
  {
    id: 'contract',
    title: 'Contract',
    subtitle: 'View & download',
    iconSet: 'ionicons',
    iconName: 'document-text-outline',
  },
  {
    id: 'receipts',
    title: 'Receipts',
    subtitle: 'View & download',
    iconSet: 'ionicons',
    iconName: 'receipt-outline',
  },
  {
    id: 'floor-plan',
    title: 'Floor Plan',
    subtitle: 'View & download',
    iconSet: 'material',
    iconName: 'floor-plan',
  },
];

export interface PaymentRecord {
  /** Receipt number. */
  id: string;
  /** "DD Mon YYYY", as the rest of the screen writes dates. */
  date: string;
  description: string;
  /** EGP. */
  amount: number;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
const DOWN_PAYMENT = 1_175_000;
const INSTALLMENT = 145_000;
/** Monthly installments paid so far, on the 5th from Apr 2024 to Sep 2026. */
const INSTALLMENTS_PAID = 30;

/**
 * Payments received, for the Receipts document: a down payment, then monthly
 * installments up to the one before "Next Installment" (05 Oct 2026). They
 * total `financial`'s Amount Paid, EGP 5,525,000.
 */
export const paymentHistory: readonly PaymentRecord[] = [
  { id: 'RCP-2024-0001', date: '05 Mar 2024', description: 'Down payment', amount: DOWN_PAYMENT },
  ...Array.from({ length: INSTALLMENTS_PAID }, (_, index): PaymentRecord => {
    const month = (3 + index) % 12;
    const year = 2024 + Math.floor((3 + index) / 12);
    return {
      id: `RCP-${year}-${String(index + 2).padStart(4, '0')}`,
      date: `05 ${MONTHS[month]} ${year}`,
      description: `Installment ${index + 1}`,
      amount: INSTALLMENT,
    };
  }),
];
