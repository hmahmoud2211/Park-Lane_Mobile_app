import type { UnitRole } from '../../features/unit/types';

/**
 * The Household screen's copy. No Figma reference: it follows the inner screens' frame. Written
 * for anyone, of any age: short sentences, everyday words, and every message says what to do next.
 */
export const householdCopy = {
  title: 'Household',
  subtitle: 'The people who share your home.',

  // Signed out
  invitedTitle: 'You’re invited',
  invitedBody: 'Sign in, or create your account, to join. We’ll keep your invite.',
  signInTitle: 'Sign in first',
  signInBody: 'Sign in to see who shares your home, or to join one.',
  signIn: 'Sign in to continue',
  checkingSession: 'Checking your sign-in…',

  // Loading and problems
  loading: 'Loading your household…',
  loadFailed: 'Couldn’t load your household',
  retry: 'Try again',
  unavailableTitle: 'Not available yet',
  unavailableBody: 'Households aren’t set up for your building yet. Building management can help.',

  // Joining
  joinTitle: 'Join your family’s home',
  joinBody: 'Ask the apartment’s owner to invite you. Tap the link in their message, or enter the code here.',
  codeLabel: 'Invite code',
  paste: 'Paste',
  pasteEmpty: 'Copy the invite message or code first, then tap Paste.',
  scan: 'Scan QR code',
  closeScan: 'Close camera',
  scanHint: 'Point the camera at the QR code on the owner’s phone.',
  scanWrong: 'That QR code isn’t a Parklane invite. Try again.',
  checking: 'Checking the invite…',
  previewTitle: (name: string) => `Join ${name}?`,
  previewBy: (who: string, role: UnitRole) =>
    `${who || 'The owner'} invited you${role === 'owner' ? ' as an owner. You can also invite and remove people.' : '.'}`,
  previewWhat: 'You can then use this home’s devices from your phone.',
  join: (name: string) => `Join ${name}`,
  otherCode: 'Use a different code',
  alreadyIn: (name: string) => `You’re already in ${name}. There’s nothing more to do.`,
  joined: (name: string) => `Welcome to ${name}! You can now use your home’s devices.`,
  openSmartHome: 'Open Smart Home',

  // Members
  membersTitle: 'People',
  you: 'You',
  role: (role: UnitRole) => (role === 'owner' ? 'Owner' : 'Member'),
  remove: 'Remove',
  removeConfirm: 'Yes, remove',
  cancel: 'Cancel',
  removeWarning: (name: string) => `${name} will no longer be able to use this home’s devices.`,
  removeFailed: 'Couldn’t remove them. Try again.',
  memberOnly: (owners: string) => `Only an owner can invite people. Ask ${owners || 'an owner'} to send an invite.`,

  // Inviting
  inviteTitle: 'Invite family',
  inviteBody: 'Send an invite by WhatsApp, text or email. It works once, for 24 hours.',
  invite: 'Invite someone',
  inviteOwner: 'Invite another owner',
  inviteOwnerHint: 'An owner can also invite and remove people.',
  inviteFailed: 'Couldn’t create the invite. Try again.',
  shareTitle: 'Join our apartment',
  shareWhat: 'Invite',
  shareAgain: 'Share again',
  copy: 'Copy',
  copied: 'Copied. Paste it into any message.',
  copyFailed: 'Couldn’t copy. Press and hold the code instead.',
  inviteExpired: 'This invite has expired. Create a new one.',
  codeSpoken: (code: string) => `Invite code ${code.split('').join(' ')}`,
  qrLabel: 'QR code of the invite',
  qrHint: 'Or let them scan this with their phone’s camera.',
  cancelInvite: 'Cancel invite',
  waitingTitle: 'Waiting to be used',
  waitingBy: (who: string) => (who ? `Sent by ${who}` : ''),
  cancelFailed: 'Couldn’t cancel the invite. Try again.',
} as const;
