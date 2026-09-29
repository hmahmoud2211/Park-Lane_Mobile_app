import type { PropsWithChildren } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';

import { useAppTheme } from '../../hooks/useAppTheme';
import { GlassSurface } from '../common/GlassSurface';

export interface NeonPanelProps extends PropsWithChildren {
  /** Panel colour; defaults to the near-opaque navy of the inner screens. */
  fill?: string;
  /** Edge colours, left to right; default to cyan into violet. */
  strokeColors?: readonly [string, string];
  /** Corner glow colours at the bottom; default to `strokeColors`. */
  glowBottomColors?: readonly [string, string];
  style?: StyleProp<ViewStyle>;
}

/**
 * The card of the Visitor Access and Maintenance designs: a flat navy panel
 * with the neon edge (see GlassSurface `glow`). The designs show no frosting
 * or tint, and the fill is nearly opaque, so the blur would only cost
 * performance (and on web its saturation boost turns the navy purple).
 */
export function NeonPanel({
  fill,
  strokeColors,
  glowBottomColors,
  style,
  children,
}: NeonPanelProps) {
  const theme = useAppTheme();

  return (
    <GlassSurface
      radius={theme.borderRadius.sm}
      glow
      strokeColors={strokeColors ?? [theme.colors.cardStrokeFrom, theme.colors.featureStrokeTo]}
      glowBottomColors={glowBottomColors}
      blurred={false}
      tinted={false}
      style={[{ backgroundColor: fill ?? theme.colors.panelFill }, style]}
    >
      {children}
    </GlassSurface>
  );
}
