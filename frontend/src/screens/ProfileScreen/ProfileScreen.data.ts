import { flags } from '../../config/flags';
import type { IconSet } from '../../types/icons.types';

/**
 * Mock content for the profile screen, shaped like a future API response so
 * wiring it to a backend replaces this module rather than the screen.
 */

export interface ProfileMenuItem {
  id: string;
  title: string;
  iconSet: IconSet;
  iconName: string;
  /** The screen the row opens; the sample rows have none yet. */
  route?: 'AccountSecurity' | 'EmsDevices' | 'HelpSupport';
}

const sampleProfileMenu: readonly ProfileMenuItem[] = [
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

/** The store build lists only rows that open a real screen (flags.sampleContent). */
export const profileMenu: readonly ProfileMenuItem[] = flags.sampleContent
  ? sampleProfileMenu
  : [
      { id: 'account', title: 'Account & Security', iconSet: 'ionicons', iconName: 'shield-checkmark-outline', route: 'AccountSecurity' },
      { id: 'devices', title: 'My Devices', iconSet: 'material', iconName: 'devices', route: 'EmsDevices' },
      { id: 'help', title: 'Help & Support', iconSet: 'ionicons', iconName: 'headset-outline', route: 'HelpSupport' },
    ];

/**
 * Payload behind the resident's gate-access QR. Static mock: a real one would
 * be short-lived and issued by the backend.
 */
// Written out in full so the bundler drops the sample code from the store build, which never shows it.
export const accessPassPayload = process.env.EXPO_PUBLIC_STORE_MODE === '1' ? '' : 'PARKLANE:RESIDENT:A-302:AHMED-HASSAN';

export const profileCopy = {
  title: 'Profile',
  passCaption: 'Show this at the gate',
} as const;
