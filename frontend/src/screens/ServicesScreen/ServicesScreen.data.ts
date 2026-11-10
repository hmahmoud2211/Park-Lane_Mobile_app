import { flags } from '../../config/flags';
import type { IconSet } from '../../types/icons.types';
import type { ImageKey } from '../../constants/images';

/**
 * Content for the Services screen. Wording matches the Figma reference
 * (assets/Screens/screen12.png) exactly, line breaks included.
 */

export const servicesCopy = {
  title: 'Services',
  subtitle: 'Everyday services, made easier.',
} as const;

export interface ServiceItem {
  id: string;
  title: string;
  description: string;
  /** The illustration in the row's tile. */
  icon: ImageKey;
  /** Drawn instead of `icon` for services that have no illustration yet. */
  glyph?: { set: IconSet; name: string };
  /**
   * Drawn on the "Under Development" placeholder the row opens until its
   * screen is designed; that page takes a vector icon.
   */
  iconSet: IconSet;
  iconName: string;
  /** Screen the row opens; rows without one open the placeholder. */
  route?: ServiceRoute;
}

/** The screens a row can open; kept to these few so navigate() checks each one. */
export type ServiceRoute = 'Clinic' | 'HealthPassport' | 'HelpSupport' | 'Bills' | 'Deliveries' | 'Housekeeping' | 'MovingRequest';

const allServices: readonly ServiceItem[] = [
  {
    id: 'housekeeping',
    title: 'Housekeeping',
    description: 'Book cleaning services for your unit,\nchoose date and time.',
    icon: 'serviceHousekeeping',
    iconSet: 'material',
    iconName: 'spray-bottle',
    route: 'Housekeeping',
  },
  {
    id: 'bills',
    title: 'Bills & Utilities',
    description: 'View and pay your electricity,\nwater and gas bills.',
    icon: 'serviceBills',
    iconSet: 'material',
    iconName: 'file-document-outline',
    route: 'Bills',
  },
  {
    id: 'deliveries',
    title: 'Deliveries',
    description: 'Track your deliveries and\nmanage incoming packages.',
    icon: 'serviceDeliveries',
    iconSet: 'material',
    iconName: 'package-variant-closed',
    route: 'Deliveries',
  },
  {
    id: 'moving',
    title: 'Moving Request',
    description: 'Schedule a move-in or move-out\nrequest with management.',
    icon: 'serviceMoving',
    iconSet: 'material',
    iconName: 'dolly',
    route: 'MovingRequest',
  },
  {
    // Not in the Figma reference; added with the same row. No illustration
    // exists for it yet, so the tile draws a glyph.
    id: 'clinic',
    title: 'Clinical Appointment',
    description: 'Book a doctor at the Park Lane clinic,\nand see your visits.',
    icon: 'serviceHealth',
    glyph: { set: 'ionicons', name: 'calendar-number-outline' },
    iconSet: 'ionicons',
    iconName: 'calendar-number-outline',
    route: 'Clinic',
  },
  {
    // Not in the Figma reference; added after it with the same row.
    id: 'health-passport',
    title: 'Health Passport',
    description: 'Your family’s medical records,\nand a summary for your doctor.',
    icon: 'serviceHealth',
    iconSet: 'ionicons',
    iconName: 'medkit-outline',
    route: 'HealthPassport',
  },
  {
    id: 'support',
    title: 'Help & Support',
    description: 'Get assistance, contact management\nor explore FAQs.',
    icon: 'serviceSupport',
    iconSet: 'material',
    iconName: 'headset',
    route: 'HelpSupport',
  },
];

/**
 * The rows on screen. A row with no screen yet opens the "coming soon" placeholder, which the
 * store build leaves out (flags.sampleContent): there, only services that really work are listed.
 */
export const services: readonly ServiceItem[] = flags.sampleContent ? allServices : allServices.filter((item) => item.route);
