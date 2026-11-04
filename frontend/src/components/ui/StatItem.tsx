import Ionicons from '@expo/vector-icons/Ionicons';
import { useMemo } from 'react';
import { StyleSheet, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';

import { useAppTheme } from '../../hooks/useAppTheme';
import type { TypographyVariant } from '../../theme';
import type { AppTheme } from '../../types/theme.types';
import { AppIcon } from '../common/AppIcon';
import { AppText } from '../common/AppText';
import type { IconSet } from './ServiceTile';

/** Change against a previous period, e.g. "▼ 12% vs. last month". */
export interface StatTrend {
  direction: 'up' | 'down';
  /** The figure, e.g. "12%". */
  change: string;
  /** What it is measured against, e.g. "vs. last month". */
  comparison: string;
  /** Whether the change is good news; for consumption, falling is positive. */
  tone: 'positive' | 'negative';
}

/** One labelled figure, shaped so screen data can be mapped straight onto it. */
export interface StatItemData {
  id: string;
  label: string;
  value: string;
  iconSet?: IconSet;
  iconName?: string;
  /** Puts the value above the label, e.g. "2 / Bathrooms". */
  valueFirst?: boolean;
  /** Draws a status dot before the value, e.g. "● Active". */
  status?: 'success';
  /** Extra line under the value, e.g. "This Month". */
  caption?: string;
  trend?: StatTrend;
}

export interface StatItemProps extends Omit<StatItemData, 'id'> {
  /** `large` is for headline figures such as the unit price. */
  size?: 'regular' | 'large';
  iconSize?: number;
  /** Space between the icon and the text. */
  iconGap?: number;
  /**
   * How far the trend line may run past the column, into the gap beside it.
   * The design lets it, so it stays on one line at the reference width.
   */
  trendOverhang?: number;
  /**
   * Shrinks type, icon and spacing together, for rows narrower than the
   * design's. 1 is the reference size.
   */
  scale?: number;
  style?: StyleProp<ViewStyle>;
}

const STATUS_DOT = 7;

/**
 * An optional leading icon beside a label and a value, as in every figure on
 * the My Unit screen. Values stay on one line (and shrink to fit on native);
 * labels may wrap, as "Remaining Installments" does in the design.
 */
export function StatItem({
  label,
  value,
  iconSet,
  iconName,
  valueFirst = false,
  status,
  caption,
  trend,
  size = 'regular',
  iconSize = 20,
  iconGap = 10,
  trendOverhang = 0,
  scale = 1,
  style,
}: StatItemProps) {
  const theme = useAppTheme();
  const styles = useMemo(
    () => createStyles(theme, iconSize * scale, iconGap * scale, trendOverhang * scale, scale),
    [theme, iconSize, iconGap, trendOverhang, scale],
  );

  const labelText = (
    <AppText variant="statLabel" color={theme.colors.textAccentSoft} style={styles.label}>
      {label}
    </AppText>
  );

  const valueText = (
    <View style={styles.valueRow}>
      {status ? <View style={[styles.dot, { backgroundColor: theme.colors[status] }]} /> : null}
      <AppText
        variant={size === 'large' ? 'statValueLarge' : 'statValue'}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.8}
        style={[styles.value, size === 'large' ? styles.valueLarge : styles.valueRegular]}
      >
        {value}
      </AppText>
    </View>
  );

  const toneColor = trend?.tone === 'positive' ? theme.colors.success : theme.colors.error;
  const summary = [label, value, caption, trend && `${trend.direction} ${trend.change} ${trend.comparison}`]
    .filter(Boolean)
    .join(', ');

  return (
    <View style={[styles.row, style]} accessible accessibilityLabel={summary}>
      {iconSet && iconName ? (
        <View style={styles.iconBox}>
          <AppIcon set={iconSet} name={iconName} size={iconSize * scale} />
        </View>
      ) : null}

      <View style={styles.text}>
        {valueFirst ? valueText : labelText}
        {valueFirst ? labelText : valueText}

        {caption ? (
          <AppText variant="statLabel" color={theme.colors.textAccentSoft} style={styles.label}>
            {caption}
          </AppText>
        ) : null}

        {trend ? (
          <View style={styles.trend}>
            <Ionicons
              name={trend.direction === 'up' ? 'caret-up' : 'caret-down'}
              size={9 * scale}
              color={toneColor}
            />
            <AppText
              variant="tileCaption"
              color={toneColor}
              style={[styles.trendText, styles.trendType]}
            >
              {trend.change}{' '}
              {/* As in the design, only good news carries its colour through. */}
              <AppText
                variant="tileCaption"
                color={trend.tone === 'positive' ? toneColor : theme.colors.textSecondary}
                style={styles.trendType}
              >
                {trend.comparison}
              </AppText>
            </AppText>
          </View>
        ) : null}
      </View>
    </View>
  );
}

function createStyles(
  theme: AppTheme,
  iconSize: number,
  iconGap: number,
  trendOverhang: number,
  scale: number,
) {
  // Type overrides only when scaled, so the reference size is the token itself.
  const sized = (variant: TypographyVariant): TextStyle => {
    const { fontSize, lineHeight } = theme.typography[variant] as TextStyle;
    return scale === 1 || fontSize === undefined || lineHeight === undefined
      ? {}
      : { fontSize: fontSize * scale, lineHeight: lineHeight * scale };
  };

  // Tall enough for a label and a value, so the icon centres on that pair
  // whether or not a caption and trend follow beneath it.
  const pairHeight =
    (theme.typography.statLabel.lineHeight + theme.typography.statValue.lineHeight) * scale;

  return StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'flex-start',
    },
    iconBox: {
      width: iconSize,
      height: Math.max(pairHeight, iconSize),
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: iconGap,
    },
    text: {
      flex: 1,
    },
    label: sized('statLabel'),
    valueRow: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    value: {
      flexShrink: 1,
    },
    valueRegular: sized('statValue'),
    valueLarge: sized('statValueLarge'),
    dot: {
      width: STATUS_DOT * scale,
      height: STATUS_DOT * scale,
      borderRadius: (STATUS_DOT * scale) / 2,
      marginRight: 5 * scale,
    },
    trend: {
      flexDirection: 'row',
      alignItems: 'center',
      marginTop: 3 * scale,
      marginRight: -trendOverhang,
    },
    trendText: {
      flexShrink: 1,
      marginLeft: 3 * scale,
    },
    trendType: sized('tileCaption'),
  });
}
