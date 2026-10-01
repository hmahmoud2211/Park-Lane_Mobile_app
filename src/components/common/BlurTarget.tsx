import { createContext, useContext, type RefObject } from 'react';
import type { View } from 'react-native';

/**
 * The backdrop a BlurView samples on Android. Since SDK 55, Android only
 * blurs content wrapped in a `BlurTargetView` whose ref the BlurView is given;
 * without one it falls back to a flat translucent layer. AppBackground wraps
 * the screen photo in that target and publishes its ref here.
 */
export const BlurTargetContext = createContext<RefObject<View | null> | null>(null);

export function useBlurTarget() {
  return useContext(BlurTargetContext);
}
