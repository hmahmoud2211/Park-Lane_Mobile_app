import Ionicons from '@expo/vector-icons/Ionicons';
import { useNavigation } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  View,
  useWindowDimensions,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

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
  CATEGORIES_SHOWN,
  SEPARATOR,
  createRequest,
  emergencyPhone,
  initialRequests,
  maintenanceCopy as copy,
  requestStatusDisplay,
  serviceCategories,
  telLink,
  type MaintenanceRequest,
  type RequestForm as RequestFormValues,
  type ServiceCategory,
} from './MaintenanceScreen.data';
import {
  ACTION_HEIGHT,
  ACTION_ICON_SIZE,
  ACTION_RADIUS,
  BADGE_ICON_SIZE,
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
import { RequestForm } from './RequestForm';

/** Space kept above a panel the screen scrolls to, so its heading clears the edge. */
const SCROLL_MARGIN = 12;

/** Opens the phone's dialer; a device without one (e.g. a tablet) just ignores it. */
function dial(phone: string | null) {
  Linking.openURL(telLink(phone)).catch(() => undefined);
}

/** Categories in the reference's rows of three. */
function rowsOfThree(items: readonly ServiceCategory[]): ServiceCategory[][] {
  return Array.from({ length: Math.ceil(items.length / 3) }, (_, row) =>
    items.slice(row * 3, row * 3 + 3),
  );
}

interface RequestRowProps {
  item: MaintenanceRequest;
  onPress: () => void;
  hint: string;
  style?: StyleProp<ViewStyle>;
}

/** One request: category badge, title, reference and unit, status and chevron. */
function RequestRow({ item, onPress, hint, style }: RequestRowProps) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const category = serviceCategories.find((entry) => entry.id === item.categoryId);
  const status = requestStatusDisplay[item.status];

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${item.title}, ${item.id}, ${item.unit}, ${status.label}`}
      accessibilityHint={hint}
      style={({ pressed }) => [styles.request, style, pressed && styles.pressed]}
    >
      <View style={styles.badge}>
        {category ? (
          <AppIcon set={category.iconSet} name={category.iconName} size={BADGE_ICON_SIZE} />
        ) : null}
      </View>
      <View style={styles.requestText}>
        <AppText variant="statValue" numberOfLines={1}>
          {item.title}
        </AppText>
        <AppText
          variant="tileCaption"
          color={theme.colors.textSupport}
          numberOfLines={1}
          style={styles.requestMeta}
        >
          {`${item.id}${SEPARATOR}${item.unit}`}
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
  );
}

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

  // Screen-local until there is a maintenance backend to file requests with.
  // TODO(api): submit and load requests from the service once it exists.
  const [requests, setRequests] = useState<readonly MaintenanceRequest[]>(initialRequests);
  const [activeId, setActiveId] = useState(initialRequests[0].id);
  const [showAllCategories, setShowAllCategories] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  /** `undefined` while the form is closed; a category title, or '', while open. */
  const [formCategory, setFormCategory] = useState<string | undefined>(undefined);

  const scroll = useRef<ScrollView>(null);
  const formY = useRef(0);
  const activeY = useRef(0);
  const scrollToForm = useRef(false);

  const request = requests.find((item) => item.id === activeId) ?? requests[0];
  const history = requests.filter((item) => item.id !== request.id);
  const shownCategories = showAllCategories
    ? serviceCategories
    : serviceCategories.slice(0, CATEGORIES_SHOWN);

  const steps = useMemo<readonly ProgressStep[]>(
    () =>
      request.stages.map((stage) => ({
        id: stage.status,
        label: requestStatusDisplay[stage.status].label,
        details: stage.date ? [stage.date, stage.time ?? ''].filter(Boolean) : undefined,
      })),
    [request],
  );
  const currentStep = request.stages.findIndex((stage) => stage.status === request.status);

  const scrollTo = (y: number) =>
    scroll.current?.scrollTo({ y: Math.max(0, y - SCROLL_MARGIN), animated: true });

  // A category tile opens the form on that category; "New Request" on none.
  const openForm = (categoryTitle: string) => {
    if (formCategory === undefined) {
      // Scrolled to once it has laid out (see the form's onLayout).
      scrollToForm.current = true;
    } else {
      scrollTo(formY.current);
    }
    setFormCategory(categoryTitle);
  };

  const submitRequest = (form: RequestFormValues) => {
    const created = createRequest(form, requests, request.unit);
    setRequests((current) => [created, ...current]);
    setActiveId(created.id);
    setFormCategory(undefined);
    setShowHistory(false);
    AccessibilityInfo.announceForAccessibility(copy.submitted(created.id));
    // The form folds away; the new request takes the Active Request panel.
    requestAnimationFrame(() => scrollTo(activeY.current));
  };

  const showRequest = (id: string) => {
    setActiveId(id);
    setShowHistory(false);
    scrollTo(activeY.current);
  };

  const openHistory = () => {
    setShowHistory(true);
    scrollTo(activeY.current);
  };

  return (
    <ScreenWrapper
      backgroundSource={images.homeBackground}
      withScrim={false}
      backgroundOverlay={0.34}
    >
      <StatusBar style="light" />

      {/* As on Visitor Access: iOS pads for the keyboard, Android resizes the window itself. */}
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          ref={scroll}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
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
            photo={images.maintenanceHero}
            photoAspect={imageAspects.maintenanceHero}
            style={styles.card}
          />

          <NeonPanel style={[styles.card, styles.categories]}>
            <PanelHeading
              title={copy.categoriesTitle}
              iconSet="ionicons"
              iconName="grid-outline"
              iconSize={19}
              actionLabel={showAllCategories ? copy.showLess : copy.viewAll}
              actionExpanded={showAllCategories}
              onActionPress={() => setShowAllCategories((current) => !current)}
              divider={false}
            />
            <View style={styles.grid}>
              {rowsOfThree(shownCategories).map((row) => (
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
                      onPress={() => openForm(item.title)}
                      style={styles.tile}
                    />
                  ))}
                  {/* Keeps a short last row's tiles at a third of the width. */}
                  {Array.from({ length: 3 - row.length }, (_, index) => (
                    <View key={`spacer-${index}`} style={styles.tile} />
                  ))}
                </View>
              ))}
            </View>
          </NeonPanel>

          {formCategory !== undefined ? (
            <View
              onLayout={(event) => {
                formY.current = event.nativeEvent.layout.y;
                if (scrollToForm.current) {
                  scrollToForm.current = false;
                  scrollTo(formY.current);
                }
              }}
            >
              <RequestForm
                categoryTitle={formCategory || undefined}
                onSubmit={submitRequest}
                onClose={() => setFormCategory(undefined)}
                style={styles.card}
              />
            </View>
          ) : null}

          <View
            onLayout={(event) => {
              activeY.current = event.nativeEvent.layout.y;
            }}
          >
            <NeonPanel style={styles.card}>
              <PanelHeading
                title={copy.activeTitle}
                iconSet="ionicons"
                iconName="document-text-outline"
                iconSize={19}
                actionLabel={history.length > 0 ? (showHistory ? copy.showLess : copy.viewAll) : undefined}
                actionExpanded={history.length > 0 ? showHistory : undefined}
                onActionPress={() => setShowHistory((current) => !current)}
              />

              <RequestRow
                item={request}
                onPress={() => setShowHistory((current) => !current)}
                hint="Shows your other requests"
              />

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
                {/* Dials the technician; a new request has no one to call yet. */}
                <Pressable
                  onPress={() => dial(request.contactPhone)}
                  disabled={!request.contactPhone}
                  accessibilityRole="button"
                  accessibilityHint="Calls the technician"
                  accessibilityState={{ disabled: !request.contactPhone }}
                  style={({ pressed }) => pressed && styles.pressed}
                >
                  <StatItem
                    label="Contact"
                    value={request.contactPhone ?? copy.contactPending}
                    iconSet="ionicons"
                    iconName="call-outline"
                    iconSize={DETAILS_ICON_SIZE}
                    iconGap={DETAILS_ICON_GAP}
                    scale={DETAILS_SCALE * scale}
                  />
                </Pressable>
              </DividedRow>

              {showHistory && history.length > 0 ? (
                <View style={styles.history}>
                  <View style={styles.detailsDivider} />
                  <AppText
                    variant="statLabel"
                    color={theme.colors.textSupport}
                    style={styles.historyTitle}
                  >
                    {copy.historyTitle}
                  </AppText>
                  {history.map((item, index) => (
                    <RequestRow
                      key={item.id}
                      item={item}
                      onPress={() => showRequest(item.id)}
                      hint="Shows this request"
                      style={index === 0 ? styles.historyFirstRow : styles.historyRow}
                    />
                  ))}
                </View>
              ) : null}
            </NeonPanel>
          </View>

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
              onPress={() => openForm('')}
              style={styles.newRequest}
            />
            <Pressable
              onPress={openHistory}
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
                  variant="statLabel"
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
        <BottomBar />
      </KeyboardAvoidingView>

      <AppMenu
        visible={menuOpen}
        onClose={() => setMenuOpen(false)}
        items={menuItems}
        align="right"
      />
    </ScreenWrapper>
  );
}
