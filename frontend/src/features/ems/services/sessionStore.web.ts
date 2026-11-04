import { tabStorage } from '../../../lib/storage/tabStorage';

/**
 * Web has no secure store, so the web build keeps the session for the tab
 * only (sessionStorage): closing the tab signs out.
 */
const KEY = 'ems.session';
const storage = tabStorage;

export const sessionStore = {
  load: async () => {
    try {
      return storage()?.getItem(KEY) ?? null;
    } catch {
      return null;
    }
  },
  save: async (token: string) => {
    try {
      storage()?.setItem(KEY, token);
    } catch {
      // Private mode: the session lasts until reload.
    }
  },
  clear: async () => {
    try {
      storage()?.removeItem(KEY);
    } catch {
      // Nothing stored.
    }
  },
};
