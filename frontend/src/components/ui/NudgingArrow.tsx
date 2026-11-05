import { useEffect, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Platform } from 'react-native';

import { ArrowRightIcon } from './ArrowRightIcon';

export interface NudgingArrowProps {
  size?: number;
  color?: string;
  /** How far right the arrow travels, in dp. */
  distance?: number;
}

const TRAVEL_OUT_MS = 520;
const TRAVEL_BACK_MS = 420;
const REST_MS = 1100;

/**
 * The onboarding CTA's arrow, drifting right and settling back on a slow loop
 * to hint that the button moves the user forward.
 *
 * Only `transform` is animated, so the whole loop runs on the native driver and
 * never touches the JS thread per frame. Honours the system "reduce motion"
 * setting, where it holds still instead.
 */
export function NudgingArrow({ size = 16, color, distance = 6 }: NudgingArrowProps) {
  // Lazy state rather than a ref: stable across renders, and readable during
  // render without tripping the rules of React.
  const [translateX] = useState(() => new Animated.Value(0));
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let active = true;

    AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (active) {
        setReduceMotion(enabled);
      }
    });

    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);

    return () => {
      active = false;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    if (reduceMotion) {
      translateX.setValue(0);
      return;
    }

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(translateX, {
          toValue: distance,
          duration: TRAVEL_OUT_MS,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: Platform.OS !== 'web',
        }),
        Animated.timing(translateX, {
          toValue: 0,
          duration: TRAVEL_BACK_MS,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: Platform.OS !== 'web',
        }),
        Animated.delay(REST_MS),
      ]),
    );

    loop.start();

    return () => loop.stop();
  }, [reduceMotion, distance, translateX]);

  return (
    <Animated.View style={{ transform: [{ translateX }] }}>
      <ArrowRightIcon size={size} color={color} />
    </Animated.View>
  );
}
