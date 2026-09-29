import Ionicons from '@expo/vector-icons/Ionicons';
import { useNavigation } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useMemo, useState } from 'react';
import { Linking, Pressable, ScrollView, View, useWindowDimensions } from 'react-native';

import { AppButton } from '../../components/common/AppButton';
import { AppIcon } from '../../components/common/AppIcon';
import { AppText } from '../../components/common/AppText';
import { BottomBar } from '../../components/layout/BottomBar';
import { PageHeader } from '../../components/layout/PageHeader';
import { ScreenWrapper } from '../../components/layout/ScreenWrapper';
import { AppMenu, type AppMenuItem } from '../../components/ui/AppMenu';
import { DividedRow } from '../../components/ui/DividedRow';
import { FeatureBanner } from '../../components/ui/FeatureBanner';
import { NeonPanel } from '../../components/ui/NeonPanel';
import { PanelHeading } from '../../components/ui/PanelHeading';
import { ProgressStepper, type ProgressStep } from '../../components/ui/ProgressStepper';
import { ServiceTile } from '../../components/ui/ServiceTile';
import { StatItem } from '../../components/ui/StatItem';
import { StatusChip } from '../../components/ui/StatusChip';
import { imageAspects, images } from '../../constants/images';
import { useAppTheme } from '../../hooks/useAppTheme';
import type { RootStackScreenProps } from '../../types/navigation.types';
import {
  SEPARATOR,
  activeRequest as request,
  emergencyPhone,
  maintenanceCopy as copy,
  requestStatusDisplay,
  serviceCategories,
  telLink,
  type ServiceCategory,
} from './MaintenanceScreen.data';
import {
  ACTION_HEIGHT,
  ACTION_ICON_SIZE,
  ACTION_RADIUS,
  BADGE_ICON_SIZE,
  BOTTOM_BAR_HEIGHT,
  CALL_ICON_SIZE,
  DETAILS_GAP,
  DETAILS_ICON_GAP,
  DETAILS_ICON_SIZE,
  DETAILS_SCALE,
  DETAILS_WEIGHTS,
  EMERGENCY_ICON_SIZE,
  ROW_CHEVRON_SIZE,
  contentScaleFor,
  createStyles,
} from './MaintenanceScreen.styles';

/** Placeholder for links whose destination screens are not designed yet. */
function notYetRouted() {
  // TODO(nav): route to the destination screen once it is designed.
}

/** Opens the phone's dialer; a device without one (e.g. a tablet) just ignores it. */
function dial(phone: string | null) {
  Linking.openURL(telLink(phone)).catch(() => undefined);
}

/** The categories in the reference's rows of three. */
const categoryRows: readonly (readonly ServiceCategory[])[] = Array.from(
  { length: Math.ceil(serviceCategories.length / 3) },
  (_, row) => serviceCategories.slice(row * 3, row * 3 + 3),
);

export function MaintenanceScreen() {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { width } = useWindowDimensions();
  const scale = contentScaleFor(width);
  const navigation = useNavigation<RootStackScreenProps<'Maintenance'>['navigation']>();
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

  const category = serviceCategories.find((item) => item.id === request.categoryId);
  const status = requestStatusDisplay[request.status];

  const steps = useMemo<readonly ProgressStep[]>(
    () =>
      request.stages.map((stage) => ({
        id: stage.status,
        label: requestStatusDisplay[stage.status].label,
        details: stage.date ? [stage.date, stage.time ?? ''].filter(Boolean) : undefined,
      })),
    [],
  );
  const currentStep = request.stages.findIndex((stage) => stage.status === request.status);

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
            titleVariant="inputLabel"
            onMenuPress={() => setMenuOpen(true)}
            style={styles.header}
          />

          <FeatureBanner
            title={copy.bannerTitle}
            body={copy.bannerBody}
            bodyVariant="statLabel"
            photo={images.maintenanceHero}
            photoAspect={imageAspects.maintenanceHero}
            style={styles.card}
          />

          <NeonPanel style={[styles.card, styles.categories]}>
            <PanelHeading
              title={copy.categoriesTitle}
              titleVariant="passTitle"
              iconSet="ionicons"
              iconName="grid-outline"
              iconSize={19}
              actionLabel={copy.viewAll}
              onActionPress={notYetRouted}
              divider={false}
            />
            <View style={styles.grid}>
              {categoryRows.map((row) => (
                <View key={row[0].id} style={styles.gridRow}>
                  {row.map((item) => (
                    <ServiceTile
                      key={item.id}
                      layout="stacked"
                      title={item.title}
                      subtitle={item.subtitle}
                      iconSet={item.iconSet}
                      iconName={item.iconName}
                      nested
                      glow
                      scale={scale}
                      // TODO(nav): open a new request in this category once that screen exists.
                      onPress={notYetRouted}
                      style={styles.tile}
                    />
                  ))}
                </View>
              ))}
            </View>
          </NeonPanel>

          <NeonPanel style={styles.card}>
            <PanelHeading
              title={copy.activeTitle}
              titleVariant="passTitle"
              iconSet="ionicons"
              iconName="document-text-outline"
              iconSize={19}
              actionLabel={copy.viewAll}
              onActionPress={notYetRouted}
            />

            <Pressable
              onPress={notYetRouted}
              accessibilityRole="button"
              accessibilityLabel={`${request.title}, ${request.id}, ${request.unit}, ${status.label}`}
              style={({ pressed }) => [styles.request, pressed && styles.pressed]}
            >
              <View style={styles.badge}>
                {category ? (
                  <AppIcon set={category.iconSet} name={category.iconName} size={BADGE_ICON_SIZE} />
                ) : null}
              </View>
              <View style={styles.requestText}>
                <AppText variant="statValue" numberOfLines={1}>
                  {request.title}
                </AppText>
                <AppText
                  variant="tileSubtitle"
                  color={theme.colors.textSupport}
                  numberOfLines={1}
                  style={styles.requestMeta}
                >
                  {`${request.id}${SEPARATOR}${request.unit}`}
                </AppText>
              </View>
              <StatusChip label={status.label} tone={status.tone} style={styles.requestChip} />
              <Ionicons
                name="chevron-forward"
                size={ROW_CHEVRON_SIZE}
                color={theme.colors.textPrimary}
                style={styles.requestChevron}
              />
            </Pressable>

            <ProgressStepper steps={steps} currentIndex={currentStep} style={styles.stepper} />

            <View style={styles.detailsDivider} />

            <DividedRow weights={DETAILS_WEIGHTS} gap={DETAILS_GAP * scale} style={styles.details}>
              <StatItem
                label="Technician"
                value={request.technician}
                iconSet="ionicons"
                iconName="person-outline"
                iconSize={DETAILS_ICON_SIZE}
                iconGap={DETAILS_ICON_GAP}
                scale={DETAILS_SCALE * scale}
              />
              <StatItem
                label="Visit Date"
                value={request.visitDate}
                caption={request.visitWindow}
                iconSet="ionicons"
                iconName="calendar-outline"
                iconSize={DETAILS_ICON_SIZE}
                iconGap={DETAILS_ICON_GAP}
                scale={DETAILS_SCALE * scale}
              />
              <Pressable
                onPress={() => dial(request.contactPhone)}
                accessibilityRole="button"
                accessibilityHint="Calls the technician"
                style={({ pressed }) => pressed && styles.pressed}
              >
                <StatItem
                  label="Contact"
                  value={request.contactPhone}
                  iconSet="ionicons"
                  iconName="call-outline"
                  iconSize={DETAILS_ICON_SIZE}
                  iconGap={DETAILS_ICON_GAP}
                  scale={DETAILS_SCALE * scale}
                />
              </Pressable>
            </DividedRow>
          </NeonPanel>

          <View style={[styles.card, styles.actions]}>
            <AppButton
              title={copy.newRequest}
              variant="gradient"
              gradientColors={[
                theme.colors.ctaSky,
                theme.colors.ctaRoyal,
                theme.colors.ctaViolet,
                theme.colors.ctaPink,
              ]}
              height={ACTION_HEIGHT}
              radius={ACTION_RADIUS}
              labelVariant="statValue"
              leadingIcon={
                <Ionicons name="add" size={ACTION_ICON_SIZE} color={theme.colors.textPrimary} />
              }
              leadingPlacement="inline"
              // TODO(nav): open the new request form once that screen is designed.
              onPress={notYetRouted}
              style={styles.newRequest}
            />
            <Pressable
              onPress={notYetRouted}
              accessibilityRole="button"
              accessibilityLabel={copy.myRequests}
              style={({ pressed }) => [styles.myRequests, pressed && styles.pressed]}
            >
              <NeonPanel style={styles.myRequestsPanel}>
                <Ionicons
                  name="document-text-outline"
                  size={ACTION_ICON_SIZE}
                  color={theme.colors.textPrimary}
                />
                <AppText variant="statValue" style={styles.myRequestsLabel}>
                  {copy.myRequests}
                </AppText>
              </NeonPanel>
            </Pressable>
          </View>

          {/* Not itself a button: "Call Now" is, and web cannot nest buttons.
              TODO(nav): make the card open emergency support once that screen exists. */}
          <View style={styles.card}>
            <NeonPanel
              // The warm corner glow of the design's emergency card.
              glowBottomColors={[theme.colors.emergencyStroke, theme.colors.featureStrokeTo]}
              style={styles.emergency}
            >
              <View style={styles.emergencyWashClip} pointerEvents="none">
                <LinearGradient
                  colors={[theme.colors.emergencyWash, theme.colors.transparent]}
                  start={{ x: 0, y: 0.5 }}
                  end={{ x: 1, y: 0.5 }}
                  style={styles.emergencyWash}
                />
              </View>

              <Ionicons
                name="warning-outline"
                size={EMERGENCY_ICON_SIZE}
                color={theme.colors.emergencyIcon}
                style={styles.emergencyIcon}
              />
              <View style={styles.emergencyText}>
                <AppText variant="statValue">{copy.emergencyTitle}</AppText>
                <AppText
                  variant="tileCaption"
                  color={theme.colors.textSupport}
                  numberOfLines={2}
                  style={styles.emergencyBody}
                >
                  {copy.emergencyBody}
                </AppText>
              </View>

              <Pressable
                onPress={() => dial(emergencyPhone)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={copy.callNow}
                accessibilityHint="Opens the phone to call emergency support"
                style={({ pressed }) => [styles.callNow, pressed && styles.pressed]}
              >
                <Ionicons
                  name="call-outline"
                  size={CALL_ICON_SIZE}
                  color={theme.colors.emergencyIcon}
                />
                <AppText
                  variant="tileSubtitle"
                  color={theme.colors.emergencyText}
                  style={styles.callNowLabel}
                >
                  {copy.callNow}
                </AppText>
              </Pressable>
              <Ionicons
                name="chevron-forward"
                size={ROW_CHEVRON_SIZE}
                color={theme.colors.textPrimary}
                style={styles.emergencyChevron}
              />
            </NeonPanel>
          </View>
        </ScrollView>

        {/* The same empty glass bar as Visitor Access. */}
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
