import Ionicons from '@expo/vector-icons/Ionicons';
import { StatusBar } from 'expo-status-bar';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Pressable, ScrollView, View, type ScrollViewInstance } from 'react-native';

import { AppIcon } from '../../components/common/AppIcon';
import { AppText } from '../../components/common/AppText';
import { ErrorNotice } from '../../components/feedback/ErrorNotice';
import { LoadingState } from '../../components/feedback/LoadingState';
import { Notice } from '../../components/feedback/Notice';
import { GlassSurface } from '../../components/common/GlassSurface';
import { BottomBar } from '../../components/layout/BottomBar';
import { PageHeader } from '../../components/layout/PageHeader';
import { ResponsiveColumns } from '../../components/layout/ResponsiveColumns';
import { ScreenWrapper } from '../../components/layout/ScreenWrapper';
import { AppMenu } from '../../components/ui/AppMenu';
import { FeatureBanner } from '../../components/ui/FeatureBanner';
import { FilterChip } from '../../components/ui/FilterChip';
import { NeonPanel } from '../../components/ui/NeonPanel';
import { PanelHeading } from '../../components/ui/PanelHeading';
import { imageAspects, images } from '../../constants/images';
import { bookAmenity, cancelAmenityBooking, getAmenities, listMyBookings } from '../../features/amenities/services/amenitiesApi';
import { useEms } from '../../features/ems/hooks/useEms';
import { EmsError, emsErrorText } from '../../features/ems/services/emsHttp';
import { useAppTheme } from '../../hooks/useAppTheme';
import { useFocusQuery } from '../../hooks/useFocusQuery';
import { useScreenLayout } from '../../hooks/useScreenLayout';
import { AmenityCard } from './AmenityCard';
import {
  amenitiesCopy as copy,
  amenitiesFor,
  capacityLabel,
  categoryChips,
  dateChoices,
  formFieldOf,
  hoursLabel,
  initialVisibleCount,
  peopleLabel,
  toAmenity,
  upcomingBookings,
  type Amenity,
  type BookingErrors,
  type BookingForm as BookingValues,
  type CategoryFilter,
} from './AmenitiesBookingScreen.data';
import {
  BANNER_HEIGHT,
  BOOKING_ICON_SIZE,
  CANCEL_ICON_SIZE,
  MORE_CHEVRON_SIZE,
  WIDE_COLUMN_WEIGHTS,
  createStyles,
} from './AmenitiesBookingScreen.styles';
import { BookingForm } from './BookingForm';
import { useScreenMenu } from '../../hooks/useScreenMenu';

/** Space kept above a panel the screen scrolls to, so its heading clears the edge. */
const SCROLL_MARGIN = 12;

export function AmenitiesBookingScreen() {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { menuOpen, setMenuOpen, menuItems } = useScreenMenu();
  const [filter, setFilter] = useState<CategoryFilter>('all');
  const [expanded, setExpanded] = useState(false);

  // Building management's catalogue and the apartment's bookings; reloaded when the screen is shown, and the
  // bookings again when one changes anywhere on the compound.
  const catalogue = useFocusQuery(getAmenities);
  const mine = useFocusQuery(listMyBookings);
  const { onRealtimeEvent } = useEms();
  const reloadMine = mine.reload;
  useEffect(
    () =>
      onRealtimeEvent((event) => {
        if (event.type === 'amenity.updated' || event.type === 'ready') reloadMine();
      }),
    [onRealtimeEvent, reloadMine],
  );
  const amenities = useMemo(() => (catalogue.data?.amenities ?? []).map(toAmenity), [catalogue.data]);
  const dates = useMemo(() => (catalogue.data ? dateChoices(catalogue.data) : []), [catalogue.data]);
  const bookings = useMemo(() => (catalogue.data && mine.data ? upcomingBookings(mine.data, catalogue.data.firstDate) : []), [catalogue.data, mine.data]);
  const matching = amenitiesFor(amenities, filter);
  const visible = expanded ? matching : matching.slice(0, initialVisibleCount);
  // Hidden when the filter already fits in the first screenful.
  const canExpand = matching.length > initialVisibleCount;

  /** The amenity whose booking form is open under its card, if any. */
  const [bookingFor, setBookingFor] = useState<Amenity['id'] | null>(null);

  const scroll = useRef<ScrollViewInstance>(null);
  const layout = useScreenLayout();
  // Beside My Bookings, the list sits in a column: offsets inside it start from the columns' top.
  const sideBySide = layout.columns > 1;
  const sectionsY = useRef(0);
  const sectionTop = () => (sideBySide ? sectionsY.current : 0);
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
      scrollTo(sectionTop() + listY.current + formY.current);
      return;
    }
    // Scrolled to once the form has laid out (see its onLayout).
    scrollToFormOnLayout.current = true;
    setBookingFor(id);
  };

  // The backend checks the rules and counts the places inside one transaction.
  const confirmBooking = async (amenity: Amenity, form: BookingValues): Promise<BookingErrors | string | null> => {
    try {
      const booking = await bookAmenity(amenity.id, { date: form.date, start: form.slot, people: Number(form.people) });
      setBookingFor(null);
      reloadMine();
      AccessibilityInfo.announceForAccessibility(copy.booked(amenity.title, booking.date, `${booking.start} - ${booking.end}`));
      // The form folds away and the new booking shows in My Bookings, which is
      // scrolled to once it has moved up into place (see its onLayout).
      scrollToBookingsOnLayout.current = true;
      return null;
    } catch (error: unknown) {
      const field = error instanceof EmsError ? formFieldOf(error.field, error.code) : null;
      return field ? { [field]: emsErrorText(error) } : emsErrorText(error);
    }
  };

  const [cancelError, setCancelError] = useState<string | null>(null);
  const cancelBooking = (id: string) => {
    setCancelError(null);
    cancelAmenityBooking(id)
      .then(reloadMine)
      .catch((error: unknown) => setCancelError(emsErrorText(error)));
  };

  const listSection = (
    <>
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
                    scrollTo(sectionTop() + listY.current + formY.current);
                  }
                }}
              >
                <BookingForm
                  amenity={amenity}
                  dates={dates}
                  onSubmit={(form) => confirmBooking(amenity, form)}
                  onClose={() => setBookingFor(null)}
                />
              </View>
            ) : null}
          </Fragment>
        ))}
        {visible.length === 0 ? (
          <AppText variant="statValue" color={theme.colors.textSupport} align="center" style={styles.empty}>
            {amenities.length === 0 ? copy.noCatalogue : copy.empty}
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
    </>
  );

  const bookingsSection = bookings.length > 0 || sideBySide ? (
    <View
      onLayout={(event) => {
        bookingsY.current = event.nativeEvent.layout.y;
        if (scrollToBookingsOnLayout.current) {
          scrollToBookingsOnLayout.current = false;
          scrollTo(sectionTop() + bookingsY.current);
        }
      }}
    >
      <NeonPanel style={[styles.bookings, sideBySide && styles.bookingsBeside]}>
        <PanelHeading
          title={copy.bookingsTitle}
          iconSet="ionicons"
          iconName="calendar-outline"
        />
        {bookings.length === 0 ? (
          <AppText variant="tileCaption" color={theme.colors.textSupport} style={styles.bookingsEmpty}>
            {copy.bookingsEmpty}
          </AppText>
        ) : null}
        {cancelError ? (
          <AppText variant="tileCaption" color={theme.colors.error} accessibilityRole="alert" style={styles.bookingsEmpty}>
            {cancelError}
          </AppText>
        ) : null}
        {bookings.map((booking, index) => {
          const amenity = amenities.find((entry) => entry.id === booking.amenityId);
          return (
            <View
              key={booking.id}
              style={[styles.booking, index > 0 && styles.bookingDivided]}
            >
              <View style={styles.bookingRing}>
                <AppIcon
                  set={amenity?.iconSet ?? 'ionicons'}
                  name={amenity?.iconName ?? 'sparkles-outline'}
                  size={BOOKING_ICON_SIZE}
                />
              </View>
              <View style={styles.bookingText}>
                <AppText variant="statValue" numberOfLines={1}>
                  {booking.amenityTitle}
                </AppText>
                <AppText
                  variant="tileCaption"
                  color={theme.colors.textSupport}
                  style={styles.bookingMeta}
                >
                  {`${booking.date} • ${booking.slot} • ${peopleLabel(booking.people)}`}
                </AppText>
              </View>
              {booking.cancellable ? (
                <Pressable
                  onPress={() => cancelBooking(booking.id)}
                  hitSlop={10}
                  accessibilityRole="button"
                  accessibilityLabel={copy.cancelBooking(booking.amenityTitle, booking.date)}
                  style={({ pressed }) => pressed && styles.pressed}
                >
                  <Ionicons
                    name="close-circle-outline"
                    size={CANCEL_ICON_SIZE}
                    color={theme.colors.textSecondary}
                  />
                </Pressable>
              ) : null}
            </View>
          );
        })}
      </NeonPanel>
    </View>
  ) : null;

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
          contentContainerStyle={[styles.content, layout.contentStyle]}
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

          {catalogue.error ? (
            catalogue.error.code === 'no_home' ? (
              <Notice tone="info" title={copy.noHomeTitle} style={styles.banner}>
                {copy.noHomeBody}
              </Notice>
            ) : (
              <View style={styles.banner}>
                <ErrorNotice title={copy.loadFailed} retryLabel={copy.retry} onRetry={catalogue.reload}>
                  {catalogue.error.message}
                </ErrorNotice>
              </View>
            )
          ) : !catalogue.data ? (
            <LoadingState />
          ) : sideBySide ? (
            <View
              onLayout={(event) => {
                sectionsY.current = event.nativeEvent.layout.y;
              }}
            >
              <ResponsiveColumns gap={0} weights={WIDE_COLUMN_WEIGHTS}>
                {listSection}
                {bookingsSection}
              </ResponsiveColumns>
            </View>
          ) : (
            <>
              {listSection}
              {bookingsSection}
            </>
          )}
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
