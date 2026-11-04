import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback, useMemo, useState } from 'react';

import type { AppMenuItem } from '../components/ui/AppMenu';
import type { RootStackParamList } from '../types/navigation.types';

/**
 * Logging out: back to the sign-in screen, with the stack reset so back cannot
 * return to where the resident was.
 *
 * Frontend only: the login is not wired to a backend, so there is no session to
 * clear, and it deliberately leaves the EMS smart-home session alone, as before.
 * TODO(auth): clear the stored session here once one exists.
 */
export function useLogout(): () => void {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  return useCallback(() => {
    navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
  }, [navigation]);
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
