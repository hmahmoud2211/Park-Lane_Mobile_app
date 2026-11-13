import { useEffect, useRef } from 'react';
import { Linking, Platform } from 'react-native';

import { codeFromLink } from '../services/unitRules';

/**
 * Calls `open` with the code of a family invite link the app was opened with
 * (parklane://join/K7Q4-9MXD, from the invite page's "Open in the Parklane app" button),
 * at launch or while running. Other links are left alone. On the web the navigator's own
 * addresses handle /join/<code>.
 */
export function useInviteLinks(open: (code: string) => void): void {
  const openRef = useRef(open);
  useEffect(() => {
    openRef.current = open;
  }, [open]);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    let cancelled = false;
    const handle = (url: string | null | undefined) => {
      const code = url ? codeFromLink(url) : null;
      if (code && !cancelled) openRef.current(code);
    };
    // Only once per launch: the initial link stays the same for the whole run.
    Linking.getInitialURL().then(handle, () => undefined);
    const subscription = Linking.addEventListener('url', ({ url }) => handle(url));
    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, []);
}
