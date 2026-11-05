/**
 * The web build has no secure store, so it keeps secrets for the browser tab only
 * (sessionStorage): closing the tab forgets them. Null where there is none (a browser
 * that refuses storage, or no window at all).
 */
export function tabStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.sessionStorage : null;
  } catch {
    return null;
  }
}
