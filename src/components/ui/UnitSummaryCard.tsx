import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { useMemo } from 'react';
import { Image, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { images } from '../../constants/images';
import { useAppTheme } from '../../hooks/useAppTheme';
import type { AppTheme } from '../../types/theme.types';
import { AppText } from '../common/AppText';
import { GlassSurface } from '../common/GlassSurface';

export interface UnitSummaryCardProps {
  title: string;
  meta: string;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}

const CARD_HEIGHT = 81;
const CHEVRON_SIZE = 30;

/**
 * The resident's unit at a glance.
 *
 * The photo fills the whole card, with a left-to-right scrim over it so the
 * title and meta line stay legible against the lit building behind them.
 */
export function UnitSummaryCard({ title, meta, onPress, style }: UnitSummaryCardProps) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  // Opaque at the text, clearing by the middle so the building stays visible.
  const scrim = useMemo(
    () => [theme.colors.scrimBottom, theme.colors.scrimBottom, theme.colors.transparent] as const,
    [theme],
  );

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${meta}`}
      style={({ pressed }) => [style, pressed && styles.pressed]}
    >
      <GlassSurface
        radius={theme.borderRadius.lg}
        stroke="gradient"
        strokeColors={[theme.colors.featureStrokeFrom, theme.colors.featureStrokeTo]}
        style={styles.surface}
      >
        <Image source={images.unitPhoto} style={styles.photo} resizeMode="cover" />

        <LinearGradient
          colors={[...scrim]}
          locations={[0, 0.38, 0.82]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />

        <View style={styles.text}>
          <AppText variant="cardTitle">{title}</AppText>
          <AppText variant="tileTitle" color={theme.colors.textSecondary}>
            {meta}
          </AppText>
        </View>

        <View style={styles.chevron}>
          <Ionicons name="chevron-forward" size={16} color={theme.colors.textPrimary} />
        </View>
      </GlassSurface>
    </Pressable>
  );
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    surface: {
      height: CARD_HEIGHT,
      flexDirection: 'row',
      alignItems: 'center',
    },
    photo: {
      position: 'absolute',
      top: 0,
      left: 0,
      width: '100%',
      height: '100%',
    },
    text: {
      flex: 1,
      paddingLeft: theme.spacing.md,
      paddingRight: theme.spacing.sm,
    },
    chevron: {
      position: 'absolute',
      right: theme.spacing.sm,
      width: CHEVRON_SIZE,
      height: CHEVRON_SIZE,
      borderRadius: CHEVRON_SIZE / 2,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.scrimBottom,
      alignItems: 'center',
      justifyContent: 'center',
    },
    pressed: {
      opacity: 0.85,
    },
  });
}
