import type { SmartDeviceType } from '../../types/ems.types';

/** Copy for My Devices: the devices registered in EMS, which the app and Alexa both control. */

export const devicesCopy = {
  title: 'My Devices',
  subtitle: 'Devices you and Alexa can switch.',
  accountIntro: 'Sign in to your EMS account to see and control your registered devices.',
  devicesTitle: 'Devices',
  add: 'Add',
  close: 'Close',
  empty: 'No devices yet. Add a virtual switch to try the app and Alexa, or pair a SONOFF Wi-Fi plug.',
  loadFailed: 'Your devices could not be loaded.',
  retry: 'Try again',
  addTitle: 'Add a device',
  virtualNote:
    'A virtual switch has no hardware behind it. It behaves like a real switch in the app and with Alexa, and is always labelled “Virtual”.',
  sonoffNote:
    'Pairs a SONOFF Wi-Fi plug from its setup hotspot, then registers it here once the backend can see and switch it on your network.',
  startPairing: 'Start pairing',
  addVirtual: 'Add virtual switch',
  name: 'Name',
  room: 'Room (optional)',
  rename: 'Edit',
  remove: 'Remove',
  confirmRemove: 'Tap again to remove',
  save: 'Save',
  cancel: 'Cancel',
  simulateOffline: 'Simulate offline',
  live: 'Live updates on',
  connecting: 'Connecting for live updates…',
  offline: 'Live updates paused. Showing the last known state.',
} as const;

export interface AddOption {
  id: 'virtual' | 'sonoff';
  label: string;
  iconName: string;
}

export const addOptions: readonly AddOption[] = [
  { id: 'virtual', label: 'Virtual switch', iconName: 'toggle-outline' },
  { id: 'sonoff', label: 'SONOFF Wi-Fi plug', iconName: 'flash-outline' },
];

export const virtualTypes: readonly { id: SmartDeviceType; label: string; iconName: string }[] = [
  { id: 'switch', label: 'Switch', iconName: 'toggle-outline' },
  { id: 'light', label: 'Light', iconName: 'bulb-outline' },
  { id: 'plug', label: 'Plug', iconName: 'flash-outline' },
];
