/** Copy for a device's own screen. The controls' own words live with them (features/home/components). */
export const deviceDetailCopy = {
  fallbackTitle: 'Device',
  accountIntro: 'Sign in to your EMS account to control your devices.',
  acSettings: 'All AC settings',
  acSettingsHint: 'Shows every setting this air conditioner offers: airflow, features, timers and filter',
  detailsTitle: 'Details',
  connectingHub: 'Connecting to your home hub…',
  loadingDevice: 'Loading your device…',
  missingTitle: 'Device not found',
  missingBody: 'It may have been removed from your home, or your account was moved to another unit.',
  back: 'Go back',
  name: 'Name',
  rename: 'Rename',
  save: 'Save',
  cancel: 'Cancel',
  room: 'Room',
  noRoom: 'No room',
  hubOffline: 'Your home hub is offline. Showing the last known state.',
  manufacturer: 'Made by',
  model: 'Model',
  integration: 'Connected through',
  address: 'Address',
  gatewayOffline: 'Your home hub isn’t answering. Showing the last known state.',
  experimental: 'This device uses an experimental integration. Some controls may not work on every model.',
  assumed: 'Some values are what the gateway expects, not what the device reported: it doesn’t report back for every change.',
  remove: 'Remove device',
  confirmRemove: 'Tap again to remove',
  removeHint: 'Removes the device and its stored keys from your gateway',
} as const;

/** The room picker's value for "No room" (room ids are never empty). */
export const NO_ROOM = '';
