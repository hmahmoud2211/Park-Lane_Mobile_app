import type { ProgressPhaseId } from '../../hooks/useSonoffPairing';
import type { ApPayloadFormat, PairingErrorKind, PairingStatus, PairingStep } from '../../types/sonoff.types';

export const pairingCopy = {
  title: 'Add SONOFF Device',
  subtitle: 'Wi-Fi smart plug, without the eWeLink app',
  cancel: 'Cancel',
  continue: 'Continue',
  retry: 'Try again',
  startOver: 'Start over',
  done: 'Done',

  bannerTitle: 'Pair a SONOFF plug',
  bannerBody: 'Join it, then add it to your hub.',
  instructionsTitle: 'Put the plug in pairing mode',
  testedWith: 'Tested with the SONOFF S26R2TPF. Other SONOFF Wi-Fi plugs with Compatible Pairing mode may work.',

  connectTitle: 'Connect to the plug',
  connectIdle: 'Join the plug’s Wi-Fi',
  connectIdleCaption: 'Your phone joins the plug’s own ITEAD- network for a moment.',
  joinPrompt: 'Join the plug’s network',
  joinNamed: (ssid: string) => `Join ${ssid}`,
  scanAgain: 'Scan again',
  hotspotsTitle: 'Plug networks nearby',
  noHotspots: 'None found yet. Check that the LED is blinking quickly, then scan again.',
  useSettingsInstead: 'Join from Wi-Fi settings instead',
  manualTitle: 'Join from your phone’s settings',
  manualSteps: [
    'Open Settings, then Wi-Fi.',
    'Choose the network that starts with ITEAD-.',
    'Enter the password 12345678.',
    'Come back to Parklane. It checks for the plug when you return.',
  ],
  openWifiSettings: 'Open Wi-Fi settings',
  checkForPlug: 'I’ve joined, check for the plug',
  noInternetNote:
    'Your phone may warn that this network has no internet. That is expected: choose to stay connected.',
  detectedTitle: 'Device detected',
  detectedCaption: 'Parklane received the plug’s details over its setup network.',

  wifiTitle: 'Your home Wi-Fi',
  wifiBody: 'The network the plug should join.',
  wifiDetected: (ssid: string) => `Filled in from your phone’s Wi-Fi: “${ssid}”.`,
  wifiNearby: 'Networks nearby (2.4 GHz)',
  wifiScan: 'Refresh',
  wifiPasswordRemembered: 'Password filled in from the last time you paired on this network.',
  wifiPasswordNote: 'Phones don’t let apps read saved Wi-Fi passwords, so type it once here.',
  wifiRemember: 'Remember the password on this phone',
  provisionTitle: 'Send to the plug',
  provisionUnverified: 'Unverified',
  provisionExplainer:
    'ITEAD does not document how its app passes Wi-Fi settings to a plug in Compatible Pairing mode, and on the S26R2TPF the setup endpoint (POST /ap) has not answered so far. Parklane can try the method community tools describe, as an experiment.',
  provisionUnsupported:
    'Sending Wi-Fi settings is unsupported until it is verified for this plug. Turn on Experimental pairing to try it anyway, or use the option below.',
  experimentalLabel: 'Experimental pairing',
  serverTitle: 'Server the plug connects to',
  serverExplainer:
    'After joining Wi-Fi, the plug contacts this server over HTTPS (/dispatch/device) to be told where to keep its connection. The official app sends its regional eWeLink server. Another address moves the plug off eWeLink’s cloud to a server you run.',
  serverCustom: 'Custom server',
  serverHost: 'Server name or IP',
  serverPort: 'Port',
  formatTitle: 'Request format',
  review: 'Review and send',
  confirmTitle: 'Send these settings to the plug?',
  confirmWarning:
    'Experimental. The plug may ignore this, or keep the settings and fail to join. Parklane reports only what it can observe.',
  confirmSend: 'Send to plug',
  confirmBack: 'Back',
  alreadySetUpTitle: 'Already on this Wi-Fi?',
  alreadySetUpBody:
    'If this plug was set up on your Wi-Fi before, it does not need the settings again. Unplug it and plug it back in: it leaves pairing mode and rejoins on its own, and Parklane finds it on your network.',
  alreadySetUpAction: 'Find it on my network',

  progressTitle: 'Setting up',
  noResponseNote:
    'The plug did not answer the request. It may have dropped its hotspot to join your Wi-Fi, or ignored it; Parklane is checking which.',
  acceptedNote: 'The plug accepted the settings.',
  noResponseJoinedNote: 'The plug did not answer the request, but it did join your Wi-Fi.',
  powerCycleNote: 'Unplug the plug, wait a few seconds, and plug it back in.',
  discoveredTitle: 'Device discovered',
  discoveredCaption: 'The plug is on your home network. Add it to your hub to control it.',
  nameLabel: 'Name on the hub',
  namePlaceholder: 'e.g. Living Room Plug',
  nameMissing: 'Give the plug a name.',
  defaultName: 'SONOFF Plug',
  addToHub: 'Add to hub',
  editWifi: 'Edit Wi-Fi settings',
  completedTitle: 'Setup completed',
  completedCaption: 'The plug is on your hub. Your hub sends its commands through the unit’s device backend.',
  testTitle: 'Try it',
  turnOn: 'Turn on',
  turnOff: 'Turn off',
  testOk: (power: 'on' | 'off') => `The hub switched the plug ${power}.`,
  ownershipNote:
    'Joining Wi-Fi is not the same as being added: the hub only controls the plug once it is registered.',
} as const;

/** The labels of the wizard's stage track. */
export const wizardSteps: readonly { id: PairingStep; label: string }[] = [
  { id: 'instructions', label: 'Pair mode' },
  { id: 'connect', label: 'Connect' },
  { id: 'wifi', label: 'Wi-Fi' },
  { id: 'progress', label: 'Finish' },
];

export const instructions = [
  { title: 'Power on the plug', body: 'Plug it into a socket. Its LED lights up.' },
  {
    title: 'Hold the button for about 5 seconds',
    body: 'The LED blinks two short, one long: that is Quick Pairing mode.',
  },
  {
    title: 'Hold it again for about 5 seconds',
    body: 'The LED blinks quickly and steadily: that is Compatible Pairing mode.',
  },
  {
    title: 'Wait for its Wi-Fi network',
    body: 'The plug broadcasts a network named ITEAD- followed by its device ID.',
  },
] as const;

export const statusLabels: Record<PairingStatus, string> = {
  waitingForPairing: 'Waiting for pairing',
  connectingToDevice: 'Connecting to device',
  deviceDetected: 'Device detected',
  configuringWifi: 'Configuring Wi-Fi',
  waitingForReconnection: 'Waiting for reconnection',
  deviceDiscovered: 'Device discovered',
  provisioningFailed: 'Provisioning failed',
  registrationRequired: 'Registration required',
  setupCompleted: 'Setup completed',
};

export const phaseLabels: Record<ProgressPhaseId, { title: string; skipped?: string }> = {
  send: { title: 'Send Wi-Fi settings', skipped: 'Not needed: the plug already knows your Wi-Fi' },
  leave: { title: 'Plug leaves pairing mode' },
  home: { title: 'Phone back on home Wi-Fi', skipped: 'No device backend in this build' },
  find: { title: 'Plug found on your network' },
  hub: { title: 'Added to your hub' },
};

export const payloadFormats: readonly { id: ApPayloadFormat; label: string; body: string }[] = [
  { id: 'ewelinkApp', label: 'eWeLink app', body: 'As captured from the official app on firmware 3.5.' },
  { id: 'sonotaV4', label: 'SonOTA v4', body: 'Adds "version": 4, as older firmware expected.' },
];

/** What to do about each failure. `action` adds a button beside "Try again". */
export type AdviceAction = 'appSettings' | 'wifiSettings' | 'editWifi' | 'startOver';

export const errorAdvice: Record<PairingErrorKind, { title: string; advice: string; action?: AdviceAction }> = {
  hotspotNotFound: {
    title: 'Plug network not found',
    advice: 'Check the plug is in Compatible Pairing mode (fast, steady blinking) and close to the phone.',
  },
  wrongNetwork: {
    title: 'Wrong Wi-Fi network',
    advice: 'Join the network that starts with ITEAD-, then check again.',
    action: 'wifiSettings',
  },
  joinCancelled: {
    title: 'Join cancelled',
    advice: 'Parklane needs to join the plug’s network for a moment. Try again and choose Join or Connect.',
  },
  permissionDenied: {
    title: 'Location access needed',
    advice: 'Android lets apps find and join Wi-Fi networks only with precise location. Allow it for Parklane.',
    action: 'appSettings',
  },
  locationServicesOff: {
    title: 'Location is off',
    advice: 'Turn on Location in quick settings so the phone can scan for the plug’s network.',
  },
  localNetworkDenied: {
    title: 'Local network access may be off',
    advice: 'In Settings › Privacy & Security › Local Network, turn Parklane on, then check again.',
    action: 'appSettings',
  },
  timeout: {
    title: 'No answer from the plug',
    advice: 'Make sure the phone is on the plug’s ITEAD- network and the LED is still blinking quickly.',
  },
  invalidResponse: {
    title: 'Not a SONOFF answer',
    advice: 'Something at 10.10.7.1 answered, but not with a SONOFF plug’s details. Check you joined the ITEAD- network.',
  },
  unsupportedPlatform: {
    title: 'Use the Parklane phone app',
    advice: 'Pairing needs the iOS or Android app: browsers cannot reach a device’s setup network.',
  },
  provisioningUnsupported: {
    title: 'Wi-Fi setup unsupported',
    advice: 'Sending Wi-Fi settings is not verified for this plug yet.',
  },
  provisioningRejected: {
    title: 'The plug refused the settings',
    advice: 'Try the other request format, or check the server name and port.',
    action: 'editWifi',
  },
  stillInPairingMode: {
    title: 'Still in pairing mode',
    advice:
      'The plug kept its setup network up. Check the Wi-Fi password, and that the network is 2.4 GHz and not hidden.',
    action: 'editWifi',
  },
  notOnHomeWifi: {
    title: 'Phone still on the plug’s network',
    advice: 'Switch your phone back to your home Wi-Fi in settings, then try again.',
    action: 'wifiSettings',
  },
  deviceNotFound: {
    title: 'Plug not found on your network',
    advice:
      'It may not have joined. Check the Wi-Fi password and that the network is 2.4 GHz. The backend must be on the same network for mDNS to reach it.',
    action: 'editWifi',
  },
  keyRejected: {
    title: 'Plug found, but its key did not work',
    advice: 'Put the plug back in pairing mode and start over, so Parklane reads its key again.',
    action: 'startOver',
  },
  notControllable: {
    title: 'Plug added, but not controllable',
    advice: 'The hub could not switch it. Check the backend can reach the plug on port 8081.',
  },
  unsupportedDevice: {
    title: 'Device not supported yet',
    advice: 'Only single-channel plugs can be added this way for now.',
    action: 'startOver',
  },
  backendNotConfigured: {
    title: 'Device backend not set up',
    advice:
      'Set EXPO_PUBLIC_DEVICE_BACKEND_URL for this build and PUBLIC_URL on the backend, so the hub can reach it.',
  },
  backendUnreachable: {
    title: 'Device backend unreachable',
    advice: 'Check the phone is on your home Wi-Fi and the backend is running.',
  },
  cubeUnreachable: {
    title: 'Hub unreachable',
    advice: 'The backend could not reach your CUBE hub. Check the hub is on and its address in the backend’s settings.',
  },
  cubeRejected: {
    title: 'The hub refused',
    advice: 'Check the backend’s CUBE password or token, then try again.',
  },
  unknown: {
    title: 'Something went wrong',
    advice: 'Try again. If it keeps happening, start over.',
    action: 'startOver',
  },
};
