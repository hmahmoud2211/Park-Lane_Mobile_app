/**
 * Static copy and configuration for the login screen. Text matches the Figma
 * screen exactly and must not be reworded here.
 */

export type SignInMethodId = 'biometric' | 'guest';

export interface SignInMethod {
  id: SignInMethodId;
  label: string;
}

export const signInMethods: readonly SignInMethod[] = [
  // Face and fingerprint are one option: the OS picks whichever sensor exists.
  { id: 'biometric', label: 'Biometric' },
  // Skips the form and opens Home without a resident; see LoginScreen.
  { id: 'guest', label: 'Continue\nas Guest' },
];

export const loginCopy = {
  headingLead: 'Welcome',
  headingAccent: 'Back',
  subtitle: 'Sign in to your Parklane account',
  emailLabel: 'Email or Username',
  passwordLabel: 'Password',
  forgotPassword: 'Forget Password?',
  submit: 'Sign in',
  divider: 'OR',
} as const;

/** Deliberately permissive: enough to catch typos, not to police addresses. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface LoginErrors {
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
