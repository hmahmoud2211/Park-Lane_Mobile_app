import { StatusBar } from 'expo-status-bar';
import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, View, type ScrollViewProps, type StyleProp, type ViewStyle } from 'react-native';

import { images } from '../../constants/images';
import { useScreenLayout } from '../../hooks/useScreenLayout';
import { BottomBar } from './BottomBar';
import { ScreenWrapper } from './ScreenWrapper';

export interface InnerScreenFrameProps
  extends Omit<ScrollViewProps, 'contentContainerStyle' | 'showsVerticalScrollIndicator' | 'children'> {
  /** The screen's own content style (gutter, rhythm); the responsive column style is added after it. */
  contentStyle: StyleProp<ViewStyle>;
  /** Drawn over the whole page, outside the scroll view: a menu or a sheet. */
  overlay?: ReactNode;
  children: ReactNode;
}

/**
 * The page every inner screen of the smart-home and settings area is built on: the home
 * background with a 34% overlay and no scrim, light status bar text, one scrolling column
 * that reflows on wider screens (useScreenLayout), and the bottom bar. The screen draws its
 * PageHeader and panels as children.
 *
 * Taps reach buttons while the keyboard is up (keyboardShouldPersistTaps "handled") unless
 * the screen says otherwise; every other ScrollView prop, such as refreshControl, passes
 * through.
 */
export function InnerScreenFrame({ contentStyle, overlay, children, keyboardShouldPersistTaps = 'handled', ...scrollProps }: InnerScreenFrameProps) {
  const layout = useScreenLayout();

  return (
    <ScreenWrapper backgroundSource={images.homeBackground} withScrim={false} backgroundOverlay={0.34}>
      <StatusBar style="light" />
      <View style={styles.flex}>
        <ScrollView
          {...scrollProps}
          contentContainerStyle={[contentStyle, layout.contentStyle]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps={keyboardShouldPersistTaps}
        >
          {children}
        </ScrollView>
        <BottomBar />
      </View>
      {overlay}
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
});
