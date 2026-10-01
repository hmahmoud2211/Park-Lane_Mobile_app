import Ionicons from '@expo/vector-icons/Ionicons';
import { useMemo, useRef } from 'react';
import {
  Pressable,
  StyleSheet,
  View,
  type LayoutRectangle,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import { useAppTheme } from '../../hooks/useAppTheme';
import type { AppTheme } from '../../types/theme.types';
import { AppText } from '../common/AppText';
import { GlassSurface } from '../common/GlassSurface';
import { StatusChip, type StatusTone } from './StatusChip';

export interface VisitorPassCardProps {
  /** Encoded into the QR code. */
  qrValue: string;
  name: string;
  /** Date and time, e.g. "05 Oct 2026 • 02:30 PM". */
  schedule: string;
  guestsLabel: string;
  /** Car plate; the car column is left out when there is none. */
  plate?: string;
  caption: string;
  statusLabel: string;
  statusTone: StatusTone;
  statusIcon?: keyof typeof Ionicons.glyphMap;
  /** Receives the button's window position, so a menu can hang from it. */
  onMorePress?: (anchor: LayoutRectangle) => void;
  style?: StyleProp<ViewStyle>;
}

/*
 * Based on the Visitor Access reference (assets/Screens/screen5.png), with
 * more air than it draws: the QR 14dp in, the details column 14dp after it,
 * and a divided column for the "more" button on the right. The text is set in
 * My Unit's type, so the footnote wraps where the design fits it on one line.
 */
const QR_SIZE = 56;
const QR_PADDING = 3.5;
const QR_BORDER = 1.5;
const QR_INSET = 14;
const DETAILS_GAP = 14;
const DETAILS_TOP = 14;
const DETAILS_BOTTOM = 14;
const INFO_ICON_SIZE = 12;
const INFO_ICON_GAP = 6.5;
const INFO_SEPARATOR_HEIGHT = 11;
const INFO_SEPARATOR_GAP = 9;
const DETAILS_TO_DIVIDER = 11.5;
const DIVIDER_HEIGHT = 52;
const MORE_COLUMN = 21.5;
const MORE_ICON_SIZE = 13;

/** The active visitor pass: QR code, holder, visit details and status. */
export function VisitorPassCard({
  qrValue,
  name,
  schedule,
  guestsLabel,
  plate,
  caption,
  statusLabel,
  statusTone,
  statusIcon,
  onMorePress,
  style,
}: VisitorPassCardProps) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const moreRef = useRef<View>(null);

  const handleMorePress = () => {
    moreRef.current?.measureInWindow((x, y, width, height) => {
      onMorePress?.({ x, y, width, height });
    });
  };

  return (
    <GlassSurface
      radius={theme.borderRadius.md}
      glow
      strokeColors={[theme.colors.cardStrokeFrom, theme.colors.featureStrokeTo]}
      // The same frosted glass as the My Unit cards.
      fillOpacity={theme.glass.subtleFillOpacity}
      style={[styles.card, style]}
    >
      <View
        style={styles.qrFrame}
        accessible
        accessibilityRole="image"
        accessibilityLabel={`QR pass for ${name}`}
      >
        <QRCode
          value={qrValue}
          size={QR_SIZE}
          // Low correction keeps the code coarse enough to read at this size.
          ecl="L"
          color={theme.colors.deepNavy}
          backgroundColor={theme.colors.white}
        />
      </View>

      <View style={styles.details}>
        <View style={styles.nameRow}>
          {/* Wraps rather than truncates where a narrow screen crowds it against the chip. */}
          <AppText variant="sectionTitle" numberOfLines={2} style={styles.name}>
            {name}
          </AppText>
          <StatusChip
            label={statusLabel}
            tone={statusTone}
            icon={statusIcon}
            glow
          />
        </View>

        <AppText variant="statLabel" color={theme.colors.textSupport} style={styles.schedule}>
          {schedule}
        </AppText>

        <View style={styles.infoRow}>
          <Ionicons name="people-outline" size={INFO_ICON_SIZE} color={theme.colors.textPrimary} />
          <AppText variant="tileCaption" color={theme.colors.textSupport} style={styles.infoText}>
            {guestsLabel}
          </AppText>
          {plate ? (
            <>
              <View style={styles.infoSeparator} />
              <Ionicons name="car-outline" size={INFO_ICON_SIZE} color={theme.colors.textPrimary} />
              <AppText
                variant="tileCaption"
                color={theme.colors.textSupport}
                style={styles.infoText}
              >
                {plate}
              </AppText>
            </>
          ) : null}
        </View>

        <AppText variant="tileCaption" color={theme.colors.textSupport} style={styles.caption}>
          {caption}
        </AppText>
      </View>

      <View style={styles.divider} />

      <Pressable
        ref={moreRef}
        onPress={handleMorePress}
        disabled={!onMorePress}
        hitSlop={{ top: 12, bottom: 12, left: 6, right: 6 }}
        accessibilityRole="button"
        accessibilityLabel="Pass options"
        style={({ pressed }) => [
          styles.more,
          !onMorePress && styles.moreDisabled,
          pressed && styles.pressed,
        ]}
      >
        <Ionicons name="ellipsis-vertical" size={MORE_ICON_SIZE} color={theme.colors.textPrimary} />
      </Pressable>
    </GlassSurface>
  );
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    card: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingLeft: QR_INSET,
    },
    qrFrame: {
      padding: QR_PADDING,
      borderRadius: 4,
      borderWidth: QR_BORDER,
      borderColor: theme.colors.electricCyan,
      backgroundColor: theme.colors.white,
      shadowColor: theme.colors.electricCyan,
      shadowOpacity: 0.8,
      shadowRadius: 6,
      shadowOffset: { width: 0, height: 0 },
      elevation: 6,
    },
    details: {
      flex: 1,
      marginLeft: DETAILS_GAP,
      marginRight: DETAILS_TO_DIVIDER,
      paddingTop: DETAILS_TOP,
      paddingBottom: DETAILS_BOTTOM,
    },
    // The chip sits on the name's first line, a touch taller than it; the glow
    // overhangs the row below.
    nameRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      zIndex: 1,
    },
    name: {
      flex: 1,
      marginRight: theme.spacing.sm,
    },
    schedule: {
      marginTop: 5,
    },
    infoRow: {
      height: INFO_ICON_SIZE,
      flexDirection: 'row',
      alignItems: 'center',
      marginTop: 9,
    },
    infoText: {
      marginLeft: INFO_ICON_GAP,
    },
    infoSeparator: {
      width: StyleSheet.hairlineWidth,
      height: INFO_SEPARATOR_HEIGHT,
      marginHorizontal: INFO_SEPARATOR_GAP,
      backgroundColor: theme.colors.dividerSubtle,
    },
    caption: {
      marginTop: 9,
    },
    divider: {
      width: StyleSheet.hairlineWidth,
      height: DIVIDER_HEIGHT,
      backgroundColor: theme.colors.dividerSubtle,
    },
    more: {
      width: MORE_COLUMN,
      alignItems: 'center',
      justifyContent: 'center',
      alignSelf: 'stretch',
    },
    moreDisabled: {
      opacity: 0.35,
    },
    pressed: {
      opacity: 0.6,
    },
  });
}
