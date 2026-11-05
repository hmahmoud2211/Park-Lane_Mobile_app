import type { IconSet } from '../../types/icons.types';
import type { TasmotaSetupErrorCode } from '../../features/direct/services/tasmotaSetup';
import type { DirectKind } from '../../types/home.types';

/** Copy for setting up a Tasmota plug that connects to the backend directly, with no hub. */
export const pairingCopy = {
  title: 'Add a Direct Device',
  subtitle: 'A Tasmota plug that connects without a hub.',
  accountIntro: 'Sign in to your EMS account to add devices.',
  noHomeTitle: 'Not linked to a unit yet',
  webTitle: 'Use the phone app',
  webBody: 'Setting up a plug means joining its own Wi-Fi, which only the Parklane app on a phone can do.',
  step: (index: number, count: number) => `Step ${index} of ${count}`,

  detailsTitle: 'The device',
  detailsIntro:
    'Direct devices run Tasmota firmware and connect to Parklane over the internet by themselves, from any network. No hub, no brand account.',
  firmwareNote:
    'The plug needs the tasmota-tls build of Tasmota. Plugs sold with Tasmota already on them need nothing else; SONOFF plugs can be flashed once by an installer.',
  name: 'Name',
  namePlaceholder: 'e.g. Desk lamp',
  kindLabel: 'What is it?',
  nameRequired: 'Give the device a name.',
  continue: 'Continue',

  joinTitle: 'Join the plug’s Wi-Fi',
  joinSteps: [
    'Plug it in. A new or reset Tasmota plug makes its own Wi-Fi network, named tasmota- and some letters.',
    'On this phone, open Wi-Fi settings and join that network. It has no internet: stay on it anyway.',
    'Come back here and tap the button below.',
  ],
  joinReset: 'No tasmota- network? Hold the plug’s button for about 40 seconds to reset it, then plug it in again.',
  openWifiSettings: 'Open Wi-Fi settings',
  joined: 'I’ve joined the plug’s network',

  wifiTitle: 'Your home Wi-Fi',
  found: (name: string | null, firmware: string | null) => `Found ${name ?? 'a Tasmota plug'}${firmware ? ` · ${firmware}` : ''}.`,
  tlsWarning:
    'This plug’s firmware does not look like the tasmota-tls build, and Parklane only takes encrypted connections. It may never connect until it is flashed with tasmota-tls.',
  wifiIntro: 'The plug joins this network, then connects to Parklane by itself.',
  ssid: 'Wi-Fi name',
  wifiPassword: 'Wi-Fi password',
  band: 'The plug only works on 2.4 GHz Wi-Fi.',
  send: 'Send to the plug',
  manualToggle: 'Enter the settings in the plug’s own page instead',
  autoToggle: 'Let the app send them instead',
  retry: 'Try again',
  manualIntro:
    'Open http://192.168.4.1 in a browser while on the plug’s network. In Configuration → Configure MQTT enter these, then set your Wi-Fi in Configuration → Configure WiFi.',
  manualDone: 'I’ve entered them',
  manualRows: {
    host: 'Host',
    port: 'Port',
    user: 'User',
    password: 'Password',
    topic: 'Topic',
    tls: 'TLS (SetOption103)',
  },
  on: 'On',
  off: 'Off',

  waitingTitle: 'Connecting',
  waitingBody:
    'Reconnect this phone to your home Wi-Fi. The plug restarts, joins your Wi-Fi and connects to Parklane. This takes about a minute.',
  slowTitle: 'Still waiting',
  slowTips: [
    'Check the Wi-Fi name and password. The plug makes its tasmota- network again if it cannot join.',
    'The plug only joins 2.4 GHz networks.',
    'Without the tasmota-tls build, the plug cannot make an encrypted connection.',
  ],

  doneTitle: 'Connected',
  doneBody: (name: string) => `${name} is ready. You’ll find it in Smart Home, under Direct.`,
  openDevice: 'Open device',
  done: 'Done',
  startOver: 'Start over',
  expired: 'That setup ran out of time. Start again.',
  failed: 'Something went wrong. Try again.',
} as const;

export const kindOptions: readonly { id: DirectKind; label: string; iconSet: IconSet; iconName: string }[] = [
  { id: 'plug', label: 'Plug', iconSet: 'material', iconName: 'power-plug-outline' },
  { id: 'switch', label: 'Switch', iconSet: 'material', iconName: 'light-switch' },
  { id: 'light', label: 'Light', iconSet: 'material', iconName: 'lightbulb-outline' },
];

/** What went wrong reaching the plug on its hotspot. */
export const setupErrors: Record<TasmotaSetupErrorCode, string> = {
  not_reached: 'The plug did not answer. Check this phone is on the plug’s tasmota- network, then try again.',
  not_tasmota: 'Something answered, but not a Tasmota plug. Check you joined the tasmota- network.',
  password: 'This plug has a web password. Reset it (hold its button for about 40 seconds) and start again.',
};

export const wifiErrors = {
  missing: 'Enter your Wi-Fi name.',
  too_long: 'The plug takes Wi-Fi names of up to 32 characters and passwords of up to 64.',
  semicolon: 'The plug cannot take a “;” in the Wi-Fi name or password.',
} as const;
