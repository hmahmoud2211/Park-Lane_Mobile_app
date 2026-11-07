import { Platform } from 'react-native';

/** Copy for pairing this phone with a CUBE Gateway and reaching it from away. */
export const gatewaySetupCopy = {
  title: 'CUBE Gateway',
  subtitle: 'Connects your devices: a box on your Wi-Fi, or your home’s gateway on CUBE’s server.',
  pairedTitle: 'Your gateways',
  active: 'In use',
  use: 'Use this gateway',
  forget: 'Forget',
  confirmForget: 'Tap again to forget',
  address: (url: string) => `Address: ${url}`,
  reconnect: 'Reconnect',
  findTitle: 'Find on your Wi-Fi',
  findIntro: 'Looks for gateways on the network this phone is on. Only addresses in your home network are checked.',
  scan: 'Search',
  scanning: 'Searching your network…',
  scanNone: 'No gateway answered. Check it is running (docker ps) and on the same network, or enter its address below.',
  claimed: 'Already set up',
  unclaimed: 'Ready to set up',
  choose: 'Use this address',
  connectTitle: 'Connect',
  connectIntro:
    'New gateway: enter the setup code from its logs (docker logs cube-os-gateway), or scan the QR code printed there. A gateway on CUBE’s server: scan the pairing code you were given, or enter its https address and setup code. Joining someone’s gateway: use the invite code they send you.',
  host: 'Gateway address',
  hostHelp: 'For example 192.168.1.20 or 192.168.1.20:8686, or the https address you were given for a gateway on CUBE’s server.',
  modeSetup: 'Setup code',
  modeInvite: 'Invite code',
  code: 'Code',
  scanQr: 'Scan QR code',
  closeQr: 'Close scanner',
  qrInvalid: 'That QR code is not a CUBE Gateway pairing code.',
  qrNoAddress: 'Setup code added. This QR code doesn’t say where the gateway is, so enter its address above.',
  connect: 'Connect',
  connected: (name: string) => `Connected to ${name}.`,
  required: 'Required',
  localNetwork:
    Platform.OS === 'ios'
      ? 'If iOS asks to find devices on your local network, allow it. Without it the app can’t reach the gateway at home.'
      : 'The phone must be on the same Wi-Fi as the gateway the first time.',
  security:
    'At home the app talks to the gateway over your own Wi-Fi without encryption. Before sending its key to a new address, the app checks the gateway proves who it is. For encrypted access everywhere, use Tailscale.',
  serverSecurity:
    'A gateway on CUBE’s server is reached over HTTPS through CUBE’s relay, from anywhere. Before sending its key to a new address, the app checks the gateway proves who it is.',
  onServer: 'On CUBE’s server',
  serverRemoteIntro:
    'This gateway runs on CUBE’s server, so the app reaches it from anywhere through CUBE’s relay. There is nothing to set up here.',
  remoteTitle: 'Access away from home',
  remoteIntro:
    'At home the app uses the gateway’s Wi-Fi address. Away, it tries the addresses below: a Tailscale address (100.x.y.z or a MagicDNS name) or your relay’s URL.',
  remoteLabel: 'Remote address',
  remoteHelp: 'Separate several with commas.',
  saveRemote: 'Save remote addresses',
  savedRemote: 'Saved.',
  tailscaleFound: 'Tailscale is running on the gateway. Use one of its addresses:',
  relayTitle: 'Relay',
  relayIntro:
    'Optional: the gateway keeps an outbound HTTPS connection to a relay you run, so the app can reach it from anywhere without opening ports. The relay forwards your requests and can see them; Tailscale encrypts end to end.',
  relayUrl: 'Relay URL',
  relayToken: 'Enrolment token (if your relay needs one)',
  relayEnable: 'Connect to relay',
  relayDisable: 'Stop using relay',
  relayConnected: 'Connected to the relay.',
  relayNotConnected: 'Not connected to the relay.',
  inviteTitle: 'Add another phone',
  inviteIntro: 'Creates a one-time code, valid for 10 minutes, that another phone enters under Invite code.',
  inviteMember: 'Invite (control only)',
  inviteOwner: 'Invite as owner',
  inviteCode: (code: string, minutes: number) => `Code: ${code} · expires in ${minutes} min`,
  ownerOnly: 'Only the gateway’s owner can change this.',
  addDevice: 'Add device',
} as const;
