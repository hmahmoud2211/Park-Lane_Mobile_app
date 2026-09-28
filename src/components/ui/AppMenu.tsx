import Ionicons from '@expo/vector-icons/Ionicons';
import { Fragment, useMemo } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAppTheme } from '../../hooks/useAppTheme';
import type { AppTheme } from '../../types/theme.types';
import { AppText } from '../common/AppText';
import { GlassSurface } from '../common/GlassSurface';

export interface AppMenuItem {
  id: string;
  label: string;
  /** Omitted for plain option lists, such as a picker's choices. */
  icon?: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
}

export interface AppMenuProps {
  visible: boolean;
  onClose: () => void;
  items: readonly AppMenuItem[];
  /** Distance below the safe-area inset, to clear the screen's header. */
  offsetTop?: number;
  /**
   * Window position of the control that opened the menu. When given, the
   * panel hangs just below it, or sits just above it when there is more room
   * there, and `offsetTop` is ignored.
   */
  anchor?: { y: number; height: number };
  /** Screen edge the panel hangs from, matching the button that opened it. */
  align?: 'left' | 'right';
  /** Marks the current choice with a check, when the menu is a picker. */
  selectedId?: string;
}

const PANEL_WIDTH = 190;
/** Space kept clear below a long list, which scrolls rather than overflowing. */
const BOTTOM_CLEARANCE = 16;
/** Gap between an `anchor` and the panel. */
const ANCHOR_GAP = 4;
/** Below this much room under an `anchor`, the panel may flip above it. */
const MIN_ROOM_BELOW = 160;

/**
 * Dropdown anchored under a screen header's menu button.
 *
 * A Modal rather than an in-tree overlay, so it escapes the scroll view and
 * always sits above the pinned bottom bar. Tapping the backdrop dismisses it.
 */
export function AppMenu({
  visible,
  onClose,
  items,
  offsetTop = 52,
  anchor,
  align = 'left',
  selectedId,
}: AppMenuProps) {
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const styles = useMemo(() => createStyles(theme), [theme]);

  const placement = useMemo(() => {
    const topBelow = anchor ? anchor.y + anchor.height + ANCHOR_GAP : insets.top + offsetTop;
    const roomBelow = windowHeight - topBelow - insets.bottom - BOTTOM_CLEARANCE;
    if (!anchor || roomBelow >= MIN_ROOM_BELOW) {
      return { position: { top: topBelow }, maxHeight: Math.max(0, roomBelow) };
    }
    const roomAbove = anchor.y - ANCHOR_GAP - insets.top - BOTTOM_CLEARANCE;
    return roomAbove > roomBelow
      ? { position: { bottom: windowHeight - anchor.y + ANCHOR_GAP }, maxHeight: roomAbove }
      : { position: { top: topBelow }, maxHeight: Math.max(0, roomBelow) };
  }, [anchor, insets.top, insets.bottom, offsetTop, windowHeight]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close menu">
        {/* Swallows taps on the panel so they do not dismiss it. */}
        <Pressable
          style={[
            styles.anchor,
            align === 'right' ? styles.anchorRight : styles.anchorLeft,
            placement.position,
          ]}
          onPress={(event) => event.stopPropagation()}
        >
          <GlassSurface radius={theme.borderRadius.lg} style={styles.panel}>
            <ScrollView
              style={{ maxHeight: placement.maxHeight }}
              bounces={false}
              showsVerticalScrollIndicator={false}
            >
              {items.map((item, index) => {
                const selected = item.id === selectedId;
                return (
                  <Fragment key={item.id}>
                    {index > 0 ? <View style={styles.divider} /> : null}
                    <Pressable
                      onPress={item.onPress}
                      accessibilityRole="menuitem"
                      accessibilityState={selectedId === undefined ? undefined : { selected }}
                      style={({ pressed }) => [styles.item, pressed && styles.itemPressed]}
                    >
                      {item.icon ? (
                        <Ionicons
                          name={item.icon}
                          size={17}
                          color={theme.colors.textPrimary}
                          style={styles.itemIcon}
                        />
                      ) : null}
                      <AppText variant="tileTitle" style={styles.itemLabel}>
                        {item.label}
                      </AppText>
                      {selected ? (
                        <Ionicons name="checkmark" size={15} color={theme.colors.accent} />
                      ) : null}
                    </Pressable>
                  </Fragment>
                );
              })}
            </ScrollView>
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
      width: PANEL_WIDTH,
    },
    anchorLeft: {
      left: theme.spacing.screenGutter,
    },
    anchorRight: {
      right: theme.spacing.screenGutter,
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
    itemIcon: {
      marginRight: theme.spacing.sm + 2,
    },
    itemLabel: {
      flex: 1,
    },
    divider: {
      height: StyleSheet.hairlineWidth,
      marginHorizontal: theme.spacing.md,
      backgroundColor: theme.colors.divider,
    },
  });
}
