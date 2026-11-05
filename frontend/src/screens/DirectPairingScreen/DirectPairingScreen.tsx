import { useNavigation } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Linking, Platform, ScrollView, View } from 'react-native';

import { AppButton } from '../../components/common/AppButton';
import { AppInput } from '../../components/common/AppInput';
import { AppText } from '../../components/common/AppText';
import { EmsAccountPanel } from '../../features/ems/components/EmsAccountPanel';
import { BottomBar } from '../../components/layout/BottomBar';
import { PageHeader } from '../../components/layout/PageHeader';
import { ScreenWrapper } from '../../components/layout/ScreenWrapper';
import { Notice } from '../../components/feedback/Notice';
import { FilterChip } from '../../components/ui/FilterChip';
import { NeonPanel } from '../../components/ui/NeonPanel';
import { PanelHeading } from '../../components/ui/PanelHeading';
import { images } from '../../constants/images';
import { useAppTheme } from '../../hooks/useAppTheme';
import { useEms } from '../../features/ems/hooks/useEms';
import { useScreenLayout } from '../../hooks/useScreenLayout';
import * as directApi from '../../features/direct/services/directApi';
import { configurePlug, probePlug, TasmotaSetupError, wifiProblem, type TasmotaInfo } from '../../features/direct/services/tasmotaSetup';
import { EmsError } from '../../features/ems/services/emsApi';
import type { Device, DirectKind, DirectPairing } from '../../types/home.types';
import type { RootStackScreenProps } from '../../types/navigation.types';
import { kindOptions, pairingCopy as copy, setupErrors, wifiErrors } from './DirectPairingScreen.data';
import { BUTTON_HEIGHT, FIELD_HEIGHT, createStyles } from './DirectPairingScreen.styles';

type Step = 'details' | 'join' | 'wifi' | 'waiting' | 'done';

const STEP_NUMBERS: Record<Exclude<Step, 'done'>, number> = { details: 1, join: 2, wifi: 3, waiting: 4 };
const STEP_COUNT = 4;
/** How often the backend is asked whether the plug has connected. */
const POLL_MS = 3_000;
/** After this long without the plug, the screen says what usually goes wrong. */
const SLOW_AFTER_MS = 2 * 60_000;

const messageOf = (error: unknown) => (error instanceof EmsError ? error.message : copy.failed);

/**
 * Adding a direct device: a Tasmota plug that connects to the EMS backend
 * itself, from any network, with no hub. The backend issues the plug's own
 * login (shown here once); the app hands it to the plug on the plug's setup
 * hotspot together with the home Wi-Fi; then the plug restarts, connects, and
 * appears in Smart Home's Direct mode.
 */
export function DirectPairingScreen() {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const layout = useScreenLayout();
  const navigation = useNavigation<RootStackScreenProps<'DirectPairing'>['navigation']>();
  const { status, directProblem, refreshHome, upsertDirectDevice, setHomeMode } = useEms();
  const [step, setStep] = useState<Step>('details');
  const [name, setName] = useState('');
  const [kind, setKind] = useState<DirectKind>('plug');
  const [pairing, setPairing] = useState<DirectPairing | null>(null);
  const [plug, setPlug] = useState<TasmotaInfo | null>(null);
  const [ssid, setSsid] = useState('');
  const [wifiPassword, setWifiPassword] = useState('');
  const [manual, setManual] = useState(false);
  const [device, setDevice] = useState<Device | null>(null);
  const [slow, setSlow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Until the plug has connected. Requests fail while the phone is still on the plug's hotspot; the next one goes on.
  useEffect(() => {
    if (step !== 'waiting' || !pairing) {
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const started = Date.now();
    const tick = async () => {
      try {
        const result = await directApi.getPairing(pairing.deviceId);
        if (cancelled) return;
        if (result.status === 'connected' && result.device) {
          upsertDirectDevice(result.device);
          setDevice(result.device);
          setStep('done');
          return;
        }
        if (result.status === 'expired') {
          setPairing(null);
          setError(copy.expired);
          setStep('details');
          return;
        }
      } catch {
        // Not back on the home Wi-Fi yet.
      }
      if (!cancelled) {
        setSlow(Date.now() - started > SLOW_AFTER_MS);
        timer = setTimeout(() => void tick(), POLL_MS);
      }
    };
    timer = setTimeout(() => void tick(), POLL_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [step, pairing, upsertDirectDevice]);

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
    } finally {
      setBusy(false);
    }
  };

  const start = () =>
    run(async () => {
      if (!name.trim()) {
        setError(copy.nameRequired);
        return;
      }
      try {
        setPairing(await directApi.createPairing(name.trim(), kind));
        setStep('join');
      } catch (caught) {
        setError(messageOf(caught));
      }
    });

  const findPlug = () =>
    run(async () => {
      try {
        setPlug(await probePlug());
        setStep('wifi');
      } catch (caught) {
        setError(caught instanceof TasmotaSetupError ? setupErrors[caught.code] : copy.failed);
      }
    });

  const send = () =>
    run(async () => {
      if (!pairing) return;
      const wifi = { ssid, password: wifiPassword };
      const problem = wifiProblem(wifi);
      if (problem) {
        setError(wifiErrors[problem]);
        return;
      }
      try {
        await configurePlug(pairing, wifi);
        setStep('waiting');
      } catch (caught) {
        setError(caught instanceof TasmotaSetupError ? setupErrors[caught.code] : copy.failed);
      }
    });

  const startOver = () => {
    // An unused pairing would otherwise wait out its half hour.
    if (pairing && step !== 'done') {
      void directApi.removeDevice(pairing.deviceId).catch(() => undefined);
    }
    setPairing(null);
    setPlug(null);
    setManual(false);
    setSlow(false);
    setError(null);
    setStep('details');
  };

  const finish = (open: boolean) => {
    setHomeMode('direct');
    if (open && device) {
      navigation.replace('DeviceDetail', { deviceId: device.id, mode: 'direct' });
    } else if (navigation.canGoBack()) {
      navigation.goBack();
    } else {
      navigation.navigate('SmartHome');
    }
  };

  const stepLine = (current: Step) =>
    current === 'done' ? null : (
      <AppText variant="tileCaption" color={theme.colors.textSupport}>
        {copy.step(STEP_NUMBERS[current], STEP_COUNT)}
      </AppText>
    );

  const errorNotice = error ? <Notice tone="error">{error}</Notice> : null;
  const startOverButton = <AppButton title={copy.startOver} variant="secondary" height={BUTTON_HEIGHT} onPress={startOver} disabled={busy} />;

  const renderStep = () => {
    switch (step) {
      case 'details':
        return (
          <NeonPanel style={styles.panel}>
            <PanelHeading title={copy.detailsTitle} iconSet="ionicons" iconName="flash-outline" divider />
            {stepLine(step)}
            <AppText variant="bodySmall" color={theme.colors.textSupport}>
              {copy.detailsIntro}
            </AppText>
            <AppInput
              variant="field"
              label={copy.name}
              placeholder={copy.namePlaceholder}
              value={name}
              onChangeText={setName}
              maxLength={64}
              height={FIELD_HEIGHT}
            />
            <AppText variant="statLabel" color={theme.colors.textSupport}>
              {copy.kindLabel}
            </AppText>
            <View style={styles.chips} accessibilityRole="radiogroup">
              {kindOptions.map((option) => (
                <FilterChip
                  key={option.id}
                  role="radio"
                  label={option.label}
                  iconSet={option.iconSet}
                  iconName={option.iconName}
                  selected={kind === option.id}
                  onPress={() => setKind(option.id)}
                />
              ))}
            </View>
            <Notice tone="info">{copy.firmwareNote}</Notice>
            {errorNotice}
            <AppButton title={copy.continue} variant="gradient" height={BUTTON_HEIGHT} loading={busy} disabled={busy} onPress={() => void start()} />
          </NeonPanel>
        );

      case 'join':
        return (
          <NeonPanel style={styles.panel}>
            <PanelHeading title={copy.joinTitle} iconSet="ionicons" iconName="wifi-outline" divider />
            {stepLine(step)}
            <View style={styles.steps}>
              {copy.joinSteps.map((line, index) => (
                <View key={line} style={styles.stepRow}>
                  <AppText variant="bodySmall" style={styles.stepNumber}>
                    {`${index + 1}.`}
                  </AppText>
                  <AppText variant="bodySmall" style={styles.flex}>
                    {line}
                  </AppText>
                </View>
              ))}
            </View>
            <AppText variant="tileCaption" color={theme.colors.textSupport}>
              {copy.joinReset}
            </AppText>
            {Platform.OS === 'android' ? (
              <AppButton
                title={copy.openWifiSettings}
                variant="secondary"
                height={BUTTON_HEIGHT}
                onPress={() => void Linking.sendIntent('android.settings.WIFI_SETTINGS').catch(() => Linking.openSettings())}
              />
            ) : null}
            {errorNotice}
            <AppButton title={copy.joined} variant="gradient" height={BUTTON_HEIGHT} loading={busy} disabled={busy} onPress={() => void findPlug()} />
            {startOverButton}
          </NeonPanel>
        );

      case 'wifi': {
        const mqtt = pairing?.mqtt;
        return (
          <NeonPanel style={styles.panel}>
            <PanelHeading title={copy.wifiTitle} iconSet="ionicons" iconName="home-outline" divider />
            {stepLine(step)}
            {plug ? <Notice tone="success">{copy.found(plug.deviceName, plug.firmware)}</Notice> : null}
            {mqtt?.tls && plug && !plug.tlsBuild ? <Notice tone="warning">{copy.tlsWarning}</Notice> : null}
            {manual && mqtt ? (
              <>
                <AppText variant="bodySmall" color={theme.colors.textSupport}>
                  {copy.manualIntro}
                </AppText>
                {(
                  [
                    [copy.manualRows.host, mqtt.host],
                    [copy.manualRows.port, String(mqtt.port)],
                    [copy.manualRows.user, mqtt.username],
                    [copy.manualRows.password, mqtt.password],
                    [copy.manualRows.topic, mqtt.topic],
                    [copy.manualRows.tls, mqtt.tls ? copy.on : copy.off],
                  ] as const
                ).map(([label, value]) => (
                  <View key={label} style={styles.settingRow}>
                    <AppText variant="tileCaption" color={theme.colors.textSupport}>
                      {label}
                    </AppText>
                    <AppText variant="tileCaption" selectable style={styles.settingValue}>
                      {value}
                    </AppText>
                  </View>
                ))}
                <AppButton title={copy.manualDone} variant="gradient" height={BUTTON_HEIGHT} onPress={() => setStep('waiting')} />
              </>
            ) : (
              <>
                <AppText variant="bodySmall" color={theme.colors.textSupport}>
                  {copy.wifiIntro}
                </AppText>
                <AppInput
                  variant="field"
                  label={copy.ssid}
                  value={ssid}
                  onChangeText={setSsid}
                  autoCapitalize="none"
                  autoCorrect={false}
                  height={FIELD_HEIGHT}
                />
                <AppInput
                  variant="field"
                  label={copy.wifiPassword}
                  value={wifiPassword}
                  onChangeText={setWifiPassword}
                  secureTextEntry
                  autoCapitalize="none"
                  autoCorrect={false}
                  height={FIELD_HEIGHT}
                />
                <AppText variant="tileCaption" color={theme.colors.textSupport}>
                  {copy.band}
                </AppText>
                {errorNotice}
                <AppButton title={copy.send} variant="gradient" height={BUTTON_HEIGHT} loading={busy} disabled={busy} onPress={() => void send()} />
              </>
            )}
            <AppButton
              title={manual ? copy.autoToggle : copy.manualToggle}
              variant="secondary"
              height={BUTTON_HEIGHT}
              onPress={() => setManual((current) => !current)}
            />
            {startOverButton}
          </NeonPanel>
        );
      }

      case 'waiting':
        return (
          <NeonPanel style={styles.panel}>
            <PanelHeading title={copy.waitingTitle} iconSet="ionicons" iconName="cloud-upload-outline" divider />
            {stepLine(step)}
            <View style={styles.center}>
              <ActivityIndicator color={theme.colors.textPrimary} />
              <AppText variant="bodySmall" color={theme.colors.textSupport}>
                {copy.waitingBody}
              </AppText>
            </View>
            {slow ? (
              <Notice tone="warning" title={copy.slowTitle}>
                {copy.slowTips.join('\n')}
              </Notice>
            ) : null}
            {startOverButton}
          </NeonPanel>
        );

      case 'done':
        return (
          <NeonPanel style={styles.panel}>
            <PanelHeading title={copy.doneTitle} iconSet="ionicons" iconName="checkmark-circle-outline" divider />
            <Notice tone="success">{copy.doneBody(device?.name ?? name)}</Notice>
            <AppButton title={copy.openDevice} variant="gradient" height={BUTTON_HEIGHT} onPress={() => finish(true)} />
            <AppButton title={copy.done} variant="secondary" height={BUTTON_HEIGHT} onPress={() => finish(false)} />
          </NeonPanel>
        );
    }
  };

  const renderBody = () => {
    if (status !== 'signedIn') {
      return <EmsAccountPanel intro={copy.accountIntro} />;
    }
    if (Platform.OS === 'web') {
      return (
        <Notice tone="info" title={copy.webTitle}>
          {copy.webBody}
        </Notice>
      );
    }
    if (directProblem && step === 'details') {
      const noHome = directProblem.code === 'no_home';
      return (
        <Notice
          tone={noHome ? 'info' : 'error'}
          title={noHome ? copy.noHomeTitle : undefined}
          actions={
            noHome ? undefined : <AppButton title={copy.retry} variant="secondary" height={BUTTON_HEIGHT} onPress={() => void refreshHome()} />
          }
        >
          {directProblem.message}
        </Notice>
      );
    }
    return renderStep();
  };

  return (
    <ScreenWrapper backgroundSource={images.homeBackground} withScrim={false} backgroundOverlay={0.34}>
      <StatusBar style="light" />
      <View style={styles.flex}>
        <ScrollView
          contentContainerStyle={[styles.content, layout.contentStyle]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <PageHeader title={copy.title} subtitle={copy.subtitle} style={styles.header} />
          {renderBody()}
        </ScrollView>
        <BottomBar />
      </View>
    </ScreenWrapper>
  );
}
