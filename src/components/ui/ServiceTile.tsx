import Ionicons from '@expo/vector-icons/Ionicons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useMemo } from 'react';
import {
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { useAppTheme } from '../../hooks/useAppTheme';
import type { TypographyVariant } from '../../theme';
import type { AppTheme } from '../../types/theme.types';
import { AppText } from '../common/AppText';
import { GlassSurface } from '../common/GlassSurface';

export type IconSet = 'ionicons' | 'material';

export interface ServiceTileProps {
  title: string;
  /** Omitted on single-line rows, such as the profile menu. */
  subtitle?: string;
  iconSet: IconSet;
  iconName: string;
  onPress?: () => void;
  /** Tighter insets and type, for three tiles across a card (My Unit documents). */
  compact?: boolean;
  /**
   * Set when the tile sits on another glass panel: it skips its own blur (see
   * GlassSurface `blurred`) and takes the lighter tint, since the panel
   * beneath is already tinted.
   */
  nested?: boolean;
  /**
   * Shrinks type, icon and insets together, for tiles narrower than the
   * design's. 1 is the reference size.
   */
  scale?: number;
  style?: StyleProp<ViewStyle>;
}

const MIN_HEIGHT = 45;
const ICON_SIZE = 21;
const COMPACT_MIN_HEIGHT = 40;
const COMPACT_ICON_SIZE = 17;

/**
 * One entry in the home screen's service grid: icon, title, supporting line and
 * a chevron. Grows past `MIN_HEIGHT` when the title wraps, so a two-line label
 * or a large system font size never clips.
 */
export function ServiceTile({
  title,
  subtitle,
  iconSet,
  iconName,
  onPress,
  compact = false,
  nested = false,
  scale = 1,
  style,
}: ServiceTileProps) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme, scale), [theme, scale]);
  const iconSize = (compact ? COMPACT_ICON_SIZE : ICON_SIZE) * scale;
  const subtitleVariant = compact ? 'tileCaption' : 'tileSubtitle';

  // The icon sets do not share a name union, so the name is typed per set.
  const icon =
    iconSet === 'ionicons' ? (
      <Ionicons
        name={iconName as keyof typeof Ionicons.glyphMap}
        size={iconSize}
        color={theme.colors.textPrimary}
      />
    ) : (
      <MaterialCommunityIcons
        name={iconName as keyof typeof MaterialCommunityIcons.glyphMap}
        size={iconSize}
        color={theme.colors.textPrimary}
      />
    );

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={subtitle ? `${title}. ${subtitle}` : title}
      style={({ pressed }) => [style, pressed && styles.pressed]}
    >
      <GlassSurface
        radius={theme.borderRadius.md}
        stroke="gradient"
        blurred={!nested}
        fillOpacity={nested ? theme.glass.subtleFillOpacity : undefined}
        style={[styles.surface, compact && styles.surfaceCompact]}
      >
        {icon}
        <View style={[styles.text, compact && styles.textCompact]}>
          <AppText variant="tileTitle" style={styles.title}>
            {title}
          </AppText>
          {subtitle ? (
            <AppText
              variant={subtitleVariant}
              color={theme.colors.textSecondary}
              style={compact ? styles.captionCompact : styles.subtitle}
            >
              {subtitle}
            </AppText>
          ) : null}
        </View>
        <Ionicons
          name="chevron-forward"
          size={(compact ? 12 : 13) * scale}
          color={theme.colors.textSecondary}
        />
      </GlassSurface>
    </Pressable>
  );
}

function createStyles(theme: AppTheme, scale: number) {
  // Type overrides only when scaled, so the reference size is the token itself.
  const sized = (variant: TypographyVariant): TextStyle => {
    const { fontSize, lineHeight } = theme.typography[variant] as TextStyle;
    return scale === 1 || fontSize === undefined || lineHeight === undefined
      ? {}
      : { fontSize: fontSize * scale, lineHeight: lineHeight * scale };
  };

  return StyleSheet.create({
    surface: {
      minHeight: MIN_HEIGHT,
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: theme.spacing.sm,
      paddingHorizontal: 8,
    },
    text: {
      flex: 1,
      marginLeft: 8,
      marginRight: 2,
    },
    title: sized('tileTitle'),
    subtitle: sized('tileSubtitle'),
    captionCompact: sized('tileCaption'),
    surfaceCompact: {
      minHeight: COMPACT_MIN_HEIGHT * scale,
      paddingLeft: 9 * scale,
      paddingRight: 5 * scale,
    },
    textCompact: {
      marginLeft: 8 * scale,
      marginRight: 0,
    },
    pressed: {
      opacity: 0.75,
    },
  });
}
