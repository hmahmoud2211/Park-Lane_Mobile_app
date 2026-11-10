import { secureStorage } from '../../../lib/storage/secureStorage';

/** Bump to ask again when what is shared with the assistant's AI providers changes. */
const KEY = 'assistant.ai-consent.v1';

/** Whether this phone's resident agreed to the assistant's use of AI providers. */
export const consentStore = {
  read: async (): Promise<boolean> => (await secureStorage.getItem(KEY)) !== null,
  save: (): Promise<void> => secureStorage.setItem(KEY, new Date().toISOString()),
};
