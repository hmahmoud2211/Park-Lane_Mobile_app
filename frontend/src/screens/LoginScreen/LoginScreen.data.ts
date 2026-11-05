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

/** Creating an account, which the Figma screen does not draw: the fields and links around the form. */
export const accountCopy = {
  nameLabel: 'Full name',
  createLink: 'Create account',
  signInLink: 'I already have an account',
  subtitle: 'Create your Parklane account',
  submit: 'Create account',
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
