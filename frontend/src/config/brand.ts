/** Names and addresses that identify the product, in one place. */
export const brand = {
  appName: 'Parklane',
  /** The voice and chat assistant, as replies are signed. */
  assistantName: 'Parklane Assistant',
  compoundName: 'Park Lane Compoundhood',
  /** How screen readers announce the wordmark. */
  wordmarkLabel: 'Park Lane Compoundhood, New Capital',
  /** app.json "scheme": the app's own links open it. */
  appScheme: 'parklane',
  /** Where a brand's browser sign-in returns to the app; the backend's APP_RETURN_URL must match. */
  accountsReturnUrl: 'parklane://accounts',
} as const;
