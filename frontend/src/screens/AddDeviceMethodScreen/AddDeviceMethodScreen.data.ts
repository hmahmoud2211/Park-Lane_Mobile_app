import type { MethodGroup } from '../../types/gateway.types';

/** Copy for choosing how to connect a device of the chosen brand. */
export const addDeviceMethodCopy = {
  title: 'Connect a device',
  fallbackTitle: 'Connect a device',
  routeTitle: 'How do you want to connect?',
  routeIntro: 'You can pair the device yourself, or use the account you already have with the maker.',
  routePairTitle: 'Pair it from the start',
  routePairBody: 'Connect the device directly, without the maker’s app wherever it allows that. Control stays with CUBE.',
  routeAccountTitle: (brand: string) => `Use my ${brand} app account`,
  routeAccountBody: 'Sign in with your account from the maker’s app. Your devices appear here, and control goes through the maker’s cloud.',
  missingBrand: 'This brand is not offered by your gateway.',
  back: 'Back to brands',
  notes: 'Good to know',
  cloudTitle: 'Manufacturer account (cloud)',
  cloudBody: 'Links your account with the maker through the building’s system. Control then goes through the maker’s cloud, not your Wi-Fi.',
  cloudAction: (name: string) => `Link ${name} account`,
  cloudNotEnabled: (name: string) => `${name}: not available yet`,
  cloudSignIn: 'Sign in to link your account',
  cloudSignInBody: 'Linking uses your Parklane account, so the devices stay with your unit.',
  cloudNoHub: 'This works once your apartment is set up in the building’s system. My Devices shows how far it is.',
  cloudLoadFailed: 'The brands the building offers could not be loaded.',
  unavailable: 'Not available',
  loadFailed: 'The brand could not be loaded.',
  retry: 'Try again',
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
