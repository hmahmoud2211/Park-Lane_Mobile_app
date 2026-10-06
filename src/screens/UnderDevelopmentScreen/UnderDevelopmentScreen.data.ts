/** Copy for the placeholder shown by features whose screens are still being built. */
export const underDevelopmentCopy = {
  badge: 'Coming Soon',
  heading: 'Under Development',
  body: (feature: string) =>
    `We're putting the finishing touches on ${feature}. It will be available in an upcoming update.`,
  cta: 'Back to Home',
} as const;
