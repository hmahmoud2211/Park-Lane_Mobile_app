import type { IconSet } from '../components/ui/ServiceTile';
import type { ParamlessRoute, RootStackParamList } from '../types/navigation.types';

export interface NavTab {
  id: string;
  label: string;
  iconSet: IconSet;
  iconName: string;
  route?: ParamlessRoute;
  /** Opens the "Under Development" placeholder until the tab's screen exists. */
  underDevelopment?: boolean;
}

/**
 * The app's main navigation, shared by the phone's bottom bar and the side
 * rail tablets and desktops get instead. Add or reorder tabs here and both
 * follow.
 */
export const HOME_TAB: NavTab = {
  id: 'home',
  label: 'Home',
  iconSet: 'ionicons',
  iconName: 'home-outline',
  route: 'Home',
};

/** Either side of the bottom bar's raised Home button. */
export const LEFT_TABS: readonly NavTab[] = [
  { id: 'ems-ai', label: 'EMS AI', iconSet: 'material', iconName: 'robot-outline', route: 'Assistant' },
  { id: 'contact', label: 'Contact Us', iconSet: 'ionicons', iconName: 'call-outline', underDevelopment: true },
];
export const RIGHT_TABS: readonly NavTab[] = [
  { id: 'services', label: 'Services', iconSet: 'ionicons', iconName: 'grid-outline', route: 'Services' },
  { id: 'settings', label: 'Settings', iconSet: 'ionicons', iconName: 'settings-outline', route: 'Settings' },
];

/** The rail lists Home first, then the bar's tabs in order. */
export const RAIL_TABS: readonly NavTab[] = [HOME_TAB, ...LEFT_TABS, ...RIGHT_TABS];

export interface CurrentRoute {
  name: keyof RootStackParamList;
  params?: object;
}

/** Whether `tab` is the page on screen. The placeholder page lights the tab that opened it. */
export function isTabActive(tab: NavTab, current: CurrentRoute | undefined): boolean {
  if (!current) {
    return false;
  }
  if (tab.underDevelopment) {
    return (
      current.name === 'UnderDevelopment' &&
      (current.params as RootStackParamList['UnderDevelopment'] | undefined)?.title === tab.label
    );
  }
  return tab.route === current.name;
}
