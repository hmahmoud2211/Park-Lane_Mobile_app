import Ionicons from '@expo/vector-icons/Ionicons';
import { useMemo } from 'react';
import { Image, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { images } from '../../constants/images';
import { useAppTheme } from '../../hooks/useAppTheme';
import { useLayoutSize } from '../../hooks/useLayoutSize';
import type { AppTheme } from '../../types/theme.types';
import { clamp } from '../../utils/responsive';
import { BackButton } from '../common/BackButton';

export interface PageHeaderProps {
  /** The screen's name, shown after the back chevron. */
  title: string;
  onMenuPress?: () => void;
  style?: StyleProp<ViewStyle>;
}

/*
 * From the Visitor Access and Maintenance designs (assets/Screens/screen5.png,
 * screen6.png). The lockup sits where Home's does, so it holds its place
 * between screens; the back label and menu ride 10dp below the header top,
 * above the lockup's middle.
 *
 * The back label takes My Unit's title type, which is wider than the
 * design's, so the chevron moves out to where My Unit's back arrow sits, 24dp
 * from the screen edge, and the lockup is drawn smaller. On narrow screens it
 * shrinks further, down to a floor, to keep clear of the label.
 */
const HEIGHT = 40;
/** The design's lockup is 132 x 40; this keeps its proportions. */
const LOCKUP_ASPECT = 132 / 40;
const LOCKUP_WIDTH = 112;
const LOCKUP_MIN_WIDTH = 80;
/** Space kept between the end of the back label and the lockup. */
const LOCKUP_CLEARANCE = 8;
const ROW_HEIGHT = 20;
/** Out into the screens' 35dp gutter, so the chevron starts 24dp in. */
const INSET_LEFT = -11;
const MENU_INSET_RIGHT = 12;
const MENU_ICON_SIZE = 24;

/** Back label, centred brand lockup and menu, across the top of an inner screen. */
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

  // Centred, so it gives up equal room on both sides to clear the back label.
  const lockupWidth =
    headerWidth > 0 && backWidth > 0
      ? clamp(
          headerWidth - 2 * (INSET_LEFT + backWidth + LOCKUP_CLEARANCE),
          LOCKUP_MIN_WIDTH,
          LOCKUP_WIDTH,
        )
      : LOCKUP_WIDTH;

  return (
    <View ref={headerRef} style={[styles.header, style]} onLayout={onHeaderLayout}>
      <Image
        fadeDuration={0}
        source={images.brandWordmark}
        style={[styles.lockup, { width: lockupWidth, height: lockupWidth / LOCKUP_ASPECT }]}
        resizeMode="contain"
        accessibilityLabel="Park Lane Compoundhood, New Capital"
      />
      {/* Drawn over the lockup, so both controls stay tappable. */}
      <View style={styles.row} pointerEvents="box-none">
        <View ref={backRef} onLayout={onBackLayout}>
          <BackButton variant="chevron" label={title} />
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
      alignSelf: 'center',
      tintColor: theme.colors.textPrimary,
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
