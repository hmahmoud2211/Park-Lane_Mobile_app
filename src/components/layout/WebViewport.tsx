import { type PropsWithChildren } from 'react';
import { Platform, StyleSheet, View, useWindowDimensions } from 'react-native';

import { useAppTheme } from '../../hooks/useAppTheme';

/** Widest viewport still treated as a phone; above it the app is centred. */
const PHONE_MAX_WIDTH = 430;

/**
 * Keeps the app at phone width when it runs in a desktop browser.
 *
 * The screens are designed for a 390dp frame, so letting them stretch across a
 * laptop window breaks their proportions. On native, and on phone-sized
 * browsers, this renders nothing but a passthrough.
 *
 * The element tree is identical in both cases and only the styles change, so
 * resizing across the breakpoint never remounts the navigator.
 */
export function WebViewport({ children }: PropsWithChildren) {
  const theme = useAppTheme();
  const { width } = useWindowDimensions();

  const constrain = Platform.OS === 'web' && width > PHONE_MAX_WIDTH;

  return (
    <View style={[styles.backdrop, constrain && { backgroundColor: theme.colors.black }]}>
      <View style={[styles.frame, constrain && styles.frameConstrained]}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: 'center',
  },
  frame: {
    flex: 1,
    width: '100%',
  },
  frameConstrained: {
    width: PHONE_MAX_WIDTH,
    overflow: 'hidden',
  },
});
