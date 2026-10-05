import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { useMemo, type ReactNode } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { useAppTheme } from '../../hooks/useAppTheme';
import type { AppTheme } from '../../types/theme.types';
import { AppIcon } from '../common/AppIcon';
import { AppText } from '../common/AppText';
import type { IconSet } from './ServiceTile';

export interface PanelHeadingProps {
  title: string;
  iconSet?: IconSet;
  iconName?: string;
  iconSize?: number;
  /** Drawn in place of `iconSet`/`iconName`, for icons no set has (e.g. ParkingSign). */
  icon?: ReactNode;
  /**
   * A supporting line under the title, aligned with it, e.g. Community's
   * "Your opinion helps…". With `icon`, set `iconSize` to the icon's width.
   */
  subtitle?: string;
  /** A trailing link, e.g. "View All", drawn with a chevron. */
  actionLabel?: string;
  onActionPress?: () => void;
  /** Gradient hairline under the heading. */
  divider?: boolean;
  /** Overrides the divider's placement, e.g. to stop it short of a photo. */
  dividerStyle?: StyleProp<ViewStyle>;
  style?: StyleProp<ViewStyle>;
}

/*
 * From the Visitor Access and Maintenance designs, with the extra room given
 * to both screens: a 38dp row, 10dp in from the panel edge.
 */
const HEIGHT = 38;
const INSET_LEFT = 10;
/** Puts the action's chevron glyph on the same line as the rows' chevrons. */
const INSET_RIGHT = 9.5;
const TITLE_GAP = 14;
const ACTION_CHEVRON_SIZE = 9;
const DIVIDER_INSET = 12;
/** Pulls the subtitle up under the title line, which is centred in the row. */
const SUBTITLE_PULL = -8;
const SUBTITLE_BOTTOM = 4;

/** Icon, title and an optional "View All" link across the top of a panel. */
export function PanelHeading({
  title,
  iconSet,
  iconName,
  iconSize = 17,
  icon,
  subtitle,
  actionLabel,
  onActionPress,
  divider = true,
  dividerStyle,
  style,
}: PanelHeadingProps) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  const row = (
    <View style={[styles.row, !subtitle && style]}>
      {icon ??
        (iconSet && iconName ? <AppIcon set={iconSet} name={iconName} size={iconSize} /> : null)}
      {/* Set like My Unit's card headings (SectionCard), so the screens share one type. */}
      <AppText variant="sectionTitle" style={styles.title} accessibilityRole="header">
        {title}
      </AppText>

      {actionLabel ? (
        <Pressable
          onPress={onActionPress}
          hitSlop={12}
          accessibilityRole="link"
          accessibilityLabel={`${actionLabel} ${title.toLowerCase()}`}
          style={({ pressed }) => [styles.action, pressed && styles.pressed]}
        >
          <AppText variant="statLabel" color={theme.colors.textSupport}>
            {actionLabel}
          </AppText>
          <Ionicons
            name="chevron-forward"
            size={ACTION_CHEVRON_SIZE}
            color={theme.colors.textSupport}
            style={styles.actionChevron}
          />
        </Pressable>
      ) : null}

      {divider ? (
        <LinearGradient
          colors={[theme.colors.cardStrokeFrom, theme.colors.featureStrokeTo]}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={[styles.divider, dividerStyle]}
        />
      ) : null}
    </View>
  );

  if (!subtitle) {
    return row;
  }

  return (
    <View style={style}>
      {row}
      <AppText
        variant="tileCaption"
        color={theme.colors.textSupport}
        style={[styles.subtitle, { marginLeft: INSET_LEFT + iconSize + TITLE_GAP }]}
      >
        {subtitle}
      </AppText>
    </View>
  );
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    row: {
      height: HEIGHT,
      flexDirection: 'row',
      alignItems: 'center',
      paddingLeft: INSET_LEFT,
      paddingRight: INSET_RIGHT,
    },
    title: {
      flex: 1,
      marginLeft: TITLE_GAP,
    },
    action: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    actionChevron: {
      marginLeft: 3,
    },
    // Overlaid on the heading's bottom edge, so it adds no height.
    divider: {
      position: 'absolute',
      top: HEIGHT,
      left: DIVIDER_INSET,
      right: DIVIDER_INSET,
      height: StyleSheet.hairlineWidth,
      opacity: 0.45,
    },
    subtitle: {
      marginTop: SUBTITLE_PULL,
      marginRight: INSET_RIGHT,
      marginBottom: SUBTITLE_BOTTOM,
    },
    pressed: {
      opacity: 0.6,
    },
  });
}
