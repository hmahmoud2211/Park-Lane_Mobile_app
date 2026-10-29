import Ionicons from '@expo/vector-icons/Ionicons';
import { CameraView } from 'expo-camera';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Platform, Pressable, View } from 'react-native';

import { AppInput } from '../../components/common/AppInput';
import { AppText } from '../../components/common/AppText';
import { ToggleSwitch } from '../../components/common/ToggleSwitch';
import { DeviceConnectionStatus, type ConnectionTone } from '../../components/ui/DeviceConnectionStatus';
import { QrScanner } from '../../components/parking/QrScanner';
import { FilterChip } from '../../components/ui/FilterChip';
import { NeonPanel } from '../../components/ui/NeonPanel';
import { PairingStep, type PairingStepState } from '../../components/ui/PairingStep';
import { PanelHeading } from '../../components/ui/PanelHeading';
import { WifiCredentialForm, validateWifiCredentials } from '../../components/ui/WifiCredentialForm';
import { lgSources } from '../../constants/lgConfig';
import { useAppTheme } from '../../hooks/useAppTheme';
import type { LgPairing, LgPairingError } from '../../hooks/useLgPairing';
import {
  hotspotForQrCode,
  isLgApplianceCode,
  isLgHotspot,
  lgHotspotPassword,
  parseLgQrCode,
  type LgQrCode,
} from '../../services/lg/lgHotspot';
import { canOpenWifiSettings } from '../../services/sonoff/wifiProvisioningService';
import { wifiPasswordStore } from '../../services/sonoff/wifiPasswordStore';
import { Notice, PrimaryAction, SecondaryAction, TextAction } from '../SonoffPairingScreen/PairingParts';
import { finishPhases, lgPairingCopy as copy, lgSetupInstructions } from './LgPairingScreen.data';
import { FIELD_HEIGHT, ROW_ICON_SIZE, createStyles } from './LgPairingScreen.styles';

function ErrorNotice({ error, onRetry }: { error: LgPairingError; onRetry?: () => void }) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  return (
    <Notice
      tone="error"
      title={error.title}
      style={styles.gapTop}
      actions={onRetry ? <TextAction title={copy.retry} onPress={onRetry} /> : undefined}
    >
      {error.message}
    </Notice>
  );
}

/** Stage 1: setup mode on the AC, and whether the backend can reach rethink at all. */
export function LgSetupModeStep({ pairing }: { pairing: LgPairing }) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { backend } = pairing;

  return (
    <View>
      <NeonPanel style={[styles.card, styles.panelTight]}>
        <PanelHeading title={copy.setupTitle} iconSet="material" iconName="remote" iconSize={19} />
        <View style={[styles.panelBody, styles.gapTop]}>
          {lgSetupInstructions.map((entry, index) => (
            <PairingStep
              key={entry.title}
              index={index + 1}
              title={entry.title}
              body={entry.body}
              connector={index < lgSetupInstructions.length - 1}
            />
          ))}
          <TextAction title={copy.setupSource} onPress={() => void Linking.openURL(lgSources.setupMode)} />
        </View>
      </NeonPanel>

      <Notice
        tone="info"
        title={copy.beforeTitle}
        style={styles.card}
        actions={<TextAction title={copy.rethinkGuide} onPress={() => void Linking.openURL(lgSources.rethinkSetup)} />}
      >
        {pairing.remote ? copy.beforeBodyRemote : copy.beforeBody}
      </Notice>

      {!pairing.setupAvailable ? (
        <Notice tone="error" style={styles.card}>
          {copy.unavailable}
        </Notice>
      ) : backend.state === 'failed' ? (
        <Notice
          tone="error"
          title={copy.backendFailed}
          style={styles.card}
          actions={<TextAction title={copy.retry} onPress={pairing.checkBackend} />}
        >
          {backend.message}
        </Notice>
      ) : (
        <View style={[styles.toggleRow, styles.card]}>
          <AppText variant="tileCaption" color={theme.colors.textSupport} style={styles.flex}>
            {backend.state === 'checking' ? copy.checkingBackend : copy.backendReady}
          </AppText>
          {backend.state === 'checking' ? (
            <ActivityIndicator size="small" color={theme.colors.textAccentSoft} />
          ) : (
            <Ionicons name="checkmark-circle" size={ROW_ICON_SIZE} color={theme.colors.success} />
          )}
        </View>
      )}

      <PrimaryAction
        title={copy.continue}
        onPress={() => void pairing.continueToWifi()}
        disabled={!pairing.setupAvailable || backend.state !== 'ready'}
        loading={pairing.busy}
      />
    </View>
  );
}

const NEARBY_SHOWN = 6;

/** Stage 2: the home Wi-Fi the AC should join, read before the phone leaves it. */
export function LgHomeWifiStep({ pairing }: { pairing: LgPairing }) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  const [initialSsid] = useState(() => pairing.homeNetwork ?? '');
  const [ssid, setSsid] = useState(initialSsid);
  const [password, setPassword] = useState('');
  const [passwordRemembered, setPasswordRemembered] = useState(false);
  const [remember, setRemember] = useState(wifiPasswordStore.available);
  const [errors, setErrors] = useState<{ ssid?: string; password?: string }>({});

  const { scanHomeNetworks } = pairing;
  useEffect(() => {
    void scanHomeNetworks();
  }, [scanHomeNetworks]);

  useEffect(() => {
    if (!initialSsid) {
      return;
    }
    let current = true;
    void wifiPasswordStore.load(initialSsid).then((saved) => {
      if (current && saved) {
        setPassword((typed) => typed || saved);
        setPasswordRemembered(true);
      }
    });
    return () => {
      current = false;
    };
  }, [initialSsid]);

  const chooseNetwork = useCallback(async (name: string) => {
    setSsid(name);
    setPassword('');
    setPasswordRemembered(false);
    const saved = await wifiPasswordStore.load(name);
    if (saved) {
      setPassword(saved);
      setPasswordRemembered(true);
    }
  }, []);

  const submit = () => {
    const next = validateWifiCredentials(ssid, password);
    setErrors(next);
    if (Object.keys(next).length > 0) {
      return;
    }
    if (remember) {
      void wifiPasswordStore.save(ssid, password);
    }
    pairing.submitWifi({ ssid: ssid.trim(), password });
  };

  return (
    <View>
      <NeonPanel style={[styles.card, styles.panelTight]}>
        <PanelHeading title={copy.wifiTitle} subtitle={copy.wifiBody} iconSet="ionicons" iconName="home-outline" iconSize={19} />
        <View style={[styles.panelBody, styles.gapTop]}>
          {pairing.canScan && (pairing.homeNetworks.length > 0 || pairing.scanningHomeNetworks) ? (
            <View>
              <View style={styles.toggleRow}>
                <AppText variant="statLabel" color={theme.colors.textAccentSoft}>
                  {copy.wifiNearby}
                </AppText>
                {pairing.scanningHomeNetworks ? (
                  <ActivityIndicator size="small" color={theme.colors.textAccentSoft} />
                ) : (
                  <TextAction title={copy.wifiScan} onPress={() => void scanHomeNetworks()} />
                )}
              </View>
              <View style={[styles.chipRow, styles.gapTopSmall]} accessibilityRole="radiogroup">
                {pairing.homeNetworks.slice(0, NEARBY_SHOWN).map((network) => (
                  <FilterChip
                    key={network.ssid}
                    role="radio"
                    label={network.ssid}
                    iconSet="ionicons"
                    iconName="wifi"
                    selected={network.ssid === ssid}
                    onPress={() => void chooseNetwork(network.ssid)}
                  />
                ))}
              </View>
            </View>
          ) : null}

          <WifiCredentialForm
            ssid={ssid}
            password={password}
            onChangeSsid={(value) => {
              setSsid(value);
              setPasswordRemembered(false);
            }}
            onChangePassword={(value) => {
              setPassword(value);
              setPasswordRemembered(false);
            }}
            errors={errors}
            onSubmit={submit}
            style={styles.gapTop}
          />

          <AppText variant="tileCaption" color={theme.colors.textSupport} style={styles.gapTop}>
            {pairing.homeNetwork && ssid === pairing.homeNetwork ? `${copy.wifiDetected(pairing.homeNetwork)} ` : ''}
            {passwordRemembered ? copy.wifiPasswordRemembered : copy.wifiPasswordNote} {copy.wifiBand}
          </AppText>

          {wifiPasswordStore.available ? (
            <View style={[styles.toggleRow, styles.gapTop]}>
              <AppText variant="statValue" style={styles.flex}>
                {copy.wifiRemember}
              </AppText>
              <ToggleSwitch
                value={remember}
                onValueChange={(next) => {
                  setRemember(next);
                  if (!next && ssid) {
                    void wifiPasswordStore.forget(ssid);
                    setPasswordRemembered(false);
                  }
                }}
                accessibilityLabel={copy.wifiRemember}
              />
            </View>
          ) : null}
        </View>
      </NeonPanel>

      <PrimaryAction title={copy.continue} onPress={submit} />
    </View>
  );
}

/**
 * What a scanned code led to. LG's label codes name the appliance, not its
 * hotspot, so the hotspot is then looked for among those in range.
 */
type QrOutcome =
  | { kind: 'looking' | 'joining' | 'notInRange' | 'several' | 'typeName' | 'unknown'; code: LgQrCode };

/** "LG S4NW24K2RME", as the label names it. */
const applianceLabel = (code: LgQrCode) => (code.model ? `LG ${code.model}` : 'your LG AC');

/** Signal bars for a hotspot's dBm, as Android's own picker draws them. */
function signalIcon(level: number): keyof typeof Ionicons.glyphMap {
  return level >= -60 ? 'wifi' : level >= -75 ? 'wifi-outline' : 'cellular-outline';
}

/** Stage 3: onto the AC's hotspot (from its QR code or the list), and the home Wi-Fi over to the AC. */
export function LgSendStep({ pairing, onOpenWifiSettings }: { pairing: LgPairing; onOpenWifiSettings: () => void }) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  // With the native module the app joins for the resident; this shows the by-hand route instead.
  const [manual, setManual] = useState(!pairing.nativeWifi);
  const [selected, setSelected] = useState<string | null>(null);
  const [typedSsid, setTypedSsid] = useState('');
  /** What the resident typed, or the QR code gave; null while the name's guess stands. */
  const [passwordOverride, setPasswordOverride] = useState<string | null>(null);
  const [passwordFromQr, setPasswordFromQr] = useState(false);
  const [nameError, setNameError] = useState<string | undefined>();
  const [scanningQr, setScanningQr] = useState(false);
  const [qrOutcome, setQrOutcome] = useState<QrOutcome | null>(null);
  /** Google's scanner (Play services) or Apple's: its own screen, with autofocus, auto-zoom and a light. */
  const systemScanner = Platform.OS !== 'web' && CameraView.isModernBarcodeScannerAvailable;
  const scanResult = useRef<ReturnType<typeof CameraView.onModernBarcodeScanned> | null>(null);
  useEffect(() => () => scanResult.current?.remove(), []);
  const { busy, error, scanHotspots } = pairing;

  useEffect(() => {
    if (pairing.canScan) {
      void scanHotspots();
    }
  }, [pairing.canScan, scanHotspots]);

  // One AC in range is the obvious choice.
  const only = pairing.hotspots.length === 1 ? pairing.hotspots[0].ssid : null;
  const hotspot = pairing.canScan ? (selected ?? only) : typedSsid.trim() || null;
  const guessed = hotspot ? lgHotspotPassword(hotspot) : null;
  const password = passwordOverride ?? guessed;

  const tone: ConnectionTone = busy ? 'working' : error ? 'error' : 'idle';

  const chooseHotspot = (ssid: string) => {
    if (pairing.canScan) {
      setSelected(ssid);
    } else {
      setTypedSsid(ssid);
    }
    setPasswordOverride(null);
    setPasswordFromQr(false);
    setNameError(undefined);
  };

  const joinAndSend = () => {
    if (!hotspot) {
      setNameError(copy.hotspotNameMissing);
      return;
    }
    if (!isLgHotspot(hotspot)) {
      setNameError(copy.hotspotNameInvalid);
      return;
    }
    setNameError(undefined);
    void pairing.send({ ssid: hotspot, password: password || null });
  };

  /**
   * Finds the AC's hotspot from its code, looking at what is in range when
   * the code names only the appliance, then joins it and sends the Wi-Fi.
   */
  const connectFromCode = async (code: LgQrCode) => {
    let ssid = hotspotForQrCode(code, pairing.hotspots);
    let nearby = pairing.hotspots;
    if (!ssid && isLgApplianceCode(code) && pairing.canScan) {
      setQrOutcome({ kind: 'looking', code });
      nearby = await scanHotspots();
      ssid = hotspotForQrCode(code, nearby);
    }
    if (!ssid) {
      setQrOutcome({
        code,
        kind: !isLgApplianceCode(code) ? 'unknown' : !pairing.canScan ? 'typeName' : nearby.length === 0 ? 'notInRange' : 'several',
      });
      return;
    }
    setQrOutcome({ kind: 'joining', code });
    chooseHotspot(ssid);
    const fromCode = code.password !== undefined;
    if (fromCode) {
      setPasswordOverride(code.password ?? '');
      setPasswordFromQr(true);
    }
    void pairing.send({ ssid, password: fromCode ? (code.password ?? null) : lgHotspotPassword(ssid) });
  };

  const onQrScanned = (data: string) => {
    setScanningQr(false);
    void connectFromCode(parseLgQrCode(data));
  };

  /** The system scanner where there is one; the in-app camera otherwise, or when it fails. */
  const scanQr = async () => {
    setQrOutcome(null);
    if (!systemScanner) {
      setScanningQr(true);
      return;
    }
    scanResult.current?.remove();
    scanResult.current = CameraView.onModernBarcodeScanned(({ data }) => {
      scanResult.current?.remove();
      scanResult.current = null;
      // iOS leaves its scanner open; Android has closed its own already.
      void CameraView.dismissScanner().catch(() => undefined);
      onQrScanned(data);
    });
    try {
      await CameraView.launchScanner({ barcodeTypes: ['qr'] });
    } catch (caught) {
      scanResult.current?.remove();
      scanResult.current = null;
      // Error codes come from class names, which the release build shortens; the message survives.
      if (!(caught instanceof Error && /cancel/i.test(caught.message))) {
        setScanningQr(true);
      }
    }
  };

  const qrNotice = (outcome: QrOutcome) => {
    const { code } = outcome;
    if (outcome.kind === 'unknown') {
      return (
        <Notice tone="warning" title={copy.qrUnreadTitle} style={styles.gapTop}>
          <AppText variant="tileCaption" color={theme.colors.textSupport}>
            {copy.qrUnreadBody}
          </AppText>
          <AppText variant="tileCaption" color={theme.colors.textPrimary} selectable numberOfLines={4}>
            {copy.qrRead(code.raw)}
          </AppText>
        </Notice>
      );
    }
    const body = {
      looking: copy.qrLooking,
      joining: copy.qrJoining,
      notInRange: copy.qrNotInRange,
      several: copy.qrSeveral,
      typeName: copy.qrTypeName,
    }[outcome.kind];
    return (
      <Notice
        tone={outcome.kind === 'notInRange' ? 'warning' : outcome.kind === 'joining' ? 'success' : 'info'}
        title={copy.qrFound(applianceLabel(code))}
        style={styles.gapTop}
        actions={
          outcome.kind === 'notInRange' ? (
            <TextAction title={copy.qrLookAgain} onPress={() => void connectFromCode(code)} />
          ) : undefined
        }
      >
        <AppText variant="tileCaption" color={theme.colors.textSupport}>
          {body}
        </AppText>
        {code.serial ? (
          <AppText variant="tileCaption" color={theme.colors.textPrimary}>
            {copy.qrSerial(code.serial)}
          </AppText>
        ) : null}
      </Notice>
    );
  };

  return (
    <View>
      <NeonPanel style={[styles.card, styles.panel]}>
        <DeviceConnectionStatus
          tone={tone}
          title={busy ? (pairing.activity ?? copy.joinIdle) : copy.joinIdle}
          caption={busy ? undefined : copy.joinIdleCaption}
        />
        {error ? <ErrorNotice error={error} /> : null}
      </NeonPanel>

      {!manual ? (
        <NeonPanel style={[styles.card, styles.panel]}>
          <AppText variant="statValue" style={styles.sectionTitle}>
            {copy.qrTitle}
          </AppText>
          <AppText variant="tileCaption" color={theme.colors.textSupport}>
            {copy.qrBody} {copy.qrTips}
          </AppText>
          {scanningQr ? (
            <View style={styles.gapTop}>
              <QrScanner onScan={onQrScanned} onClose={() => setScanningQr(false)} permissionHint={copy.qrPermission} />
            </View>
          ) : (
            <>
              <SecondaryAction
                title={qrOutcome ? copy.qrAgain : copy.qrScan}
                icon="qr-code-outline"
                onPress={() => void scanQr()}
                disabled={busy || qrOutcome?.kind === 'looking'}
                style={styles.gapTop}
              />
              {systemScanner ? (
                <TextAction
                  title={copy.qrInApp}
                  onPress={() => {
                    setQrOutcome(null);
                    setScanningQr(true);
                  }}
                />
              ) : null}
            </>
          )}
          {qrOutcome && !scanningQr ? qrNotice(qrOutcome) : null}
        </NeonPanel>
      ) : null}

      {!manual && pairing.canScan ? (
        <NeonPanel style={[styles.card, styles.panel]}>
          <AppText variant="statValue" style={styles.sectionTitle}>
            {copy.hotspotsTitle}
          </AppText>
          {pairing.hotspots.length === 0 ? (
            <AppText variant="tileCaption" color={theme.colors.textSupport}>
              {pairing.scanningHotspots ? copy.scanning : copy.noHotspots}
            </AppText>
          ) : (
            <View style={[styles.optionList, styles.gapTopSmall]} accessibilityRole="radiogroup">
              {pairing.hotspots.map((entry) => {
                const checked = entry.ssid === hotspot;
                return (
                  <Pressable
                    key={entry.ssid}
                    onPress={() => chooseHotspot(entry.ssid)}
                    disabled={busy}
                    accessibilityRole="radio"
                    accessibilityState={{ checked, disabled: busy }}
                    style={({ pressed }) => [styles.option, checked && styles.optionSelected, pressed && styles.pressed]}
                  >
                    <Ionicons name={signalIcon(entry.level)} size={ROW_ICON_SIZE} color={theme.colors.textPrimary} />
                    <AppText variant="statValue" style={styles.optionText} numberOfLines={1}>
                      {entry.ssid}
                    </AppText>
                    {checked ? <Ionicons name="checkmark-circle" size={ROW_ICON_SIZE} color={theme.colors.electricCyan} /> : null}
                  </Pressable>
                );
              })}
            </View>
          )}
          <SecondaryAction
            title={copy.scanAgain}
            icon="refresh"
            onPress={() => void scanHotspots()}
            disabled={busy || pairing.scanningHotspots}
            style={styles.gapTop}
          />
        </NeonPanel>
      ) : null}

      {!manual && !pairing.canScan ? (
        <NeonPanel style={[styles.card, styles.panel]}>
          <AppInput
            variant="field"
            height={FIELD_HEIGHT}
            label={copy.hotspotName}
            placeholder={copy.hotspotNamePlaceholder}
            value={typedSsid}
            onChangeText={(value) => {
              setTypedSsid(value);
              setPasswordOverride(null);
              setPasswordFromQr(false);
              setNameError(undefined);
            }}
            error={nameError}
            editable={!busy}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </NeonPanel>
      ) : null}

      {!manual && hotspot ? (
        <NeonPanel style={[styles.card, styles.panel]}>
          <AppInput
            variant="field"
            height={FIELD_HEIGHT}
            label={copy.hotspotPassword(hotspot)}
            placeholder={copy.noPassword}
            value={password ?? ''}
            onChangeText={(value) => {
              setPasswordOverride(value);
              setPasswordFromQr(false);
            }}
            editable={!busy}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <AppText variant="tileCaption" color={theme.colors.textSupport} style={styles.gapTopSmall}>
            {passwordFromQr
              ? copy.hotspotPasswordFromQr
              : passwordOverride !== null
                ? copy.hotspotPasswordTyped
                : guessed === null
                  ? copy.hotspotPasswordOpen
                  : copy.hotspotPasswordGuessed}
          </AppText>
        </NeonPanel>
      ) : null}

      {manual ? (
        <NeonPanel style={[styles.card, styles.panel]}>
          <AppText variant="statValue" style={styles.sectionTitle}>
            {copy.manualTitle}
          </AppText>
          <View style={styles.gapTopSmall}>
            {copy.manualSteps.map((entry, index) => (
              <PairingStep key={entry} index={index + 1} title={entry} connector={index < copy.manualSteps.length - 1} />
            ))}
          </View>
        </NeonPanel>
      ) : null}

      {Platform.OS !== 'web' ? (
        <Notice tone="info" style={styles.card}>
          {copy.noInternetNote}
        </Notice>
      ) : null}

      <View style={styles.actions}>
        {manual ? (
          <>
            <PrimaryAction title={copy.sendJoined} onPress={() => void pairing.send(null)} loading={busy} disabled={busy} />
            {canOpenWifiSettings() ? (
              <SecondaryAction title={copy.openWifiSettings} icon="settings-outline" onPress={onOpenWifiSettings} />
            ) : null}
            {pairing.nativeWifi ? <TextAction title={copy.useApp} onPress={() => setManual(false)} /> : null}
          </>
        ) : (
          <>
            <PrimaryAction
              title={copy.joinAndSend}
              onPress={joinAndSend}
              disabled={busy || (pairing.canScan && !hotspot)}
              loading={busy}
            />
            <TextAction title={copy.joinFromSettings} onPress={() => setManual(true)} />
          </>
        )}
      </View>
    </View>
  );
}

/** Stage 4: the AC joins home Wi-Fi and reaches rethink; then it is named and added. */
export function LgFinishStep({
  pairing,
  onStartOver,
  onDone,
}: {
  pairing: LgPairing;
  onStartOver: () => void;
  onDone: () => void;
}) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [name, setName] = useState<string>(copy.defaultName);
  const [room, setRoom] = useState('');
  const [nameError, setNameError] = useState<string | undefined>();
  const { phase, timedOut, found, busy, error } = pairing;

  const order = ['sent', 'home', 'find', 'added'] as const;
  const reached = phase === 'home' ? 1 : phase === 'find' ? 2 : phase === 'name' ? 3 : 4;
  const stateOf = (index: number): PairingStepState =>
    index < reached ? 'done' : index === reached ? (timedOut ? 'failed' : 'active') : 'pending';

  const submit = () => {
    if (!name.trim()) {
      setNameError(copy.nameMissing);
      return;
    }
    setNameError(undefined);
    void pairing.add({ name: name.trim(), room: room.trim() || undefined });
  };

  return (
    <View>
      <NeonPanel style={[styles.card, styles.panelTight]}>
        <PanelHeading title={copy.finishTitle} iconSet="ionicons" iconName="sync-outline" iconSize={19} />
        <View style={[styles.panelBody, styles.gapTop]}>
          {finishPhases.map((entry, index) => (
            <PairingStep
              key={entry.id}
              index={index + 1}
              title={entry.title}
              state={stateOf(order.indexOf(entry.id))}
              connector={index < finishPhases.length - 1}
            />
          ))}
        </View>
      </NeonPanel>

      {timedOut ? (
        <Notice
          tone="warning"
          title={copy.notFoundTitle}
          style={styles.card}
          actions={
            <>
              <TextAction title={copy.keepWaiting} onPress={() => void pairing.keepWaiting()} />
              <TextAction title={copy.startOver} onPress={onStartOver} />
            </>
          }
        >
          {pairing.remote ? copy.notFoundBodyRemote : copy.notFoundBody}
        </Notice>
      ) : null}

      {phase === 'name' && found ? (
        <NeonPanel style={[styles.card, styles.panelTight]}>
          <PanelHeading
            title={copy.addTitle}
            subtitle={copy.foundTitle([found.name, found.model].filter(Boolean).join(' · '))}
            iconSet="material"
            iconName="air-conditioner"
            iconSize={19}
          />
          <View style={[styles.panelBody, styles.gapTop, styles.actions]}>
            <AppInput
              variant="field"
              height={FIELD_HEIGHT}
              label={copy.name}
              value={name}
              onChangeText={setName}
              error={nameError}
              editable={!busy}
            />
            <AppInput variant="field" height={FIELD_HEIGHT} label={copy.room} value={room} onChangeText={setRoom} editable={!busy} />
            {error ? <ErrorNotice error={error} /> : null}
            <PrimaryAction title={copy.add} onPress={submit} loading={busy} disabled={busy} />
          </View>
        </NeonPanel>
      ) : null}

      {phase === 'done' ? (
        <>
          <Notice tone="success" title={copy.doneTitle} style={styles.card}>
            {copy.doneBody}
          </Notice>
          <PrimaryAction title={copy.done} onPress={onDone} />
        </>
      ) : null}
    </View>
  );
}
