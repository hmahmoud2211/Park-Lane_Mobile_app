import type { PropsWithChildren } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';

import { GlassSurface } from '../../components/common/GlassSurface';
import { useAppTheme } from '../../hooks/useAppTheme';
import { TILE_RADIUS } from './BmsScreen.styles';

export interface BmsTileProps extends PropsWithChildren {
  /** Corner radius; defaults to the reference's 8dp. A pill passes half its height. */
  radius?: number;
  style?: StyleProp<ViewStyle>;
}

/**
 * The inset tile every BMS reading sits in (a fan, a gate list, a network row):
 * as drawn, a shade darker than its panel, with a white hairline that is
 * brightest along the top-left and fades towards the far corner. Laid on a
 * NeonPanel, so it skips its own blur and tint (see GlassSurface `blurred`).
 */
export function BmsTile({ radius = TILE_RADIUS, style, children }: BmsTileProps) {
  const theme = useAppTheme();

  return (
    <GlassSurface
      radius={radius}
      stroke="gradient"
      strokeColors={[theme.colors.border, theme.colors.dividerSubtle]}
      blurred={false}
      tinted={false}
      style={[{ backgroundColor: theme.colors.fieldFill }, style]}
    >
      {children}
    </GlassSurface>
  );
}
