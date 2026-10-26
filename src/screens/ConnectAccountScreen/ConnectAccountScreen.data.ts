import type { LinkMethod } from '../../types/home.types';

/** Copy for linking a brand account, which is how residents connect their devices. */
export const connectCopy = {
  title: 'Connect Devices',
  subtitle: 'Link the app your devices already use.',
  accountIntro: 'Sign in to your EMS account to connect your devices.',
  brandsTitle: 'Choose a brand',
  brandsIntro:
    'Your devices keep working with their own app. Linking the account brings them into Parklane, ready to control from anywhere.',
  notAvailable: 'Not available yet',
  loadFailed: 'The brands could not be loaded.',
  retry: 'Try again',
  continue: 'Continue',
  cancel: 'Cancel',
  done: 'Done',
  startOver: 'Start over',
  signIn: (brand: string) => `Sign in with ${brand}`,
  externalIntro: (brand: string) => `${brand} opens its own sign-in page. Come back here when it is done.`,
  working: 'Working on it…',
  linkedTitle: 'Account linked',
  linkedBody: 'Its devices are being added to your home. They appear in My Devices in a moment.',
  failedTitle: 'Could not link the account',
  required: 'Required',
  notANumber: 'Enter a number',
  qrHint: 'Scan this code with the brand’s app on another phone or tablet, then tap Continue.',
  noHomeTitle: 'Not linked to a unit yet',
  provisioningTitle: 'Setting up your smart home',
} as const;

export const methodLabels: Record<LinkMethod, { label: string; icon: 'log-in-outline' | 'qr-code-outline' | 'key-outline' }> = {
  oauth: { label: 'Sign in', icon: 'log-in-outline' },
  qr: { label: 'QR code', icon: 'qr-code-outline' },
  credentials: { label: 'Account details', icon: 'key-outline' },
};
