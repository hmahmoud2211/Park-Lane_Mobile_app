import { emsConfig } from './ems';
import { env } from './env';

/**
 * The privacy policy, account deletion and support addresses the app links to (Settings,
 * Help & Support, creating an account). The backend serves the policy and the deletion page
 * (backend/src/public), so by default they follow EXPO_PUBLIC_DEVICE_BACKEND_URL.
 */
const backend = emsConfig.url;

export const legal = {
  /** The policy the store listings link to as well. */
  privacyPolicyUrl: (env.privacyPolicyUrl ?? '').trim() || (backend ? `${backend}/privacy` : null),
  /** Deleting an account without the app (Google Play asks for this address too). */
  accountDeletionUrl: backend ? `${backend}/account/delete` : null,
  /** Unset: Help & Support asks the resident to contact building management instead. */
  supportEmail: (env.supportEmail ?? '').trim() || null,
} as const;
