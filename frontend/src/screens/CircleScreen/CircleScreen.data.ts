import { brand } from '../../config/brand';

/**
 * The Family Circle screen's copy. No Figma reference: it follows the inner screens' frame, like Household. Written
 * for anyone, of any age: short sentences, everyday words, and every message says what to do next.
 */
export const circleCopy = {
  title: 'Family Circle',
  subtitle: 'See where your family is.',

  // Signed out, loading and problems
  signInTitle: 'Sign in first',
  signInBody: 'Sign in to see your Family Circle.',
  signIn: 'Sign in to continue',
  loading: 'Loading your Family Circle…',
  loadFailed: 'Couldn’t load your Family Circle',
  retry: 'Try again',
  unavailableTitle: 'Not available yet',
  unavailableBody: 'Family Circle isn’t switched on for your account yet. Building management can help.',

  // Starting: make a Circle or join one
  startTitle: 'Start your Family Circle',
  startBody: 'Make a Circle and invite your family, or join one with a code someone sent you.',
  nameLabel: 'Circle name',
  namePlaceholder: 'Family',
  create: 'Make Circle',
  createFailed: 'Couldn’t make the Circle. Try again.',
  joinTitle: 'Join with a code',
  joinBody: 'Enter the 8-character code from the invite message.',
  codeLabel: 'Invite code',
  paste: 'Paste',
  pasteEmpty: 'Copy the invite message or code first, then tap Paste.',
  checking: 'Checking the code…',
  cantJoin: 'Can’t join this Circle',
  previewTitle: (name: string) => `Join “${name}”?`,
  previewBody: (who: string, members: number) =>
    `${who || 'Someone'} invited you. ${members === 1 ? '1 person is' : `${members} people are`} in it. Your location stays private until you turn sharing on.`,
  join: 'Join',
  otherCode: 'Use a different code',
  alreadyIn: (name: string) => `You’re already in “${name}”.`,
  joined: (name: string) => `You joined “${name}”. Turn on sharing below when you’re ready.`,
  more: 'Join or make another Circle',
  less: 'Close',

  // Picking a Circle
  circlesLabel: 'Your Circles',

  // Map
  mapEmpty: 'Nobody in this Circle is sharing their location yet.',
  mapNote: 'Positions update about every 100 m or every minute.',
  liveChip: 'Live',
  liveNote: 'Updating every few seconds while you watch. If someone’s app is closed, live starts when they next move.',
  livePaused: 'Live view paused after 10 minutes, to save your family’s battery.',
  liveResume: 'Watch live again',

  // My sharing
  sharingTitle: 'Share my location',
  sharingOn: 'People in this Circle can see where you are and your battery.',
  sharingOff: 'Your location is private. Nobody in this Circle can see it.',
  sharingSwitch: 'Share my location with this Circle',
  disclosureTitle: 'Before you share',
  disclosureBody: `${brand.appName} will share your location and battery with the people in this Circle, also while the app is closed. Your phone will ask for permission next: choose “Allow all the time” (or “Always”) so sharing keeps working. You can turn it off here at any time.`,
  disclosureContinue: 'Continue',
  cancel: 'Cancel',
  deniedTitle: 'Location is turned off for this app',
  deniedBody: `Open your phone’s settings, choose ${brand.appName}, then Location, and allow it.`,
  openSettings: 'Open settings',
  whileUsingTitle: 'Sharing stops when the app is closed',
  whileUsingBody: 'Allow location “all the time” (or “Always”) so your family keeps seeing you.',
  allowAlways: 'Allow all the time',
  webNote: 'Sharing your own location works in the phone app. Here you can see your Circle.',
  sharingFailed: 'Couldn’t change your sharing. Try again.',

  // Members
  membersTitle: 'People',
  you: 'You',
  owner: 'Owner',
  notSharing: 'Not sharing',
  waiting: 'Sharing · waiting for a position',
  seen: (when: string) => `Seen ${when}`,
  remove: 'Remove',
  removeConfirm: 'Yes, remove',
  removeWarning: (name: string) => `${name} will leave this Circle and stop seeing everyone in it.`,
  removeFailed: 'Couldn’t remove them. Try again.',
  leave: 'Leave this Circle',
  leaveConfirm: 'Yes, leave',
  leaveWarning: 'You’ll stop seeing this Circle, and its people will stop seeing you.',
  leaveFailed: 'Couldn’t leave the Circle. Try again.',

  // Invites (owners)
  inviteTitle: 'Invite someone',
  inviteBody: 'Anyone with the app can join, even if they don’t live in the compound. A code works once, for 24 hours.',
  invite: 'Make an invite code',
  inviteFailed: 'Couldn’t make an invite. Try again.',
  share: 'Share code',
  shareTitle: 'Family Circle invite',
  shareWhat: 'Invite',
  codeExpires: (hours: number) => `Works for ${hours} more hour${hours === 1 ? '' : 's'}`,
  openInvites: 'Codes not used yet',
  cancelInvite: 'Cancel code',
  memberOnly: 'Only an owner of the Circle can invite people.',
} as const;
