import { useMemo } from 'react';
import { Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

import { useAppTheme } from '../../hooks/useAppTheme';
import type { AppTheme } from '../../types/theme.types';
import { AppIcon } from '../common/AppIcon';
import { AppText } from '../common/AppText';
import { GlassSurface } from '../common/GlassSurface';
import type { IconSet } from './ServiceTile';

export interface FilterChipProps {
  label: string;
  iconSet: IconSet;
  iconName: string;
  selected: boolean;
  onPress: () => void;
  /** `tab` for a view switcher (Smart Home's rooms), `radio` for a filter. */
  role?: 'tab' | 'radio';
  /** Applied to the touch target, e.g. `flex: 1` for chips sharing a row equally. */
  style?: StyleProp<ViewStyle>;
}

/*
 * From the Smart Home and Amenities Booking designs: icon and label in a
 * glass chip, drawn 30-34dp tall. The selected chip takes the neon edge and
 * the full glass tint; the rest sit dark, behind a faint blue hairline.
 */
const HEIGHT = 32;
const PADDING = 11;
const ICON_SIZE = 15;
const ICON_GAP = 7;

/** A selectable icon-and-label chip, e.g. a room or an amenity category. */
export function FilterChip({
  label,
  iconSet,
  iconName,
  selected,
  onPress,
  role = 'tab',
  style,
}: FilterChipProps) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole={role}
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      style={({ pressed }) => [style, pressed && styles.pressed]}
    >
      {/* Laid straight on the page photo, so it skips the blur, which tints it purple on web. */}
      <GlassSurface
        radius={theme.borderRadius.sm}
        glow={selected}
        stroke="gradient"
        strokeColors={
          selected
            ? [theme.colors.cardStrokeFrom, theme.colors.featureStrokeTo]
            : [theme.colors.dividerSubtle, theme.colors.dividerSubtle]
        }
        blurred={false}
        fillOpacity={selected ? undefined : theme.glass.subtleFillOpacity}
        style={[styles.surface, !selected && styles.idle]}
      >
        <AppIcon set={iconSet} name={iconName} size={ICON_SIZE} />
        <AppText variant={selected ? 'statValue' : 'statLabel'} numberOfLines={1}>
          {label}
        </AppText>
      </GlassSurface>
    </Pressable>
  );
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    surface: {
      height: HEIGHT,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: PADDING,
      gap: ICON_GAP,
    },
    idle: {
      backgroundColor: theme.colors.fieldFill,
    },
    pressed: {
      opacity: 0.7,
    },
  });
}
