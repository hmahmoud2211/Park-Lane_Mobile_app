import Ionicons from '@expo/vector-icons/Ionicons';
import { useMemo } from 'react';
import { Image, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { images } from '../../constants/images';
import { useAppTheme } from '../../hooks/useAppTheme';
import type { TypographyVariant } from '../../theme';
import type { AppTheme } from '../../types/theme.types';
import { BackButton } from '../common/BackButton';

export interface PageHeaderProps {
  /** The screen's name, shown after the back chevron. */
  title: string;
  onMenuPress?: () => void;
  /** Type for `title`; the designs differ slightly between screens. */
  titleVariant?: TypographyVariant;
  style?: StyleProp<ViewStyle>;
}

/*
 * From the Visitor Access and Maintenance designs (assets/Screens/screen5.png,
 * screen6.png). The lockup sits where Home's does, so it holds its place
 * between screens; the back label and menu ride 10dp below the header top,
 * above the lockup's middle.
 */
const LOCKUP_WIDTH = 132;
const LOCKUP_HEIGHT = 40;
const ROW_HEIGHT = 20;
/** Pulls the chevron's glyph, not its box, onto the 37dp line. */
const INSET_LEFT = -1.5;
const MENU_INSET_RIGHT = 12;
const MENU_ICON_SIZE = 24;

/** Back label, centred brand lockup and menu, across the top of an inner screen. */
export function PageHeader({ title, onMenuPress, titleVariant, style }: PageHeaderProps) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  return (
    <View style={[styles.header, style]}>
      <Image
        source={images.brandWordmark}
        style={styles.lockup}
        resizeMode="contain"
        accessibilityLabel="Park Lane Compoundhood, New Capital"
      />
      {/* Drawn over the lockup, so both controls stay tappable. */}
      <View style={styles.row} pointerEvents="box-none">
        <BackButton variant="chevron" label={title} labelVariant={titleVariant} />
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
      height: LOCKUP_HEIGHT,
    },
    lockup: {
      alignSelf: 'center',
      width: LOCKUP_WIDTH,
      height: LOCKUP_HEIGHT,
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
