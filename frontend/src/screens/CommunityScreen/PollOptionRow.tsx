import Ionicons from '@expo/vector-icons/Ionicons';
import { useMemo } from 'react';
import { Image, Pressable, StyleSheet, View, type ImageSourcePropType } from 'react-native';

import { AppText } from '../../components/common/AppText';
import { ProgressBar } from '../../components/ui/ProgressBar';
import { useAppTheme } from '../../hooks/useAppTheme';
import type { AppTheme } from '../../types/theme.types';

export interface PollOptionRowProps {
  label: string;
  photo: ImageSourcePropType;
  /** Share of the vote, 0-1. */
  share: number;
  selected: boolean;
  onSelect: () => void;
}

/*
 * From the Community design (assets/Screens/screen8.png), with the inner
 * screens' extra room: a radio, a thumbnail, the label, then the result bar
 * and its percentage. The label and bar share what the fixed columns leave.
 */
const MIN_HEIGHT = 30;
const INSET_LEFT = 12;
const INSET_RIGHT = 12;
const RADIO_SIZE = 12;
const CHECK_SIZE = 8;
const RADIO_TO_PHOTO = 10;
const PHOTO_WIDTH = 42;
const PHOTO_HEIGHT = 17;
const PHOTO_TO_LABEL = 8;
const LABEL_FLEX = 1.5;
const BAR_HEIGHT = 7;
const BAR_GAP = 8;
const PERCENT_WIDTH = 28;

/** One answer in a poll: tapping it casts, or moves, the resident's vote. */
export function PollOptionRow({ label, photo, share, selected, onSelect }: PollOptionRowProps) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const percent = `${Math.round(share * 100)}%`;

  return (
    <Pressable
      onPress={onSelect}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={`${label}, ${percent}`}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <View style={[styles.radio, selected && styles.radioSelected]}>
        {selected ? (
          <Ionicons name="checkmark" size={CHECK_SIZE} color={theme.colors.textPrimary} />
        ) : null}
      </View>

      <View style={styles.photo}>
        <Image
          source={photo}
          style={styles.photoImage}
          resizeMode="cover"
          fadeDuration={0}
          accessibilityIgnoresInvertColors
        />
      </View>

      <AppText variant="statValue" numberOfLines={2} style={styles.label}>
        {label}
      </AppText>

      <ProgressBar progress={share} height={BAR_HEIGHT} style={styles.bar} />

      <AppText variant="statValue" align="right" numberOfLines={1} style={styles.percent}>
        {percent}
      </AppText>
    </Pressable>
  );
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    row: {
      minHeight: MIN_HEIGHT,
      flexDirection: 'row',
      alignItems: 'center',
      paddingLeft: INSET_LEFT,
      paddingRight: INSET_RIGHT,
    },
    radio: {
      width: RADIO_SIZE,
      height: RADIO_SIZE,
      borderRadius: RADIO_SIZE / 2,
      borderWidth: theme.glass.strokeWidth,
      borderColor: theme.colors.textSecondary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    // The design's ticked radio: a lit blue disc with a pale rim and a glow.
    radioSelected: {
      backgroundColor: theme.colors.primary,
      borderColor: theme.colors.textAccentSoft,
      ...theme.shadows.glow,
      shadowColor: theme.colors.electricCyan,
      shadowOffset: { width: 0, height: 0 },
      shadowRadius: 6,
      shadowOpacity: 0.8,
      elevation: 4,
    },
    photo: {
      width: PHOTO_WIDTH,
      height: PHOTO_HEIGHT,
      marginLeft: RADIO_TO_PHOTO,
      borderRadius: theme.borderRadius.sm / 4,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.colors.dividerSubtle,
      overflow: 'hidden',
    },
    // Explicit 100% rather than absoluteFill: react-native-web stamps the
    // image's intrinsic size onto the element, which beats inset-0 alone.
    photoImage: {
      position: 'absolute',
      top: 0,
      left: 0,
      width: '100%',
      height: '100%',
    },
    label: {
      flex: LABEL_FLEX,
      marginLeft: PHOTO_TO_LABEL,
      marginRight: BAR_GAP,
    },
    bar: {
      flex: 1,
    },
    percent: {
      width: PERCENT_WIDTH,
    },
    pressed: {
      opacity: 0.7,
    },
  });
}
