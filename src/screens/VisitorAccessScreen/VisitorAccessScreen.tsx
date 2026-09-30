import Ionicons from '@expo/vector-icons/Ionicons';
import { useNavigation } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  View,
  type TextInput,
} from 'react-native';

import { AppButton } from '../../components/common/AppButton';
import { AppIcon } from '../../components/common/AppIcon';
import { AppInput } from '../../components/common/AppInput';
import { AppText } from '../../components/common/AppText';
import { BottomBar } from '../../components/layout/BottomBar';
import { PageHeader } from '../../components/layout/PageHeader';
import { ScreenWrapper } from '../../components/layout/ScreenWrapper';
import { AppMenu, type AppMenuItem } from '../../components/ui/AppMenu';
import { ArrowRightIcon } from '../../components/ui/ArrowRightIcon';
import { FeatureBanner } from '../../components/ui/FeatureBanner';
import { NeonPanel } from '../../components/ui/NeonPanel';
import { PanelHeading } from '../../components/ui/PanelHeading';
import { VisitorPassCard } from '../../components/ui/VisitorPassCard';
import { VisitorRow } from '../../components/ui/VisitorRow';
import { imageAspects, images } from '../../constants/images';
import { useAppTheme } from '../../hooks/useAppTheme';
import type { RootStackScreenProps } from '../../types/navigation.types';
import {
  SEPARATOR,
  UPCOMING_LIMIT,
  dateOptions,
  formFields,
  guestOptions,
  guestsLabel,
  initialForm,
  initialVisitors,
  initialsOf,
  passPayload,
  statusDisplay,
  timeOptions,
  validateForm,
  visitorAccessCopy as copy,
  type FormErrors,
  type FormFieldConfig,
  type FormFieldKey,
  type Option,
  type VisitorForm,
  type VisitorPass,
} from './VisitorAccessScreen.data';
import {
  BOTTOM_BAR_HEIGHT,
  CTA_ARROW_SIZE,
  CTA_HEIGHT,
  FIELD_CHEVRON_SIZE,
  FIELD_HEIGHT,
  FORM_ICON_SIZE,
  PARKING_CHEVRON_SIZE,
  createStyles,
} from './VisitorAccessScreen.styles';

type SelectKey = Extract<FormFieldKey, 'date' | 'time' | 'guests'>;

type MenuAnchor = { y: number; height: number };

/** Which dropdown is open, and the control it hangs from. */
type OpenMenu =
  | { kind: 'header' }
  | { kind: 'pass'; anchor: MenuAnchor }
  | { kind: 'select'; key: SelectKey; anchor: MenuAnchor; align: 'left' | 'right' };

/** Placeholder for links whose destination screens are not designed yet. */
function notYetRouted() {
  // TODO(nav): route to the destination screen once it is designed.
}

/** The fields in the reference's two-column rows. */
const fieldRows: readonly (readonly FormFieldConfig[])[] = Array.from(
  { length: Math.ceil(formFields.length / 2) },
  (_, row) => formFields.slice(row * 2, row * 2 + 2),
);

export function VisitorAccessScreen() {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const navigation = useNavigation<RootStackScreenProps<'VisitorAccess'>['navigation']>();

  const [visitors, setVisitors] = useState<readonly VisitorPass[]>(initialVisitors);
  const [activeId, setActiveId] = useState<string | null>(initialVisitors[0]?.id ?? null);
  const [form, setForm] = useState<VisitorForm>(initialForm);
  const [errors, setErrors] = useState<FormErrors>({});
  const [openMenu, setOpenMenu] = useState<OpenMenu | null>(null);

  const inputRefs = useRef<Partial<Record<FormFieldKey, TextInput | null>>>({});
  const selectRefs = useRef<Partial<Record<SelectKey, View | null>>>({});

  const activePass = visitors.find((visitor) => visitor.id === activeId) ?? null;
  const upcoming = visitors.filter((visitor) => visitor.id !== activeId).slice(0, UPCOMING_LIMIT);

  const selectOptions = useMemo<Record<SelectKey, readonly Option[]>>(
    () => ({ date: dateOptions(), time: timeOptions, guests: guestOptions }),
    [],
  );

  const closeMenu = useCallback(() => setOpenMenu(null), []);

  const updateField = useCallback((key: FormFieldKey, value: string) => {
    setForm((current) => ({ ...current, [key]: value }));
    // Editing a field clears its message; the rest wait for the next submit.
    setErrors((current) => (current[key] ? { ...current, [key]: undefined } : current));
  }, []);

  const openSelect = useCallback((key: SelectKey, column: number) => {
    Keyboard.dismiss();
    selectRefs.current[key]?.measureInWindow((_x, y, _width, height) => {
      setOpenMenu({
        kind: 'select',
        key,
        anchor: { y, height },
        align: column === 0 ? 'left' : 'right',
      });
    });
  }, []);

  const handleLogout = useCallback(() => {
    setOpenMenu(null);
    // Frontend only, as on Home: there is no session to clear yet.
    // TODO(auth): clear the stored session here once one exists.
    navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
  }, [navigation]);

  const cancelActivePass = useCallback(() => {
    setOpenMenu(null);
    const remaining = visitors.filter((visitor) => visitor.id !== activeId);
    setVisitors(remaining);
    // Brings the next visitor forward, so the card is never left blank while
    // anyone is still expected.
    setActiveId(remaining[0]?.id ?? null);
  }, [visitors, activeId]);

  const handleGenerate = useCallback(() => {
    Keyboard.dismiss();
    const found = validateForm(form);
    if (Object.keys(found).length > 0) {
      setErrors(found);
      return;
    }

    // Frontend only: the pass lives in this screen's state until a backend
    // issues real ones.
    const pass: VisitorPass = {
      id: `visitor-${Date.now()}`,
      name: form.name.trim(),
      mobile: form.mobile.trim(),
      date: form.date,
      time: form.time,
      guests: Number.parseInt(form.guests, 10) || 1,
      plate: form.plate.trim().toUpperCase(),
      status: 'scheduled',
    };
    setVisitors((current) => [pass, ...current]);
    setActiveId(pass.id);
    setForm(initialForm);
    setErrors({});
    AccessibilityInfo.announceForAccessibility(`QR pass created for ${pass.name}`);
  }, [form]);

  const menuItems = useMemo<readonly AppMenuItem[]>(() => {
    if (!openMenu) {
      return [];
    }
    if (openMenu.kind === 'header') {
      return [{ id: 'logout', label: 'Log out', icon: 'log-out-outline', onPress: handleLogout }];
    }
    if (openMenu.kind === 'pass') {
      return [
        { id: 'cancel', label: 'Cancel pass', icon: 'close-circle-outline', onPress: cancelActivePass },
      ];
    }
    const { key } = openMenu;
    return selectOptions[key].map((option) => ({
      id: option.id,
      label: option.label,
      onPress: () => {
        updateField(key, option.label);
        setOpenMenu(null);
      },
    }));
  }, [openMenu, selectOptions, handleLogout, cancelActivePass, updateField]);

  const selectedOptionId =
    openMenu?.kind === 'select'
      ? selectOptions[openMenu.key].find((option) => option.label === form[openMenu.key])?.id
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
      const value = form[key];
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
          contentContainerStyle={styles.content}
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

            <AppButton
              title={copy.generate}
              variant="gradient"
              gradientColors={[
                theme.colors.ctaSky,
                theme.colors.ctaRoyal,
                theme.colors.ctaViolet,
                theme.colors.ctaPink,
              ]}
              height={CTA_HEIGHT}
              labelVariant="statValue"
              trailingIcon={<ArrowRightIcon size={CTA_ARROW_SIZE} thickness={1.2} />}
              trailingPlacement="label"
              onPress={handleGenerate}
              style={styles.cta}
            />
          </NeonPanel>

          {activePass ? (
            <VisitorPassCard
              qrValue={passPayload(activePass)}
              name={activePass.name}
              schedule={`${activePass.date}${SEPARATOR}${activePass.time}`}
              guestsLabel={guestsLabel(activePass.guests)}
              plate={activePass.plate}
              caption={copy.passCaption}
              statusLabel={statusDisplay[activePass.status].label}
              // The active pass is always drawn in teal, whatever its status.
              statusTone="teal"
              statusIcon={statusDisplay[activePass.status].icon}
              // Only a visit that has not happened yet can be cancelled.
              onMorePress={
                activePass.status === 'scheduled'
                  ? ({ y, height }) => setOpenMenu({ kind: 'pass', anchor: { y, height } })
                  : undefined
              }
              style={styles.card}
            />
          ) : null}

          {upcoming.length > 0 ? (
            <NeonPanel style={[styles.card, styles.list]}>
              <PanelHeading
                title={copy.upcomingTitle}
                iconSet="ionicons"
                iconName="time-outline"
                actionLabel={copy.viewAll}
                onActionPress={notYetRouted}
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

          <Pressable
            onPress={notYetRouted}
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
        </ScrollView>

        {/* The same empty glass bar as the home screen, drawn taller here. */}
        <BottomBar height={BOTTOM_BAR_HEIGHT} style={styles.bottomBar} />
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
