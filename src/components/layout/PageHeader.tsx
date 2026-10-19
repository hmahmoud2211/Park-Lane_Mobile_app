import Ionicons from '@expo/vector-icons/Ionicons';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { useAppTheme } from '../../hooks/useAppTheme';
import { AppText } from '../common/AppText';
import { BackButton } from '../common/BackButton';
import { BRAND_LOCKUP_HEIGHT, BrandLockup } from './BrandLockup';

export interface PageHeaderProps {
  /** The screen's name, shown on its own line beneath the back ring. */
  title: string;
  /** A supporting line under the title, e.g. "Everyday services, made easier." */
  subtitle?: string;
  /** Shows the menu button at the end of the row. */
  onMenuPress?: () => void;
  /** Replaces the menu button with the screen's own control. */
  trailing?: ReactNode;
  /** Hides the back ring, e.g. on a page a visitor opened from a link. */
  showBack?: boolean;
  /** Replaces the back ring's default (pop the stack), e.g. to go back a step in a flow. */
  onBack?: () => void;
  /** A quieter line under the title, e.g. "Step 2 of 2". */
  subtitle?: string;
  /** Overrides the back ring, e.g. to step back through a wizard rather than leave it. */
  onBackPress?: () => void;
  style?: StyleProp<ViewStyle>;
}

/*
 * From the Visitor Access and Maintenance designs (assets/Screens/screen5.png,
 * screen6.png): back control, brand lockup and menu across the top.
 *
 * The lockup is part of the backdrop: centred on the screen and drawn beneath
 * the controls, at the same size and height as Home's (see BrandLockup). Only
 * the back ring and the menu share its row; the title sits on its own line
 * below, so a long screen name can never run into the lockup or push it off
 * centre. The ring sits 24dp from the screen edge, and the title lines up
 * with it.
 *
 * Drawn for a 35dp header gutter: screens with another gutter give the
 * header `marginHorizontal: 35 - gutter`.
 */
const ROW_HEIGHT = BRAND_LOCKUP_HEIGHT;
/** Out into the screens' 35dp gutter, so the ring starts 24dp in. */
const INSET_LEFT = -11;
const MENU_INSET_RIGHT = 12;
const MENU_ICON_SIZE = 24;
/** Space between the control row and the title. */
const TITLE_GAP = 14;
/** Space between the title and its supporting line, from the Services design. */
const SUBTITLE_GAP = 2;

/** Back control and menu over the brand lockup, across the top of an inner screen. */
export function PageHeader({ title, onMenuPress, trailing, showBack = true, onBack, subtitle, style }: PageHeaderProps) {
export function PageHeader({ title, subtitle, onMenuPress, trailing, onBackPress, style }: PageHeaderProps) {
  const theme = useAppTheme();

  const menu = onMenuPress ? (
    <Pressable
      onPress={onMenuPress}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel="Open menu"
      style={({ pressed }) => pressed && styles.pressed}
    >
      <Ionicons name="menu" size={MENU_ICON_SIZE} color={theme.colors.textPrimary} />
    </Pressable>
  ) : null;

  return (
    <View style={style}>
      {/* Backdrop layer: never takes touches, so the controls above stay tappable. */}
      <View style={styles.lockupLayer} pointerEvents="none">
        <BrandLockup />
      </View>
      <View style={styles.row} pointerEvents="box-none">
        {showBack ? <BackButton onPress={onBack} /> : <View />}
        <BackButton onPress={onBackPress} />
        {trailing ?? menu}
      </View>
      <AppText
        variant="subheading"
        style={styles.title}
        numberOfLines={1}
        accessibilityRole="header"
      >
        {title}
      </AppText>
      {subtitle ? (
        <AppText variant="label" color={theme.colors.textSupport} style={styles.subtitle}>
        <AppText
          variant="bodySmall"
          color={theme.colors.textAccentSoft}
          style={styles.subtitle}
          numberOfLines={2}
        >
          {subtitle}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  lockupLayer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: ROW_HEIGHT,
    alignItems: 'center',
  },
  row: {
    height: ROW_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginLeft: INSET_LEFT,
    paddingRight: MENU_INSET_RIGHT,
  },
  title: {
    marginTop: TITLE_GAP,
    marginLeft: INSET_LEFT,
  },
  subtitle: {
    marginTop: 2,
    marginTop: SUBTITLE_GAP,
    marginLeft: INSET_LEFT,
  },
  pressed: {
    opacity: 0.6,
  },
});
