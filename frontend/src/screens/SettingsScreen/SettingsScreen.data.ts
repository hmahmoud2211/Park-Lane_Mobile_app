import { flags } from '../../config/flags';
import type { IconSet } from '../../types/icons.types';

/**
 * Content for the Settings screen. Wording matches the Figma reference
 * (assets/Screens/screen13.png) exactly.
 */

export const settingsCopy = {
  title: 'Settings',
  subtitle: 'Manage your account and preferences.',
} as const;

/** The screens a row can open; kept to these few so navigate() checks each one. */
export type SettingsRoute = 'Profile' | 'EmsDevices' | 'AccountSecurity' | 'HelpSupport';

export interface SettingsItem {
  id: string;
  title: string;
  description: string;
  iconSet: IconSet;
  iconName: string;
  /** Screen the row opens. */
  route?: SettingsRoute;
  /** Signs the resident out, or opens the privacy policy, instead of opening a screen. */
  action?: 'logout' | 'privacy';
  // Rows with neither open the "Under Development" placeholder until their
  // screen is designed; the store build leaves those rows out (flags.sampleContent).
}

const allSettingsItems: readonly SettingsItem[] = [
  {
    id: 'profile',
    title: 'Profile',
    description: 'View and edit your personal information.',
    iconSet: 'ionicons',
    iconName: 'person-outline',
    route: 'Profile',
  },
  {
    id: 'devices',
    title: 'My Devices',
    description: 'Rename and switch your smart home devices.',
    iconSet: 'material',
    iconName: 'devices',
    route: 'EmsDevices',
  },
  {
    id: 'notifications',
    title: 'Notifications',
    description: 'Manage your notification preferences.',
    iconSet: 'ionicons',
    iconName: 'notifications-outline',
  },
  {
    id: 'security',
    title: 'Account & security',
    description: 'Change your password, sign out other phones or delete your account.',
    iconSet: 'ionicons',
    iconName: 'shield-checkmark-outline',
    route: 'AccountSecurity',
  },
  {
    id: 'language',
    title: 'Language',
    description: 'Choose your preferred language.',
    iconSet: 'ionicons',
    iconName: 'globe-outline',
  },
  {
    id: 'appearance',
    title: 'Appearance',
    description: 'Adjust app theme and display settings.',
    iconSet: 'ionicons',
    iconName: 'sunny-outline',
  },
  {
    id: 'app-preferences',
    title: 'App Preferences',
    description: 'Customize your app experience.',
    iconSet: 'ionicons',
    iconName: 'options-outline',
  },
  {
    id: 'help',
    title: 'Help & Support',
    description: 'Contact building management and get help.',
    iconSet: 'ionicons',
    iconName: 'headset-outline',
    route: 'HelpSupport',
  },
  {
    id: 'privacy',
    title: 'Privacy Policy',
    description: 'What we collect, who receives it and how to delete it.',
    iconSet: 'ionicons',
    iconName: 'document-lock-outline',
    action: 'privacy',
  },
  {
    id: 'logout',
    title: 'Log Out',
    description: 'Sign out from your account.',
    iconSet: 'ionicons',
    iconName: 'log-out-outline',
    action: 'logout',
  },
];

/** The rows on screen: a row with no screen yet is a placeholder, which the store build leaves out. */
export const settingsItems: readonly SettingsItem[] = flags.sampleContent
  ? allSettingsItems
  : allSettingsItems.filter((item) => item.route || item.action);
