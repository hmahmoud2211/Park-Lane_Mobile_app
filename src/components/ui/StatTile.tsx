import { useMemo, type ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';

import { useAppTheme } from '../../hooks/useAppTheme';
import type { TypographyVariant } from '../../theme';
import type { AppTheme } from '../../types/theme.types';
import { AppText } from '../common/AppText';
import { GlassSurface } from '../common/GlassSurface';
import { ProgressBar } from './ProgressBar';

export interface StatTileProps {
  /** Up to two lines, e.g. "Available\nSpaces". */
  label: string;
  /** The figure, e.g. "42" or "65%". */
  value: string;
  /** What the figure is out of, shown after it as "/ 120". */
  total?: string;
  /** Sits beside the label, in a box `iconBox` wide. */
  icon: ReactNode;
  /** Fraction filled, 0-1. Draws a gauge under the figure instead of the accent line. */
  progress?: number;
  /** Edge colours, left to right; default to cyan into blue. */
  strokeColors?: readonly [string, string];
  /**
   * Shrinks type, icon and insets together, for tiles narrower than the
   * design's. 1 is the reference size.
   */
  scale?: number;
  style?: StyleProp<ViewStyle>;
}

/*
 * From the Parking design (assets/Screens/screen7.png), with the extra room
 * the inner screens are given. The label takes the small caption type: in
 * Inter, "Occupancy" only stays on its line at that size in a quarter-width
 * tile.
 */
const INSET_TOP = 10;
const INSET_BOTTOM = 9;
const INSET_LEFT = 7;
const INSET_RIGHT = 6;
export const STAT_TILE_ICON_BOX = 16;
const LABEL_GAP = 6;
const VALUE_TOP = 5;
const TOTAL_GAP = 4;
const ACCENT_TOP = 2;
const ACCENT_HEIGHT = 2.5;
/** The accent under the figure is drawn faint, as a glow rather than a gauge. */
const ACCENT_OPACITY = 0.5;
const GAUGE_TOP = 4;
const GAUGE_HEIGHT = 3;

/** One headline figure in a row of quarter-width tiles, e.g. "42 / 120 Available Spaces". */
export function StatTile({
  label,
  value,
  total,
  icon,
  progress,
  strokeColors,
  scale = 1,
  style,
}: StatTileProps) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme, scale), [theme, scale]);
  const plainLabel = label.replace(/\s*\n\s*/g, ' ');

  return (
    <GlassSurface
      radius={theme.borderRadius.sm}
      glow
      strokeColors={strokeColors ?? [theme.colors.cardStrokeFrom, theme.colors.cardStrokeTo]}
      fillOpacity={theme.glass.subtleFillOpacity}
      style={[styles.surface, style]}
    >
      <View
        style={styles.body}
        accessible
        accessibilityLabel={total ? `${plainLabel}, ${value} of ${total}` : `${plainLabel}, ${value}`}
      >
        <View style={styles.heading}>
          <View style={styles.iconBox}>{icon}</View>
          <AppText
            variant="tileCaption"
            color={theme.colors.textAccentSoft}
            numberOfLines={2}
            style={styles.label}
          >
            {label}
          </AppText>
        </View>

        <View>
          <View style={styles.valueRow}>
            <View>
              <AppText variant="cardTitle" numberOfLines={1} style={styles.value}>
                {value}
              </AppText>
              {progress === undefined ? <View style={styles.accent} /> : null}
            </View>
            {total ? (
              <AppText
                variant="statLabel"
                color={theme.colors.textAccentSoft}
                numberOfLines={1}
                style={styles.total}
              >
                {`/ ${total}`}
              </AppText>
            ) : null}
          </View>

          {progress !== undefined ? (
            <ProgressBar progress={progress} height={GAUGE_HEIGHT * scale} style={styles.gauge} />
          ) : null}
        </View>
      </View>
    </GlassSurface>
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
      flex: 1,
    },
    body: {
      flex: 1,
      justifyContent: 'space-between',
      paddingTop: INSET_TOP * scale,
      paddingBottom: INSET_BOTTOM * scale,
      paddingLeft: INSET_LEFT * scale,
      paddingRight: INSET_RIGHT * scale,
    },
    heading: {
      flexDirection: 'row',
      alignItems: 'flex-start',
    },
    iconBox: {
      width: STAT_TILE_ICON_BOX * scale,
      alignItems: 'center',
    },
    label: {
      ...sized('tileCaption'),
      flex: 1,
      marginLeft: LABEL_GAP * scale,
    },
    // "/ 120" sits on the figure's baseline; the figure's column aligns by its text.
    valueRow: {
      flexDirection: 'row',
      alignItems: 'baseline',
      marginTop: VALUE_TOP * scale,
    },
    value: sized('cardTitle'),
    total: {
      ...sized('statLabel'),
      flexShrink: 1,
      marginLeft: TOTAL_GAP * scale,
    },
    // Only as wide as the figure above it, as drawn.
    accent: {
      height: ACCENT_HEIGHT * scale,
      marginTop: ACCENT_TOP * scale,
      borderRadius: (ACCENT_HEIGHT * scale) / 2,
      backgroundColor: theme.colors.neonBlue,
      opacity: ACCENT_OPACITY,
    },
    gauge: {
      marginTop: GAUGE_TOP * scale,
    },
  });
}
