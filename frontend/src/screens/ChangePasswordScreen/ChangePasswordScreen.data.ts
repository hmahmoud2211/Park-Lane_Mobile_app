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

/** Each field's problem, worded; a field without one has none. */
export function problemText(problems: PasswordProblems): { current?: string; next?: string; confirm?: string } {
  return {
    current: problems.current && PROBLEM_TEXT.current[problems.current],
    next: problems.next && PROBLEM_TEXT.next[problems.next],
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
