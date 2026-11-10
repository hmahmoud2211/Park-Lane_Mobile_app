import Ionicons from '@expo/vector-icons/Ionicons';
import { useRoute, type RouteProp } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  View,
  type ScrollViewInstance,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { AppButton } from '../../components/common/AppButton';
import { ErrorNotice } from '../../components/feedback/ErrorNotice';
import { LoadingState } from '../../components/feedback/LoadingState';
import { Notice } from '../../components/feedback/Notice';
import { AppIcon } from '../../components/common/AppIcon';
import { AppText } from '../../components/common/AppText';
import { BottomBar } from '../../components/layout/BottomBar';
import { PageHeader } from '../../components/layout/PageHeader';
import { ResponsiveColumns } from '../../components/layout/ResponsiveColumns';
import { ScreenWrapper } from '../../components/layout/ScreenWrapper';
import { AppMenu } from '../../components/ui/AppMenu';
import { DividedRow } from '../../components/ui/DividedRow';
import { FeatureBanner } from '../../components/ui/FeatureBanner';
import { NeonPanel } from '../../components/ui/NeonPanel';
import { PanelHeading } from '../../components/ui/PanelHeading';
import { ProgressStepper, type ProgressStep } from '../../components/ui/ProgressStepper';
import { ServiceTile } from '../../components/ui/ServiceTile';
import { StatItem } from '../../components/ui/StatItem';
import { StatusChip } from '../../components/ui/StatusChip';
import { imageAspects, images } from '../../constants/images';
import { useEms } from '../../features/ems/hooks/useEms';
import { EmsError, emsErrorText } from '../../features/ems/services/emsHttp';
import { cancelServiceRequest, createServiceRequest, getRequestOptions, listServiceRequests } from '../../features/requests/services/requestsApi';
import { useAppTheme } from '../../hooks/useAppTheme';
import { useFocusQuery } from '../../hooks/useFocusQuery';
import { useScreenLayout } from '../../hooks/useScreenLayout';
import type { RootStackParamList } from '../../types/navigation.types';
import {
  SEPARATOR,
  categoriesFrom,
  choicesFrom,
  formFieldOf,
  isOpen,
  kindCopy,
  lookOf,
  maintenanceCopy as copy,
  requestStatusDisplay,
  telLink,
  toScreenRequest,
  type MaintenanceRequest,
  type RequestForm as RequestFormValues,
  type RequestFormErrors,
  type ScreenKind,
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
import { useScreenMenu } from '../../hooks/useScreenMenu';

/** Space kept above a panel the screen scrolls to, so its heading clears the edge. */
const SCROLL_MARGIN = 12;

/** The three routes this screen serves, and the kind of request each one makes. */
type RequestRoute = 'Maintenance' | 'Housekeeping' | 'MovingRequest';
const KIND_OF: Record<RequestRoute, ScreenKind> = { Maintenance: 'maintenance', Housekeeping: 'housekeeping', MovingRequest: 'moving' };

/** Opens the phone's dialer; a device without one (e.g. a tablet) just ignores it. */
function dial(phone: string | null) {
  if (phone) Linking.openURL(telLink(phone)).catch(() => undefined);
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
  const category = lookOf(item.categoryId);
  const status = requestStatusDisplay[item.status];

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${item.title}, ${item.reference}, ${item.unit}, ${status.label}`}
      accessibilityHint={hint}
      style={({ pressed }) => [styles.request, style, pressed && styles.pressed]}
    >
      <View style={styles.badge}>
        <AppIcon set={category.iconSet} name={category.iconName} size={BADGE_ICON_SIZE} />
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
          {item.unit ? `${item.reference}${SEPARATOR}${item.unit}` : item.reference}
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
  const layout = useScreenLayout();
  // Fitted to the column the panels sit in, not the window.
  const scale = contentScaleFor(layout.columnFrameWidth);
  const { menuOpen, setMenuOpen, menuItems } = useScreenMenu();
  const route = useRoute<RouteProp<RootStackParamList, RequestRoute>>();
  const kind = KIND_OF[route.name] ?? 'maintenance';
  const words = kindCopy[kind];

  // The compound's offer (categories, days, windows) and the unit's requests; both reload when the screen is
  // shown, and the list again whenever building management acts on one of them.
  const fetchOptions = useCallback(() => getRequestOptions(kind), [kind]);
  const options = useFocusQuery(fetchOptions);
  const list = useFocusQuery(listServiceRequests);
  const { onRealtimeEvent } = useEms();
  const reloadList = list.reload;
  useEffect(
    () =>
      onRealtimeEvent((event) => {
        if (event.type === 'request.updated' || event.type === 'ready') reloadList();
      }),
    [onRealtimeEvent, reloadList],
  );

  const timeZone = options.data?.timezone ?? 'Africa/Cairo';
  const unitName = options.data?.unitName ?? '';
  const requests = useMemo<readonly MaintenanceRequest[]>(
    () => (list.data ?? []).filter((item) => item.kind === kind).map((item) => toScreenRequest(item, unitName, timeZone)),
    [list.data, kind, unitName, timeZone],
  );
  const serviceCategories = useMemo(() => categoriesFrom(options.data), [options.data]);
  const choices = useMemo(() => choicesFrom(options.data), [options.data]);
  const emergencyPhone = kind === 'maintenance' ? (options.data?.emergencyPhone ?? null) : null;

  const [chosenId, setChosenId] = useState<string | null>(null);
  const [showAllCategories, setShowAllCategories] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  /** `undefined` while the form is closed; a category id, or '', while open. */
  const [formCategory, setFormCategory] = useState<string | undefined>(undefined);
  /** The request whose "Cancel request" was tapped once; a second tap cancels it. */
  const [confirmCancelId, setConfirmCancelId] = useState<string | null>(null);
  const [cancelError, setCancelError] = useState<string | null>(null);

  const scroll = useRef<ScrollViewInstance>(null);
  const formY = useRef(0);
  const activeY = useRef(0);
  const scrollToForm = useRef(false);
  // The panels sit in page columns, so their offsets are measured within a
  // column and placed on the page from where the columns sit.
  const columnsY = useRef(0);
  const firstColumnHeight = useRef(0);
  const formTop = () => columnsY.current + formY.current;
  const activeTop = () =>
    columnsY.current + (layout.columns > 1 ? 0 : firstColumnHeight.current) + activeY.current;

  // The one chosen, else the first still open, else the latest.
  const request = requests.find((item) => item.id === chosenId) ?? requests.find(isOpen) ?? requests[0] ?? null;
  const history = request ? requests.filter((item) => item.id !== request.id) : [];
  const hasMoreCategories = serviceCategories.length > words.categoriesShown;
  const shownCategories = showAllCategories ? serviceCategories : serviceCategories.slice(0, words.categoriesShown);

  const steps = useMemo<readonly ProgressStep[]>(
    () =>
      (request?.stages ?? []).map((stage) => ({
        id: stage.status,
        label: requestStatusDisplay[stage.status].label,
        details: stage.date ? [stage.date, stage.time ?? ''].filter(Boolean) : undefined,
      })),
    [request],
  );
  const currentStep = request ? request.stages.findIndex((stage) => stage.status === request.status) : 0;

  const scrollTo = (y: number) =>
    scroll.current?.scrollTo({ y: Math.max(0, y - SCROLL_MARGIN), animated: true });

  // A category tile opens the form on that category; "New Request" on none.
  const openForm = (categoryId: string) => {
    if (formCategory === undefined) {
      // Scrolled to once it has laid out (see the form's onLayout).
      scrollToForm.current = true;
    } else {
      scrollTo(formTop());
    }
    setFormCategory(categoryId);
  };

  // The backend checks the compound's rules again and gives the request its reference.
  const submitRequest = async (form: RequestFormValues): Promise<RequestFormErrors | string | null> => {
    try {
      const created = await createServiceRequest({
        kind,
        category: form.category,
        title: form.issue.trim(),
        details: form.details.trim() || null,
        preferredDate: form.date,
        preferredWindow: form.window,
      });
      setChosenId(created.id);
      setFormCategory(undefined);
      setShowHistory(false);
      reloadList();
      AccessibilityInfo.announceForAccessibility(copy.submitted(created.reference));
      // The form folds away; the new request takes the Active Request panel.
      requestAnimationFrame(() => scrollTo(activeTop()));
      return null;
    } catch (error: unknown) {
      const field = error instanceof EmsError ? formFieldOf(error.field) : null;
      return field ? { [field]: emsErrorText(error) } : `${copy.submitFailedTitle}. ${emsErrorText(error)}`;
    }
  };

  const cancelActive = () => {
    if (!request?.cancellable) return;
    if (confirmCancelId !== request.id) {
      setConfirmCancelId(request.id);
      setCancelError(null);
      return;
    }
    setConfirmCancelId(null);
    cancelServiceRequest(request.id)
      .then(reloadList)
      .catch((error: unknown) => setCancelError(`${copy.cancelFailedTitle}. ${emsErrorText(error)}`));
  };

  const showRequest = (id: string) => {
    setChosenId(id);
    setShowHistory(false);
    scrollTo(activeTop());
  };

  const openHistory = () => {
    setShowHistory(true);
    scrollTo(activeTop());
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
          contentContainerStyle={[styles.content, layout.contentStyle]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <PageHeader
            title={words.title}
            onMenuPress={() => setMenuOpen(true)}
            style={styles.header}
          />

          {words.banner ? (
            <FeatureBanner
              title={words.banner.title}
              body={words.banner.body}
              photo={images.maintenanceHero}
              photoAspect={imageAspects.maintenanceHero}
              style={styles.card}
            />
          ) : null}

          {/*
            Ways to ask for help on the left, the request in hand on the right.
            Cards keep their own bottom margins, so the columns add no gap.
          */}
          <View
            onLayout={(event) => {
              columnsY.current = event.nativeEvent.layout.y;
            }}
          >
            <ResponsiveColumns gap={0}>
              <View
                onLayout={(event) => {
                  firstColumnHeight.current = event.nativeEvent.layout.height;
                }}
              >
                <NeonPanel style={[styles.card, styles.categories]}>
                  <PanelHeading
                    title={words.categoriesTitle}
                    iconSet="ionicons"
                    iconName="grid-outline"
                    iconSize={19}
                    actionLabel={hasMoreCategories ? (showAllCategories ? copy.showLess : copy.viewAll) : undefined}
                    actionExpanded={hasMoreCategories ? showAllCategories : undefined}
                    onActionPress={() => setShowAllCategories((current) => !current)}
                    divider={false}
                  />
                  {options.loading && !options.data ? <LoadingState /> : null}
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
                            onPress={() => openForm(item.id)}
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
                        scrollTo(formTop());
                      }
                    }}
                  >
                    <RequestForm
                      kindCopy={words}
                      choices={choices}
                      categoryId={formCategory || undefined}
                      onSubmit={submitRequest}
                      onClose={() => setFormCategory(undefined)}
                      style={styles.card}
                    />
                  </View>
                ) : null}
              </View>

              <View>
                <View
                  onLayout={(event) => {
                    activeY.current = event.nativeEvent.layout.y;
                  }}
                >
                  {list.error ? (
                    list.error.code === 'no_home' ? (
                      <Notice tone="info" title={copy.noHomeTitle} style={styles.card}>
                        {copy.noHomeBody}
                      </Notice>
                    ) : (
                      <View style={styles.card}>
                        <ErrorNotice title={copy.loadFailed} retryLabel={copy.retry} onRetry={list.reload}>
                          {list.error.message}
                        </ErrorNotice>
                      </View>
                    )
                  ) : !request ? (
                    <NeonPanel style={styles.card}>
                      <PanelHeading title={copy.activeTitle} iconSet="ionicons" iconName="document-text-outline" iconSize={19} />
                      {list.loading ? (
                        <LoadingState />
                      ) : (
                        <AppText variant="bodySmall" color={theme.colors.textSecondary} style={styles.emptyText}>
                          {copy.noRequests}
                        </AppText>
                      )}
                    </NeonPanel>
                  ) : (
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

                      {request.cancellable ? (
                        <Pressable
                          onPress={cancelActive}
                          hitSlop={8}
                          accessibilityRole="button"
                          accessibilityHint={confirmCancelId === request.id ? 'Cancels the request' : 'Asks you to tap again to confirm'}
                          style={({ pressed }) => [styles.cancelLink, pressed && styles.pressed]}
                        >
                          <AppText variant="statLabel" color={confirmCancelId === request.id ? theme.colors.error : theme.colors.textSupport}>
                            {confirmCancelId === request.id ? copy.cancelConfirm : copy.cancelRequest}
                          </AppText>
                        </Pressable>
                      ) : null}
                      {cancelError ? (
                        <AppText variant="statLabel" color={theme.colors.error} accessibilityRole="alert" style={styles.cancelLink}>
                          {cancelError}
                        </AppText>
                      ) : null}

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
                  )}
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

                {/* Not itself a button: "Call Now" is, and web cannot nest buttons. Shown once building
                    management has set the compound's emergency number (admin dashboard, Compound rules). */}
                {emergencyPhone ? (
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
                ) : null}
              </View>
            </ResponsiveColumns>
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
