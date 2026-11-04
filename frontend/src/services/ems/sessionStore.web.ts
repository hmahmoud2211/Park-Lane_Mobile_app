/**
 * Web has no secure store, so the web build keeps the session for the tab
 * only (sessionStorage): closing the tab signs out.
 */
const KEY = 'ems.session';

function storage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

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
