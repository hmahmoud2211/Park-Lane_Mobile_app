import Ionicons from '@expo/vector-icons/Ionicons';
import { Fragment, useMemo } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAppTheme } from '../../hooks/useAppTheme';
import type { AppTheme } from '../../types/theme.types';
import { AppText } from '../common/AppText';
import { GlassSurface } from '../common/GlassSurface';

export interface AppMenuItem {
  id: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
}

export interface AppMenuProps {
  visible: boolean;
  onClose: () => void;
  items: readonly AppMenuItem[];
  /** Distance below the safe-area inset, to clear the screen's header. */
  offsetTop?: number;
}

const PANEL_WIDTH = 190;

/**
 * Dropdown anchored under a screen header's menu button.
 *
 * A Modal rather than an in-tree overlay, so it escapes the scroll view and
 * always sits above the pinned bottom bar. Tapping the backdrop dismisses it.
 */
export function AppMenu({ visible, onClose, items, offsetTop = 52 }: AppMenuProps) {
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(theme), [theme]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close menu">
        {/* Swallows taps on the panel so they do not dismiss it. */}
        <Pressable
          style={[styles.anchor, { top: insets.top + offsetTop }]}
          onPress={(event) => event.stopPropagation()}
        >
          <GlassSurface radius={theme.borderRadius.lg} style={styles.panel}>
            {items.map((item, index) => (
              <Fragment key={item.id}>
                {index > 0 ? <View style={styles.divider} /> : null}
                <Pressable
                  onPress={item.onPress}
                  accessibilityRole="menuitem"
                  style={({ pressed }) => [styles.item, pressed && styles.itemPressed]}
                >
                  <Ionicons name={item.icon} size={17} color={theme.colors.textPrimary} />
                  <AppText variant="tileTitle" style={styles.itemLabel}>
                    {item.label}
                  </AppText>
                </Pressable>
              </Fragment>
            ))}
          </GlassSurface>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: theme.colors.scrimTop,
    },
    anchor: {
      position: 'absolute',
      left: theme.spacing.screenGutter,
      width: PANEL_WIDTH,
    },
    panel: {
      paddingVertical: theme.spacing.xs,
      ...theme.shadows.card,
    },
    item: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: theme.spacing.sm + 2,
      paddingHorizontal: theme.spacing.md,
    },
    itemPressed: {
      opacity: 0.6,
    },
    itemLabel: {
      marginLeft: theme.spacing.sm + 2,
    },
    divider: {
      height: StyleSheet.hairlineWidth,
      marginHorizontal: theme.spacing.md,
      backgroundColor: theme.colors.divider,
    },
  });
}
