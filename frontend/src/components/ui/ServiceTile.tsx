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
  /** Tighter insets and a smaller icon, for three tiles across a card (My Unit documents). */
  compact?: boolean;
  /**
   * Set when the tile sits on another glass panel: it skips its own blur (see
   * GlassSurface `blurred`) and takes the lighter tint, since the panel
   * beneath is already tinted.
   */
  nested?: boolean;
  /** Draws the neon edge of the My Unit cards (see GlassSurface `glow`). */
  glow?: boolean;
  /**
   * `row` puts the icon beside the text. `stacked` puts it above, with the
   * chevron at the right, as in the Maintenance categories grid.
   */
  layout?: 'row' | 'stacked';
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
/** `stacked` layout, from the Maintenance design with its extra room. */
const STACKED_ICON_SIZE = 22;
const STACKED_PADDING = 10;
const STACKED_ICON_GAP = 6;
const STACKED_CHEVRON_INSET = 6;
const STACKED_CHEVRON_SIZE = 13;

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
  glow = false,
  layout = 'row',
  scale = 1,
  style,
}: ServiceTileProps) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme, scale), [theme, scale]);
  const stacked = layout === 'stacked';
  const iconSize = (stacked ? STACKED_ICON_SIZE : compact ? COMPACT_ICON_SIZE : ICON_SIZE) * scale;

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

  const glassProps = {
    stroke: 'gradient',
    glow,
    strokeColors: glow
      ? ([theme.colors.cardStrokeFrom, theme.colors.featureStrokeTo] as const)
      : undefined,
    blurred: !nested,
    fillOpacity: nested ? theme.glass.subtleFillOpacity : undefined,
  } as const;

  if (stacked) {
    return (
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={subtitle ? `${title}. ${subtitle}` : title}
        style={({ pressed }) => [style, pressed && styles.pressed]}
      >
        <GlassSurface
          {...glassProps}
          radius={theme.borderRadius.sm}
          // Flat, as drawn: the panel beneath already carries the tint. The
          // edge stays cyan into blue, without the violet of the larger cards.
          tinted={false}
          strokeColors={glow ? [theme.colors.cardStrokeFrom, theme.colors.cardStrokeTo] : undefined}
          style={styles.stackedSurface}
        >
          {/* A fixed box, so glyphs from both icon sets start the text on one line. */}
          <View style={{ height: iconSize, justifyContent: 'center' }}>{icon}</View>
          <AppText variant="statValue" numberOfLines={1} style={styles.stackedTitle}>
            {title}
          </AppText>
          {subtitle ? (
            <AppText
              variant="tileCaption"
              color={theme.colors.textSupport}
              numberOfLines={1}
              style={styles.stackedCaption}
            >
              {subtitle}
            </AppText>
          ) : null}
          <View style={styles.stackedChevron} pointerEvents="none">
            <Ionicons
              name="chevron-forward"
              size={STACKED_CHEVRON_SIZE * scale}
              color={theme.colors.textPrimary}
            />
          </View>
        </GlassSurface>
      </Pressable>
    );
  }

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
        glow={glow}
        strokeColors={
          glow ? [theme.colors.cardStrokeFrom, theme.colors.featureStrokeTo] : undefined
        }
        blurred={!nested}
        fillOpacity={nested ? theme.glass.subtleFillOpacity : undefined}
        style={[styles.surface, compact && styles.surfaceCompact]}
      >
        {icon}
        <View style={[styles.text, compact && styles.textCompact]}>
          <AppText variant="statValue" style={styles.title}>
            {title}
          </AppText>
          {subtitle ? (
            <AppText
              variant="tileCaption"
              color={theme.colors.textSecondary}
              style={styles.subtitle}
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
    title: sized('statValue'),
    subtitle: sized('tileCaption'),
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
    stackedSurface: {
      padding: STACKED_PADDING * scale,
    },
    stackedTitle: {
      ...sized('statValue'),
      marginTop: STACKED_ICON_GAP * scale,
      marginBottom: 2 * scale,
    },
    stackedCaption: sized('tileCaption'),
    // Centred on the icon's bottom edge, as drawn: above the title, so the
    // title can run the tile's full width beneath it.
    stackedChevron: {
      position: 'absolute',
      top: (STACKED_PADDING + STACKED_ICON_SIZE - STACKED_CHEVRON_SIZE / 2) * scale,
      right: STACKED_CHEVRON_INSET * scale,
    },
  });
}
