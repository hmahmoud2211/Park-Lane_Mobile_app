import Ionicons from '@expo/vector-icons/Ionicons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useMemo } from 'react';
import { Image, Pressable, StyleSheet, View, type ImageSourcePropType } from 'react-native';

import { AppIcon } from '../../components/common/AppIcon';
import { AppText } from '../../components/common/AppText';
import { GlassSurface } from '../../components/common/GlassSurface';
import { NeonPanel } from '../../components/ui/NeonPanel';
import type { IconSet } from '../../components/ui/ServiceTile';
import { useAppTheme } from '../../hooks/useAppTheme';
import type { AppTheme } from '../../types/theme.types';

export interface AmenityCardProps {
  title: string;
  location: string;
  hours: string;
  capacity: string;
  photo: ImageSourcePropType;
  iconSet: IconSet;
  iconName: string;
  bookLabel: string;
  onPress: () => void;
  onBook: () => void;
}

/*
 * Measured on the Amenities Booking reference (assets/Screens/screen11.png):
 * a photo down the left third, drawn 107 x 71dp, then an icon ring, the name
 * and place, opening hours and capacity, and the "Book Now" button, drawn
 * 55 x 25dp. A little taller here for the roomier rhythm.
 */
const MIN_HEIGHT = 86;
const PHOTO_WIDTH = '34%';
const PHOTO_INSET = 2;
const PADDING = 10;
const RING_SIZE = 32;
const RING_ICON_SIZE = 17;
const RING_TO_TEXT = 10;
const CHEVRON_SIZE = 14;
const DETAIL_ICON_SIZE = 13;
const DETAIL_ICON_GAP = 5;
const DETAIL_RULE_HEIGHT = 14;
const DETAILS_TOP = 10;
const BOOK_WIDTH = 66;
const BOOK_HEIGHT = 28;

/** One amenity on the Amenities Booking screen. */
export function AmenityCard({
  title,
  location,
  hours,
  capacity,
  photo,
  iconSet,
  iconName,
  bookLabel,
  onPress,
  onBook,
}: AmenityCardProps) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  return (
    <NeonPanel style={styles.card}>
      {/* The neon panel leaves children unclipped, so the photo carries its own corners. */}
      <View style={styles.photo}>
        <Image
          source={photo}
          style={styles.photoImage}
          resizeMode="cover"
          fadeDuration={0}
          accessibilityIgnoresInvertColors
        />
      </View>

      <View style={styles.body}>
        {/* The heading opens the amenity; "Book Now" is its own target beside it,
            since a button may not sit inside another. */}
        <Pressable
          onPress={onPress}
          accessibilityRole="button"
          accessibilityLabel={`${title}, ${location}. Open ${hours}, ${capacity} people`}
          accessibilityHint="Shows the amenity"
          style={({ pressed }) => [styles.headingRow, pressed && styles.pressed]}
        >
          <View style={styles.ring}>
            <AppIcon set={iconSet} name={iconName} size={RING_ICON_SIZE} />
          </View>
          <View style={styles.heading}>
            <AppText variant="sectionTitle" numberOfLines={1}>
              {title}
            </AppText>
            <AppText variant="statLabel" color={theme.colors.textSupport} numberOfLines={1}>
              {location}
            </AppText>
          </View>
          <Ionicons name="chevron-forward" size={CHEVRON_SIZE} color={theme.colors.textPrimary} />
        </Pressable>

        <View style={styles.footer}>
          <View style={styles.details}>
            <View style={styles.detail}>
              <Ionicons name="time-outline" size={DETAIL_ICON_SIZE} color={theme.colors.textPrimary} />
              <AppText variant="tileCaption">{hours}</AppText>
            </View>
            <View style={styles.rule} />
            <View style={styles.detail}>
              <MaterialCommunityIcons
                name="account-multiple-outline"
                size={DETAIL_ICON_SIZE + 1}
                color={theme.colors.textPrimary}
              />
              <AppText variant="tileCaption">{capacity}</AppText>
            </View>
          </View>

          <Pressable
            onPress={onBook}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={`${bookLabel}, ${title}`}
            style={({ pressed }) => [styles.book, pressed && styles.pressed]}
          >
            {/* Laid on the card's glass, so it skips its own blur. */}
            <GlassSurface
              radius={theme.borderRadius.sm}
              glow
              blurred={false}
              strokeColors={[theme.colors.cardStrokeFrom, theme.colors.featureStrokeTo]}
              style={styles.bookSurface}
            >
              <AppText variant="statValue">{bookLabel}</AppText>
            </GlassSurface>
          </Pressable>
        </View>
      </View>
    </NeonPanel>
  );
}

function createStyles(theme: AppTheme) {
  const photoRadius = theme.borderRadius.md - PHOTO_INSET;
  return StyleSheet.create({
    card: {
      minHeight: MIN_HEIGHT,
      flexDirection: 'row',
    },
    photo: {
      width: PHOTO_WIDTH,
      margin: PHOTO_INSET,
      borderTopLeftRadius: photoRadius,
      borderBottomLeftRadius: photoRadius,
      borderTopRightRadius: theme.borderRadius.sm,
      borderBottomRightRadius: theme.borderRadius.sm,
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
    body: {
      flex: 1,
      padding: PADDING,
      justifyContent: 'space-between',
    },
    headingRow: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    ring: {
      width: RING_SIZE,
      height: RING_SIZE,
      borderRadius: RING_SIZE / 2,
      borderWidth: theme.glass.strokeWidth,
      borderColor: theme.colors.avatarStroke,
      backgroundColor: theme.colors.fieldFill,
      alignItems: 'center',
      justifyContent: 'center',
    },
    heading: {
      flex: 1,
      marginLeft: RING_TO_TEXT,
      marginRight: theme.spacing.xs,
      gap: 2,
    },
    footer: {
      flexDirection: 'row',
      alignItems: 'center',
      marginTop: DETAILS_TOP,
    },
    // Wraps capacity under the hours on narrow phones rather than squeezing the button.
    details: {
      flex: 1,
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      rowGap: theme.spacing.xs,
      marginRight: theme.spacing.sm,
    },
    detail: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: DETAIL_ICON_GAP,
    },
    rule: {
      width: StyleSheet.hairlineWidth,
      height: DETAIL_RULE_HEIGHT,
      backgroundColor: theme.colors.dividerSubtle,
      marginHorizontal: theme.spacing.sm,
    },
    book: {
      width: BOOK_WIDTH,
      height: BOOK_HEIGHT,
    },
    bookSurface: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
    },
    pressed: {
      opacity: 0.8,
    },
  });
}
