import { LinearGradient } from 'expo-linear-gradient';
import { memo, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet } from 'react-native';

import { useAppTheme } from '../../hooks/useAppTheme';
import { RAIL_TABS, isTabActive, type CurrentRoute, type NavTab } from '../../navigation/navTabs';
import type { AppTheme } from '../../types/theme.types';
import { AppIcon } from '../common/AppIcon';
import { AppText } from '../common/AppText';
import { BlurTargetContext } from '../common/BlurTarget';
import { GlassSurface } from '../common/GlassSurface';
import { GradientText } from '../common/GradientText';
import { BrandLockup } from './BrandLockup';

export interface SideNavProps {
  current: CurrentRoute | undefined;
  onSelect: (tab: NavTab) => void;
  /** Icon beside label with the wordmark on top; otherwise icon over label. */
  expanded: boolean;
}

const RADIUS = 28;
const ICON_SIZE = 22;
const ITEM_HEIGHT_COMPACT = 64;
const ITEM_HEIGHT_EXPANDED = 48;
const ITEM_RADIUS = 16;
/** The Home item keeps the bottom bar's gradient disc, a size down. */
const HOME_DISC = 40;
const INDICATOR_WIDTH = 3;
const INDICATOR_HEIGHT = 22;

/**
 * The app's main navigation on tablets and desktops: the bottom bar's tabs
 * stood up along the left edge, on the same glass. It lives outside the
 * navigator (see AppShell), so it stays put while pages change beside it.
 */
export const SideNav = memo(function SideNav({ current, onSelect, expanded }: SideNavProps) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme, expanded), [theme, expanded]);

  return (
    <BlurTargetContext.Provider value={null}>
      <GlassSurface radius={RADIUS} style={styles.surface}>
        {/* Scrolls only where the rail is shorter than its items, e.g. a phone in landscape. */}
        <ScrollView
          accessibilityRole="tablist"
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          bounces={false}
        >
          {expanded ? <BrandLockup style={styles.brand} /> : null}
          {RAIL_TABS.map((tab) => (
            <RailItem
              key={tab.id}
              tab={tab}
              active={isTabActive(tab, current)}
              expanded={expanded}
              styles={styles}
              onPress={onSelect}
            />
          ))}
        </ScrollView>
      </GlassSurface>
    </BlurTargetContext.Provider>
  );
});

interface RailItemProps {
  tab: NavTab;
  active: boolean;
  expanded: boolean;
  styles: ReturnType<typeof createStyles>;
  onPress: (tab: NavTab) => void;
}

function RailItem({ tab, active, expanded, styles, onPress }: RailItemProps) {
  const theme = useAppTheme();
  const [hovered, setHovered] = useState(false);
  const isHome = tab.id === 'home';
  const glyphColor = active ? theme.colors.textPrimary : theme.colors.navLabel;

  const icon = isHome ? (
    <LinearGradient
      colors={[theme.colors.ctaSky, theme.colors.ctaRoyal, theme.colors.ctaViolet, theme.colors.ctaPink]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[styles.homeDisc, !active && styles.homeDiscIdle]}
    >
      <AppIcon set="ionicons" name="home" size={18} color={theme.colors.textPrimary} />
    </LinearGradient>
  ) : (
    <AppIcon set={tab.iconSet} name={tab.iconName} size={ICON_SIZE} color={glyphColor} />
  );

  const labelVariant = expanded ? 'bodyStrong' : 'navLabel';
  const label = active ? (
    <GradientText
      variant={labelVariant}
      colors={[theme.colors.electricCyan, theme.colors.frameGradientEnd]}
      style={styles.label}
    >
      {expanded ? tab.label : tab.label.toUpperCase()}
    </GradientText>
  ) : (
    <AppText variant={labelVariant} color={glyphColor} numberOfLines={1} style={styles.label}>
      {tab.label}
    </AppText>
  );

  return (
    <Pressable
      onPress={() => (active ? undefined : onPress(tab))}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      accessibilityLabel={tab.label}
      style={({ pressed }) => [
        styles.item,
        hovered && !active && styles.itemHovered,
        pressed && styles.pressed,
      ]}
    >
      {active ? (
        <>
          <LinearGradient
            colors={[theme.colors.navActiveFrom, theme.colors.navActiveTo]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          />
          <LinearGradient
            colors={[theme.colors.ctaSky, theme.colors.ctaViolet, theme.colors.ctaPink]}
            start={{ x: 0, y: 0 }}
            end={{ x: 0, y: 1 }}
            style={styles.indicator}
            pointerEvents="none"
          />
        </>
      ) : null}
      {icon}
      {label}
    </Pressable>
  );
}

function createStyles(theme: AppTheme, expanded: boolean) {
  return StyleSheet.create({
    surface: {
      flex: 1,
    },
    list: {
      flexGrow: 1,
      paddingVertical: theme.spacing.lg,
      paddingHorizontal: expanded ? theme.spacing.md : theme.spacing.sm,
      gap: theme.spacing.xs,
    },
    brand: {
      alignSelf: 'center',
      marginBottom: theme.spacing.lg,
    },
    item: {
      height: expanded ? ITEM_HEIGHT_EXPANDED : ITEM_HEIGHT_COMPACT,
      flexDirection: expanded ? 'row' : 'column',
      alignItems: 'center',
      justifyContent: expanded ? 'flex-start' : 'center',
      paddingHorizontal: expanded ? theme.spacing.md : 0,
      gap: expanded ? theme.spacing.md - 2 : theme.spacing.xs,
      borderRadius: ITEM_RADIUS,
      overflow: 'hidden',
    },
    itemHovered: {
      backgroundColor: theme.colors.navHover,
    },
    label: expanded ? {} : { maxWidth: '100%' },
    homeDisc: {
      width: expanded ? 30 : HOME_DISC,
      height: expanded ? 30 : HOME_DISC,
      marginHorizontal: expanded ? -4 : 0,
      borderRadius: HOME_DISC / 2,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: theme.glass.strokeWidth,
      borderColor: theme.colors.frameStroke,
    },
    homeDiscIdle: {
      opacity: 0.75,
    },
    indicator: {
      position: 'absolute',
      left: 0,
      top: '50%',
      marginTop: -INDICATOR_HEIGHT / 2,
      width: INDICATOR_WIDTH,
      height: INDICATOR_HEIGHT,
      borderRadius: INDICATOR_WIDTH / 2,
    },
    pressed: theme.motion.pressed,
  });
}
