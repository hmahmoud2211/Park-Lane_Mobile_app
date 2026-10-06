import Ionicons from '@expo/vector-icons/Ionicons';
import { useMemo } from 'react';
import { Image, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { images } from '../../constants/images';
import { useAppTheme } from '../../hooks/useAppTheme';
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
 * The lockup is part of the backdrop: fixed in size, centred on the screen
 * and drawn beneath the controls, so the title never moves or shrinks it.
 * The back control is the Profile header's ring and bold title, 24dp from
 * the screen edge like My Unit's.
 */
const HEIGHT = 40;
/** The design's lockup is 132 x 40; this keeps its proportions. */
const LOCKUP_ASPECT = 132 / 40;
const LOCKUP_WIDTH = 112;
const LOCKUP_HEIGHT = LOCKUP_WIDTH / LOCKUP_ASPECT;
const ROW_HEIGHT = BACK_BUTTON_SIZE;
/** Out into the screens' 35dp gutter, so the ring starts 24dp in. */
const INSET_LEFT = -11;
const MENU_INSET_RIGHT = 12;
const MENU_ICON_SIZE = 24;

/** Back control and menu over the brand lockup, across the top of an inner screen. */
export function PageHeader({ title, onMenuPress, style }: PageHeaderProps) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  return (
    <View style={[styles.header, style]}>
      {/* Backdrop layer: never takes touches, so the controls above stay tappable. */}
      <View style={styles.lockupLayer} pointerEvents="none">
        <Image
          fadeDuration={0}
          source={images.brandWordmark}
          style={styles.lockup}
          resizeMode="contain"
          accessibilityLabel="Park Lane Compoundhood, New Capital"
        />
      </View>
      <View style={styles.row} pointerEvents="box-none">
        <BackButton title={title} style={styles.back} />
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
    lockupLayer: {
      ...StyleSheet.absoluteFill,
      alignItems: 'center',
    },
    lockup: {
      marginTop: (ROW_HEIGHT - LOCKUP_HEIGHT) / 2,
      width: LOCKUP_WIDTH,
      height: LOCKUP_HEIGHT,
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
