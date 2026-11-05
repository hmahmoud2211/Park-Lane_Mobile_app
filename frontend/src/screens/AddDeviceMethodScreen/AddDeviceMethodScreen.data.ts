import type { MethodGroup } from '../../types/gateway.types';

/** Copy for choosing how to connect a device of the chosen brand. */
export const addDeviceMethodCopy = {
  title: 'Connect a device',
  fallbackTitle: 'Connect a device',
  missingBrand: 'This brand is not offered by your gateway.',
  back: 'Back to brands',
  notes: 'Good to know',
  cloudTitle: 'Manufacturer account (cloud)',
  cloudBody: 'Links your account with the maker through the building’s smart home hub. Control then goes through the maker’s cloud, not your Wi-Fi.',
  cloudAction: (name: string) => `Link ${name} account`,
  cloudNotEnabled: (name: string) => `${name}: not available yet`,
  cloudSignIn: 'Sign in to link your account',
  cloudSignInBody: 'Linking uses your EMS account, so the devices stay with your unit.',
  cloudNoHub: 'Your EMS account needs a unit with a ready smart home hub first. My Devices shows where it is.',
  cloudLoadFailed: 'The brands the building offers could not be loaded. Try again in a moment.',
  unavailable: 'Not available',
  loadFailed: 'The brand could not be loaded.',
  retry: 'Try again',
  offline: 'Your gateway is not reachable right now.',
} as const;

export const groupCopy: Record<MethodGroup, { title: string; intro: string; icon: string }> = {
  existing: {
    title: 'Find existing device',
    intro: 'For a device already connected to your home Wi-Fi.',
    icon: 'search-outline',
  },
  new: {
    title: 'Connect new device',
    intro: 'For a new or reset device that still needs your Wi-Fi.',
    icon: 'add-circle-outline',
  },
  advanced: {
    title: 'Advanced connection',
    intro: 'Special setups for some models: a known address, local credentials, or the gateway’s own Wi-Fi.',
    icon: 'construct-outline',
  },
};
