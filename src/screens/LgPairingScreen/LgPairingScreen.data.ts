import type { LgFinishPhase, LgPairingStep } from '../../hooks/useLgPairing';

export const lgPairingCopy = {
  title: 'Add LG AC',
  subtitle: 'Air conditioner, without the ThinQ app',
  cancel: 'Cancel',
  continue: 'Continue',
  retry: 'Try again',
  done: 'Done',

  setupTitle: 'Put the AC in Wi-Fi setup mode',
  setupSource: 'LG’s instructions',
  beforeTitle: 'Before you start',
  beforeBody:
    'The AC calls LG’s cloud once it is on your Wi-Fi, and rethink has to answer in its place: on your home network, common.lgthinq.com and rethink.lan must resolve to the computer running rethink (a DNS override on your router). Without that, the AC joins your Wi-Fi but never shows up here.',
  beforeBodyRemote:
    'The AC is told where rethink is along with your Wi-Fi, so any Wi-Fi with internet access will do. Older ThinQ1 models are the exception: on their network, common.lgthinq.com must still resolve to rethink (a DNS override on the router).',
  rethinkGuide: 'rethink’s setup guide',
  checkingBackend: 'Checking the LG bridge…',
  backendFailed: 'LG bridge not ready',
  backendReady: 'The LG bridge is running.',
  unavailable:
    'This build cannot pair LG appliances: it predates the feature. Install the latest Parklane build, then try again.',

  wifiTitle: 'Your home Wi-Fi',
  wifiBody: 'The network the AC should join.',
  wifiDetected: (ssid: string) => `Filled in from your phone’s Wi-Fi: “${ssid}”.`,
  wifiNearby: 'Networks nearby (2.4 GHz)',
  wifiScan: 'Refresh',
  wifiBand: 'LG ACs only join 2.4 GHz Wi-Fi.',
  wifiPasswordRemembered: 'Password filled in from the last time you paired on this network.',
  wifiPasswordNote: 'Phones don’t let apps read saved Wi-Fi passwords, so type it once here.',
  wifiRemember: 'Remember the password on this phone',

  joinTitle: 'Send it to the AC',
  joinIdle: 'Join the AC’s Wi-Fi',
  joinIdleCaption: 'Your phone joins the AC’s own LGE_ network for a moment and hands it your Wi-Fi.',
  hotspotsTitle: 'AC networks nearby',
  scanning: 'Looking for AC networks…',
  noHotspots: 'None found yet. Check that the AC is in setup mode, then scan again.',
  scanAgain: 'Scan again',
  hotspotName: 'AC network name',
  hotspotNamePlaceholder: 'e.g. LGE_AC2_1234',
  hotspotNameMissing: 'Enter the AC network’s name, as your Wi-Fi settings show it.',
  hotspotNameInvalid: 'LG AC networks start with LGE_.',
  hotspotPassword: (ssid: string) => `Password for ${ssid}`,
  noPassword: 'None (open network)',
  hotspotPasswordFromQr: 'From the AC’s QR code.',
  hotspotPasswordTyped: 'As you typed it.',
  hotspotPasswordOpen: 'This network has no password.',
  hotspotPasswordGuessed:
    'Filled in from the network name, the way LG names them. If joining fails, check the AC’s manual or label and type it here.',
  joinAndSend: 'Join and send',
  qrTitle: 'Scan the AC’s QR code',
  qrBody:
    'It is on the label with the model and serial number, next to the LG ThinQ logo. With the AC in setup mode, Parklane recognises it from the code, finds its network and sends your Wi-Fi.',
  qrTips: 'Hold the phone 10–15 cm from it and keep still; use the light if the label is in shadow.',
  qrScan: 'Scan QR code',
  qrInApp: 'Use the in-app camera instead',
  qrAgain: 'Scan again',
  qrPermission: 'Allow camera access to scan the AC’s code, or pick its network below.',
  qrFound: (appliance: string) => `Found ${appliance}`,
  qrSerial: (serial: string) => `Serial ${serial}`,
  qrLooking: 'Looking for its Wi-Fi network…',
  qrJoining: 'Joining its network and sending your Wi-Fi.',
  qrNotInRange:
    'Its Wi-Fi network is not in range yet. Put the AC in Wi-Fi setup mode (step 1), wait a few seconds, then look again.',
  qrSeveral: 'Several AC networks are in range: pick this AC’s below.',
  qrTypeName: 'Type its network’s name below, as your phone’s Wi-Fi settings show it (it starts with LGE_).',
  qrLookAgain: 'Look again',
  qrUnreadTitle: 'Not an LG appliance code',
  qrUnreadBody:
    'Scan the code on the AC’s label, next to the LG ThinQ logo, or pick its network below. If this is that code, send the text below to whoever looks after the app.',
  qrRead: (raw: string) => `Read: ${raw}`,
  joinFromSettings: 'Join from Wi-Fi settings instead',
  manualTitle: 'Join from your phone’s settings',
  manualSteps: [
    'Open Settings, then Wi-Fi.',
    'Choose the network that starts with LGE_.',
    'Enter its password if asked: for LGE_AC2_1234 it is 12341234; for older names like LGE_AC-12-34-56, lge12345.',
    'Come back to Parklane and tap “I’ve joined, send”.',
  ],
  sendJoined: 'I’ve joined, send',
  openWifiSettings: 'Open Wi-Fi settings',
  useApp: 'Let Parklane join for me',
  noInternetNote: 'Your phone may warn that this network has no internet. That is expected: stay connected.',

  finishTitle: 'Setting up',
  addTitle: 'Name the AC',
  name: 'Name',
  room: 'Room (optional)',
  defaultName: 'AC',
  nameMissing: 'Give the AC a name, e.g. “Bedroom AC”.',
  add: 'Add AC',
  foundTitle: (name: string) => `Found: ${name}`,
  notFoundTitle: 'The AC has not shown up yet',
  notFoundBody:
    'It took your Wi-Fi but has not reached rethink. Most often the DNS override is missing, so the AC called LG instead: check that common.lgthinq.com resolves to the rethink computer on your network. A typo in the Wi-Fi password has the same effect; then start over.',
  notFoundBodyRemote:
    'It took your Wi-Fi but has not reached rethink. Check that this Wi-Fi has internet access; a typo in the Wi-Fi password also keeps the AC off it, then start over. An older ThinQ1 model also needs common.lgthinq.com to resolve to rethink on its network.',
  keepWaiting: 'Keep waiting',
  startOver: 'Start over',
  doneTitle: 'Added',
  doneBody: 'The AC is in My Devices. The app and Alexa can switch it now.',
} as const;

/** The labels of the wizard's stage track. */
export const lgWizardSteps: readonly { id: LgPairingStep; label: string }[] = [
  { id: 'prepare', label: 'Setup mode' },
  { id: 'wifi', label: 'Wi-Fi' },
  { id: 'join', label: 'Send' },
  { id: 'finish', label: 'Finish' },
];

/**
 * LG's own steps; the buttons differ by model and year (lgSources.setupMode).
 * The back of the remote names the right ones.
 */
export const lgSetupInstructions = [
  { title: 'Switch the AC on at the wall', body: 'Stay within a few metres of it: its setup network has a short range.' },
  {
    title: 'Hold the Wi-Fi setup buttons for 3 seconds',
    body: 'Point the remote at the AC. Depending on the model it is the Wi-Fi button, the Mode button on newer models, or the two buttons either side of Temp ▼ on older ones.',
  },
  {
    title: 'Wait for its network',
    body: 'The AC broadcasts a Wi-Fi network starting with LGE_, for example LGE_AC2_1234.',
  },
] as const;

export const finishPhases: readonly { id: Exclude<LgFinishPhase, 'name' | 'done'> | 'sent' | 'added'; title: string }[] = [
  { id: 'sent', title: 'Wi-Fi sent to the AC' },
  { id: 'home', title: 'Phone back on home Wi-Fi' },
  { id: 'find', title: 'AC reached rethink' },
  { id: 'added', title: 'Added to your devices' },
];
