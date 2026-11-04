import type { IconSet } from '../../components/ui/ServiceTile';

/**
 * Mock content for the profile screen, shaped like a future API response so
 * wiring it to a backend replaces this module rather than the screen.
 */

export interface ProfileMenuItem {
  id: string;
  title: string;
  iconSet: IconSet;
  iconName: string;
}

export const profileMenu: readonly ProfileMenuItem[] = [
  { id: 'my-profile', title: 'My Profile', iconSet: 'ionicons', iconName: 'person-outline' },
  {
    id: 'family',
    title: 'My Family Members & Tenants',
    iconSet: 'material',
    iconName: 'account-multiple-plus-outline',
  },
  { id: 'payments', title: 'My Payments', iconSet: 'ionicons', iconName: 'card-outline' },
  {
    id: 'visitor-invitation',
    title: 'Create Visitor Invitation',
    iconSet: 'ionicons',
    iconName: 'qr-code-outline',
  },
  {
    id: 'service-requests',
    title: 'My Home Service Requests',
    iconSet: 'ionicons',
    iconName: 'construct-outline',
  },
];

/**
 * Payload behind the resident's gate-access QR. Static mock: a real one would
 * be short-lived and issued by the backend.
 */
export const accessPassPayload = 'PARKLANE:RESIDENT:A-302:AHMED-HASSAN';

export const profileCopy = {
  title: 'Profile',
  passCaption: 'Show this at the gate',
} as const;
