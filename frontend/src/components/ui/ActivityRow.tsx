import Ionicons from '@expo/vector-icons/Ionicons';
import { useMemo, type ReactNode } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { useAppTheme } from '../../hooks/useAppTheme';
import type { AppTheme } from '../../types/theme.types';
import { AppText } from '../common/AppText';
import { StatusChip, type StatusTone } from './StatusChip';

export interface ActivityRowProps {
  /** Drawn in the badge at the leading edge. */
  icon: ReactNode;
  title: string;
  /** Lines under the title, e.g. "My Vehicle • P2-148". */
  details: readonly string[];
  /** A right-hand column before the status, e.g. "Today, 09:14 AM". */
  time?: string;
  statusLabel: string;
  statusTone: StatusTone;
  /** Soft halo around the status, as on the latest guest request. */
  statusGlow?: boolean;
  /** Hairline along the top, separating the row from the one above. */
  divided?: boolean;
  /** Makes the row a button, shown by its trailing chevron. */
  onPress?: () => void;
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
}

/*
 * From the Parking design (assets/Screens/screen7.png), with the extra room
 * the inner screens are given: rows at least 46dp tall, as VisitorRow's, and
 * the Maintenance request badge. The time and status columns are fixed, so
 * only the title column gives way on narrow screens, wrapping rather than
 * truncating.
 */
const MIN_HEIGHT = 46;
const INSET_VERTICAL = 8;
const INSET_LEFT = 12;
const INSET_RIGHT = 12;
/** Leaves the chevron where the panel heading's "View All" chevron sits. */
const INSET_RIGHT_CHEVRON = 9.5;
export const ACTIVITY_BADGE_SIZE = 32;
const BADGE_TO_TEXT = 10;
const DETAIL_TOP = 2;
const TIME_GAP = 8;
const CHIP_WIDTH = 64;
const CHEVRON_SIZE = 13;
const CHEVRON_GAP = 6;

/** One entry in a panel's list: an event, a request or a booking, with its status. */
export function ActivityRow({
  icon,
  title,
  details,
  time,
  statusLabel,
  statusTone,
  statusGlow = false,
  divided = false,
  onPress,
  accessibilityHint,
  style,
}: ActivityRowProps) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={[title, ...details, time, statusLabel].filter(Boolean).join(', ')}
      accessibilityHint={accessibilityHint}
      style={({ pressed }) => [
        styles.row,
        onPress && styles.rowPressable,
        pressed && styles.pressed,
        style,
      ]}
    >
      {divided ? <View style={styles.divider} /> : null}

      <View style={styles.badge}>{icon}</View>

      <View style={styles.text}>
        <AppText variant="statValue" numberOfLines={2}>
          {title}
        </AppText>
        {details.map((line) => (
          <AppText
            key={line}
            variant="tileCaption"
            color={theme.colors.textSupport}
            numberOfLines={1}
            style={styles.detail}
          >
            {line}
          </AppText>
        ))}
      </View>

      {time ? (
        <AppText
          variant="tileCaption"
          color={theme.colors.textSupport}
          numberOfLines={1}
          style={styles.time}
        >
          {time}
        </AppText>
      ) : null}

      <StatusChip label={statusLabel} tone={statusTone} glow={statusGlow} style={styles.chip} />

      {onPress ? (
        <Ionicons
          name="chevron-forward"
          size={CHEVRON_SIZE}
          color={theme.colors.textPrimary}
          style={styles.chevron}
        />
      ) : null}
    </Pressable>
  );
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    row: {
      minHeight: MIN_HEIGHT,
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: INSET_VERTICAL,
      paddingLeft: INSET_LEFT,
      paddingRight: INSET_RIGHT,
    },
    rowPressable: {
      paddingRight: INSET_RIGHT_CHEVRON,
    },
    // Overlaid rather than stacked, so every row keeps the measured height.
    divider: {
      position: 'absolute',
      top: 0,
      left: INSET_LEFT,
      right: INSET_LEFT,
      height: StyleSheet.hairlineWidth,
      backgroundColor: theme.colors.dividerSubtle,
    },
    // The Maintenance request badge: a shade lighter than its panel.
    badge: {
      width: ACTIVITY_BADGE_SIZE,
      height: ACTIVITY_BADGE_SIZE,
      borderRadius: theme.borderRadius.sm,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.colors.dividerSubtle,
      backgroundColor: theme.colors.badgeFill,
      alignItems: 'center',
      justifyContent: 'center',
    },
    text: {
      flex: 1,
      marginLeft: BADGE_TO_TEXT,
      marginRight: TIME_GAP,
    },
    detail: {
      marginTop: DETAIL_TOP,
    },
    time: {
      marginRight: TIME_GAP,
    },
    chip: {
      width: CHIP_WIDTH,
    },
    chevron: {
      marginLeft: CHEVRON_GAP,
    },
    pressed: {
      opacity: 0.7,
    },
  });
}
