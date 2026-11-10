import Ionicons from '@expo/vector-icons/Ionicons';
import { useNavigation } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  View,
  type TextInputInstance,
  type ViewInstance,
} from 'react-native';

import { AppIcon } from '../../components/common/AppIcon';
import { AppInput } from '../../components/common/AppInput';
import { AppText } from '../../components/common/AppText';
import { BottomBar } from '../../components/layout/BottomBar';
import { PageHeader } from '../../components/layout/PageHeader';
import { ResponsiveColumns } from '../../components/layout/ResponsiveColumns';
import { ScreenWrapper } from '../../components/layout/ScreenWrapper';
import { AppMenu, type AppMenuItem } from '../../components/ui/AppMenu';
import { FeatureBanner } from '../../components/ui/FeatureBanner';
import { NeonPanel } from '../../components/ui/NeonPanel';
import { PanelHeading } from '../../components/ui/PanelHeading';
import { VisitorPassCard } from '../../components/ui/VisitorPassCard';
import { VisitorRow } from '../../components/ui/VisitorRow';
import { imageAspects, images } from '../../constants/images';
import { useAppTheme } from '../../hooks/useAppTheme';
import { useFocusQuery } from '../../hooks/useFocusQuery';
import { useScreenLayout } from '../../hooks/useScreenLayout';
import { downloadPdf } from '../../features/documents/services/exportPdf';
import { useEms } from '../../features/ems/hooks/useEms';
import { EmsError, emsErrorText } from '../../features/ems/services/emsHttp';
import { useResidentIdentity } from '../../features/home/hooks/useResidentIdentity';
import { getMySite } from '../../features/sites/services/sitesApi';
import { createVisitorPass, listVisitorPasses, revokeVisitorPass } from '../../features/visitors/services/visitorsApi';
import { ErrorNotice } from '../../components/feedback/ErrorNotice';
import { Notice } from '../../components/feedback/Notice';
import { flags } from '../../config/flags';
import { zonedDate, zonedInstant } from '../../utils/zonedTime';
import type { RootStackScreenProps } from '../../types/navigation.types';
import {
  DEFAULT_RULES,
  SEPARATOR,
  UPCOMING_LIMIT,
  dateOptions,
  formFieldOf,
  formFields,
  guestOptions,
  initialForm,
  initialsOf,
  labelFor,
  orderPasses,
  statusDisplay,
  timeOptions,
  toScreenPass,
  validateForm,
  visitorAccessCopy as copy,
  type FormErrors,
  type FormFieldConfig,
  type FormFieldKey,
  type Option,
  type VisitorForm,
  type VisitorPass,
} from './VisitorAccessScreen.data';
import { guestsLabel } from '../../utils/format';
import { buildPassDocument } from './VisitorAccessScreen.documents';
import { PARKING_CHEVRON_SIZE, createStyles } from './VisitorAccessScreen.styles';
import { FIELD_CHEVRON_SIZE, FIELD_HEIGHT, FORM_ICON_SIZE } from '../../components/forms/formMetrics';
import { useLogout } from '../../hooks/useScreenMenu';
import { FormSubmitButton } from '../../components/forms/FormSubmitButton';

type SelectKey = Extract<FormFieldKey, 'date' | 'time' | 'guests'>;

/** Where the tapped control sits; `x` and `width` line a picker up with its field on wide layouts. */
type MenuAnchor = { y: number; height: number; x?: number; width?: number };

/** Which dropdown is open, and the control it hangs from. */
type OpenMenu =
  | { kind: 'header' }
  | { kind: 'pass'; anchor: MenuAnchor }
  | { kind: 'select'; key: SelectKey; anchor: MenuAnchor; align: 'left' | 'right' };

/** The fields in the reference's two-column rows. */
const fieldRows: readonly (readonly FormFieldConfig[])[] = Array.from(
  { length: Math.ceil(formFields.length / 2) },
  (_, row) => formFields.slice(row * 2, row * 2 + 2),
);

export function VisitorAccessScreen() {
  const theme = useAppTheme();
  const layout = useScreenLayout();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const navigation = useNavigation<RootStackScreenProps<'VisitorAccess'>['navigation']>();

  // The unit's passes and the compound's visiting rules; both reload whenever the screen is shown.
  const passes = useFocusQuery(listVisitorPasses);
  const site = useFocusQuery(getMySite);
  const { onRealtimeEvent } = useEms();
  const identity = useResidentIdentity();
  const timeZone = site.data?.site.timezone ?? 'Africa/Cairo';
  const rules = site.data?.settings.visitors ?? DEFAULT_RULES;
  const visitors = useMemo<readonly VisitorPass[]>(
    () => orderPasses(passes.data ?? []).map((pass) => toScreenPass(pass, timeZone)),
    [passes.data, timeZone],
  );
  const [chosenId, setChosenId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<VisitorForm>(() => initialForm(zonedDate(Date.now(), 'Africa/Cairo')));
  const reloadPasses = passes.reload;

  // The gate letting a visitor in (or a family member making a pass) shows at once.
  useEffect(
    () =>
      onRealtimeEvent((event) => {
        if (event.type === 'visitor.updated' || event.type === 'ready') reloadPasses();
      }),
    [onRealtimeEvent, reloadPasses],
  );
  const [errors, setErrors] = useState<FormErrors>({});
  const [openMenu, setOpenMenu] = useState<OpenMenu | null>(null);
  const [showAllUpcoming, setShowAllUpcoming] = useState(false);

  const inputRefs = useRef<Partial<Record<FormFieldKey, TextInputInstance | null>>>({});
  const selectRefs = useRef<Partial<Record<SelectKey, ViewInstance | null>>>({});

  const activePass =
    visitors.find((visitor) => visitor.id === chosenId) ??
    visitors.find((visitor) => visitor.status === 'scheduled' || visitor.status === 'arrived') ??
    visitors[0] ??
    null;
  const activeId = activePass?.id ?? null;
  const setActiveId = setChosenId;
  const allUpcoming = visitors.filter((visitor) => visitor.id !== activeId);
  // "View All" only appears when someone is hidden behind it.
  const hasMoreUpcoming = allUpcoming.length > UPCOMING_LIMIT;
  const upcoming = showAllUpcoming ? allUpcoming : allUpcoming.slice(0, UPCOMING_LIMIT);

  const selectOptions = useMemo<Record<SelectKey, readonly Option[]>>(
    () => ({ date: dateOptions(rules, timeZone), time: timeOptions(rules, form.date, timeZone), guests: guestOptions(rules) }),
    [rules, timeZone, form.date],
  );

  const closeMenu = useCallback(() => setOpenMenu(null), []);

  const updateField = useCallback((key: FormFieldKey, value: string) => {
    setForm((current) => ({ ...current, [key]: value }));
    // Editing a field clears its message; the rest wait for the next submit.
    setErrors((current) => (current[key] ? { ...current, [key]: undefined } : current));
  }, []);

  const openSelect = useCallback((key: SelectKey, column: number) => {
    Keyboard.dismiss();
    selectRefs.current[key]?.measureInWindow((x, y, width, height) => {
      setOpenMenu({
        kind: 'select',
        key,
        anchor: { x, y, width, height },
        align: column === 0 ? 'left' : 'right',
      });
    });
  }, []);

  const leave = useLogout();
  const handleLogout = useCallback(() => {
    setOpenMenu(null);
    leave();
  }, [leave]);

  const cancelActivePass = useCallback(() => {
    setOpenMenu(null);
    if (!activeId) return;
    revokeVisitorPass(activeId)
      .then(() => {
        // Brings the next visitor forward, so the card is never left blank while anyone is still expected.
        setChosenId(null);
        reloadPasses();
      })
      .catch((error: unknown) => Alert.alert(copy.cancelFailedTitle, emsErrorText(error)));
  }, [activeId, reloadPasses]);

  // The visitor needs the QR, so the pass goes out as a one-page PDF: the
  // share sheet on a phone (WhatsApp, Mail, Files...), the print dialog's
  // "Save as PDF" on the web.
  const shareActivePass = useCallback(() => {
    setOpenMenu(null);
    if (!activePass) {
      return;
    }
    downloadPdf(buildPassDocument(activePass, { name: identity.fullName, unit: site.data ? site.data.site.name : '' })).catch(() =>
      Alert.alert(copy.shareFailedTitle, copy.shareFailedBody),
    );
  }, [activePass, identity.fullName, site.data]);

  const handleGenerate = useCallback(() => {
    Keyboard.dismiss();
    if (busy) return;
    const found = validateForm(form);
    if (Object.keys(found).length > 0) {
      setErrors(found);
      return;
    }

    // The backend makes the pass and its QR; it checks the compound's rules again.
    setBusy(true);
    createVisitorPass({
      visitorName: form.name.trim(),
      visitorPhone: form.mobile.trim() || null,
      plate: form.plate.trim().toUpperCase() || null,
      guests: Number.parseInt(form.guests, 10) || 1,
      arrivesAt: new Date(zonedInstant(form.date, form.time, timeZone)).toISOString(),
    })
      .then((pass) => {
        setChosenId(pass.id);
        setForm(initialForm(zonedDate(Date.now(), timeZone)));
        setErrors({});
        reloadPasses();
        AccessibilityInfo.announceForAccessibility(`QR pass created for ${pass.visitorName}`);
      })
      .catch((error: unknown) => {
        const field = error instanceof EmsError ? formFieldOf(error.field) : null;
        if (field) setErrors({ [field]: emsErrorText(error) });
        else Alert.alert(copy.createFailedTitle, emsErrorText(error));
      })
      .finally(() => setBusy(false));
  }, [busy, form, timeZone, reloadPasses]);

  const menuItems = useMemo<readonly AppMenuItem[]>(() => {
    if (!openMenu) {
      return [];
    }
    if (openMenu.kind === 'header') {
      return [{ id: 'logout', label: 'Log out', icon: 'log-out-outline', onPress: handleLogout }];
    }
    if (openMenu.kind === 'pass') {
      const share: AppMenuItem = {
        id: 'share',
        label: copy.sharePass,
        icon: 'share-outline',
        onPress: shareActivePass,
      };
      // Only a visit that has not happened yet can be cancelled.
      return activePass?.status === 'scheduled'
        ? [
            share,
            {
              id: 'cancel',
              label: copy.cancelPass,
              icon: 'close-circle-outline',
              onPress: cancelActivePass,
            },
          ]
        : [share];
    }
    const { key } = openMenu;
    return selectOptions[key].map((option) => ({
      id: option.id,
      label: option.label,
      onPress: () => {
        updateField(key, option.id);
        // A new day has other free times: the chosen time may no longer exist.
        if (key === 'date') updateField('time', '');
        setOpenMenu(null);
      },
    }));
  }, [
    openMenu,
    selectOptions,
    handleLogout,
    activePass,
    shareActivePass,
    cancelActivePass,
    updateField,
  ]);

  const selectedOptionId =
    openMenu?.kind === 'select'
      ? selectOptions[openMenu.key].find((option) => option.id === form[openMenu.key])?.id
      : undefined;

  const renderField = (field: FormFieldConfig, column: number) => {
    const icon = (
      <AppIcon
        set={field.iconSet}
        name={field.iconName}
        size={field.iconSize}
        color={theme.colors.textPrimary}
      />
    );

    if (field.kind === 'select') {
      const key = field.key as SelectKey;
      const value = labelFor(selectOptions[key], form[key]);
      return (
        <Pressable
          key={key}
          ref={(node) => {
            selectRefs.current[key] = node;
          }}
          onPress={() => openSelect(key, column)}
          accessibilityRole="button"
          accessibilityLabel={`${field.label}: ${value || field.placeholder}`}
          accessibilityHint="Opens a list of choices"
          style={({ pressed }) => [styles.gridItem, pressed && styles.pressed]}
        >
          {/* Display only: the whole field is the button, not the input. */}
          <View pointerEvents="none">
            <AppInput
              variant="field"
              height={FIELD_HEIGHT}
              label={field.label}
              value={value}
              onChangeText={() => undefined}
              placeholder={field.placeholder}
              editable={false}
              leftIcon={icon}
              rightIcon={
                <Ionicons
                  name="chevron-down"
                  size={FIELD_CHEVRON_SIZE}
                  color={theme.colors.textPrimary}
                />
              }
              error={errors[key]}
            />
          </View>
        </Pressable>
      );
    }

    const isPhone = field.kind === 'phone';
    return (
      <AppInput
        key={field.key}
        ref={(node) => {
          inputRefs.current[field.key] = node;
        }}
        variant="field"
        height={FIELD_HEIGHT}
        containerStyle={styles.gridItem}
        label={field.label}
        value={form[field.key]}
        onChangeText={(text) => updateField(field.key, text)}
        placeholder={field.placeholder}
        leftIcon={icon}
        error={errors[field.key]}
        keyboardType={isPhone ? 'phone-pad' : 'default'}
        autoCapitalize={field.key === 'plate' ? 'characters' : 'words'}
        autoCorrect={false}
        autoComplete={field.key === 'name' ? 'name' : isPhone ? 'tel' : 'off'}
        textContentType={field.key === 'name' ? 'name' : isPhone ? 'telephoneNumber' : 'none'}
        returnKeyType={field.key === 'name' ? 'next' : 'done'}
        onSubmitEditing={
          field.key === 'name' ? () => inputRefs.current.mobile?.focus() : undefined
        }
        accessibilityLabel={field.label}
      />
    );
  };

  return (
    <ScreenWrapper
      backgroundSource={images.homeBackground}
      withScrim={false}
      backgroundOverlay={0.34}
    >
      <StatusBar style="light" />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={[styles.content, layout.contentStyle]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <PageHeader
            title={copy.title}
            onMenuPress={() => setOpenMenu({ kind: 'header' })}
            style={styles.header}
          />

          <FeatureBanner
            title={copy.bannerTitle}
            body={copy.bannerBody}
            photo={images.visitorHero}
            photoAspect={imageAspects.visitorHero}
            style={styles.card}
          />

          {/*
            The form on the left, what it produces on the right. Cards keep
            their own bottom margins, so the columns add no gap of their own.
          */}
          <ResponsiveColumns gap={0}>
            <>
              <NeonPanel style={[styles.card, styles.form]}>
                <View style={styles.formHeader}>
                  <View style={styles.formIcon}>
                    <Ionicons
                      name="person-add-outline"
                      size={FORM_ICON_SIZE}
                      color={theme.colors.textPrimary}
                    />
                  </View>
                  <View style={styles.formTitle}>
                    <AppText variant="sectionTitle" accessibilityRole="header">
                      {copy.formTitle}
                    </AppText>
                    <AppText
                      variant="statLabel"
                      color={theme.colors.textSupport}
                      style={styles.formSubtitle}
                    >
                      {copy.formSubtitle}
                    </AppText>
                  </View>
                </View>

                <View style={styles.grid}>
                  {fieldRows.map((row) => (
                    <View key={row[0].key} style={styles.gridRow}>
                      {row.map((field, column) => renderField(field, column))}
                    </View>
                  ))}
                </View>

                <FormSubmitButton title={busy ? copy.creating : copy.generate} onPress={handleGenerate} style={styles.cta} />
              </NeonPanel>
            </>

            <>
              {passes.error ? (
                passes.error.code === 'no_home' ? (
                  <Notice tone="info" title={copy.noHomeTitle} style={styles.card}>
                    {copy.noHomeBody}
                  </Notice>
                ) : (
                  <ErrorNotice title={copy.loadFailed} retryLabel={copy.retry} onRetry={passes.reload}>
                    {passes.error.message}
                  </ErrorNotice>
                )
              ) : passes.data && visitors.length === 0 ? (
                <NeonPanel style={[styles.card, styles.list]}>
                  <AppText variant="bodySmall" color={theme.colors.textSecondary}>
                    {copy.noPasses}
                  </AppText>
                </NeonPanel>
              ) : null}

              {activePass ? (
                <VisitorPassCard
                  qrValue={activePass.code}
                  name={activePass.name}
                  schedule={`${activePass.date}${SEPARATOR}${activePass.time}`}
                  guestsLabel={guestsLabel(activePass.guests)}
                  plate={activePass.plate}
                  caption={copy.passCaption}
                  statusLabel={statusDisplay[activePass.status].label}
                  // The active pass is always drawn in teal, whatever its status.
                  statusTone="teal"
                  statusIcon={statusDisplay[activePass.status].icon}
                  onMorePress={({ y, height }) => setOpenMenu({ kind: 'pass', anchor: { y, height } })}
                  style={styles.card}
                />
              ) : null}

              {upcoming.length > 0 ? (
                <NeonPanel style={[styles.card, styles.list]}>
                  <PanelHeading
                    title={copy.upcomingTitle}
                    iconSet="ionicons"
                    iconName="time-outline"
                    actionLabel={
                      hasMoreUpcoming ? (showAllUpcoming ? copy.showLess : copy.viewAll) : undefined
                    }
                    actionExpanded={hasMoreUpcoming ? showAllUpcoming : undefined}
                    onActionPress={() => setShowAllUpcoming((current) => !current)}
                  />

                  <View style={styles.listRows}>
                    {upcoming.map((visitor, index) => (
                      <VisitorRow
                        key={visitor.id}
                        divided={index > 0}
                        name={visitor.name}
                        meta={`${visitor.date}, ${visitor.time}${SEPARATOR}${guestsLabel(visitor.guests)}`}
                        initials={initialsOf(visitor.name)}
                        plate={visitor.plate}
                        statusLabel={statusDisplay[visitor.status].label}
                        statusTone={statusDisplay[visitor.status].tone}
                        onPress={() => setActiveId(visitor.id)}
                      />
                    ))}
                  </View>
                </NeonPanel>
              ) : null}

              {/* "Reserve Guest Parking" goes straight to the booking flow, where the build has parking. */}
              {flags.sampleContent ? (
              <Pressable
                onPress={() => navigation.navigate('ReserveParking', { mode: 'guest' })}
                accessibilityRole="button"
                accessibilityLabel={`${copy.parkingTitle}. ${copy.parkingSubtitle}`}
                style={({ pressed }) => [styles.card, pressed && styles.pressed]}
              >
                <NeonPanel style={styles.parking}>
                  <View style={styles.parkingBadge}>
                    <AppText variant="body">P</AppText>
                  </View>
                  <View style={styles.parkingText}>
                    <AppText variant="statValue">{copy.parkingTitle}</AppText>
                    <AppText variant="tileCaption" color={theme.colors.textSupport}>
                      {copy.parkingSubtitle}
                    </AppText>
                  </View>
                  <Ionicons
                    name="chevron-forward"
                    size={PARKING_CHEVRON_SIZE}
                    color={theme.colors.textPrimary}
                  />
                </NeonPanel>
              </Pressable>
              ) : null}
            </>
          </ResponsiveColumns>
        </ScrollView>

        {/* The same empty glass bar as the home screen, drawn taller here. */}
        <BottomBar />
      </KeyboardAvoidingView>

      <AppMenu
        visible={openMenu !== null}
        onClose={closeMenu}
        items={menuItems}
        align={openMenu?.kind === 'select' ? openMenu.align : 'right'}
        anchor={openMenu && openMenu.kind !== 'header' ? openMenu.anchor : undefined}
        selectedId={selectedOptionId}
      />
    </ScreenWrapper>
  );
}
