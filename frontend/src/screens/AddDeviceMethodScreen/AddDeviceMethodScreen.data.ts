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

/**
 * Brands whose devices the building's Home Assistant can link through the
 * maker's cloud (backend/src/ha/integrations.ts), for the cloud fallback.
 */
export const cloudIntegrations: Record<string, readonly string[]> = {
  lg: ['lg_thinq', 'webostv'],
  samsung: ['smartthings'],
  sonoff: ['sonoff'],
  tuya: ['tuya'],
};
