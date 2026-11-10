import { tabStorage } from '../../../lib/storage/tabStorage';

const KEY = 'assistant.ai-consent.v1';

/** The web build asks again in each browser tab, like its sign-in (tabStorage). */
export const consentStore = {
  read: async (): Promise<boolean> => tabStorage()?.getItem(KEY) != null,
  save: async (): Promise<void> => tabStorage()?.setItem(KEY, new Date().toISOString()),
};
