import type { IconSet } from '../../components/ui/ServiceTile';
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
  /**
   * Drawn on the "Under Development" placeholder the row opens until its
   * screen is designed; that page takes a vector icon.
   */
  iconSet: IconSet;
  iconName: string;
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
    id: 'support',
    title: 'Help & Support',
    description: 'Get assistance, contact management\nor explore FAQs.',
    icon: 'serviceSupport',
    iconSet: 'material',
    iconName: 'headset',
  },
];
