import Ionicons from '@expo/vector-icons/Ionicons';
import { useMemo, type ReactNode } from 'react';
import {
  Image,
  Pressable,
  StyleSheet,
  View,
  type ImageSourcePropType,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { useAppTheme } from '../../hooks/useAppTheme';
import type { AppTheme } from '../../types/theme.types';
import { AppText } from '../common/AppText';

export interface MediaRowProps {
  photo: ImageSourcePropType;
  photoWidth: number;
  photoHeight: number;
  /** Drawn over the photo's left part, e.g. an alert's warning badge. */
  photoBadge?: ReactNode;
  /** A column before the photo, e.g. an event's date. */
  leading?: ReactNode;
  title: string;
  /** Lines under the title; each wraps rather than truncating. */
  details: readonly string[];
  /** A short right-hand note, e.g. "2h ago". */
  time?: string;
  /**
   * A control before the chevron, e.g. an RSVP pill. It sits outside the
   * row's own button, so screen readers reach it separately.
   */
  action?: ReactNode;
  /** Hairline along the top, separating the row from the one above. */
  divided?: boolean;
  /** Where the hairline starts; defaults to the row's inset. */
  dividerInsetLeft?: number;
  /** Makes the row a button, shown by its trailing chevron. */
  onPress?: () => void;
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
}

/*
 * From the Community design (assets/Screens/screen8.png), with the extra room
 * the inner screens are given: rows at least 46dp tall, as ActivityRow's, the
 * chevron where the panel heading's "View All" chevron sits. Only the text
 * column gives way on narrow screens.
 */
const MIN_HEIGHT = 46;
const INSET_VERTICAL = 8;
export const MEDIA_ROW_INSET_LEFT = 12;
const INSET_RIGHT = 9.5;
export const MEDIA_ROW_LEADING_GAP = 8;
const PHOTO_TO_TEXT = 10;
const DETAIL_TOP = 2;
const TIME_GAP = 8;
const ACTION_GAP = 6;
const CHEVRON_SIZE = 13;
const CHEVRON_GAP = 6;

/** One entry in a panel's list, led by a photo: an announcement, event or alert. */
export function MediaRow({
  photo,
  photoWidth,
  photoHeight,
  photoBadge,
  leading,
  title,
  details,
  time,
  action,
  divided = false,
  dividerInsetLeft = MEDIA_ROW_INSET_LEFT,
  onPress,
  accessibilityHint,
  style,
}: MediaRowProps) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  return (
    <View style={[styles.row, style]}>
      {divided ? <View style={[styles.divider, { left: dividerInsetLeft }]} /> : null}

      <Pressable
        onPress={onPress}
        disabled={!onPress}
        accessibilityRole={onPress ? 'button' : undefined}
        accessibilityLabel={[title, ...details, time].filter(Boolean).join(', ')}
        accessibilityHint={accessibilityHint}
        style={({ pressed }) => [styles.main, pressed && styles.pressed]}
      >
        {leading ? <View style={styles.leading}>{leading}</View> : null}

        <View style={[styles.photo, { width: photoWidth, height: photoHeight }]}>
          <Image
            source={photo}
            style={styles.photoImage}
            resizeMode="cover"
            fadeDuration={0}
            accessibilityIgnoresInvertColors
          />
          {photoBadge ? <View style={styles.photoBadge}>{photoBadge}</View> : null}
        </View>

        <View style={styles.text}>
          <AppText variant="statValue" numberOfLines={2}>
            {title}
          </AppText>
          {details.map((line) => (
            <AppText
              key={line}
              variant="tileCaption"
              color={theme.colors.textSupport}
              style={styles.detail}
            >
              {line}
            </AppText>
          ))}
        </View>

        {time ? (
          <AppText
            variant="tileCaption"
            color={theme.colors.textSupport}
            numberOfLines={1}
            style={styles.time}
          >
            {time}
          </AppText>
        ) : null}
      </Pressable>

      {action ? <View style={styles.action}>{action}</View> : null}

      {onPress ? (
        // The same target as the row; hidden from screen readers, which reach the row.
        <Pressable
          onPress={onPress}
          hitSlop={10}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={({ pressed }) => [styles.chevron, pressed && styles.pressed]}
        >
          <Ionicons name="chevron-forward" size={CHEVRON_SIZE} color={theme.colors.textPrimary} />
        </Pressable>
      ) : null}
    </View>
  );
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    row: {
      minHeight: MIN_HEIGHT,
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: INSET_VERTICAL,
      paddingLeft: MEDIA_ROW_INSET_LEFT,
      paddingRight: INSET_RIGHT,
    },
    // Overlaid rather than stacked, so every row keeps its height.
    divider: {
      position: 'absolute',
      top: 0,
      right: MEDIA_ROW_INSET_LEFT,
      height: StyleSheet.hairlineWidth,
      backgroundColor: theme.colors.dividerSubtle,
    },
    main: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
    },
    leading: {
      alignSelf: 'stretch',
      justifyContent: 'center',
      marginRight: MEDIA_ROW_LEADING_GAP,
    },
    photo: {
      borderRadius: theme.borderRadius.sm / 2,
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
    photoBadge: {
      position: 'absolute',
      top: 0,
      bottom: 0,
      left: 0,
      justifyContent: 'center',
    },
    text: {
      flex: 1,
      marginLeft: PHOTO_TO_TEXT,
      marginRight: TIME_GAP,
    },
    detail: {
      marginTop: DETAIL_TOP,
    },
    time: {
      alignSelf: 'flex-start',
      marginTop: DETAIL_TOP,
    },
    action: {
      marginLeft: ACTION_GAP,
    },
    chevron: {
      marginLeft: CHEVRON_GAP,
    },
    pressed: {
      opacity: 0.7,
    },
  });
}
