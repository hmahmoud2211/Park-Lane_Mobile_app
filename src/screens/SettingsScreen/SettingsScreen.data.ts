import type { IconSet } from '../../components/ui/ServiceTile';
import type { ParamlessRoute } from '../../types/navigation.types';

/**
 * Content for the Settings screen. Wording matches the Figma reference
 * (assets/Screens/screen13.png) exactly.
 */

export const settingsCopy = {
  title: 'Settings',
  subtitle: 'Manage your account and preferences.',
} as const;

export interface SettingsItem {
  id: string;
  title: string;
  description: string;
  iconSet: IconSet;
  iconName: string;
  /** Screen the row opens. */
  route?: ParamlessRoute;
  /** Signs the resident out instead of opening a screen. */
  action?: 'logout';
  // Rows with neither open the "Under Development" placeholder until their
  // screen is designed.
}

export const settingsItems: readonly SettingsItem[] = [
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
    title: 'Security',
    description: 'Update your password and security settings.',
    iconSet: 'ionicons',
    iconName: 'shield-checkmark-outline',
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
    description: 'Get assistance or explore FAQs.',
    iconSet: 'ionicons',
    iconName: 'headset-outline',
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
