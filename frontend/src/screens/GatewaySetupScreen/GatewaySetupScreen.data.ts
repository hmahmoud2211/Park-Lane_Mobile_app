import { Platform } from 'react-native';

import type { PhoneAge, PhoneOrigin, PhoneRow } from '../../features/gateway/services/gatewayPhones';
import type { UnitInvite, UnitRole } from '../../features/unit/types';
import { formatClock12, formatDate } from '../../utils/format';

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
  title: 'CUBE Gateway',
  subtitle: 'Connects your devices: a box on your Wi-Fi, or your home’s gateway on CUBE’s server.',
  accountTitle: 'Your apartment’s gateway',
  accountIntro: 'Connect this phone to your apartment’s gateway with your EMS account. No setup code needed.',
  accountConnect: 'Connect with my account',
  accountConnecting: 'Connecting to your apartment’s gateway…',
  accountConnected: (name: string) =>
    `Connected to ${name} through your EMS account. This phone has its own access, which ends when you sign out.`,
  accountPaired: (name: string) => `This phone is already paired with ${name}, your apartment’s gateway.`,
  accountNoGatewayTitle: 'Your apartment has no gateway yet',
  accountNoGateway: 'Once building management links one to your apartment, check again here.',
  accountCheckAgain: 'Check again',
  accountErrorTitle: 'Could not connect through your account',
  accountError: (code: string, message: string) =>
    code === 'account_login_off'
      ? 'Your apartment’s gateway isn’t linked to EMS accounts yet. Ask building management.'
      : code === 'not_found'
        ? 'Connecting through your account isn’t available on this EMS server yet.'
        : message,
  accountRetry: 'Try again',
  accountRefusedTitle: 'This phone’s access has ended',
  accountRefused: 'Your apartment’s gateway no longer accepts this phone. Try again, or ask building management.',
  viaAccount: 'Your account',
  accountNoUnitTitle: 'You’re not part of an apartment yet',
  accountNoUnit: 'Join one with an invite code from its owner, below. Its devices and gateway then connect here.',
  membersTitle: 'Members',
  unitLoading: 'Loading your apartment…',
  unitError: 'Could not load your apartment',
  roleLabel: (role: UnitRole) => (role === 'owner' ? 'Owner' : 'Member'),
  you: 'You',
  removeMember: 'Remove',
  removeMemberConfirm: 'Remove member',
  removeMemberWarning: (name: string) => `${name} will lose access to this apartment’s devices, and to the gateway within a few minutes.`,
  removeMemberFailed: 'The member could not be removed.',
  familyTitle: 'Invite family',
  familyIntro: 'Creates a one-time code, valid for 24 hours. Whoever signs in and enters it joins this apartment: its devices and its gateway.',
  familyAsMember: 'Member',
  familyAsOwner: 'Owner',
  familyMemberHint: 'A member uses the apartment’s devices.',
  familyOwnerHint: 'An owner can also invite and remove people, and manage the gateway.',
  familyCreate: 'Create invite code',
  familyAnother: 'Create another code',
  familyCode: (code: string) => `Invite code ${code.split('').join(' ')}`,
  familyExpires: (invite: UnitInvite) => {
    const at = new Date(invite.expiresAt);
    return `For ${invite.role === 'owner' ? 'an owner' : 'a member'} · single use · expires ${formatDate(at)}, ${formatClock12(at.getHours(), at.getMinutes())}`;
  },
  familyFailed: 'The invite code could not be created.',
  share: 'Share',
  shareTitle: 'Join our apartment',
  shareWhat: 'Invite',
  shareExpired: 'This code has expired. Create a new one.',
  joinTitle: 'Join an apartment',
  joinIntro: 'Joining your family’s apartment? Ask its owner for an invite code and enter it here.',
  joinCode: 'Invite code',
  join: 'Join apartment',
  joinFailed: 'Could not join the apartment. Try again.',
  joined: (name: string) => `You joined ${name}. Its devices and gateway are connecting.`,
  joinError: (code: string, message: string) =>
    code === 'invalid'
      ? 'That code didn’t work: it may be mistyped, already used or expired. Ask the owner for a new one.'
      : code === 'rate_limited'
        ? 'Too many tries. Wait a few minutes, then try again.'
        : message,
  othersTitle: 'Lost a phone?',
  othersIntro: 'Sign out of your EMS account on every other phone. They also lose access to your apartment’s gateway.',
  othersAction: 'Sign out my other phones',
  othersConfirmTitle: 'Sign out your other phones?',
  othersWarning:
    'For a lost or stolen phone: every other phone signed in to your EMS account is signed out, and loses access to your apartment’s gateway within a few minutes. This phone stays signed in.',
  othersConfirm: 'Sign out other phones',
  othersDone: (count: number) =>
    count === 0 ? 'No other phones were signed in.' : count === 1 ? 'Signed out 1 other phone.' : `Signed out ${count} other phones.`,
  othersFailed: 'Your other phones could not be signed out.',
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
  signInHint: 'Sign in to connect your apartment’s gateway automatically.',
  installerTitle: 'Installer setup',
  installerSubtitle: 'Setup codes, QR codes and invite codes.',
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
