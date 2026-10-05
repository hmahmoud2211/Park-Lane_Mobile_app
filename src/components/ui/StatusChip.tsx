import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { useMemo } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { useAppTheme } from '../../hooks/useAppTheme';
import type { AppTheme } from '../../types/theme.types';
import { AppText } from '../common/AppText';

/**
 * `teal` marks arrivals and the active pass, `violet` scheduled visits, `slate`
 * entries, and `indigo` an open invitation, e.g. Community's "Register".
 */
export type StatusTone = 'teal' | 'violet' | 'slate' | 'indigo';

export interface StatusChipProps {
  label: string;
  tone: StatusTone;
  /** Leading glyph, e.g. the calendar on the active pass. */
  icon?: keyof typeof Ionicons.glyphMap;
  /** Soft halo in the tone's colour, as on the active pass. */
  glow?: boolean;
  style?: StyleProp<ViewStyle>;
}

/** Measured on the Visitor Access reference (assets/Screens/screen5.png). */
const HEIGHT = 19;
const STROKE_WIDTH = 1;
const ICON_SIZE = 10;

/**
 * Pill showing a visitor's status. The stroke is a gradient ring (blue into
 * violet on the scheduled tone), drawn as a gradient behind an inset fill.
 */
export function StatusChip({ label, tone, icon, glow = false, style }: StatusChipProps) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { text, fill, stroke } = toneColors(theme, tone);

  return (
    <View
      style={[
        styles.shell,
        // Android draws elevation from the view's own fill, so the glow needs one.
        glow && [styles.glow, { shadowColor: stroke[0], backgroundColor: fill }],
        style,
      ]}
      accessibilityRole="text"
      accessibilityLabel={`Status: ${label}`}
    >
      <LinearGradient
        colors={[...stroke]}
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
        style={styles.ring}
      >
        <View style={[styles.fill, { backgroundColor: fill }]}>
          {icon ? <Ionicons name={icon} size={ICON_SIZE} color={text} style={styles.icon} /> : null}
          <AppText variant="statLabel" color={text} numberOfLines={1}>
            {label}
          </AppText>
        </View>
      </LinearGradient>
    </View>
  );
}

function toneColors(theme: AppTheme, tone: StatusTone) {
  const { colors } = theme;
  switch (tone) {
    case 'teal':
      return {
        text: colors.chipTealText,
        fill: colors.chipTealFill,
        stroke: [colors.chipTealStroke, colors.chipTealStroke] as const,
      };
    case 'violet':
      return {
        text: colors.chipVioletText,
        fill: colors.chipVioletFill,
        stroke: [colors.chipVioletStrokeFrom, colors.chipVioletStrokeTo] as const,
      };
    case 'slate':
      return {
        text: colors.chipSlateText,
        fill: colors.chipSlateFill,
        stroke: [colors.chipSlateStroke, colors.chipSlateStroke] as const,
      };
    case 'indigo':
      return {
        text: colors.textPrimary,
        fill: colors.chipIndigoFill,
        stroke: [colors.chipIndigoStrokeFrom, colors.chipIndigoStrokeTo] as const,
      };
  }
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    shell: {
      height: HEIGHT,
      borderRadius: HEIGHT / 2,
    },
    glow: {
      shadowOpacity: 0.7,
      shadowRadius: 6,
      shadowOffset: { width: 0, height: 0 },
      elevation: 4,
    },
    ring: {
      flex: 1,
      borderRadius: HEIGHT / 2,
      padding: STROKE_WIDTH,
    },
    fill: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: HEIGHT / 2 - STROKE_WIDTH,
      paddingHorizontal: theme.spacing.sm - STROKE_WIDTH,
    },
    icon: {
      marginRight: 7,
    },
  });
}
