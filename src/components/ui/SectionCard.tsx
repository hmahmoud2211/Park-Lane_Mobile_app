import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { useMemo, type PropsWithChildren } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { useAppTheme } from '../../hooks/useAppTheme';
import type { AppTheme } from '../../types/theme.types';
import { AppIcon } from '../common/AppIcon';
import { AppText } from '../common/AppText';
import { GlassSurface } from '../common/GlassSurface';
import type { IconSet } from './ServiceTile';

export interface SectionCardProps extends PropsWithChildren {
  title: string;
  iconSet: IconSet;
  iconName: string;
  /** Makes the heading row a link, shown by its trailing chevron. */
  onPress?: () => void;
  /** Hairline under the heading; the Documents card goes without. */
  divider?: boolean;
  style?: StyleProp<ViewStyle>;
  /** Overrides the body's padding or layout. */
  contentStyle?: StyleProp<ViewStyle>;
}

/** Heading row height, down to the divider. */
const HEADER_HEIGHT = 44;
const ICON_SIZE = 20;

/**
 * A titled glass card: icon, heading and chevron over a hairline, then the
 * card's own content. Every panel below the My Unit hero is one of these.
 */
export function SectionCard({
  title,
  iconSet,
  iconName,
  onPress,
  divider = true,
  style,
  contentStyle,
  children,
}: SectionCardProps) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  return (
    <GlassSurface
      radius={theme.borderRadius.md}
      glow
      strokeColors={[theme.colors.cardStrokeFrom, theme.colors.featureStrokeTo]}
      fillOpacity={theme.glass.subtleFillOpacity}
      style={style}
    >
      <Pressable
        onPress={onPress}
        disabled={!onPress}
        accessibilityRole={onPress ? 'button' : 'header'}
        accessibilityLabel={title}
        style={({ pressed }) => [styles.header, pressed && styles.pressed]}
      >
        <View style={styles.icon}>
          <AppIcon set={iconSet} name={iconName} size={ICON_SIZE} />
        </View>
        <AppText variant="sectionTitle" style={styles.title}>
          {title}
        </AppText>
        {onPress ? (
          <Ionicons name="chevron-forward" size={15} color={theme.colors.textPrimary} />
        ) : null}
      </Pressable>

      {divider ? (
        <LinearGradient
          colors={[theme.colors.cardStrokeFrom, theme.colors.featureStrokeTo]}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={styles.divider}
        />
      ) : null}

      <View style={[styles.body, contentStyle]}>{children}</View>
    </GlassSurface>
  );
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    header: {
      height: HEADER_HEIGHT,
      flexDirection: 'row',
      alignItems: 'center',
      paddingLeft: theme.spacing.md,
      paddingRight: 12,
    },
    icon: {
      width: ICON_SIZE,
      alignItems: 'center',
    },
    title: {
      flex: 1,
      marginLeft: 14,
    },
    divider: {
      height: StyleSheet.hairlineWidth,
      marginHorizontal: theme.spacing.md,
      opacity: 0.45,
    },
    body: {
      paddingTop: 14,
      paddingBottom: theme.spacing.md,
      paddingHorizontal: theme.spacing.md,
    },
    pressed: {
      opacity: 0.7,
    },
  });
}
