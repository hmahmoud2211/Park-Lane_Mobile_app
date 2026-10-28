import type { IconSet } from '../../components/ui/ServiceTile';
import type { ImageKey } from '../../constants/images';
import type { ParamlessRoute } from '../../types/navigation.types';

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
  /**
   * Drawn on the "Under Development" placeholder the row opens until its
   * screen is designed; that page takes a vector icon.
   */
  iconSet: IconSet;
  iconName: string;
  /** Screen the row opens; rows without one open the placeholder. */
  route?: ParamlessRoute;
}

export const services: readonly ServiceItem[] = [
  {
    id: 'housekeeping',
    title: 'Housekeeping',
    description: 'Book cleaning services for your unit,\nchoose date and time.',
    icon: 'serviceHousekeeping',
    iconSet: 'material',
    iconName: 'spray-bottle',
  },
  {
    id: 'bills',
    title: 'Bills & Utilities',
    description: 'View and pay your electricity,\nwater and gas bills.',
    icon: 'serviceBills',
    iconSet: 'material',
    iconName: 'file-document-outline',
  },
  {
    id: 'deliveries',
    title: 'Deliveries',
    description: 'Track your deliveries and\nmanage incoming packages.',
    icon: 'serviceDeliveries',
    iconSet: 'material',
    iconName: 'package-variant-closed',
  },
  {
    id: 'moving',
    title: 'Moving Request',
    description: 'Schedule a move-in or move-out\nrequest with management.',
    icon: 'serviceMoving',
    iconSet: 'material',
    iconName: 'dolly',
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
  },
];
