import Ionicons from '@expo/vector-icons/Ionicons';
import { useRoute } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { useMemo, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';

import { AppButton } from '../../components/common/AppButton';
import { AppText } from '../../components/common/AppText';
import { ToggleSwitch } from '../../components/common/ToggleSwitch';
import { EmsAccountPanel } from '../../components/ems/EmsAccountPanel';
import { BottomBar } from '../../components/layout/BottomBar';
import { PageHeader } from '../../components/layout/PageHeader';
import { ResponsiveColumns } from '../../components/layout/ResponsiveColumns';
import { ScreenWrapper } from '../../components/layout/ScreenWrapper';
import { Notice } from '../../components/parking/Notice';
import { NeonPanel } from '../../components/ui/NeonPanel';
import { PanelHeading } from '../../components/ui/PanelHeading';
import { ProgressBar } from '../../components/ui/ProgressBar';
import { StatusChip, type StatusTone } from '../../components/ui/StatusChip';
import { images } from '../../constants/images';
import { useAcControls } from '../../hooks/useAcControls';
import { useAppTheme } from '../../hooks/useAppTheme';
import { useEmsDevices } from '../../hooks/useEmsDevices';
import { useScreenLayout } from '../../hooks/useScreenLayout';
import type { ControlSetting, ControlValue } from '../../types/ems.types';
import type { RootStackScreenProps } from '../../types/navigation.types';
import {
  STEPPER_DEBOUNCE_MS,
  TIMER_STEP_HOURS,
  acCopy as copy,
  actionLabels,
  airflowLabel,
  airflowOrder,
  climateKeys,
  fanOrder,
  featureIcons,
  filterKeys,
  formatHours,
  formatReading,
  humanize,
  modeChoices,
  summaryKeys,
  timerIcons,
} from './AcControlScreen.data';
import { CARD_GAP, FILTER_BAR_HEIGHT, SMALL_BUTTON_HEIGHT, STEP_ICON_SIZE, createStyles } from './AcControlScreen.styles';
import { ChoiceChips, ErrorLine, ReadingRow, StepperRow, SwitchRow } from './AcSettingRows';

const ACTION_TONES: Record<string, StatusTone> = {
  cooling: 'indigo',
  heating: 'amber',
  drying: 'teal',
  fan: 'violet',
};

/** One step from `value` on the grid `min + n * step`, or null past the range; off-grid values snap first. */
function stepFrom(value: number, setting: ControlSetting, direction: 1 | -1, step = setting.step ?? 1): number | null {
  const min = setting.min ?? 0;
  const max = setting.max ?? 0;
  const position = (value - min) / step;
  const index = direction === 1 ? Math.floor(position + 1e-6) + 1 : Math.ceil(position - 1e-6) - 1;
  const next = Math.round((min + index * step) * 1e4) / 1e4;
  return next < min || next > max ? null : next;
}

const degrees = (value: number) => (Number.isInteger(value) ? String(value) : value.toFixed(1));

function formatDate(value: ControlValue): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
}

const isTimer = (setting: ControlSetting) => setting.kind === 'number' && setting.unit === 'h';

/**
 * Everything an EMS air conditioner announces beyond power: mode, set point,
 * fan speed, both airflow directions, its features (Jet, Air purify, Energy
 * saving…), timers, filter hours, and readings. Only what this model supports
 * is shown, from what the backend reads off the AC.
 *
 * Each change shows at once as asked for, then as the AC confirmed it; the
 * same values arrive live when someone uses the remote. Settings the AC would
 * ignore right now (the mode while it is off, Jet outside Cooling) are dimmed
 * and say what they need.
 */
export function AcControlScreen() {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const layout = useScreenLayout();
  const { deviceId } = useRoute<RootStackScreenProps<'AcControl'>['route']>().params;
  const ems = useEmsDevices();
  const ac = useAcControls(deviceId);
  const [showDetails, setShowDetails] = useState(false);
  const [confirmFilter, setConfirmFilter] = useState(false);

  const device = ems.devices.find((entry) => entry.id === deviceId) ?? null;
  const controls = ac.controls;
  const settings = controls?.settings ?? [];
  const byKey = new Map(settings.map((setting) => [setting.key, setting]));
  const shown = (setting: ControlSetting): ControlValue =>
    setting.key in ac.pending ? ac.pending[setting.key] : setting.value;
  const isPending = (key: string) => key in ac.pending;

  const placed = new Set([...climateKeys, ...filterKeys, ...summaryKeys]);
  const rest = settings.filter((setting) => !placed.has(setting.key));
  const features = rest.filter((setting) => setting.kind !== 'sensor' && !isTimer(setting));
  const timers = rest.filter(isTimer);
  const readings = rest.filter((setting) => setting.kind === 'sensor');

  const mode = byKey.get('mode');
  const temperature = byKey.get('temperature');
  const fan = byKey.get('fan_mode');
  const swingVertical = byKey.get('swing_mode');
  const swingHorizontal = byKey.get('swing_horizontal_mode');

  // ---- Summary --------------------------------------------------------------------------

  const powerPending = device ? ems.busy[device.id] === 'power' || device.pendingPower !== null : false;
  const poweredOn = device ? (device.pendingPower ?? device.power) === 'on' : controls?.power === 'on';
  const action = controls?.action ? (actionLabels[controls.action] ?? humanize(controls.action)) : null;
  const fault = byKey.get('error')?.value;
  const hasFault = fault !== null && fault !== undefined && fault !== 0 && fault !== '0' && fault !== false;
  const drawing = byKey.get('energy_current');

  const setPoint = temperature ? shown(temperature) : null;
  const changeTemperature = (direction: 1 | -1) => {
    if (temperature && typeof setPoint === 'number') {
      const next = stepFrom(setPoint, temperature, direction);
      if (next !== null) {
        ac.set('temperature', next, STEPPER_DEBOUNCE_MS);
      }
    }
  };
  const temperatureStep = (direction: 1 | -1) => {
    const disabled =
      !temperature?.available || typeof setPoint !== 'number' || stepFrom(setPoint, temperature, direction) === null;
    return (
      <Pressable
        onPress={() => changeTemperature(direction)}
        disabled={disabled}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={direction === 1 ? copy.raise : copy.lower}
        accessibilityState={{ disabled }}
        style={({ pressed }) => [
          styles.stepButton,
          direction === 1 ? styles.stepWarm : styles.stepCool,
          pressed && styles.pressed,
          disabled && styles.dim,
        ]}
      >
        <Ionicons name={direction === 1 ? 'add' : 'remove'} size={STEP_ICON_SIZE} color={theme.colors.textPrimary} />
      </Pressable>
    );
  };

  const summaryReadings = [
    controls?.currentTemperature !== null && controls?.currentTemperature !== undefined
      ? `${copy.room} ${degrees(controls.currentTemperature)}${temperature?.unit ?? '°C'}`
      : null,
    controls?.currentHumidity !== null && controls?.currentHumidity !== undefined
      ? `${copy.humidity} ${Math.round(controls.currentHumidity)}%`
      : null,
    drawing && typeof drawing.value === 'number' ? `${copy.drawing} ${formatReading(drawing.value, drawing.unit)}` : null,
  ].filter((entry): entry is string => entry !== null);

  const summary = controls ? (
    <NeonPanel style={styles.panel}>
      <View style={styles.heroTop}>
        <View style={styles.chips}>
          <StatusChip label={controls.online ? 'Online' : 'Offline'} tone={controls.online ? 'teal' : 'red'} />
          {action ? <StatusChip label={action} tone={ACTION_TONES[controls.action ?? ''] ?? 'slate'} /> : null}
          {hasFault ? <StatusChip label={copy.fault(String(fault))} tone="red" icon="warning-outline" /> : null}
        </View>
        <View style={styles.inline}>
          {powerPending ? <ActivityIndicator size="small" color={theme.colors.textAccentSoft} /> : null}
          <ToggleSwitch
            value={poweredOn}
            onValueChange={(on) => device && void ems.setPower(device, on)}
            disabled={!device || powerPending}
            accessibilityLabel={`${copy.power}: ${device?.name ?? copy.fallbackTitle}`}
          />
        </View>
      </View>

      {temperature ? (
        <View style={styles.setPointRow}>
          {temperatureStep(-1)}
          <AppText
            variant="heroTitle"
            align="center"
            style={[styles.setPoint, !temperature.available && styles.dim]}
            accessibilityLiveRegion="polite"
            accessibilityLabel={typeof setPoint === 'number' ? `${degrees(setPoint)} degrees` : undefined}
          >
            {typeof setPoint === 'number' ? `${degrees(setPoint)}${temperature.unit ?? ''}` : '—'}
          </AppText>
          {temperatureStep(1)}
        </View>
      ) : null}

      {summaryReadings.length > 0 ? (
        <View style={styles.readings}>
          {summaryReadings.map((reading) => (
            <AppText key={reading} variant="tileCaption" color={theme.colors.textSupport}>
              {reading}
            </AppText>
          ))}
        </View>
      ) : null}

      {!controls.online ? (
        <AppText variant="tileCaption" color={theme.colors.textAccentSoft} align="center">
          {copy.offline}
        </AppText>
      ) : controls.power !== 'on' ? (
        <AppText variant="tileCaption" color={theme.colors.textAccentSoft} align="center">
          {copy.turnOnHint}
        </AppText>
      ) : null}
      <ErrorLine error={(device && ems.errors[device.id]) || ac.errors.temperature} />
    </NeonPanel>
  ) : null;

  // ---- Mode, fan and airflow ----------------------------------------------------------

  const modePanel = mode ? (
    <NeonPanel style={styles.panel}>
      <PanelHeading title={copy.modeTitle} iconSet="material" iconName="tune-variant" divider />
      <ChoiceChips
        options={mode.options ?? []}
        selected={shown(mode)}
        disabled={!mode.available || isPending('mode')}
        onSelect={(option) => ac.set('mode', option)}
        choice={(option) => modeChoices[option] ?? { label: humanize(option), iconSet: 'material', iconName: 'tune-variant' }}
      />
      <ErrorLine error={ac.errors.mode} />
    </NeonPanel>
  ) : null;

  const airflowGroup = (setting: ControlSetting | undefined, label: string, iconName: string, order: (options: string[]) => string[]) =>
    setting ? (
      <View style={styles.group}>
        <AppText variant="statLabel" color={theme.colors.textSupport}>
          {label}
        </AppText>
        <ChoiceChips
          options={order(setting.options ?? [])}
          selected={shown(setting)}
          disabled={!setting.available || isPending(setting.key)}
          onSelect={(option) => ac.set(setting.key, option)}
          choice={(option) => ({
            label: setting.key === 'fan_mode' ? humanize(option) : airflowLabel(option),
            iconSet: 'material',
            iconName,
          })}
        />
        <ErrorLine error={ac.errors[setting.key]} />
      </View>
    ) : null;

  const byFanOrder = (options: string[]) =>
    [...options].sort((a, b) => (fanOrder.indexOf(a) + 1 || 99) - (fanOrder.indexOf(b) + 1 || 99));

  const airflowPanel =
    fan || swingVertical || swingHorizontal ? (
      <NeonPanel style={styles.panel}>
        <PanelHeading title={copy.airflowTitle} iconSet="material" iconName="fan" divider />
        {airflowGroup(fan, copy.fanTitle, 'fan', byFanOrder)}
        {airflowGroup(swingVertical, copy.verticalAirflow, 'arrow-up-down', airflowOrder)}
        {airflowGroup(swingHorizontal, copy.horizontalAirflow, 'arrow-left-right', airflowOrder)}
      </NeonPanel>
    ) : null;

  // ---- Features and timers -------------------------------------------------------------

  const featureRow = (setting: ControlSetting, index: number) => {
    const divider = index > 0;
    const iconName = featureIcons[setting.key] ?? 'tune-variant';
    const value = shown(setting);
    if (setting.kind === 'switch') {
      return (
        <SwitchRow
          key={setting.key}
          setting={setting}
          value={value}
          pending={isPending(setting.key)}
          error={ac.errors[setting.key]}
          iconName={iconName}
          divider={divider}
          onChange={(next) => ac.set(setting.key, next)}
        />
      );
    }
    if (setting.kind === 'select') {
      return (
        <View key={setting.key} style={[styles.group, divider && styles.rowDivider]}>
          <AppText variant="statValue">{setting.name}</AppText>
          <ChoiceChips
            options={setting.options ?? []}
            selected={value}
            disabled={!setting.available || isPending(setting.key)}
            onSelect={(option) => ac.set(setting.key, option)}
            choice={(option) => ({ label: humanize(option), iconSet: 'material', iconName })}
          />
          {!setting.available && setting.requires ? (
            <AppText variant="tileCaption" color={theme.colors.textAccentSoft}>
              {copy.needs(setting.requires)}
            </AppText>
          ) : null}
          <ErrorLine error={ac.errors[setting.key]} />
        </View>
      );
    }
    if (setting.kind === 'number') {
      const current = typeof value === 'number' ? value : (setting.min ?? 0);
      return (
        <StepperRow
          key={setting.key}
          setting={setting}
          shown={formatReading(current, setting.unit)}
          pending={isPending(setting.key)}
          error={ac.errors[setting.key]}
          iconName={iconName}
          divider={divider}
          lower={stepFrom(current, setting, -1)}
          higher={stepFrom(current, setting, 1)}
          onChange={(next) => ac.set(setting.key, next, STEPPER_DEBOUNCE_MS)}
        />
      );
    }
    return (
      <View key={setting.key} style={[styles.group, divider && styles.rowDivider]}>
        <AppButton
          title={setting.name}
          variant="secondary"
          height={SMALL_BUTTON_HEIGHT}
          loading={isPending(setting.key)}
          disabled={!setting.available}
          onPress={() => ac.set(setting.key, null)}
        />
        <ErrorLine error={ac.errors[setting.key]} />
      </View>
    );
  };

  const featuresPanel =
    features.length > 0 ? (
      <NeonPanel style={styles.panel}>
        <PanelHeading title={copy.featuresTitle} iconSet="material" iconName="star-four-points-outline" divider />
        {features.map(featureRow)}
      </NeonPanel>
    ) : null;

  const timersPanel =
    timers.length > 0 ? (
      <NeonPanel style={styles.panel}>
        <PanelHeading title={copy.timersTitle} iconSet="material" iconName="timer-outline" divider />
        {timers.map((setting, index) => {
          const value = shown(setting);
          const hours = typeof value === 'number' ? value : 0;
          const step = Math.max(setting.step ?? TIMER_STEP_HOURS, TIMER_STEP_HOURS);
          return (
            <StepperRow
              key={setting.key}
              setting={setting}
              shown={hours > 0 ? formatHours(hours) : copy.timerOff}
              pending={isPending(setting.key)}
              error={ac.errors[setting.key]}
              iconName={timerIcons[setting.key] ?? 'timer-outline'}
              divider={index > 0}
              lower={hours > 0 ? stepFrom(hours, setting, -1, step) : null}
              higher={stepFrom(hours, setting, 1, step)}
              onChange={(next) => ac.set(setting.key, next, STEPPER_DEBOUNCE_MS)}
            />
          );
        })}
      </NeonPanel>
    ) : null;

  // ---- Filter and readings --------------------------------------------------------------

  const filterUsed = byKey.get('filterused');
  const filterLife = byKey.get('filterlife');
  const filterReset = byKey.get('filterreset');
  const usedHours = typeof filterUsed?.value === 'number' ? filterUsed.value : null;
  const lifeHours = typeof filterLife?.value === 'number' && filterLife.value > 0 ? filterLife.value : null;
  const lastCleaned = formatDate(byKey.get('changeddate')?.value ?? null);

  const filterPanel =
    filterUsed || filterReset ? (
      <NeonPanel style={styles.panel}>
        <PanelHeading title={copy.filterTitle} iconSet="material" iconName="air-filter" divider />
        {usedHours !== null ? (
          <View style={styles.group}>
            <AppText variant="statValue">{copy.filterUsage(usedHours, lifeHours)}</AppText>
            {lifeHours ? (
              <ProgressBar
                progress={usedHours / lifeHours}
                height={FILTER_BAR_HEIGHT}
                accessibilityLabel={copy.filterUsage(usedHours, lifeHours)}
              />
            ) : null}
            <AppText variant="tileCaption" color={theme.colors.textSupport}>
              {copy.filterHours}
            </AppText>
            {lifeHours && usedHours >= lifeHours ? (
              <AppText variant="tileCaption" color={theme.colors.warning}>
                {copy.filterDue}
              </AppText>
            ) : null}
          </View>
        ) : null}
        {byKey.has('changeddate') ? (
          <ReadingRow label={copy.filterLastCleaned} value={lastCleaned ?? copy.filterNever} />
        ) : null}
        {filterReset ? (
          <>
            <AppButton
              title={confirmFilter ? copy.filterConfirm : copy.filterReset}
              variant="secondary"
              height={SMALL_BUTTON_HEIGHT}
              loading={isPending('filterreset')}
              disabled={!filterReset.available}
              onPress={() => {
                if (!confirmFilter) {
                  setConfirmFilter(true);
                  return;
                }
                setConfirmFilter(false);
                ac.set('filterreset', null);
              }}
            />
            <ErrorLine error={ac.errors.filterreset} />
          </>
        ) : null}
      </NeonPanel>
    ) : null;

  const detailsPanel =
    readings.length > 0 ? (
      <NeonPanel style={styles.panel}>
        <PanelHeading
          title={copy.detailsTitle}
          iconSet="material"
          iconName="gauge"
          actionLabel={showDetails ? copy.hide : copy.show}
          actionExpanded={showDetails}
          onActionPress={() => setShowDetails((current) => !current)}
          divider={showDetails}
        />
        {showDetails
          ? readings.map((setting) => (
              <ReadingRow key={setting.key} label={setting.name} value={formatReading(setting.value, setting.unit)} />
            ))
          : null}
      </NeonPanel>
    ) : null;

  // ---- Page -------------------------------------------------------------------------------

  let body: ReactNode;
  if (ems.status !== 'signedIn') {
    body = <EmsAccountPanel intro={copy.accountIntro} />;
  } else if (ems.devicesLoaded && !device) {
    body = <Notice tone="error" title={copy.notFound} />;
  } else if (!controls) {
    body = ac.loadError ? (
      <Notice
        tone="error"
        title={copy.loadFailed}
        actions={
          <AppButton title={copy.retry} variant="secondary" height={SMALL_BUTTON_HEIGHT} onPress={() => void ac.reload()} />
        }
      >
        {ac.loadError}
      </Notice>
    ) : (
      <View style={styles.inline}>
        <ActivityIndicator color={theme.colors.textPrimary} />
        <AppText variant="tileCaption" color={theme.colors.textSupport}>
          {copy.loading}
        </AppText>
      </View>
    );
  } else {
    body = (
      <ResponsiveColumns gap={CARD_GAP}>
        <>
          {summary}
          {modePanel}
          {airflowPanel}
        </>
        <>
          {featuresPanel}
          {timersPanel}
          {filterPanel}
          {detailsPanel}
        </>
      </ResponsiveColumns>
    );
  }

  return (
    <ScreenWrapper backgroundSource={images.homeBackground} withScrim={false} backgroundOverlay={0.34}>
      <StatusBar style="light" />
      <View style={styles.flex}>
        <ScrollView contentContainerStyle={[styles.content, layout.contentStyle]} showsVerticalScrollIndicator={false}>
          <PageHeader title={device?.name ?? copy.fallbackTitle} subtitle={copy.subtitle} style={styles.header} />
          {body}
        </ScrollView>
        <BottomBar />
      </View>
    </ScreenWrapper>
  );
}
