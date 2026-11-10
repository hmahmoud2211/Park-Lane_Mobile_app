/**
 * Copy for deleting an account (no Figma reference). It must match what the backend does
 * (backend/src/ems/accountDeletion.ts) and what the privacy policy says (backend/src/public).
 */
export const deleteAccountCopy = {
  title: 'Delete account',
  subtitle: 'This happens at once and cannot be undone.',
  deletedHeading: 'What is deleted',
  deleted: [
    'Your name, email and password, and every sign-in on your phones.',
    'Your place in your apartment, and your access to its devices and gateway.',
    'Your Health Passport: profiles, records, documents and summaries, and records shared with you or by you.',
    'Upcoming clinic appointments are cancelled.',
  ],
  keptHeading: 'What is kept',
  kept: [
    'The clinic’s record of visits that already happened, which clinics must keep as medical records. It is no longer linked to your name or email.',
    'The building’s log of device actions, no longer linked to you.',
    'Brand accounts linked to your apartment’s home hub belong to the apartment. Remove them in My Devices first if you want them gone.',
  ],
  passwordLabel: 'Your password',
  passwordMissing: 'Enter your password to confirm it is you.',
  understand: 'I understand my account and its data will be deleted permanently.',
  submit: 'Delete my account',
  show: 'Show password',
  hide: 'Hide password',
  guestTitle: 'You are not signed in',
  guestBody: 'Sign in to the account you want to delete.',
  signIn: 'Sign in',
} as const;
