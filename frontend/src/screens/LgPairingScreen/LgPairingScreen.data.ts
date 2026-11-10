import type { LgPairingStep } from '../../features/lg/types';

/** Copy for adding an LG AC from the phone through the CUBE Gateway and ReThink (ported from Master). */

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
    'The AC calls LG’s cloud once it is on your Wi-Fi, and ReThink answers in its place. When your gateway knows ReThink’s public address, ThinQ2 models are told where it is along with your Wi-Fi. Otherwise, and always for older ThinQ1 models, lgthinq.com must resolve to the ReThink server on your network (a DNS override on your router); without that the AC joins your Wi-Fi but never shows up here.',
  experimentalNote: 'Experimental: works with the models in ReThink’s support list.',
  rethinkGuide: 'ReThink’s setup guide',
  checkingBackend: 'Checking your gateway…',
  backendFailed: 'LG setup not ready',
  backendReady: 'Your gateway can set up LG appliances through ReThink.',
  unavailable:
    'This version of the app cannot pair LG appliances. Update Parklane from the App Store or Google Play.',

  wifiTitle: 'Your home Wi-Fi',
  wifiBody: 'The network the AC should join.',
  wifiDetected: (ssid: string) => `Filled in from your phone’s Wi-Fi: “${ssid}”.`,
  wifiNearby: 'Networks nearby (2.4 GHz)',
  wifiScan: 'Refresh',
  wifiBand: 'LG ACs only join 2.4 GHz Wi-Fi.',
  wifiPasswordNote: 'Phones don’t let apps read saved Wi-Fi passwords, so type it here. It goes only to the AC and is not stored.',

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
  hotspotPasswordGuessed: 'Documented default for this network name — change it if it doesn’t work (check the AC’s label or manual).',
  joinAndSend: 'Join and send',
  qrTitle: 'Scan the AC’s QR code',
  qrBody:
    'It is on the label with the model and serial number, next to the LG ThinQ logo. With the AC in setup mode, the app recognises it from the code, finds its network and sends your Wi-Fi.',
  qrTips: 'Hold the phone 10–15 cm from it and keep still; use the light if the label is in shadow.',
  qrScan: 'Scan QR code',
  qrInApp: 'Use the in-app camera instead',
  qrAgain: 'Scan again',
  qrPermission: 'Allow camera access to scan the AC’s code, or pick its network below.',
  qrFound: (appliance: string) => `Found ${appliance}`,
  qrSerial: (serial: string) => `Serial ${serial}`,
  qrLooking: 'Looking for its Wi-Fi network…',
  qrJoining: 'Joining its network and sending your Wi-Fi.',
  qrConfirm: 'Found its network. Check the password below, then tap “Join and send”.',
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
    'Enter its password if asked (on the AC’s label or in its manual). The documented default for names like LGE_AC2_1234 is the suffix twice (12341234), and for older names like LGE_AC-12-34-56, lge12345.',
    'Come back to Parklane and tap “I’ve joined, send”.',
  ],
  sendJoined: 'I’ve joined, send',
  openWifiSettings: 'Open Wi-Fi settings',
  useApp: 'Let the app join for me',
  noInternetNote: 'Your phone may warn that this network has no internet. That is expected: stay connected.',

  finishTitle: 'Setting up',
  notFoundTitle: 'The AC has not shown up yet',
  notFoundBody:
    'It took your Wi-Fi but has not reached ReThink. Most often the DNS override is missing, so the AC called LG instead: check that common.lgthinq.com resolves to the ReThink server on your network. A typo in the Wi-Fi password has the same effect; then start over.',
  notFoundBodyRemote:
    'It took your Wi-Fi but has not reached ReThink. Check that this Wi-Fi has internet access; a typo in the Wi-Fi password also keeps the AC off it, then start over. An older ThinQ1 model also needs common.lgthinq.com to resolve to ReThink on its network.',
  keepWaiting: 'Look for it on ReThink',
  startOver: 'Start over',
  failedTitle: 'Setup did not finish',
  doneTitle: 'Connected',
  doneBody: 'Your gateway found the AC on ReThink and read its state. Name it and choose its room next.',
  nameAndRoom: 'Name and room',
  acSettings: 'All AC settings',
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

export const finishPhases: readonly { id: 'sent' | 'home' | 'find' | 'added'; title: string }[] = [
  { id: 'sent', title: 'Wi-Fi sent to the AC' },
  { id: 'home', title: 'Phone back on home Wi-Fi' },
  { id: 'find', title: 'Gateway waiting for the AC on ReThink' },
  { id: 'added', title: 'Paired with your gateway' },
];
