import { flags } from '../../config/flags';

/**
 * Static copy and configuration for the login screen. Text matches the Figma
 * screen, except "Forgot password?" (the design's "Forget Password?" is a typo).
 */

export type SignInMethodId = 'biometric' | 'guest';

export interface SignInMethod {
  id: SignInMethodId;
  label: string;
}

const allSignInMethods: readonly SignInMethod[] = [
  // Face and fingerprint are one option: the OS picks whichever sensor exists.
  { id: 'biometric', label: 'Biometric' },
  // Skips the form and opens Home without a resident; see LoginScreen.
  { id: 'guest', label: 'Continue\nas Guest' },
];

/** Biometric sign-in isn't built yet, so the store build doesn't offer it. */
export const signInMethods: readonly SignInMethod[] = flags.sampleContent
  ? allSignInMethods
  : allSignInMethods.filter((method) => method.id !== 'biometric');

export const loginCopy = {
  headingLead: 'Welcome',
  headingAccent: 'Back',
  subtitle: 'Sign in to your Parklane account',
  emailLabel: 'Email or Username',
  passwordLabel: 'Password',
  forgotPassword: 'Forgot password?',
  /** There is no self-service reset: building management issues a temporary password (admin dashboard). */
  forgotPasswordHelp:
    'Ask Park Lane building management to reset your password. They give you a temporary password; when you sign in with it, the app asks you to choose your own.',
  submit: 'Sign in',
  divider: 'OR',
  /** While a sign-in kept from last time is checked. */
  checking: 'Checking your sign-in…',
} as const;

/** Deliberately permissive: enough to catch typos, not to police addresses. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Creating an account, which the Figma screen does not draw: the fields and links around the form. */
export const accountCopy = {
  nameLabel: 'Full name',
  createLink: 'Create account',
  signInLink: 'I already have an account',
  subtitle: 'Create your Parklane account',
  submit: 'Create account',
  consentLead: 'By creating an account you agree to our ',
  privacyLink: 'Privacy Policy',
  consentEnd: '.',
} as const;

export type LoginMode = 'signIn' | 'create';

export interface LoginErrors {
  name?: string;
  email?: string;
  password?: string;
}

export function validateLogin(email: string, password: string): LoginErrors {
  const errors: LoginErrors = {};

  const trimmed = email.trim();
  if (!trimmed) {
    errors.email = 'Enter your email or username';
  } else if (trimmed.includes('@') && !EMAIL_PATTERN.test(trimmed)) {
    errors.email = 'Enter a valid email address';
  }

  if (!password) {
    errors.password = 'Enter your password';
  }

  return errors;
}

/** The backend's own rules for a new account, said before the request is sent. */
export function validateNewAccount(name: string, email: string, password: string): LoginErrors {
  const errors = validateLogin(email, password);
  if (!name.trim()) {
    errors.name = 'Enter your name';
  }
  if (!errors.email && !email.includes('@')) {
    errors.email = 'Enter a valid email address';
  }
  if (!errors.password && password.length < 8) {
    errors.password = 'Use at least 8 characters';
  }
  return errors;
}
