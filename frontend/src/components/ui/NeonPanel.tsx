import type { PropsWithChildren } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';

import { useAppTheme } from '../../hooks/useAppTheme';
import { GlassSurface } from '../common/GlassSurface';

export interface NeonPanelProps extends PropsWithChildren {
  /** Edge colours, left to right; default to cyan into violet. */
  strokeColors?: readonly [string, string];
  /** Corner glow colours at the bottom; default to `strokeColors`. */
  glowBottomColors?: readonly [string, string];
  /** Corner radius; defaults to the cards' 12dp. A pill passes half its height. */
  radius?: number;
  style?: StyleProp<ViewStyle>;
}

/**
 * The card of the Visitor Access and Maintenance screens, built exactly like
 * the My Unit cards (see SectionCard): frosted glass under the light gradient
 * tint, with the neon edge (see GlassSurface `glow`). Anything glass laid on
 * it must skip its own blur (`nested` tiles, `flat` avatars, field inputs).
 */
export function NeonPanel({ strokeColors, glowBottomColors, radius, style, children }: NeonPanelProps) {
  const theme = useAppTheme();

  return (
    <GlassSurface
      radius={radius ?? theme.borderRadius.md}
      glow
      strokeColors={strokeColors ?? [theme.colors.cardStrokeFrom, theme.colors.featureStrokeTo]}
      glowBottomColors={glowBottomColors}
      fillOpacity={theme.glass.subtleFillOpacity}
      style={style}
    >
      {children}
    </GlassSurface>
  );
}
