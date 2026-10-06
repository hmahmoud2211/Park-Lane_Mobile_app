import Ionicons from '@expo/vector-icons/Ionicons';
import { useMemo } from 'react';
import { Image, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { images } from '../../constants/images';
import { useAppTheme } from '../../hooks/useAppTheme';
import { useLayoutSize } from '../../hooks/useLayoutSize';
import type { AppTheme } from '../../types/theme.types';
import { BACK_BUTTON_SIZE, BackButton } from '../common/BackButton';

export interface PageHeaderProps {
  /** The screen's name, shown beside the back ring. */
  title: string;
  onMenuPress?: () => void;
  style?: StyleProp<ViewStyle>;
}

/*
 * From the Visitor Access and Maintenance designs (assets/Screens/screen5.png,
 * screen6.png): back control, brand lockup and menu across the top.
 *
 * The back control is the Profile header's ring and bold title, shared by
 * every screen, and sits 24dp from the screen edge like My Unit's. That pair
 * is wider than the design's bare chevron, so the lockup is centred in the
 * space between the title and the menu rather than on the screen, shrinking
 * to a floor on narrow screens and hidden if a long title leaves no room.
 */
const HEIGHT = 40;
/** The design's lockup is 132 x 40; this keeps its proportions. */
const LOCKUP_ASPECT = 132 / 40;
const LOCKUP_WIDTH = 112;
const LOCKUP_MIN_WIDTH = 72;
/** Space kept on each side of the lockup. */
const LOCKUP_CLEARANCE = 8;
const ROW_HEIGHT = BACK_BUTTON_SIZE;
/** Out into the screens' 35dp gutter, so the ring starts 24dp in. */
const INSET_LEFT = -11;
const MENU_INSET_RIGHT = 12;
const MENU_ICON_SIZE = 24;

/** Back control, brand lockup and menu, across the top of an inner screen. */
export function PageHeader({ title, onMenuPress, style }: PageHeaderProps) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  // Both measured before the first paint, so the lockup never jumps in size.
  const {
    ref: headerRef,
    size: { width: headerWidth },
    onLayout: onHeaderLayout,
  } = useLayoutSize();
  const { ref: backRef, size: { width: backWidth }, onLayout: onBackLayout } = useLayoutSize();

  const measured = headerWidth > 0 && backWidth > 0;
  const gapStart = INSET_LEFT + backWidth + LOCKUP_CLEARANCE;
  const gapEnd = headerWidth - MENU_INSET_RIGHT - MENU_ICON_SIZE - LOCKUP_CLEARANCE;
  const available = gapEnd - gapStart;
  const lockupWidth = Math.min(LOCKUP_WIDTH, available);
  const lockupHeight = lockupWidth / LOCKUP_ASPECT;
  const showLockup = measured && available >= LOCKUP_MIN_WIDTH;

  return (
    <View ref={headerRef} style={[styles.header, style]} onLayout={onHeaderLayout}>
      {showLockup ? (
        <Image
          fadeDuration={0}
          source={images.brandWordmark}
          style={[
            styles.lockup,
            {
              width: lockupWidth,
              height: lockupHeight,
              left: gapStart + (available - lockupWidth) / 2,
              top: (ROW_HEIGHT - lockupHeight) / 2,
            },
          ]}
          resizeMode="contain"
          accessibilityLabel="Park Lane Compoundhood, New Capital"
        />
      ) : null}
      {/* Drawn over the lockup, so both controls stay tappable. */}
      <View style={styles.row} pointerEvents="box-none">
        <View ref={backRef} onLayout={onBackLayout} style={styles.back}>
          <BackButton title={title} />
        </View>
        <Pressable
          onPress={onMenuPress}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Open menu"
          style={({ pressed }) => pressed && styles.pressed}
        >
          <Ionicons name="menu" size={MENU_ICON_SIZE} color={theme.colors.textPrimary} />
        </Pressable>
      </View>
    </View>
  );
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    header: {
      height: HEIGHT,
    },
    lockup: {
      position: 'absolute',
      tintColor: theme.colors.textPrimary,
    },
    back: {
      flexShrink: 1,
      marginRight: theme.spacing.sm,
    },
    row: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      height: ROW_HEIGHT,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginLeft: INSET_LEFT,
      paddingRight: MENU_INSET_RIGHT,
    },
    pressed: {
      opacity: 0.6,
    },
  });
}
