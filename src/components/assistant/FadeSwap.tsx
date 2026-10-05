import { useEffect, useState, type PropsWithChildren } from 'react';
import { Animated, Easing, Platform, type StyleProp, type ViewStyle } from 'react-native';

export interface FadeSwapProps extends PropsWithChildren {
  /** Changing this replays the entrance, e.g. when a hint's text changes. */
  swapKey: string | number;
  /** Where the content rises from, in dp; negative slides it down. */
  rise?: number;
  /** Horizontal offset to enter from, for side-to-side transitions. */
  shift?: number;
  duration?: number;
  style?: StyleProp<ViewStyle>;
}

const NATIVE = Platform.OS !== 'web';

/** Fades its content in (and slides it a little) whenever `swapKey` changes. */
export function FadeSwap({ swapKey, rise = 8, shift = 0, duration = 300, style, children }: FadeSwapProps) {
  const [progress] = useState(() => new Animated.Value(0));

  useEffect(() => {
    progress.setValue(0);
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: NATIVE,
    });
    animation.start();
    return () => animation.stop();
  }, [duration, progress, swapKey]);

  return (
    <Animated.View
      style={[
        style,
        {
          opacity: progress,
          transform: [
            { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [rise, 0] }) },
            { translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [shift, 0] }) },
          ],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}
