import Ionicons from '@expo/vector-icons/Ionicons';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { LinearGradient } from 'expo-linear-gradient';
import { useMemo } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { useAppTheme } from '../../hooks/useAppTheme';
import type { ParamlessRoute, RootStackParamList } from '../../types/navigation.types';
import type { AppTheme } from '../../types/theme.types';
import { AppIcon } from '../common/AppIcon';
import { AppText } from '../common/AppText';
import { GradientText } from '../common/GradientText';
import { BlurTargetContext } from '../common/BlurTarget';
import { GlassSurface } from '../common/GlassSurface';
import type { IconSet } from '../ui/ServiceTile';

export interface BottomBarProps {
  /**
   * Horizontal padding of the view the bar sits in, so the bar lands at the
   * same place on screen whether or not that view is inset by a gutter.
   */
  inset?: number;
  style?: StyleProp<ViewStyle>;
}

type Route = keyof RootStackParamList;

interface NavTab {
  id: string;
  label: string;
  iconSet: IconSet;
  iconName: string;
  route?: ParamlessRoute;
  /** Opens the "Under Development" placeholder until the tab's screen exists. */
  underDevelopment?: boolean;
}

/** Two tabs either side of the raised Home button. */
const LEFT_TABS: readonly NavTab[] = [
  { id: 'ems-ai', label: 'EMS AI', iconSet: 'material', iconName: 'robot-outline', route: 'Assistant' },
  { id: 'contact', label: 'Contact Us', iconSet: 'ionicons', iconName: 'call-outline', underDevelopment: true },
];
const RIGHT_TABS: readonly NavTab[] = [
  { id: 'services', label: 'Services', iconSet: 'ionicons', iconName: 'grid-outline', underDevelopment: true },
  // Account settings live on the Profile screen for now.
  { id: 'settings', label: 'Settings', iconSet: 'ionicons', iconName: 'settings-outline', route: 'Profile' },
];

/*
 * Proportions read from the navbar reference: the Home disc breaks out of the
 * top of the bar, sits in a dark seat inside a faint halo, and its label lines
 * up with the other tabs' labels just beneath it.
 */
const ICON_SIZE = 21;
const ICON_GAP = 4;
const LABEL_HEIGHT = 11;
const HOME_SIZE = 48;
const HOME_SEAT = 4;
const HOME_HALO = 7;
/** Space between the halo's bottom edge and the "HOME" label. */
const HOME_LABEL_GAP = 3;
/** The active tab's underline, just beneath its label. */
const INDICATOR_GAP = 4;
const INDICATOR_WIDTH = 16;
const INDICATOR_HEIGHT = 2.5;

/**
 * One size and place for the bar on every screen: 62dp tall, 20dp in from
 * each side of the screen and 16dp up from the bottom, as on Home.
 */
const NAV_BAR_HEIGHT = 62;
const NAV_BAR_SIDE = 20;
const NAV_BAR_BOTTOM = 16;

/** How far the Home halo rises above the top of the bar. */
const HOME_OVERHANG = (() => {
  const halo = HOME_SIZE + HOME_SEAT * 2 + HOME_HALO * 2;
  const labelTop = (NAV_BAR_HEIGHT - (ICON_SIZE + ICON_GAP + LABEL_HEIGHT)) / 2 + ICON_SIZE + ICON_GAP;
  return Math.max(0, halo + HOME_LABEL_GAP - labelTop);
})();

/**
 * Space from the bottom of the screen to the top of the Home halo. Scrolling
 * screens pad their content by this (plus their own gap) so the last item
 * clears the bar.
 */
export const NAV_BAR_CLEARANCE = NAV_BAR_BOTTOM + NAV_BAR_HEIGHT + HOME_OVERHANG;

/**
 * The glass navigation bar pinned at the bottom of every main screen: EMS AI
 * and Contact Us on the left, Services and Settings on the right, and a raised
 * Home button in the middle.
 *
 * The bar floats over scrolling content, but the Android blur samples only the
 * screen photo (see BlurTarget) and would paint it over the cards beneath,
 * making the bar look solid. So it opts out of the target and keeps the
 * translucent tint there.
 */
export function BottomBar({ inset = 0, style }: BottomBarProps) {
  const theme = useAppTheme();
  const height = NAV_BAR_HEIGHT;
  const styles = useMemo(() => createStyles(theme, height), [theme, height]);
  const placement = useMemo<ViewStyle>(
    () => ({
      position: 'absolute',
      left: NAV_BAR_SIDE - inset,
      right: NAV_BAR_SIDE - inset,
      bottom: NAV_BAR_BOTTOM,
    }),
    [inset],
  );
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute();
  const current = route.name as Route;
  // On the placeholder page, the tab that opened it is the active one.
  const placeholderTitle =
    current === 'UnderDevelopment' ? (route.params as RootStackParamList['UnderDevelopment']).title : undefined;

  const isActive = (tab: NavTab) =>
    tab.underDevelopment ? placeholderTitle === tab.label : tab.route === current;

  const go = (tab: NavTab) => {
    if (isActive(tab)) {
      return;
    }
    if (tab.route) {
      navigation.navigate(tab.route);
    } else if (tab.underDevelopment) {
      navigation.navigate('UnderDevelopment', {
        title: tab.label,
        iconSet: tab.iconSet,
        iconName: tab.iconName,
      });
    }
  };

  // The active tab is lit like the CTAs: white glyph, gradient label, a glowing underline.
  const renderLabel = (label: string, active: boolean) =>
    active ? (
      <>
        <GradientText variant="navLabel" colors={labelGradient} style={styles.label}>
          {label.toUpperCase()}
        </GradientText>
        <LinearGradient
          colors={[theme.colors.ctaSky, theme.colors.ctaViolet, theme.colors.ctaPink]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={styles.indicator}
        />
      </>
    ) : (
      <AppText variant="navLabel" color={theme.colors.navLabel} numberOfLines={1} style={styles.label}>
        {label}
      </AppText>
    );

  const renderTab = (tab: NavTab) => {
    const active = isActive(tab);
    return (
      <Pressable
        key={tab.id}
        onPress={() => go(tab)}
        accessibilityRole="tab"
        accessibilityState={{ selected: active }}
        accessibilityLabel={tab.label}
        style={({ pressed }) => [styles.tab, pressed && styles.pressed]}
      >
        <AppIcon
          set={tab.iconSet}
          name={tab.iconName}
          size={ICON_SIZE}
          color={active ? theme.colors.textPrimary : theme.colors.navLabel}
        />
        {renderLabel(tab.label, active)}
      </Pressable>
    );
  };

  const homeActive = current === 'Home';
  const labelGradient = [theme.colors.electricCyan, theme.colors.frameGradientEnd] as const;

  return (
    <View style={[placement, style]}>
      <BlurTargetContext.Provider value={null}>
        <GlassSurface radius={height / 2} style={styles.surface}>
          {LEFT_TABS.map(renderTab)}
          {/* The Home disc floats above this cell; only its label sits in the bar. */}
          <View style={styles.tab} pointerEvents="none">
            <View style={styles.iconSlot} />
            {renderLabel('Home', homeActive)}
          </View>
          {RIGHT_TABS.map(renderTab)}
        </GlassSurface>
      </BlurTargetContext.Provider>

      <LinearGradient
        colors={[theme.colors.navHaloFrom, theme.colors.navHaloTo]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.homeHalo}
        pointerEvents="box-none"
      >
        <Pressable
          onPress={() => (homeActive ? undefined : navigation.popTo('Home'))}
          accessibilityRole="tab"
          accessibilityState={{ selected: homeActive }}
          accessibilityLabel="Home"
          style={({ pressed }) => [styles.homeSeat, pressed && styles.pressed]}
        >
          <LinearGradient
            colors={[
              theme.colors.ctaSky,
              theme.colors.ctaRoyal,
              theme.colors.ctaViolet,
              theme.colors.ctaPink,
            ]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.homeDisc}
          >
            <LinearGradient
              colors={[theme.colors.navGloss, theme.colors.navGlossEdge]}
              start={{ x: 0.5, y: 0 }}
              end={{ x: 0.5, y: 1 }}
              style={styles.gloss}
              pointerEvents="none"
            />
            <Ionicons name="home" size={22} color={theme.colors.textPrimary} />
          </LinearGradient>
        </Pressable>
      </LinearGradient>
    </View>
  );
}

function createStyles(theme: AppTheme, height: number) {
  const seat = HOME_SIZE + HOME_SEAT * 2;
  const halo = seat + HOME_HALO * 2;
  // Where the tab labels start, so the disc can sit just above "HOME".
  const contentTop = (height - (ICON_SIZE + ICON_GAP + LABEL_HEIGHT)) / 2;
  const labelTop = contentTop + ICON_SIZE + ICON_GAP;
  const haloTop = labelTop - HOME_LABEL_GAP - halo;

  return StyleSheet.create({
    surface: {
      height,
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: theme.spacing.xs,
    },
    tab: {
      flex: 1,
      height: '100%',
      alignItems: 'center',
      justifyContent: 'center',
    },
    iconSlot: {
      height: ICON_SIZE,
    },
    label: {
      marginTop: ICON_GAP,
    },
    homeHalo: {
      position: 'absolute',
      top: haloTop,
      left: '50%',
      marginLeft: -halo / 2,
      width: halo,
      height: halo,
      borderRadius: halo / 2,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: theme.glass.strokeWidth,
      borderColor: theme.colors.navHaloStroke,
    },
    homeSeat: {
      width: seat,
      height: seat,
      borderRadius: seat / 2,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.colors.backgroundDeep,
      ...theme.shadows.glow,
      shadowColor: theme.colors.violet,
    },
    homeDisc: {
      width: HOME_SIZE,
      height: HOME_SIZE,
      borderRadius: HOME_SIZE / 2,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: theme.glass.strokeWidth,
      borderColor: theme.colors.frameStroke,
      overflow: 'hidden',
    },
    gloss: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      height: HOME_SIZE / 2,
    },
    indicator: {
      position: 'absolute',
      top: labelTop + LABEL_HEIGHT + INDICATOR_GAP,
      width: INDICATOR_WIDTH,
      height: INDICATOR_HEIGHT,
      borderRadius: INDICATOR_HEIGHT / 2,
      ...theme.shadows.glow,
      shadowColor: theme.colors.magenta,
      shadowOffset: { width: 0, height: 0 },
      shadowRadius: 6,
      shadowOpacity: 0.8,
    },
    pressed: {
      opacity: 0.8,
      transform: [{ scale: 0.97 }],
    },
  });
}
