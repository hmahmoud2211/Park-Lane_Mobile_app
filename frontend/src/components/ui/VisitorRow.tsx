import Ionicons from '@expo/vector-icons/Ionicons';
import { useMemo } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { useAppTheme } from '../../hooks/useAppTheme';
import type { AppTheme } from '../../types/theme.types';
import { AppText } from '../common/AppText';
import { Avatar } from './Avatar';
import { StatusChip, type StatusTone } from './StatusChip';

export interface VisitorRowProps {
  name: string;
  /** Visit time and party size, e.g. "Today, 11:00 AM • 1 Guest". */
  meta: string;
  initials: string;
  /** Car plate; the column stays in place when there is none. */
  plate?: string;
  statusLabel: string;
  statusTone: StatusTone;
  /** Hairline along the top, separating the row from the one above. */
  divided?: boolean;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}

/*
 * Based on the Visitor Access reference (assets/Screens/screen5.png), with
 * more air than it draws: a 46dp row, the avatar 12dp from the card edge,
 * and fixed plate, status and chevron columns on the right, so only the name
 * column gives way on narrow screens.
 */
const ROW_HEIGHT = 46;
const AVATAR_SIZE = 28;
const INSET_LEFT = 12;
const INSET_RIGHT = 8;
const NAME_GAP = 10;
const CAR_ICON_SIZE = 13;
const CAR_TO_PLATE = 9;
const PLATE_COLUMN = 40.5;
/** Narrower than drawn, so the longest meta line keeps one line in My Unit's type. */
const CHIP_WIDTH = 60;
const CHIP_TO_CHEVRON = 5;
const CHEVRON_SIZE = 13;

/** One visitor in the "Upcoming Visitors" list: who, when, car, status. */
export function VisitorRow({
  name,
  meta,
  initials,
  plate,
  statusLabel,
  statusTone,
  divided = false,
  onPress,
  style,
}: VisitorRowProps) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole="button"
      accessibilityLabel={[name, meta, plate, statusLabel].filter(Boolean).join(', ')}
      accessibilityHint={onPress ? 'Shows this visitor’s pass' : undefined}
      style={({ pressed }) => [styles.row, pressed && styles.pressed, style]}
    >
      {divided ? <View style={styles.divider} /> : null}

      <Avatar
        initials={initials}
        size={AVATAR_SIZE}
        variant="flat"
        labelVariant="statLabel"
        style={styles.avatar}
      />

      <View style={styles.text}>
        <AppText variant="statValue" numberOfLines={1}>
          {name}
        </AppText>
        <AppText
          variant="tileCaption"
          color={theme.colors.textSupport}
          numberOfLines={1}
          style={styles.meta}
        >
          {meta}
        </AppText>
      </View>

      <Ionicons name="car-outline" size={CAR_ICON_SIZE} color={theme.colors.textPrimary} />
      <AppText
        variant="tileCaption"
        color={theme.colors.inputLabel}
        numberOfLines={1}
        style={styles.plate}
      >
        {plate || '—'}
      </AppText>

      <StatusChip label={statusLabel} tone={statusTone} style={styles.chip} />

      <Ionicons
        name="chevron-forward"
        size={CHEVRON_SIZE}
        color={theme.colors.textPrimary}
        style={styles.chevron}
      />
    </Pressable>
  );
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    row: {
      height: ROW_HEIGHT,
      flexDirection: 'row',
      alignItems: 'center',
      paddingLeft: INSET_LEFT,
      paddingRight: INSET_RIGHT,
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
    avatar: {
      backgroundColor: theme.colors.avatarFill,
      borderColor: theme.colors.avatarStroke,
    },
    // Both text blocks sit a little below the row's centre, as drawn: the
    // padding shifts each by half its value.
    text: {
      flex: 1,
      marginLeft: NAME_GAP,
      marginRight: theme.spacing.xs,
      paddingTop: 2,
    },
    meta: {
      marginTop: 3,
    },
    plate: {
      width: PLATE_COLUMN,
      marginLeft: CAR_TO_PLATE,
      paddingTop: 2,
    },
    chip: {
      width: CHIP_WIDTH,
    },
    chevron: {
      marginLeft: CHIP_TO_CHEVRON,
    },
    pressed: {
      opacity: 0.7,
    },
  });
}
