import Ionicons from '@expo/vector-icons/Ionicons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { StyleSheet, View, type StyleProp, type TextStyle } from 'react-native';

import { useAppTheme } from '../../hooks/useAppTheme';
import type { IconSet } from '../ui/ServiceTile';

/** A ringed plus or minus over the glyph's bottom-right corner, e.g. "add a vehicle". */
export type IconBadge = 'add' | 'remove';

export interface AppIconProps {
  set: IconSet;
  name: string;
  size: number;
  /** Defaults to the primary text colour. */
  color?: string;
  badge?: IconBadge;
  style?: StyleProp<TextStyle>;
}

/**
 * Badge proportions, from the Parking design (assets/Screens/screen7.png):
 * a ring about half the glyph's size, overhanging its corner slightly.
 */
const BADGE_RATIO = 0.52;
const BADGE_SIGN_RATIO = 0.78;
const BADGE_OVERHANG = 0.12;
const BADGE_STROKE = 1.2;

/**
 * One glyph from either icon family, chosen by the `IconSet` that screen data
 * already carries, so data-driven rows need no per-set branching of their own.
 */
export function AppIcon({ set, name, size, color, badge, style }: AppIconProps) {
  const theme = useAppTheme();
  const tint = color ?? theme.colors.textPrimary;

  // The icon sets do not share a name union, so the name is typed per set.
  const glyph =
    set === 'ionicons' ? (
      <Ionicons name={name as keyof typeof Ionicons.glyphMap} size={size} color={tint} style={style} />
    ) : (
      <MaterialCommunityIcons
        name={name as keyof typeof MaterialCommunityIcons.glyphMap}
        size={size}
        color={tint}
        style={style}
      />
    );

  if (!badge) {
    return glyph;
  }

  const badgeSize = size * BADGE_RATIO;
  return (
    <View style={{ width: size, height: size }}>
      {glyph}
      {/* The dark fill cuts the glyph's strokes where the ring crosses them, as drawn. */}
      <View
        style={[
          styles.badge,
          {
            width: badgeSize,
            height: badgeSize,
            borderRadius: badgeSize / 2,
            right: -badgeSize * BADGE_OVERHANG,
            bottom: -badgeSize * BADGE_OVERHANG,
            borderColor: tint,
            backgroundColor: theme.colors.backgroundDeep,
          },
        ]}
      >
        <Ionicons name={badge} size={badgeSize * BADGE_SIGN_RATIO} color={tint} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    position: 'absolute',
    borderWidth: BADGE_STROKE,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
