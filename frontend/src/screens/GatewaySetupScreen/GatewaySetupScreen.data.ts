import { Platform } from 'react-native';

import type { PhoneAge, PhoneOrigin, PhoneRow } from '../../features/gateway/services/gatewayPhones';
import { formatDate } from '../../utils/format';

function ago(age: PhoneAge): string {
  switch (age.unit) {
    case 'now':
      return 'just now';
    case 'minutes':
      return `${age.count} min ago`;
    case 'hours':
      return `${age.count} h ago`;
    case 'days':
      return age.count === 1 ? '1 day ago' : `${age.count} days ago`;
    case 'date':
      return `on ${formatDate(new Date(age.at))}`;
  }
}

const PHONE_ORIGIN: Record<PhoneOrigin, string> = {
  mine: 'Your account',
  resident: 'Resident account',
  installer: 'Installer',
};

/** Copy for pairing this phone with a CUBE Gateway and reaching it from away. */
export const gatewaySetupCopy = {
  title: 'Home hub',
  subtitle: 'The box that connects your smart devices to the app.',
  accountTitle: 'Your home hub',
  accountIntro: 'Connect this phone to your apartment’s home hub. No code needed.',
  accountConnect: 'Connect',
  accountConnecting: 'Connecting to your home hub…',
  accountConnected: (name: string) => `Connected to ${name}. You’re all set. This phone stays connected until you sign out.`,
  accountPaired: (name: string) => `This phone is connected to ${name}, your apartment’s home hub.`,
  accountNoGatewayTitle: 'Your apartment has no home hub yet',
  accountNoGateway: 'Building management sets it up. Check again once they have.',
  accountCheckAgain: 'Check again',
  accountErrorTitle: 'Couldn’t connect to your home hub',
  accountError: (code: string, message: string) =>
    code === 'account_login_off'
      ? 'Your home hub isn’t ready for accounts yet. Ask building management.'
      : code === 'not_found'
        ? 'This isn’t available for your building yet.'
        : message,
  accountRetry: 'Try again',
  accountRefusedTitle: 'This phone needs to connect again',
  accountRefused: 'Tap Try again. If it keeps happening, ask building management.',
  viaAccount: 'Your account',
  accountNoUnitTitle: 'You’re not in an apartment yet',
  accountNoUnit: 'Join your family’s home with their invite code. Your home hub then connects by itself.',
  householdTitle: 'Household',
  householdJoin: 'Join with an invite code',
  householdOpen: 'People and invites',
  householdSummary: (name: string, count: number) => `${name} · ${count === 1 ? '1 person' : `${count} people`}`,
  cancel: 'Cancel',
  phonesTitle: 'Phones',
  phonesIntro: 'The phones that can use this gateway, most recently used first. Remove one you lost or no longer use.',
  phonesLoading: 'Loading phones…',
  phonesError: 'Could not load the phones',
  thisPhone: 'This phone',
  phoneOrigin: (origin: PhoneOrigin) => PHONE_ORIGIN[origin],
  phoneDetail: (row: PhoneRow) =>
    `${row.role === 'owner' ? 'Owner' : 'Member'} · ${
      row.lastUsed ? `last used ${ago(row.lastUsed)}` : row.added ? `added ${ago(row.added)}, not used yet` : 'not used yet'
    }`,
  remove: 'Remove',
  removeConfirm: 'Remove phone',
  removeWarning: (row: PhoneRow) =>
    row.origin === 'installer'
      ? `${row.name} will lose access to this gateway right away.`
      : `${row.name} will lose access to this gateway right away and be signed out of EMS.`,
  removeFailed: 'The phone could not be removed.',
  signInHint: 'Sign in to connect your home hub automatically.',
  installerTitle: 'Advanced setup',
  installerSubtitle: 'For installers: setup codes, remote access and phones.',
  installerIntro: 'For installers, or to pair a gateway that isn’t linked to your account.',
  show: 'Show',
  hide: 'Hide',
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
  scanNone: 'No gateway answered. Check it is switched on and on the same Wi-Fi network as this phone, or enter its address below.',
  claimed: 'Already set up',
  unclaimed: 'Ready to set up',
  choose: 'Use this address',
  connectTitle: 'Connect',
  connectIntro:
    'New gateway: enter the setup code your installer gave you, or scan its QR code. A gateway on CUBE’s server: scan the pairing code you were given, or enter its https address and setup code. Joining someone’s gateway: use the invite code they send you.',
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
  accountRemoteIntro:
    'Through your account, this phone reaches the gateway from anywhere through CUBE’s relay. There is nothing to set up here.',
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
