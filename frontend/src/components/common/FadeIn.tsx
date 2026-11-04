import { useEffect, useState, type PropsWithChildren } from 'react';
import { Animated, Platform, type StyleProp, type ViewStyle } from 'react-native';

import { useAppTheme } from '../../hooks/useAppTheme';
import { useReduceMotion } from '../../hooks/useReduceMotion';

export interface FadeInProps extends PropsWithChildren {
  /** Wait before starting, e.g. `index * theme.motion.stagger` for a list. */
  delay?: number;
  style?: StyleProp<ViewStyle>;
}

/**
 * Fades its content in and lifts it into place once, when it mounts. With
 * reduced motion on it simply appears.
 */
export function FadeIn({ delay = 0, style, children }: FadeInProps) {
  const theme = useAppTheme();
  const reduceMotion = useReduceMotion();
  const [progress] = useState(() => new Animated.Value(0));

  useEffect(() => {
    const animation = Animated.timing(progress, {
      toValue: 1,
      delay: reduceMotion ? 0 : delay,
      duration: reduceMotion ? 0 : theme.motion.duration.slow,
      useNativeDriver: Platform.OS !== 'web',
    });
    animation.start();
    return () => animation.stop();
    // Plays once on mount; later prop changes must not replay it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Animated.View
      style={[
        style,
        {
          opacity: progress,
          transform: [
            {
              translateY: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [theme.motion.enterOffset, 0],
              }),
            },
          ],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}
