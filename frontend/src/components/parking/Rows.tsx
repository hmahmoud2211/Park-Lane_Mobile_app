import Ionicons from '@expo/vector-icons/Ionicons';
import { useMemo } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import { useAppTheme } from '../../hooks/useAppTheme';
import type { AppTheme } from '../../types/theme.types';
import type { QrImageSource } from '../../utils/passImage.shared';
import { AppText } from '../common/AppText';
import { StatusChip, type StatusTone } from '../ui/StatusChip';

/* --------------------------------------------------------- List row */

export interface ListRowProps {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  lines?: readonly string[];
  statusLabel?: string;
  statusTone?: StatusTone;
  onPress?: () => void;
  divided?: boolean;
  accessibilityHint?: string;
}

/** One booking, event or alert in a list, with readable type and its status. */
export function ListRow({ icon, title, lines = [], statusLabel, statusTone, onPress, divided, accessibilityHint }: ListRowProps) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={[title, ...lines, statusLabel].filter(Boolean).join(', ')}
      accessibilityHint={accessibilityHint}
      style={({ pressed }) => [styles.row, divided && styles.divided, pressed && styles.pressed]}
    >
      <View style={styles.badge}>
        <Ionicons name={icon} size={18} color={theme.colors.textPrimary} />
      </View>
      <View style={styles.text}>
        <AppText variant="bodyStrong" numberOfLines={2}>
          {title}
        </AppText>
        {lines.map((line, index) => (
          <AppText key={`${index}-${line}`} variant="label" color={theme.colors.textSupport} numberOfLines={2}>
            {line}
          </AppText>
        ))}
      </View>
      {statusLabel && statusTone ? <StatusChip label={statusLabel} tone={statusTone} style={styles.chip} /> : null}
      {onPress ? <Ionicons name="chevron-forward" size={15} color={theme.colors.textSupport} /> : null}
    </Pressable>
  );
}

/* ------------------------------------------------------------ QR pass */

export interface PassQrProps {
  value: string;
  size?: number;
  /** Greys the code out with a caption, e.g. once a pass is used. */
  voidLabel?: string;
  /** Receives the drawing, e.g. to save the code as an image. */
  qrRef?: (source: QrImageSource | null) => void;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}

/** White margin around the code, which scanners need. Drawn into the code itself, so a saved image keeps it. */
const QUIET_ZONE = 8;

/** A scannable QR on a white quiet zone. */
export function PassQr({ value, size = 190, voidLabel, qrRef, accessibilityLabel = 'Gate pass QR code', style }: PassQrProps) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  return (
    <View style={[styles.qrWrap, style]}>
      <View style={[styles.qrFrame, voidLabel ? styles.qrVoid : null]} accessible accessibilityLabel={accessibilityLabel}>
        <QRCode
          value={value}
          size={size + QUIET_ZONE * 2}
          quietZone={QUIET_ZONE}
          color={theme.colors.qrForeground}
          backgroundColor={theme.colors.qrBackground}
          ecl="M"
          getRef={qrRef}
        />
      </View>
      {voidLabel ? (
        <View style={styles.voidBadge}>
          <AppText variant="bodyStrong">{voidLabel}</AppText>
        </View>
      ) : null}
    </View>
  );
}

/* ------------------------------------------------------------ Timeline */

export interface TimelineItem {
  id: string;
  time: string;
  title: string;
  detail?: string;
  tone?: 'normal' | 'good' | 'bad';
}

/** A vertical run of events, newest first. */
export function Timeline({ items }: { items: readonly TimelineItem[] }) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  return (
    <View>
      {items.map((item, index) => {
        const dot =
          item.tone === 'good' ? theme.colors.success : item.tone === 'bad' ? theme.colors.error : theme.colors.accent;
        return (
          <View key={item.id} style={styles.event}>
            <View style={styles.rail}>
              <View style={[styles.dot, { backgroundColor: dot }]} />
              {index < items.length - 1 ? <View style={styles.line} /> : null}
            </View>
            <View style={styles.eventText}>
              <AppText variant="label" color={theme.colors.textSupport}>
                {item.time}
              </AppText>
              <AppText variant="bodyStrong">{item.title}</AppText>
              {item.detail ? (
                <AppText variant="label" color={theme.colors.textMuted}>
                  {item.detail}
                </AppText>
              ) : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    row: {
      minHeight: 56,
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 10,
      gap: 10,
    },
    divided: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.colors.dividerSubtle,
    },
    pressed: {
      opacity: 0.7,
    },
    badge: {
      width: 36,
      height: 36,
      borderRadius: theme.borderRadius.sm,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.colors.dividerSubtle,
      backgroundColor: theme.colors.badgeFill,
      alignItems: 'center',
      justifyContent: 'center',
    },
    text: {
      flex: 1,
      gap: 2,
    },
    chip: {
      minWidth: 74,
    },

    qrWrap: {
      alignItems: 'center',
      justifyContent: 'center',
    },
    qrFrame: {
      // Just enough to clear the rounded corners; the rest of the margin is drawn in the code.
      padding: 4,
      borderRadius: theme.borderRadius.md,
      backgroundColor: theme.colors.qrBackground,
      borderWidth: 2,
      borderColor: theme.colors.electricCyan,
      shadowColor: theme.colors.electricCyan,
      shadowOpacity: 0.7,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 0 },
      elevation: 6,
    },
    qrVoid: {
      opacity: 0.18,
    },
    voidBadge: {
      position: 'absolute',
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: theme.borderRadius.pill,
      backgroundColor: theme.colors.chipSlateFill,
      borderWidth: 1,
      borderColor: theme.colors.chipSlateStroke,
    },

    event: {
      flexDirection: 'row',
    },
    rail: {
      width: 18,
      alignItems: 'center',
    },
    dot: {
      width: 9,
      height: 9,
      borderRadius: 5,
      marginTop: 5,
    },
    line: {
      flex: 1,
      width: 1,
      backgroundColor: theme.colors.dividerSubtle,
      marginVertical: 3,
    },
    eventText: {
      flex: 1,
      paddingLeft: 8,
      paddingBottom: 14,
    },
  });
}
