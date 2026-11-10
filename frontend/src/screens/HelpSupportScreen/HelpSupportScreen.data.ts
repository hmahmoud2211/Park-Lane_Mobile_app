/** Copy for Help & Support (no Figma reference; set like the Settings rows and inner-screen panels). */
export const helpSupportCopy = {
  title: 'Help & Support',
  subtitle: 'Get help, and how we look after your data.',
  contactHeading: 'Contact us',
  contactBody:
    'For your apartment, access, devices or your account, contact the Park Lane building management office. They can also reset your password.',
  emailTitle: 'Email support',
  emailDescription: (email: string) => email,
  passwordHeading: 'Forgot your password?',
  passwordBody:
    'Ask building management to reset it. They give you a temporary password; when you sign in with it, the app asks you to choose your own.',
  healthHeading: 'About the health features',
  healthBody:
    'Health Passport and Clinical Appointment help you keep your family’s records and book visits at the compound’s clinic. Parklane does not give medical advice, and does not diagnose or treat any condition. Suggestions made with AI are checked by you or your doctor. Always ask a doctor or pharmacist before making a medical decision; in an emergency, call your local emergency number.',
  privacyTitle: 'Privacy policy',
  privacyDescription: 'What we collect, who receives it and how to delete it.',
  accountTitle: 'Account & security',
  accountDescription: 'Change your password, sign out other phones or delete your account.',
} as const;
