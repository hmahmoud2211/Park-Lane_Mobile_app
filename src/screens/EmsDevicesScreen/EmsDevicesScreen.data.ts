import type { SmartDeviceType } from '../../types/ems.types';

/** Copy for My Devices: the devices registered in EMS, which the app and Alexa both control. */

export const devicesCopy = {
  title: 'My Devices',
  subtitle: 'Devices you and Alexa can switch.',
  accountIntro: 'Sign in to your EMS account to see and control your registered devices.',
  devicesTitle: 'Devices',
  add: 'Add',
  close: 'Close',
  empty: 'No devices yet. Add a virtual switch to try the app and Alexa, pair a SONOFF Wi-Fi plug, or add an LG AC.',
  loadFailed: 'Your devices could not be loaded.',
  retry: 'Try again',
  addTitle: 'Add a device',
  virtualNote:
    'A virtual switch has no hardware behind it. It behaves like a real switch in the app and with Alexa, and is always labelled “Virtual”.',
  sonoffNote:
    'Pairs a SONOFF Wi-Fi plug from its setup hotspot, adds it to your CUBE hub, then to your devices here, so the hub, the app and Alexa all control it.',
  startPairing: 'Start pairing',
  lgNote:
    'LG air conditioners, through rethink, the LG bridge on your home network. Pair a new AC from here, or add one rethink already knows.',
  lgLoading: 'Looking for LG appliances…',
  lgNotConfigured: 'LG appliances are not set up on the EMS backend yet (RETHINK_MQTT_URL).',
  lgBridgeDown: 'The EMS backend cannot reach rethink, the LG bridge. Check it is running.',
  lgEmpty: 'Rethink has no LG appliances yet. Pair your AC to add it.',
  lgPairNew: 'Pair a new AC',
  lgRefresh: 'Refresh',
  lgPick: 'Choose the appliance',
  lgAdded: 'added',
  lgOffline: 'offline',
  lgPickFirst: 'Choose an appliance first.',
  lgNameMissing: 'Give the AC a name, e.g. “Bedroom AC”.',
  lgDefaultName: 'AC',
  addLg: 'Add LG appliance',
  addVirtual: 'Add virtual switch',
  name: 'Name',
  room: 'Room (optional)',
  controls: 'Controls',
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
  id: 'virtual' | 'sonoff' | 'lg';
  label: string;
  iconName: string;
}

export const addOptions: readonly AddOption[] = [
  { id: 'virtual', label: 'Virtual switch', iconName: 'toggle-outline' },
  { id: 'sonoff', label: 'SONOFF', iconName: 'flash-outline' },
  { id: 'lg', label: 'LG', iconName: 'snow-outline' },
];

export const virtualTypes: readonly { id: SmartDeviceType; label: string; iconName: string }[] = [
  { id: 'switch', label: 'Switch', iconName: 'toggle-outline' },
  { id: 'light', label: 'Light', iconName: 'bulb-outline' },
  { id: 'plug', label: 'Plug', iconName: 'flash-outline' },
];
