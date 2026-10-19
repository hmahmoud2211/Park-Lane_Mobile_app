import type Ionicons from '@expo/vector-icons/Ionicons';
import { useNavigation } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, View, useWindowDimensions } from 'react-native';

import { AppButton } from '../../components/common/AppButton';
import { AppIcon } from '../../components/common/AppIcon';
import { AppText } from '../../components/common/AppText';
import { BottomBar } from '../../components/layout/BottomBar';
import { PageHeader } from '../../components/layout/PageHeader';
import { ScreenWrapper } from '../../components/layout/ScreenWrapper';
import { ListRow } from '../../components/parking/Rows';
import { Panel } from '../../components/parking/Panel';
import { ParkingButton } from '../../components/parking/ParkingButton';
import { reservationIcon, reservationLines } from '../../components/parking/presenters';
import { AppMenu, type AppMenuItem } from '../../components/ui/AppMenu';
import { FeatureBanner } from '../../components/ui/FeatureBanner';
import { ParkingSign } from '../../components/ui/ParkingSign';
import { PhotoCard } from '../../components/ui/PhotoCard';
import { StatTile } from '../../components/ui/StatTile';
import { StatusChip } from '../../components/ui/StatusChip';
import { imageAspects, images } from '../../constants/images';
import { useAppTheme } from '../../hooks/useAppTheme';
import { useParking } from '../../hooks/useParking';
import {
  dashboardCounts,
  myParking,
  type ActivityItem,
  reservationView,
  residentActivity,
  residentReservations,
} from '../../services/parking/selectors';
import { formatDateTime, formatTime } from '../../services/parking/time';
import type { RootStackScreenProps } from '../../types/navigation.types';
import {
  SEPARATOR,
  parkingActions,
  parkingCopy as copy,
  parkingStats,
  type ActionTone,
  type ParkingAction,
  type StatIcon,
} from './ParkingScreen.data';
import {
  ACTION_HEIGHT,
  ACTION_ICON_SIZE,
  ACTION_RADIUS,
  ACTION_WEIGHTS,
  BANNER_HEIGHT,
  HEADING_ICON_SIZE,
  HEADING_SIGN_SIZE,
  STAT_ICON_SIZE,
  contentScaleFor,
  createStyles,
} from './ParkingScreen.styles';

/** Upcoming and active guest bookings shown before "View All". */
const GUEST_LIMIT = 3;

const ACTIVITY_ICONS: Record<ActivityItem['kind'], keyof typeof Ionicons.glyphMap> = {
  entry: 'log-in-outline',
  exit: 'log-out-outline',
  booked: 'calendar-outline',
  cancelled: 'close-circle-outline',
  'no-show': 'person-remove-outline',
};

export function ParkingScreen() {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { width } = useWindowDimensions();
  const scale = contentScaleFor(width);
  const navigation = useNavigation<RootStackScreenProps<'Parking'>['navigation']>();
  const { db, now, residentId } = useParking();
  const [menuOpen, setMenuOpen] = useState(false);

  const handleLogout = useCallback(() => {
    setMenuOpen(false);
    // Frontend only, as on Home: there is no session to clear yet.
    // TODO(auth): clear the stored session here once one exists.
    navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
  }, [navigation]);

  const menuItems = useMemo<readonly AppMenuItem[]>(
    () => [
      {
        id: 'history',
        label: 'Reservation history',
        icon: 'time-outline',
        onPress: () => {
          setMenuOpen(false);
          navigation.navigate('ReservationHistory');
        },
      },
      {
        id: 'demo',
        label: 'Demo controls',
        icon: 'construct-outline',
        onPress: () => {
          setMenuOpen(false);
          navigation.navigate('DemoControls');
        },
      },
      { id: 'logout', label: 'Log out', icon: 'log-out-outline', onPress: handleLogout },
    ],
    [handleLogout, navigation],
  );

  const counts = useMemo(() => dashboardCounts(db, now), [db, now]);
  const stats = useMemo(() => parkingStats(counts), [counts]);
  const mine = useMemo(() => myParking(db, residentId), [db, residentId]);
  const myCar = mine.vehicles.find((v) => !v.ev) ?? mine.vehicles[0];
  const evCount = mine.vehicles.filter((v) => v.ev).length;

  const bookings = useMemo(
    () => residentReservations(db, residentId).map((r) => reservationView(db, r, now)),
    [db, residentId, now],
  );
  const live = (s: string) => s === 'confirmed' || s === 'checked-in';
  const guestBookings = bookings.filter((v) => v.reservation.bookedFor === 'guest' && live(v.reservation.status));
  // Bookings are already listed above; activity keeps what happened at the gate and what changed.
  const activity = useMemo(
    () => residentActivity(db, residentId, 20).filter((item) => item.kind !== 'booked').slice(0, 3),
    [db, residentId],
  );

  const openAction = (id: ParkingAction['id']) => {
    switch (id) {
      case 'navigate':
        navigation.navigate('ParkingMap', { spaceId: mine.space?.id });
        return;
      case 'reserve-guest':
        navigation.navigate('ReserveParking', { mode: 'guest' });
        return;
      case 'reserve-ev':
        navigation.navigate('ReserveParking', { mode: 'ev' });
    }
  };

  const renderStatIcon = (icon: StatIcon) =>
    icon === 'parking-sign' ? (
      <ParkingSign size={STAT_ICON_SIZE * scale} />
    ) : (
      <AppIcon {...icon} size={STAT_ICON_SIZE * scale} />
    );

  // Only the lit buttons carry a fill; the plain one is the glass button.
  const actionLook = (tone: ActionTone) => {
    switch (tone) {
      case 'blue':
        return {
          variant: 'gradient',
          gradientColors: [theme.colors.actionBlueFrom, theme.colors.actionBlueVia, theme.colors.actionBlueTo],
          style: styles.actionBlue,
        } as const;
      case 'violet':
        return {
          variant: 'gradient',
          gradientColors: [theme.colors.actionVioletFrom, theme.colors.actionVioletVia, theme.colors.actionVioletTo],
          style: styles.actionViolet,
        } as const;
      case 'glass':
        return { variant: 'secondary', gradientColors: undefined, style: undefined } as const;
    }
  };

  const mySpace = mine.space;
  const parked = mySpace?.occupancy === 'occupied';

  return (
    <ScreenWrapper backgroundSource={images.homeBackground} withScrim={false} backgroundOverlay={0.34}>
      <StatusBar style="light" />

      <View style={styles.flex}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <PageHeader title={copy.title} onMenuPress={() => setMenuOpen(true)} style={styles.header} />

          <FeatureBanner
            title={copy.bannerTitle}
            body={copy.bannerBody}
            photo={images.parkingHero}
            photoAspect={imageAspects.parkingHero}
            height={BANNER_HEIGHT}
            style={styles.card}
          />

          {mySpace ? (
            <PhotoCard
              title={copy.myParkingTitle}
              icon={<ParkingSign size={HEADING_SIGN_SIZE} />}
              headline={`Slot ${mySpace.label}`}
              meta={`${mine.building?.name ?? ''}${SEPARATOR}${mine.zone?.level ?? ''}`}
              photo={images.parkingSlot}
              photoAspect={imageAspects.parkingSlot}
              onPress={() => navigation.navigate('ParkingMap', { spaceId: mySpace.id })}
              accessibilityHint="Shows the way to your bay"
              scale={scale}
              style={styles.card}
            >
              <StatusChip
                label={parked ? 'Car parked' : 'Bay free'}
                tone={parked ? 'teal' : 'slate'}
                glow={parked}
                style={styles.slotChip}
              />
            </PhotoCard>
          ) : null}

          {myCar ? (
            <PhotoCard
              title={copy.vehicleTitle}
              icon={<AppIcon set="ionicons" name="car-outline" size={HEADING_ICON_SIZE} />}
              headline={`${myCar.make} ${myCar.model}`}
              meta={`${myCar.colour}${SEPARATOR}${myCar.plateCountry} Plate: ${myCar.plate}`}
              photo={images.registeredVehicle}
              photoAspect={imageAspects.registeredVehicle}
              photoLayout="cutout"
              scale={scale}
              style={styles.card}
            >
              {evCount > 0 ? (
                <StatusChip label={`+${evCount} EV registered`} tone="indigo" style={styles.vehicleChip} />
              ) : null}
            </PhotoCard>
          ) : null}

          <View style={styles.stats}>
            {stats.map((stat) => (
              <StatTile
                key={stat.id}
                label={stat.label}
                value={stat.value}
                total={stat.total}
                icon={renderStatIcon(stat.icon)}
                progress={stat.progress}
                // The gauge tile's edge runs on into violet, as drawn.
                strokeColors={
                  stat.progress !== undefined ? [theme.colors.cardStrokeFrom, theme.colors.featureStrokeTo] : undefined
                }
                scale={scale}
              />
            ))}
          </View>
          <AppText variant="label" color={theme.colors.textSupport} style={styles.countsNote}>
            {`${copy.countsNote} Updated ${formatTime(now)}.`}
          </AppText>

          <View style={[styles.card, styles.actions]}>
            {parkingActions.map((action, index) => {
              const look = actionLook(action.tone);
              return (
                <AppButton
                  key={action.id}
                  title={action.label}
                  variant={look.variant}
                  gradientColors={look.gradientColors}
                  height={ACTION_HEIGHT}
                  radius={ACTION_RADIUS}
                  labelVariant="statValue"
                  leadingIcon={<AppIcon {...action.icon} size={ACTION_ICON_SIZE * scale} />}
                  leadingPlacement="inline"
                  accessibilityLabel={action.label.replace('\n', ' ')}
                  onPress={() => openAction(action.id)}
                  style={[{ flex: ACTION_WEIGHTS[index] }, look.style]}
                />
              );
            })}
          </View>

          <Panel
            title={copy.guestRequestTitle}
            icon="people-outline"
            style={styles.card}
            trailing={<ViewAll onPress={() => navigation.navigate('ReservationHistory')} />}
          >
            {guestBookings.length === 0 ? (
              <AppText variant="caption" color={theme.colors.textSecondary}>
                {copy.guestRequestEmpty}
              </AppText>
            ) : (
              guestBookings.slice(0, GUEST_LIMIT).map((view, index) => (
                <ListRow
                  key={view.reservation.id}
                  divided={index > 0}
                  icon={reservationIcon(view)}
                  title={view.title}
                  lines={reservationLines(view, now)}
                  statusLabel={view.status.label}
                  statusTone={view.status.tone}
                  onPress={() => navigation.navigate('ReservationDetails', { reservationId: view.reservation.id })}
                />
              ))
            )}
            <ParkingButton
              label="Reserve Guest Parking"
              icon="add-circle-outline"
              tone="primary"
              onPress={() => navigation.navigate('ReserveParking', { mode: 'guest' })}
            />
          </Panel>

          <Panel title={copy.activityTitle} icon="time-outline" style={styles.card}>
            {activity.length === 0 ? (
              <AppText variant="caption" color={theme.colors.textSecondary}>
                {copy.activityEmpty}
              </AppText>
            ) : (
              activity.map((item, index) => (
                <ListRow
                  key={item.id}
                  divided={index > 0}
                  icon={ACTIVITY_ICONS[item.kind]}
                  title={item.title}
                  lines={[item.detail, item.timeLabel]}
                />
              ))
            )}
          </Panel>

          {/* Demo tooling, kept apart from the resident's own actions. */}
          <Pressable
            onPress={() => navigation.navigate('DemoControls')}
            accessibilityRole="button"
            accessibilityLabel="Open demo controls"
            style={({ pressed }) => [styles.demoStrip, pressed && styles.pressed]}
          >
            <AppIcon set="ionicons" name="construct-outline" size={16} color={theme.colors.textSupport} />
            <AppText variant="label" color={theme.colors.textSupport} style={styles.flex}>
              {`Demo · simulated time ${formatDateTime(now)} · open demo controls`}
            </AppText>
          </Pressable>
        </ScrollView>

        <BottomBar />
      </View>

      <AppMenu visible={menuOpen} onClose={() => setMenuOpen(false)} items={menuItems} align="right" />
    </ScreenWrapper>
  );
}

function ViewAll({ onPress }: { onPress: () => void }) {
  const theme = useAppTheme();
  return (
    <Pressable onPress={onPress} hitSlop={10} accessibilityRole="link" accessibilityLabel="View all bookings">
      <AppText variant="label" color={theme.colors.textSupport}>
        {`${copy.viewAll} ›`}
      </AppText>
    </Pressable>
  );
}

