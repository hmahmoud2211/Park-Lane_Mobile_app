import { useNavigation, useRoute } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Platform, ScrollView, View } from 'react-native';

import { AppButton } from '../../components/common/AppButton';
import { AppIcon } from '../../components/common/AppIcon';
import { AppInput } from '../../components/common/AppInput';
import { AppText } from '../../components/common/AppText';
import { StepList } from '../../components/gateway/StepList';
import { BottomBar } from '../../components/layout/BottomBar';
import { PageHeader } from '../../components/layout/PageHeader';
import { ScreenWrapper } from '../../components/layout/ScreenWrapper';
import { Notice } from '../../components/parking/Notice';
import { FilterChip } from '../../components/ui/FilterChip';
import { NeonPanel } from '../../components/ui/NeonPanel';
import { PanelHeading } from '../../components/ui/PanelHeading';
import { StatusChip } from '../../components/ui/StatusChip';
import { images } from '../../constants/images';
import { useAppTheme } from '../../hooks/useAppTheme';
import { useGateway } from '../../hooks/useGateway';
import { useProvisioningSession } from '../../hooks/useProvisioningSession';
import { useScreenLayout } from '../../hooks/useScreenLayout';
import * as api from '../../services/gateway/gatewayApi';
import { deviceRequest } from '../../services/provisioning/deviceHttp';
import { openDeviceSetupPage } from '../../services/provisioning/setupPage';
import { detectShelly, sendWifiToShelly } from '../../services/provisioning/shellySoftap';
import { readSonoffDevice, type SonoffSetupInfo } from '../../services/provisioning/sonoffSoftap';
import {
  WifiJoinError,
  canJoinInApp,
  canOpenWifiSettings,
  joinHotspot,
  openWifiSettings,
  releaseHotspot,
  waitForDevice,
} from '../../services/provisioning/wifiJoin';
import type { ProvisioningPlugin } from '../../types/gateway.types';
import type { RootStackScreenProps } from '../../types/navigation.types';
import { provisioningCopy as copy } from './DeviceProvisioningScreen.data';
import { BUTTON_HEIGHT, FIELD_HEIGHT, createStyles } from './DeviceProvisioningScreen.styles';

type Stage = 'loading' | 'model' | 'prepare' | 'join' | 'wifi' | 'guided' | 'gateway' | 'waiting';

const OTHER_MODEL = '__other__';
const DETECT_WINDOW_MS = 20_000;

/** Is the expected device answering on its setup network? Returns what it said, or null. */
async function probeSetupDevice(pluginId: string, ip: string): Promise<object | null> {
  if (pluginId.startsWith('shelly')) {
    return detectShelly(ip);
  }
  if (pluginId.startsWith('sonoff')) {
    return readSonoffDevice(ip);
  }
  if (pluginId.startsWith('wled')) {
    const info = (await deviceRequest(`http://${ip}/json/info`, { timeoutMs: 3_000 }).catch(() => null)) as { ver?: unknown } | null;
    return info && typeof info === 'object' && 'ver' in info ? info : null;
  }
  return {};
}

/**
 * Setting up a factory-new device on the home Wi-Fi, driven by the gateway's
 * provisioning plugin for the brand:
 *
 * - phone (Shelly): the phone joins the device's open hotspot and sends the
 *   Wi-Fi with Shelly's documented API.
 * - guided (WLED, SONOFF DIY): the phone joins the hotspot and the resident
 *   enters the Wi-Fi on the device's own page.
 * - gateway (Kasa, LG via ReThink): the gateway joins the hotspot with its own
 *   Wi-Fi radio and runs the setup.
 *
 * The home Wi-Fi password never touches the gateway in the phone and guided
 * setups. Success is the gateway's call: it reports `connected` only after
 * finding the device on the LAN and reading its state.
 */
export function DeviceProvisioningScreen() {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const layout = useScreenLayout();
  const navigation = useNavigation<RootStackScreenProps<'DeviceProvisioning'>['navigation']>();
  const { params } = useRoute<RootStackScreenProps<'DeviceProvisioning'>['route']>();
  const { target, refresh } = useGateway();
  const provisioning = useProvisioningSession();
  const { session } = provisioning;

  const [stage, setStage] = useState<Stage>('loading');
  const [plugin, setPlugin] = useState<ProvisioningPlugin | null>(null);
  const [model, setModel] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [stepError, setStepError] = useState<string | null>(null);
  const [hotspotPassword, setHotspotPassword] = useState('');
  const [hotspotSsid, setHotspotSsid] = useState('');
  const [homeSsid, setHomeSsid] = useState('');
  const [homePassword, setHomePassword] = useState('');
  const [sonoff, setSonoff] = useState<SonoffSetupInfo | null | undefined>(undefined);
  const joinedSsid = useRef<string | null>(null);
  const onHotspot = useRef(false);
  /** The phone is (or may be) on the device's hotspot, away from the gateway. */
  const [awayFromHome, setAwayFromHome] = useState(false);

  // The plugin's declared models and requirements.
  useEffect(() => {
    if (!target || plugin) return;
    let cancelled = false;
    api.listProvisioningPlugins(target).then(
      (list) => {
        if (cancelled) return;
        const found = list.find((entry) => entry.id === params.pluginId) ?? null;
        setPlugin(found);
        setStage(found && found.model_choices.length > 0 ? 'model' : 'prepare');
      },
      () => {
        if (!cancelled) setStage('prepare');
      },
    );
    return () => {
      cancelled = true;
    };
  }, [target, plugin, params.pluginId]);

  // Without model choices, open the session straight away.
  const opened = useRef(false);
  useEffect(() => {
    if (stage === 'prepare' && !session && !opened.current) {
      opened.current = true;
      void provisioning.open(params.pluginId, model);
    }
  }, [stage, session, provisioning, params.pluginId, model]);

  // Done or needing authorization: on to the next screen.
  useEffect(() => {
    if (session?.state === 'connected' && session.device_id) {
      void refresh();
      navigation.replace('DeviceSetup', { deviceId: session.device_id });
    }
  }, [session, navigation, refresh]);

  // Leaving mid-way: let go of the device's hotspot and close the session.
  const cancelRef = useRef(provisioning.cancel);
  useEffect(() => {
    cancelRef.current = provisioning.cancel;
  }, [provisioning.cancel]);
  useEffect(
    () => () => {
      if (onHotspot.current) {
        void releaseHotspot(joinedSsid.current);
      }
      void cancelRef.current();
    },
    [],
  );

  const deviceIp = session?.hotspot.device_ip ?? '';
  const transport = session?.transport ?? plugin?.transport ?? 'phone';

  const chooseModel = async () => {
    const chosen = model === OTHER_MODEL ? null : model;
    opened.current = true;
    setStage('prepare');
    await provisioning.open(params.pluginId, chosen);
  };

  const confirmSetupMode = async () => {
    await provisioning.report('pairing_mode_confirmed');
    setStage(transport === 'gateway' ? 'gateway' : 'join');
  };

  const afterJoined = async (ssid: string | null) => {
    setBusy(copy.checkingDevice);
    const found = await waitForDevice(() => probeSetupDevice(params.pluginId, deviceIp), { timeoutMs: DETECT_WINDOW_MS, intervalMs: 2_000 });
    setBusy(null);
    if (!found) {
      setStepError(copy.deviceNotFound);
      return;
    }
    onHotspot.current = true;
    setAwayFromHome(true);
    // The phone may be off the home network now; queue reports until it is back.
    await provisioning.report('device_ap_joined', ssid ? { ssid } : {}, { queueIfUnreachable: true });
    if (params.pluginId.startsWith('sonoff')) {
      setSonoff(found as SonoffSetupInfo);
    }
    setStage(transport === 'phone' ? 'wifi' : 'guided');
  };

  const joinInApp = async () => {
    if (!session) return;
    setStepError(null);
    setBusy(copy.joining);
    await provisioning.report('joining_device_ap');
    try {
      const password = session.hotspot.password_rule === 'verified_rule' ? session.hotspot.password : hotspotPassword || null;
      const ssid = await joinHotspot({ ssid: hotspotSsid.trim() || null, prefixes: session.hotspot.ssid_prefixes, password });
      joinedSsid.current = ssid ?? (hotspotSsid.trim() || null);
      onHotspot.current = true;
      setAwayFromHome(true);
      setBusy(null);
      await afterJoined(joinedSsid.current);
    } catch (error) {
      setBusy(null);
      if (error instanceof WifiJoinError && error.kind === 'wrongPassword' && session.hotspot.password_rule === 'user') {
        await provisioning.report('hotspot_password_needed');
      }
      setStepError(error instanceof WifiJoinError ? error.message : 'The phone could not join the device’s network.');
    }
  };

  const backHome = async () => {
    if (onHotspot.current) {
      await releaseHotspot(joinedSsid.current);
      onHotspot.current = false;
    }
    setAwayFromHome(false);
    await provisioning.report('phone_returned', {}, { queueIfUnreachable: true });
    provisioning.watch();
    setStage('waiting');
  };

  const sendWifi = async () => {
    if (!homeSsid.trim()) {
      setStepError(`${copy.homeSsid}: ${copy.required}`);
      return;
    }
    setStepError(null);
    setBusy(copy.sending);
    const shelly = await detectShelly(deviceIp || undefined);
    if (!shelly) {
      setBusy(null);
      setStepError(copy.deviceNotFound);
      return;
    }
    await provisioning.report('device_info', { mac: shelly.mac, gen: shelly.gen, model: shelly.model, id: shelly.id }, { queueIfUnreachable: true });
    const outcome = await sendWifiToShelly(shelly, { ssid: homeSsid.trim(), password: homePassword }, { ip: deviceIp || undefined });
    // The password is not needed any more.
    setHomePassword('');
    setBusy(null);
    if (outcome.kind === 'rejected') {
      setStepError(`${copy.rejected} ${outcome.message}`);
      return;
    }
    await provisioning.report('wifi_config_sent', { outcome: outcome.kind }, { queueIfUnreachable: true });
    await backHome();
  };

  const guidedDone = async () => {
    if (sonoff) {
      await provisioning.report('device_info', { deviceid: sonoff.deviceId, apikey: sonoff.apikey, chipid: sonoff.chipId }, { queueIfUnreachable: true });
    }
    await provisioning.report('wifi_config_sent', {}, { queueIfUnreachable: true });
    await backHome();
  };

  const runOnGateway = async () => {
    if (!homeSsid.trim() || !hotspotSsid.trim()) {
      setStepError(`${!homeSsid.trim() ? copy.homeSsid : copy.hotspotSsid}: ${copy.required}`);
      return;
    }
    setStepError(null);
    setBusy(copy.sending);
    const password = session?.hotspot.password_rule === 'verified_rule' ? session.hotspot.password : hotspotPassword || null;
    const next = await provisioning.run({ home_ssid: homeSsid.trim(), home_password: homePassword, hotspot_ssid: hotspotSsid.trim(), hotspot_password: password });
    setHomePassword('');
    setBusy(null);
    if (next) {
      provisioning.watch();
      setStage('waiting');
    }
  };

  const startOver = () => {
    provisioning.reset();
    opened.current = false;
    onHotspot.current = false;
    setAwayFromHome(false);
    joinedSsid.current = null;
    setSonoff(undefined);
    setStepError(null);
    setStage(plugin && plugin.model_choices.length > 0 ? 'model' : 'prepare');
  };

  // ---- rendering ---------------------------------------------------------------------------

  const failed = session?.state === 'pairing_failed';

  const renderModel = () => (
    <NeonPanel style={styles.panel}>
      <PanelHeading title={copy.modelTitle} iconSet="ionicons" iconName="pricetag-outline" divider />
      <AppText variant="bodySmall" color={theme.colors.textSupport}>
        {copy.modelIntro}
      </AppText>
      <View style={styles.chips} accessibilityRole="radiogroup">
        {[...(plugin?.model_choices ?? []), OTHER_MODEL].map((choice) => (
          <FilterChip
            key={choice}
            role="radio"
            label={choice === OTHER_MODEL ? copy.otherModel : choice}
            iconSet="ionicons"
            iconName="hardware-chip-outline"
            selected={model === choice}
            onPress={() => setModel(choice)}
          />
        ))}
      </View>
      <AppButton title={copy.continue} variant="gradient" height={BUTTON_HEIGHT} disabled={!model} onPress={() => void chooseModel()} />
    </NeonPanel>
  );

  const renderHotspotPassword = () => {
    if (!session) return null;
    if (session.hotspot.password_rule === 'none') {
      return (
        <AppText variant="tileCaption" color={theme.colors.textSupport}>
          {copy.hotspotOpen}
        </AppText>
      );
    }
    if (session.hotspot.password_rule === 'verified_rule' && session.hotspot.password) {
      return (
        <>
          <AppText variant="statValue" selectable>
            {copy.hotspotVerified(session.hotspot.password)}
          </AppText>
          {session.hotspot.rule_source ? (
            <AppText variant="tileCaption" color={theme.colors.textSupport}>
              {`${copy.sourceLabel}: ${session.hotspot.rule_source}`}
            </AppText>
          ) : null}
        </>
      );
    }
    return (
      <>
        <AppInput
          variant="field"
          label={copy.hotspotUserLabel}
          value={hotspotPassword}
          onChangeText={setHotspotPassword}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          height={FIELD_HEIGHT}
        />
        <AppText variant="tileCaption" color={theme.colors.textSupport}>
          {copy.hotspotUserHelp}
        </AppText>
      </>
    );
  };

  const renderJoin = () => {
    if (!session) return null;
    const inApp = canJoinInApp(transport === 'guided' ? 'guided' : 'phone');
    const names = session.hotspot.ssid_prefixes.map((prefix) => `${prefix}…`).join(' or ');
    return (
      <NeonPanel style={styles.panel}>
        <PanelHeading title={copy.hotspotTitle} iconSet="ionicons" iconName="wifi-outline" divider />
        <AppText variant="bodySmall" color={theme.colors.textSupport}>
          {copy.hotspotNames(names)}
        </AppText>
        {renderHotspotPassword()}
        <AppInput
          variant="field"
          label={copy.ssidLabel}
          value={hotspotSsid}
          onChangeText={setHotspotSsid}
          autoCapitalize="none"
          autoCorrect={false}
          height={FIELD_HEIGHT}
        />
        <Notice tone="info">{Platform.OS === 'android' ? copy.androidNoInternet : copy.iosLocalNetwork}</Notice>
        {inApp ? (
          <AppButton title={copy.joinInApp} variant="gradient" height={BUTTON_HEIGHT} disabled={busy !== null} onPress={() => void joinInApp()} />
        ) : (
          <>
            <AppText variant="bodySmall" color={theme.colors.textSupport}>
              {copy.joinManualIntro}
            </AppText>
            <View style={styles.row}>
              {canOpenWifiSettings() ? (
                <AppButton title={copy.openWifiSettings} variant="secondary" height={BUTTON_HEIGHT} onPress={() => void openWifiSettings()} style={styles.action} />
              ) : null}
              <AppButton
                title={copy.joinedManual}
                variant="gradient"
                height={BUTTON_HEIGHT}
                disabled={busy !== null}
                onPress={() => {
                  setStepError(null);
                  void afterJoined(hotspotSsid.trim() || null);
                }}
                style={styles.action}
              />
            </View>
          </>
        )}
      </NeonPanel>
    );
  };

  const renderHomeWifiFields = () => (
    <>
      <AppInput
        variant="field"
        label={copy.homeSsid}
        value={homeSsid}
        onChangeText={setHomeSsid}
        autoCapitalize="none"
        autoCorrect={false}
        height={FIELD_HEIGHT}
      />
      <AppInput
        variant="field"
        label={copy.homePassword}
        value={homePassword}
        onChangeText={setHomePassword}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="off"
        height={FIELD_HEIGHT}
      />
    </>
  );

  const renderWifi = () => (
    <NeonPanel style={styles.panel}>
      <PanelHeading title={copy.wifiTitle} iconSet="ionicons" iconName="home-outline" divider />
      <AppText variant="bodySmall" color={theme.colors.textSupport}>
        {copy.wifiIntro}
      </AppText>
      {renderHomeWifiFields()}
      <AppButton title={copy.send} variant="gradient" height={BUTTON_HEIGHT} disabled={busy !== null} onPress={() => void sendWifi()} />
    </NeonPanel>
  );

  const renderGuided = () => (
    <NeonPanel style={styles.panel}>
      <PanelHeading title={copy.guidedTitle} iconSet="ionicons" iconName="globe-outline" divider />
      <AppText variant="bodySmall" color={theme.colors.textSupport}>
        {copy.guidedIntro}
      </AppText>
      {params.pluginId.startsWith('sonoff') && sonoff !== undefined ? (
        <AppText variant="tileCaption" color={theme.colors.textSupport}>
          {sonoff ? copy.sonoffKeyRead : copy.sonoffKeyMissing}
        </AppText>
      ) : null}
      <View style={styles.row}>
        <AppButton title={copy.openPage} variant="secondary" height={BUTTON_HEIGHT} onPress={() => void openDeviceSetupPage(deviceIp)} style={styles.action} />
        <AppButton title={copy.savedOnDevice} variant="gradient" height={BUTTON_HEIGHT} disabled={busy !== null} onPress={() => void guidedDone()} style={styles.action} />
      </View>
    </NeonPanel>
  );

  const renderGateway = () => (
    <NeonPanel style={styles.panel}>
      <PanelHeading title={copy.gatewayTitle} iconSet="ionicons" iconName="hardware-chip-outline" divider />
      <AppText variant="bodySmall" color={theme.colors.textSupport}>
        {copy.gatewayIntro}
      </AppText>
      <AppInput
        variant="field"
        label={copy.hotspotSsid}
        value={hotspotSsid}
        onChangeText={setHotspotSsid}
        autoCapitalize="none"
        autoCorrect={false}
        height={FIELD_HEIGHT}
      />
      <AppText variant="tileCaption" color={theme.colors.textSupport}>
        {copy.hotspotSsidHelp}
      </AppText>
      {renderHotspotPassword()}
      {renderHomeWifiFields()}
      <AppButton title={copy.run} variant="gradient" height={BUTTON_HEIGHT} disabled={busy !== null} onPress={() => void runOnGateway()} />
    </NeonPanel>
  );

  const renderWaiting = () => {
    if (!session) return null;
    if (session.state === 'local_authorization_required') {
      return (
        <Notice
          tone="info"
          title={copy.localAuthTitle}
          actions={
            <AppButton
              title={copy.finishPairing}
              variant="gradient"
              height={BUTTON_HEIGHT}
              onPress={() =>
                navigation.replace('DeviceDiscovery', {
                  brandId: params.brandId,
                  adapterId: session.adapter_id,
                  mode: 'scan',
                  candidateId: session.candidate_id ?? undefined,
                })
              }
            />
          }
        >
          {copy.localAuthBody}
        </Notice>
      );
    }
    if (failed) return null;
    return (
      <Notice tone="info" title={copy.waitingTitle}>
        {copy.waitingBody}
      </Notice>
    );
  };

  const renderStage = () => {
    if (Platform.OS === 'web' && transport !== 'gateway') {
      return <Notice tone="warning">{copy.phoneOnly}</Notice>;
    }
    switch (stage) {
      case 'loading':
        return <ActivityIndicator color={theme.colors.textPrimary} />;
      case 'model':
        return renderModel();
      case 'prepare':
        return session ? (
          <AppButton title={copy.prepareAction} variant="gradient" height={BUTTON_HEIGHT} onPress={() => void confirmSetupMode()} />
        ) : provisioning.error ? null : (
          <ActivityIndicator color={theme.colors.textPrimary} />
        );
      case 'join':
        return renderJoin();
      case 'wifi':
        return renderWifi();
      case 'guided':
        return renderGuided();
      case 'gateway':
        return renderGateway();
      case 'waiting':
        return renderWaiting();
      default:
        return null;
    }
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
          <PageHeader title={plugin?.title ?? copy.title} subtitle={plugin?.description} style={styles.header} />
          {!target && stage !== 'waiting' && !awayFromHome ? (
            <Notice tone="warning">{copy.offline}</Notice>
          ) : (
            <>
              {session?.experimental || plugin?.status === 'experimental' ? (
                <Notice tone="warning" title={copy.experimentalTitle}>
                  {copy.experimentalBody}
                </Notice>
              ) : null}

              {session ? (
                <NeonPanel style={styles.panel}>
                  <PanelHeading title={copy.stepsTitle} iconSet="ionicons" iconName="list-outline" divider />
                  <StepList steps={session.steps} state={session.state} failed={failed} />
                  {session.experimental ? <StatusChip label="Experimental" tone="amber" icon="flask-outline" /> : null}
                </NeonPanel>
              ) : null}

              {plugin && plugin.requirements.length > 0 && (stage === 'model' || stage === 'prepare') ? (
                <NeonPanel style={styles.panel}>
                  <PanelHeading title={copy.requirementsTitle} iconSet="ionicons" iconName="checkbox-outline" divider />
                  {plugin.requirements.map((item) => (
                    <View key={item} style={styles.bullet}>
                      <AppIcon set="ionicons" name="ellipse" size={6} color={theme.colors.textSupport} />
                      <AppText variant="tileCaption" color={theme.colors.textSupport} style={styles.flex}>
                        {item}
                      </AppText>
                    </View>
                  ))}
                </NeonPanel>
              ) : null}

              {failed && session?.error ? (
                <Notice
                  tone="error"
                  title={copy.failedTitle}
                  actions={
                    <View style={styles.row}>
                      <AppButton title={copy.tryAgain} variant="gradient" height={BUTTON_HEIGHT} onPress={startOver} style={styles.action} />
                      <AppButton title={copy.back} variant="secondary" height={BUTTON_HEIGHT} onPress={() => navigation.goBack()} style={styles.action} />
                    </View>
                  }
                >
                  {`${session.error.message} ${session.error.recovery}`}
                </Notice>
              ) : null}

              {provisioning.error ? <Notice tone="error">{provisioning.error}</Notice> : null}
              {stepError ? <Notice tone="error">{stepError}</Notice> : null}
              {busy ? (
                <View style={styles.center} accessibilityLiveRegion="polite">
                  <ActivityIndicator color={theme.colors.textPrimary} />
                  <AppText variant="tileCaption" color={theme.colors.textSupport}>
                    {busy}
                  </AppText>
                </View>
              ) : null}

              {!failed ? renderStage() : null}

              {!failed && stage !== 'waiting' ? (
                <AppButton title={copy.cancel} variant="secondary" height={BUTTON_HEIGHT} onPress={() => navigation.goBack()} />
              ) : null}
            </>
          )}
        </ScrollView>
        <BottomBar />
      </View>
    </ScreenWrapper>
  );
}
