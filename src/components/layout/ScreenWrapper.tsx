import { useContext, useMemo, type PropsWithChildren, type ReactNode } from 'react';
import {
  ScrollView,
  StyleSheet,
  View,
  type ImageSourcePropType,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';

import { ShellContext } from '../../context/ShellContext';
import { useAppTheme } from '../../hooks/useAppTheme';
import { AppBackground } from '../common/AppBackground';

export interface ScreenWrapperProps extends PropsWithChildren {
  /** Renders the shared photo background behind the content. */
  withBackground?: boolean;
  /**
   * Overrides the background photo; defaults to the shared one. `null` drops
   * the photo so `backdrop` can paint the whole background.
   */
  backgroundSource?: ImageSourcePropType | null;
  /** Darkens the top and bottom of the background for legibility. */
  withScrim?: boolean;
  /** Flat darkening over the whole background photo, 0-1. */
  backgroundOverlay?: number;
  /** See AppBackground's `bottomAnchorAspect`. */
  backgroundBottomAnchorAspect?: number;
  /** Applies the standard horizontal gutter. */
  withGutter?: boolean;
  scrollable?: boolean;
  edges?: readonly Edge[];
  /** Decorative layers drawn above the background but below the content. */
  backdrop?: ReactNode;
  style?: StyleProp<ViewStyle>;
  contentContainerStyle?: StyleProp<ViewStyle>;
}

export function ScreenWrapper({
  withBackground = true,
  backgroundSource,
  withScrim = true,
  backgroundOverlay,
  backgroundBottomAnchorAspect,
  withGutter = false,
  scrollable = false,
  edges = ['top', 'bottom'],
  backdrop,
  style,
  contentContainerStyle,
  children,
}: ScreenWrapperProps) {
  const theme = useAppTheme();
  const railReserve = useContext(ShellContext)?.railReserve ?? 0;

  const gutterStyle = useMemo<StyleProp<ViewStyle>>(
    () => (withGutter ? { paddingHorizontal: theme.spacing.screenGutter } : null),
    [withGutter, theme],
  );

  const content = scrollable ? (
    <ScrollView
      style={styles.fill}
      contentContainerStyle={[styles.scrollContent, gutterStyle, contentContainerStyle]}
      showsVerticalScrollIndicator={false}
      bounces={false}
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[styles.fill, gutterStyle, contentContainerStyle]}>{children}</View>
  );

  const body = (
    <SafeAreaView style={[styles.fill, style]} edges={edges}>
      {/* Beside the side rail, when there is one; the background still runs under it. */}
      <View style={[styles.fill, railReserve > 0 && { marginLeft: railReserve }]}>{content}</View>
    </SafeAreaView>
  );

  if (!withBackground) {
    return <View style={[styles.fill, { backgroundColor: theme.colors.background }]}>{body}</View>;
  }

  return (
    <AppBackground
      source={backgroundSource}
      withScrim={withScrim}
      overlay={backgroundOverlay}
      bottomAnchorAspect={backgroundBottomAnchorAspect}
    >
      {backdrop}
      {body}
    </AppBackground>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
  },
});
