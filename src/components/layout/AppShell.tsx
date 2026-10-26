import { useCallback, useEffect, useMemo, useState, type PropsWithChildren } from 'react';
import { Animated, Platform, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ShellContext, type ShellContextValue } from '../../context/ShellContext';
import { useAppTheme } from '../../hooks/useAppTheme';
import { useReduceMotion } from '../../hooks/useReduceMotion';
import type { CurrentRoute, NavTab } from '../../navigation/navTabs';
import { breakpointFor } from '../../theme';
import { SideNav } from './SideNav';

export interface AppShellProps extends PropsWithChildren {
  current: CurrentRoute | undefined;
  onNavigate: (tab: NavTab) => void;
}

/**
 * The frame every screen is drawn in.
 *
 * Phones get the screens edge to edge, each with its own bottom bar. From
 * tablet width up, screens that have app navigation get a side rail instead.
 * The rail floats over the screen's own background, and the room it takes
 * goes out through ShellContext: ScreenWrapper insets the content by it, and
 * screens lay out for the width they really have rather than the window's.
 *
 * The element tree is the same at every size and only styles change, so
 * resizing a browser window across a breakpoint never remounts the navigator.
 */
export function AppShell({ current, onNavigate, children }: AppShellProps) {
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReduceMotion();
  const { width: windowWidth } = useWindowDimensions();
  const [requests, setRequests] = useState(0);

  const requestSideNav = useCallback(() => {
    setRequests((count) => count + 1);
    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;
      // A page change blurs one screen before focusing the next; waiting a
      // tick lets the next screen claim the rail first, so it never blinks.
      setTimeout(() => setRequests((count) => count - 1), 0);
    };
  }, []);

  const { sideNav } = theme.layout;
  const sideNavAvailable = breakpointFor(windowWidth) !== 'mobile';
  const sideNavVisible = sideNavAvailable && requests > 0;
  const expanded = windowWidth >= sideNav.expandedFrom;
  const railWidth = expanded ? sideNav.expandedWidth : sideNav.compactWidth;
  const railLeft = sideNav.inset + insets.left;
  const reserved = sideNavVisible ? railLeft + railWidth : 0;

  const value = useMemo<ShellContextValue>(
    () => ({
      windowWidth,
      frameWidth: windowWidth - reserved,
      sideNavAvailable,
      sideNavVisible,
      railReserve: reserved,
      brandInRail: sideNavVisible && expanded,
      requestSideNav,
    }),
    [windowWidth, reserved, sideNavAvailable, sideNavVisible, expanded, requestSideNav],
  );

  const [reveal] = useState(() => new Animated.Value(sideNavVisible ? 1 : 0));
  useEffect(() => {
    Animated.timing(reveal, {
      toValue: sideNavVisible ? 1 : 0,
      duration: reduceMotion ? 0 : theme.motion.duration.slow,
      useNativeDriver: Platform.OS !== 'web',
    }).start();
  }, [sideNavVisible, reduceMotion, reveal, theme]);

  return (
    <ShellContext.Provider value={value}>
      <View style={[styles.root, { backgroundColor: theme.colors.background }]}>
        {children}
        {sideNavVisible ? (
          <Animated.View
            style={[
              styles.rail,
              {
                left: railLeft,
                width: railWidth,
                top: sideNav.inset + insets.top,
                bottom: sideNav.inset + insets.bottom,
                opacity: reveal,
                transform: [
                  { translateX: reveal.interpolate({ inputRange: [0, 1], outputRange: [-theme.spacing.md, 0] }) },
                ],
              },
            ]}
          >
            <SideNav current={current} onSelect={onNavigate} expanded={expanded} />
          </Animated.View>
        ) : null}
      </View>
    </ShellContext.Provider>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    // Keeps the rail's entrance and wide pages from scrolling the window sideways.
    overflow: 'hidden',
  },
  rail: {
    position: 'absolute',
  },
});
