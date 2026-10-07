import { useMemo } from 'react';
import { Image, StyleSheet, type StyleProp, type ImageStyle } from 'react-native';

import { images } from '../../constants/images';
import { useAppTheme } from '../../hooks/useAppTheme';
import type { AppTheme } from '../../types/theme.types';

export interface BrandLockupProps {
  style?: StyleProp<ImageStyle>;
}

/** The Park Lane wordmark at its one size, 132 x 40 as on the Home design. */
export const BRAND_LOCKUP_WIDTH = 132;
export const BRAND_LOCKUP_HEIGHT = 40;

/**
 * The "Park Lane / Compoundhood / New Capital" wordmark. Every screen header
 * draws it through this component, so it is the same size on every page; the
 * headers centre it, and `spacing.headerTop` sets the same distance above it.
 */
export function BrandLockup({ style }: BrandLockupProps) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  return (
    <Image
      fadeDuration={0}
      source={images.brandWordmark}
      style={[styles.lockup, style]}
      resizeMode="contain"
      accessibilityLabel="Park Lane Compoundhood, New Capital"
    />
  );
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    lockup: {
      width: BRAND_LOCKUP_WIDTH,
      height: BRAND_LOCKUP_HEIGHT,
      tintColor: theme.colors.textPrimary,
    },
  });
}
