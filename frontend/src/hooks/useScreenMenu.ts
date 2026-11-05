import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback, useMemo, useState } from 'react';

import type { AppMenuItem } from '../components/ui/AppMenu';
import { useEms } from '../features/ems/hooks/useEms';
import type { RootStackParamList } from '../types/navigation.types';

/**
 * Logging out: ends the session, then back to the sign-in screen, with the stack
 * reset so back cannot return to where the resident was. In that order, because
 * the sign-in screen passes a live session straight through to Home.
 */
export function useLogout(): () => void {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { signOut } = useEms();
  return useCallback(() => {
    void signOut().finally(() => navigation.reset({ index: 0, routes: [{ name: 'Login' }] }));
  }, [navigation, signOut]);
}

/**
 * The menu behind a screen header's menu button: whether it is open, and its
 * "Log out" item. Screens with more items list them before `logoutItem`; the
 * others use `menuItems` as it is.
 */
export function useScreenMenu() {
  const leave = useLogout();
  const [menuOpen, setMenuOpen] = useState(false);

  const logout = useCallback(() => {
    setMenuOpen(false);
    leave();
  }, [leave]);

  const logoutItem = useMemo<AppMenuItem>(
    () => ({ id: 'logout', label: 'Log out', icon: 'log-out-outline', onPress: logout }),
    [logout],
  );
  const menuItems = useMemo<readonly AppMenuItem[]>(() => [logoutItem], [logoutItem]);

  return { menuOpen, setMenuOpen, logout, logoutItem, menuItems };
}
