import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useContext } from 'react';

import { ShellContext } from '../context/ShellContext';

/**
 * Puts the side rail beside the calling screen while it is focused, on
 * screens wide enough for one. Returns true when the rail is standing in for
 * the bottom bar, so the caller can leave the bar out.
 *
 * Focus rather than mount decides it: the web stack keeps earlier screens
 * mounted beneath the current one.
 */
export function useSideNav(): boolean {
  const shell = useContext(ShellContext);
  const request = shell?.requestSideNav;

  useFocusEffect(
    useCallback(() => {
      if (!request) {
        return undefined;
      }
      return request();
    }, [request]),
  );

  return shell?.sideNavAvailable ?? false;
}
