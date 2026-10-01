import { useNavigation } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useMemo, useState } from 'react';
import { ScrollView, View, useWindowDimensions } from 'react-native';

import { AppButton } from '../../components/common/AppButton';
import { AppIcon } from '../../components/common/AppIcon';
import { BottomBar } from '../../components/layout/BottomBar';
import { PageHeader } from '../../components/layout/PageHeader';
import { ScreenWrapper } from '../../components/layout/ScreenWrapper';
import { ActivityRow } from '../../components/ui/ActivityRow';
import { AppMenu, type AppMenuItem } from '../../components/ui/AppMenu';
import { FeatureBanner } from '../../components/ui/FeatureBanner';
import { NeonPanel } from '../../components/ui/NeonPanel';
import { PanelHeading } from '../../components/ui/PanelHeading';
import { ParkingSign } from '../../components/ui/ParkingSign';
import { PhotoCard } from '../../components/ui/PhotoCard';
import { StatTile } from '../../components/ui/StatTile';
import { StatusChip } from '../../components/ui/StatusChip';
import { imageAspects, images } from '../../constants/images';
import { useAppTheme } from '../../hooks/useAppTheme';
import type { RootStackScreenProps } from '../../types/navigation.types';
import {
  SEPARATOR,
  activityKindDisplay,
  activityStatusLabel,
  capacity,
  guestRequestStatusDisplay,
  guestsLabel,
  latestGuestRequest as guestRequest,
  mySlot,
  myVehicle,
  parkingActions,
  parkingCopy as copy,
  parkingStats,
  recentActivity,
  slotStatusDisplay,
  timeRange,
  type ActionTone,
  type StatIcon,
} from './ParkingScreen.data';
import {
  ACTION_HEIGHT,
  ACTION_ICON_SIZE,
  ACTION_RADIUS,
  ACTION_WEIGHTS,
  BANNER_HEIGHT,
  BOTTOM_BAR_HEIGHT,
  HEADING_ICON_SIZE,
  HEADING_SIGN_SIZE,
  ROW_ICON_SIZE,
  STAT_ICON_SIZE,
  contentScaleFor,
  createStyles,
} from './ParkingScreen.styles';

/** Placeholder for links whose destination screens are not designed yet. */
function notYetRouted() {
  // TODO(nav): route to the destination screen once it is designed.
}

export function ParkingScreen() {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { width } = useWindowDimensions();
  const scale = contentScaleFor(width);
  const navigation = useNavigation<RootStackScreenProps<'Parking'>['navigation']>();
  const [menuOpen, setMenuOpen] = useState(false);

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

  const stats = useMemo(() => parkingStats(capacity), []);
  const slotStatus = slotStatusDisplay[mySlot.status];
  const requestStatus = guestRequestStatusDisplay[guestRequest.status];

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
          gradientColors: [
            theme.colors.actionBlueFrom,
            theme.colors.actionBlueVia,
            theme.colors.actionBlueTo,
          ],
          style: styles.actionBlue,
        } as const;
      case 'violet':
        return {
          variant: 'gradient',
          gradientColors: [
            theme.colors.actionVioletFrom,
            theme.colors.actionVioletVia,
            theme.colors.actionVioletTo,
          ],
          style: styles.actionViolet,
        } as const;
      case 'glass':
        return { variant: 'secondary', gradientColors: undefined, style: undefined } as const;
    }
  };

  return (
    <ScreenWrapper
      backgroundSource={images.homeBackground}
      withScrim={false}
      backgroundOverlay={0.34}
    >
      <StatusBar style="light" />

      <View style={styles.flex}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <PageHeader
            title={copy.title}
            onMenuPress={() => setMenuOpen(true)}
            style={styles.header}
          />

          <FeatureBanner
            title={copy.bannerTitle}
            body={copy.bannerBody}
            photo={images.parkingHero}
            photoAspect={imageAspects.parkingHero}
            height={BANNER_HEIGHT}
            style={styles.card}
          />

          <PhotoCard
            title={copy.myParkingTitle}
            icon={<ParkingSign size={HEADING_SIGN_SIZE} />}
            headline={`Slot ${mySlot.code}`}
            meta={`${mySlot.tower}${SEPARATOR}${mySlot.level}`}
            photo={images.parkingSlot}
            photoAspect={imageAspects.parkingSlot}
            scale={scale}
            style={styles.card}
          >
            <StatusChip
              label={slotStatus.label}
              tone={slotStatus.tone}
              glow
              style={styles.slotChip}
            />
          </PhotoCard>

          <PhotoCard
            title={copy.vehicleTitle}
            icon={<AppIcon set="ionicons" name="car-outline" size={HEADING_ICON_SIZE} />}
            headline={`${myVehicle.make} ${myVehicle.model}`}
            meta={`${myVehicle.colour}${SEPARATOR}${myVehicle.plateCountry} Plate: ${myVehicle.plate}`}
            photo={images.registeredVehicle}
            photoAspect={imageAspects.registeredVehicle}
            photoLayout="cutout"
            // TODO(nav): open the vehicle's details once that screen is designed.
            onPress={notYetRouted}
            accessibilityHint="Shows the vehicle's details"
            scale={scale}
            style={styles.card}
          />

          <View style={[styles.card, styles.stats]}>
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
                  stat.progress !== undefined
                    ? [theme.colors.cardStrokeFrom, theme.colors.featureStrokeTo]
                    : undefined
                }
                scale={scale}
              />
            ))}
          </View>

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
                  // TODO(nav): each opens its own flow (directions to the bay, the
                  // guest parking form, vehicle registration) once designed.
                  onPress={notYetRouted}
                  style={[{ flex: ACTION_WEIGHTS[index] }, look.style]}
                />
              );
            })}
          </View>

          <NeonPanel style={[styles.card, styles.list]}>
            <PanelHeading
              title={copy.guestRequestTitle}
              iconSet="ionicons"
              iconName="people-outline"
              iconSize={HEADING_ICON_SIZE}
              actionLabel={copy.viewAll}
              onActionPress={notYetRouted}
            />
            <ActivityRow
              icon={<AppIcon set="ionicons" name="calendar-outline" size={ROW_ICON_SIZE} />}
              title={guestRequest.date}
              details={[timeRange(guestRequest), guestsLabel(guestRequest.guests)]}
              statusLabel={requestStatus.label}
              statusTone={requestStatus.tone}
              statusGlow
              // TODO(nav): open the request once its detail screen is designed.
              onPress={notYetRouted}
              accessibilityHint="Shows the guest parking request"
            />
          </NeonPanel>

          <NeonPanel style={[styles.card, styles.list]}>
            <PanelHeading
              title={copy.activityTitle}
              iconSet="ionicons"
              iconName="time-outline"
              iconSize={HEADING_ICON_SIZE}
              actionLabel={copy.viewAll}
              onActionPress={notYetRouted}
            />
            {recentActivity.map((entry, index) => {
              const kind = activityKindDisplay[entry.kind];
              return (
                <ActivityRow
                  key={entry.id}
                  divided={index > 0}
                  icon={<AppIcon {...kind.icon} size={ROW_ICON_SIZE} />}
                  title={kind.title}
                  details={[`${entry.subject}${SEPARATOR}${entry.detail}`]}
                  time={entry.time}
                  statusLabel={activityStatusLabel[entry.status]}
                  statusTone={kind.tone}
                />
              );
            })}
          </NeonPanel>
        </ScrollView>

        {/* The same empty glass bar as Visitor Access and Maintenance. */}
        <BottomBar height={BOTTOM_BAR_HEIGHT} style={styles.bottomBar} />
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
