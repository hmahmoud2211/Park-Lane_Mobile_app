import { MIN_PASSWORD_LENGTH, type PasswordChangeFailure, type PasswordProblems } from '../../features/ems/services/passwordChange';

/** Copy for choosing one's own password after signing in with a temporary one. */
export const changePasswordCopy = {
  headingLead: 'Choose your',
  headingAccent: 'own password',
  intro: 'Your account was created with a temporary password. Choose your own to continue.',
  signedInAs: (email: string) => `Signed in as ${email}`,
  currentLabel: 'Temporary password',
  nextLabel: 'New password',
  confirmLabel: 'Confirm new password',
  rules: `At least ${MIN_PASSWORD_LENGTH} characters, not your email and not the temporary password.`,
  show: 'Show passwords',
  hide: 'Hide passwords',
  submit: 'Save and continue',
  signOut: 'Sign out',
} as const;

/** The same form opened from Account & security, to change a password the resident already chose. */
export const voluntaryPasswordCopy = {
  ...changePasswordCopy,
  headingLead: 'Change your',
  headingAccent: 'password',
  intro: 'Choose a new password. Your other phones are signed out; this one stays signed in.',
  currentLabel: 'Current password',
  rules: `At least ${MIN_PASSWORD_LENGTH} characters, not your email and not your current password.`,
  submit: 'Save new password',
} as const;

const PROBLEM_TEXT = {
  current: { required: 'Enter the temporary password' },
  next: {
    required: 'Choose a new password',
    short: `Use at least ${MIN_PASSWORD_LENGTH} characters`,
    same: 'Use a password different from the temporary one',
    email: 'Don’t use your email as your password',
  },
  confirm: { required: 'Enter the new password again', mismatch: 'The passwords don’t match' },
} as const;

const VOLUNTARY_TEXT = {
  current: { required: 'Enter your current password' },
  same: 'Use a password different from your current one',
} as const;

/** Each field's problem, worded; a field without one has none. */
export function problemText(problems: PasswordProblems, voluntary = false): { current?: string; next?: string; confirm?: string } {
  return {
    current: problems.current && (voluntary ? VOLUNTARY_TEXT.current : PROBLEM_TEXT.current)[problems.current],
    next: problems.next && (voluntary && problems.next === 'same' ? VOLUNTARY_TEXT.same : PROBLEM_TEXT.next[problems.next]),
    confirm: problems.confirm && PROBLEM_TEXT.confirm[problems.confirm],
  };
}

/** A refused change: the backend's own words for its rules, ours for the rest. */
export function failureText(failure: PasswordChangeFailure, message: string): string {
  switch (failure) {
    case 'wrong_current':
      return 'The temporary password isn’t right.';
    case 'rate_limited':
      return 'Too many tries. Wait a few minutes, then try again.';
    case 'rules':
    case 'other':
      return message;
  }
}
