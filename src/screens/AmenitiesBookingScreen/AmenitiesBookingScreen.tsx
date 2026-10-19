import Ionicons from '@expo/vector-icons/Ionicons';
import { useNavigation } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { Fragment, useCallback, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Pressable, ScrollView, View } from 'react-native';

import { AppIcon } from '../../components/common/AppIcon';
import { AppText } from '../../components/common/AppText';
import { GlassSurface } from '../../components/common/GlassSurface';
import { BottomBar } from '../../components/layout/BottomBar';
import { PageHeader } from '../../components/layout/PageHeader';
import { ScreenWrapper } from '../../components/layout/ScreenWrapper';
import { AppMenu, type AppMenuItem } from '../../components/ui/AppMenu';
import { FeatureBanner } from '../../components/ui/FeatureBanner';
import { FilterChip } from '../../components/ui/FilterChip';
import { NeonPanel } from '../../components/ui/NeonPanel';
import { PanelHeading } from '../../components/ui/PanelHeading';
import { imageAspects, images } from '../../constants/images';
import { useAppTheme } from '../../hooks/useAppTheme';
import type { RootStackScreenProps } from '../../types/navigation.types';
import { guestsLabel } from '../VisitorAccessScreen/VisitorAccessScreen.data';
import { AmenityCard } from './AmenityCard';
import {
  amenities,
  amenitiesCopy as copy,
  amenitiesFor,
  createBooking,
  initialBookings,
  capacityLabel,
  categoryChips,
  hoursLabel,
  initialVisibleCount,
  type Amenity,
  type Booking,
  type BookingForm as BookingValues,
  type CategoryFilter,
} from './AmenitiesBookingScreen.data';
import {
  BANNER_HEIGHT,
  BOOKING_ICON_SIZE,
  CANCEL_ICON_SIZE,
  MORE_CHEVRON_SIZE,
  createStyles,
} from './AmenitiesBookingScreen.styles';
import { BookingForm } from './BookingForm';

/** Space kept above a panel the screen scrolls to, so its heading clears the edge. */
const SCROLL_MARGIN = 12;

export function AmenitiesBookingScreen() {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const navigation = useNavigation<RootStackScreenProps<'AmenitiesBooking'>['navigation']>();
  const [menuOpen, setMenuOpen] = useState(false);
  const [filter, setFilter] = useState<CategoryFilter>('all');
  const [expanded, setExpanded] = useState(false);
  const matching = amenitiesFor(filter);
  const visible = expanded ? matching : matching.slice(0, initialVisibleCount);
  // Hidden when the filter already fits in the first screenful.
  const canExpand = matching.length > initialVisibleCount;

  // Screen-local until there is a booking service to send them to.
  // TODO(api): book, list and cancel through the amenities service once it exists.
  const [bookings, setBookings] = useState<readonly Booking[]>(initialBookings);
  /** The amenity whose booking form is open under its card, if any. */
  const [bookingFor, setBookingFor] = useState<Amenity['id'] | null>(null);

  const scroll = useRef<ScrollView>(null);
  const listY = useRef(0);
  const formY = useRef(0);
  const bookingsY = useRef(0);
  const scrollToFormOnLayout = useRef(false);
  const scrollToBookingsOnLayout = useRef(false);

  const scrollTo = (y: number) =>
    scroll.current?.scrollTo({ y: Math.max(0, y - SCROLL_MARGIN), animated: true });

  // "Book Now" and the card's heading both open the form under that card.
  const openBooking = (id: Amenity['id']) => {
    if (bookingFor === id) {
      scrollTo(listY.current + formY.current);
      return;
    }
    // Scrolled to once the form has laid out (see its onLayout).
    scrollToFormOnLayout.current = true;
    setBookingFor(id);
  };

  const confirmBooking = (amenity: Amenity, form: BookingValues) => {
    const booking = createBooking(form, amenity, bookings);
    setBookings((current) => [...current, booking]);
    setBookingFor(null);
    AccessibilityInfo.announceForAccessibility(copy.booked(amenity.title, booking.date, booking.slot));
    // The form folds away and the new booking shows in My Bookings, which is
    // scrolled to once it has moved up into place (see its onLayout).
    scrollToBookingsOnLayout.current = true;
  };

  const cancelBooking = (id: string) =>
    setBookings((current) => current.filter((booking) => booking.id !== id));

  const handleLogout = useCallback(() => {
    setMenuOpen(false);
    // Frontend only, as on Home: there is no session to clear yet.
    // TODO(auth): clear the stored session here once one exists.
    navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
  }, [navigation]);

  const menuItems = useMemo<readonly AppMenuItem[]>(
    () => [{ id: 'logout', label: 'Log out', icon: 'log-out-outline', onPress: handleLogout }],
    [handleLogout],
  );

  return (
    <ScreenWrapper
      backgroundSource={images.homeBackground}
      withScrim={false}
      backgroundOverlay={0.34}
    >
      <StatusBar style="light" />

      <View style={styles.flex}>
        <ScrollView
          ref={scroll}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          <PageHeader
            title={copy.title}
            onMenuPress={() => setMenuOpen(true)}
            style={styles.header}
          />

          <FeatureBanner
            title={copy.bannerTitle}
            body={copy.bannerBody}
            photo={images.amenitiesHero}
            photoAspect={imageAspects.amenitiesHero}
            height={BANNER_HEIGHT}
            footer={null}
            style={styles.banner}
          />

          <View style={styles.chips} accessibilityRole="radiogroup">
            {categoryChips.map((chip) => (
              <FilterChip
                key={chip.id}
                label={chip.label}
                iconSet={chip.iconSet}
                iconName={chip.iconName}
                selected={chip.id === filter}
                onPress={() => setFilter(chip.id)}
                role="radio"
                style={styles.chip}
              />
            ))}
          </View>

          <View
            style={styles.list}
            onLayout={(event) => {
              listY.current = event.nativeEvent.layout.y;
            }}
          >
            {visible.map((amenity) => (
              <Fragment key={amenity.id}>
                <AmenityCard
                  title={amenity.title}
                  location={amenity.location}
                  hours={hoursLabel(amenity)}
                  capacity={capacityLabel(amenity)}
                  photo={images[amenity.photo]}
                  iconSet={amenity.iconSet}
                  iconName={amenity.iconName}
                  bookLabel={copy.bookNow}
                  onPress={() => openBooking(amenity.id)}
                  onBook={() => openBooking(amenity.id)}
                />
                {bookingFor === amenity.id ? (
                  <View
                    onLayout={(event) => {
                      formY.current = event.nativeEvent.layout.y;
                      if (scrollToFormOnLayout.current) {
                        scrollToFormOnLayout.current = false;
                        scrollTo(listY.current + formY.current);
                      }
                    }}
                  >
                    <BookingForm
                      amenity={amenity}
                      bookings={bookings}
                      onSubmit={(form) => confirmBooking(amenity, form)}
                      onClose={() => setBookingFor(null)}
                    />
                  </View>
                ) : null}
              </Fragment>
            ))}
            {visible.length === 0 ? (
              <AppText variant="statValue" color={theme.colors.textSupport} align="center" style={styles.empty}>
                {copy.empty}
              </AppText>
            ) : null}
          </View>

          {canExpand ? (
            <Pressable
              onPress={() => setExpanded((current) => !current)}
              accessibilityRole="button"
              accessibilityLabel={expanded ? copy.showLess : copy.viewMore}
              accessibilityState={{ expanded }}
              style={({ pressed }) => [styles.more, pressed && styles.pressed]}
            >
              <GlassSurface
                radius={theme.borderRadius.pill}
                blurred={false}
                fillOpacity={theme.glass.subtleFillOpacity}
                style={styles.moreSurface}
              >
                <AppText variant="statValue" align="center" style={styles.moreLabel}>
                  {expanded ? copy.showLess : copy.viewMore}
                </AppText>
                <Ionicons
                  name={expanded ? 'chevron-up' : 'chevron-forward'}
                  size={MORE_CHEVRON_SIZE}
                  color={theme.colors.textPrimary}
                />
              </GlassSurface>
            </Pressable>
          ) : null}

          {bookings.length > 0 ? (
            <View
              onLayout={(event) => {
                bookingsY.current = event.nativeEvent.layout.y;
                if (scrollToBookingsOnLayout.current) {
                  scrollToBookingsOnLayout.current = false;
                  scrollTo(bookingsY.current);
                }
              }}
            >
              <NeonPanel style={styles.bookings}>
                <PanelHeading
                  title={copy.bookingsTitle}
                  iconSet="ionicons"
                  iconName="calendar-outline"
                />
                {bookings.map((booking, index) => {
                  const amenity = amenities.find((entry) => entry.id === booking.amenityId);
                  if (!amenity) {
                    return null;
                  }
                  return (
                    <View
                      key={booking.id}
                      style={[styles.booking, index > 0 && styles.bookingDivided]}
                    >
                      <View style={styles.bookingRing}>
                        <AppIcon
                          set={amenity.iconSet}
                          name={amenity.iconName}
                          size={BOOKING_ICON_SIZE}
                        />
                      </View>
                      <View style={styles.bookingText}>
                        <AppText variant="statValue" numberOfLines={1}>
                          {amenity.title}
                        </AppText>
                        <AppText
                          variant="tileCaption"
                          color={theme.colors.textSupport}
                          style={styles.bookingMeta}
                        >
                          {`${booking.date} • ${booking.slot} • ${guestsLabel(booking.guests)}`}
                        </AppText>
                      </View>
                      <Pressable
                        onPress={() => cancelBooking(booking.id)}
                        hitSlop={10}
                        accessibilityRole="button"
                        accessibilityLabel={copy.cancelBooking(amenity.title, booking.date)}
                        style={({ pressed }) => pressed && styles.pressed}
                      >
                        <Ionicons
                          name="close-circle-outline"
                          size={CANCEL_ICON_SIZE}
                          color={theme.colors.textSecondary}
                        />
                      </Pressable>
                    </View>
                  );
                })}
              </NeonPanel>
            </View>
          ) : null}
        </ScrollView>

        {/* The same empty glass bar as the other inner screens. */}
        <BottomBar />
      </View>

      <AppMenu
        visible={menuOpen}
        onClose={() => setMenuOpen(false)}
        items={menuItems}
        align="right"
      />
    </ScreenWrapper>
  );
}
