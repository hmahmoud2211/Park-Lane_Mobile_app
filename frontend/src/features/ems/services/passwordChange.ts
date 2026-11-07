import type { EmsUser } from '../../../types/ems.types';

/**
 * Choosing one's own password after signing in with a temporary one (an account building
 * management created or reset). Rules only, no React or network, so they are checked on their
 * own (passwordChange.checks.ts); the words are the screen's.
 */

/** The backend's minimum, said before the request is sent. */
export const MIN_PASSWORD_LENGTH = 10;

export interface PasswordFields {
  current: string;
  next: string;
  confirm: string;
  /** The account's email, which the new password must not be. Unknown offline at launch. */
  email: string | null;
}

export interface PasswordProblems {
  current?: 'required';
  next?: 'required' | 'short' | 'same' | 'email';
  confirm?: 'required' | 'mismatch';
}

/** What the app can tell before sending; the backend checks the same rules again. */
export function passwordProblems(fields: PasswordFields): PasswordProblems {
  const problems: PasswordProblems = {};
  if (!fields.current) {
    problems.current = 'required';
  }
  if (!fields.next) {
    problems.next = 'required';
  } else if (fields.next.length < MIN_PASSWORD_LENGTH) {
    problems.next = 'short';
  } else if (fields.current && fields.next === fields.current) {
    problems.next = 'same';
  } else if (fields.email && fields.next.trim().toLowerCase() === fields.email.trim().toLowerCase()) {
    problems.next = 'email';
  }
  if (!fields.confirm) {
    problems.confirm = 'required';
  } else if (fields.confirm !== fields.next) {
    problems.confirm = 'mismatch';
  }
  return problems;
}

export const hasProblems = (problems: PasswordProblems) => Object.keys(problems).length > 0;

/**
 * The step comes before anything else when the account says so, or when any call was refused
 * with `password_change_required` (an admin reset the password after this sign-in).
 */
export function needsPasswordChange(user: Pick<EmsUser, 'mustChangePassword'> | null, refused: boolean): boolean {
  return refused || user?.mustChangePassword === true;
}

/** Where a sign-in goes next: the step, or the app. */
export function routeAfterSignIn(user: Pick<EmsUser, 'mustChangePassword'> | null, refused: boolean): 'ChangePassword' | 'Home' {
  return needsPasswordChange(user, refused) ? 'ChangePassword' : 'Home';
}

/** How a refused change is worded: a wrong temporary password, the backend's rules (its own message), too many tries, or as it came. */
export type PasswordChangeFailure = 'wrong_current' | 'rules' | 'rate_limited' | 'other';

export function passwordChangeFailure(code: string | null): PasswordChangeFailure {
  switch (code) {
    case 'unauthorized':
      return 'wrong_current';
    case 'bad_request':
      return 'rules';
    case 'rate_limited':
      return 'rate_limited';
    default:
      return 'other';
  }
}
