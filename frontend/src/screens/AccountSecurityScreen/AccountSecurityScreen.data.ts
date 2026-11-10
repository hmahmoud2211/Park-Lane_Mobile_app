import type { IconSet } from '../../types/icons.types';

/** Copy for Account & security (no Figma reference; set like the Settings rows). */
export const accountSecurityCopy = {
  title: 'Account & security',
  subtitle: (email: string) => `Signed in as ${email}`,
  guestSubtitle: 'Sign in to manage your account.',
  guestTitle: 'You are not signed in',
  guestBody: 'Your password, your phones and deleting your account are managed after signing in.',
  signIn: 'Sign in',
  confirmOthersTitle: 'Sign out your other phones?',
  confirmOthersBody: 'Every phone signed in to this account, except this one, is signed out, and loses access to your apartment’s devices within a few minutes.',
  confirmOthers: 'Sign out other phones',
  cancel: 'Cancel',
  othersDone: (count: number) =>
    count === 0 ? 'No other phone was signed in.' : `${count} other ${count === 1 ? 'phone was' : 'phones were'} signed out.`,
} as const;

export type AccountActionId = 'password' | 'others' | 'delete';

export interface AccountAction {
  id: AccountActionId;
  title: string;
  description: string;
  iconSet: IconSet;
  iconName: string;
}

export const accountActions: readonly AccountAction[] = [
  {
    id: 'password',
    title: 'Change password',
    description: 'Choose a new password for this account.',
    iconSet: 'ionicons',
    iconName: 'key-outline',
  },
  {
    id: 'others',
    title: 'Sign out other phones',
    description: 'For a lost or old phone: end every other sign-in.',
    iconSet: 'ionicons',
    iconName: 'phone-portrait-outline',
  },
  {
    id: 'delete',
    title: 'Delete account',
    description: 'Delete your account and its data permanently.',
    iconSet: 'ionicons',
    iconName: 'trash-outline',
  },
];
