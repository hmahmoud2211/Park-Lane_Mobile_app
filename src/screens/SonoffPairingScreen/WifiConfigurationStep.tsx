import Ionicons from '@expo/vector-icons/Ionicons';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, View } from 'react-native';

import { AppInput } from '../../components/common/AppInput';
import { AppText } from '../../components/common/AppText';
import { ToggleSwitch } from '../../components/common/ToggleSwitch';
import { DeviceConnectionStatus } from '../../components/ui/DeviceConnectionStatus';
import { FilterChip } from '../../components/ui/FilterChip';
import { NeonPanel } from '../../components/ui/NeonPanel';
import { PanelHeading } from '../../components/ui/PanelHeading';
import { StatusChip } from '../../components/ui/StatusChip';
import { WifiCredentialForm, validateWifiCredentials } from '../../components/ui/WifiCredentialForm';
import { apProvisioningSources, dispatchServerPresets } from '../../constants/sonoffConfig';
import { useAppTheme } from '../../hooks/useAppTheme';
import type { SonoffPairing } from '../../hooks/useSonoffPairing';
import { wifiPasswordStore } from '../../services/sonoff/wifiPasswordStore';
import type { ApPayloadFormat } from '../../types/sonoff.types';
import { Notice, PrimaryAction, SecondaryAction, TextAction } from './PairingParts';
import { pairingCopy as copy, payloadFormats } from './SonoffPairingScreen.data';
import { FIELD_HEIGHT, ROW_ICON_SIZE, createStyles } from './SonoffPairingScreen.styles';

type ServerChoice = (typeof dispatchServerPresets)[number]['id'] | 'custom';

const HOST = /^[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$/;
/** RFC 5737's documentation ranges: never a real server. */
const DOCUMENTATION_RANGE = /^(192\.0\.2|198\.51\.100|203\.0\.113)\./;

function validateServer(choice: ServerChoice | null, host: string, port: string) {
  if (!choice) {
    return { server: 'Choose the server the plug should contact.' };
  }
  if (choice !== 'custom') {
    return {};
  }
  const errors: { host?: string; port?: string } = {};
  const trimmed = host.trim();
  if (!HOST.test(trimmed)) {
    errors.host = 'Enter a server name or IP address.';
  } else if (DOCUMENTATION_RANGE.test(trimmed)) {
    errors.host = 'That is a documentation-only address, not a real server.';
  }
  const number = Number(port);
  if (!Number.isInteger(number) || number < 1 || number > 65535) {
    errors.port = '1–65535';
  }
  return errors;
}

const NEARBY_SHOWN = 6;

/**
 * Stage 4: home Wi-Fi details, and the experimental request that would hand them to the plug.
 * The network is filled in from the Wi-Fi the phone was on before joining the plug's hotspot,
 * and nearby 2.4 GHz networks can be picked; a password remembered from an earlier pairing
 * fills in too (phones never let apps read saved Wi-Fi passwords).
 */
export function WifiConfigurationStep({ pairing }: { pairing: SonoffPairing }) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  /** The network shown when the step opens: the home Wi-Fi read before joining the hotspot. */
  const [initialSsid] = useState(() => pairing.homeNetwork ?? '');
  const [ssid, setSsid] = useState(initialSsid);
  const [password, setPassword] = useState('');
  const [passwordRemembered, setPasswordRemembered] = useState(false);
  const [remember, setRemember] = useState(wifiPasswordStore.available);
  const [wifiErrors, setWifiErrors] = useState<{ ssid?: string; password?: string }>({});
  const [experimental, setExperimental] = useState(false);
  const [server, setServer] = useState<ServerChoice | null>(null);
  const [host, setHost] = useState('');
  const [port, setPort] = useState('443');
  const [serverErrors, setServerErrors] = useState<{ server?: string; host?: string; port?: string }>({});
  const [format, setFormat] = useState<ApPayloadFormat>('ewelinkApp');
  const [reviewing, setReviewing] = useState(false);

  const { scanHomeNetworks } = pairing;
  useEffect(() => {
    void scanHomeNetworks();
  }, [scanHomeNetworks]);

  // A password remembered for the network shown when the step opens.
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

  /** Picking a network fills its remembered password, if there is one. */
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

  const preset = dispatchServerPresets.find((entry) => entry.id === server);
  const target = preset
    ? { serverName: preset.serverName, port: preset.port }
    : { serverName: host.trim(), port: Number(port) };

  const review = () => {
    const nextWifi = validateWifiCredentials(ssid, password);
    const nextServer = validateServer(server, host, port);
    setWifiErrors(nextWifi);
    setServerErrors(nextServer);
    if (Object.keys(nextWifi).length === 0 && Object.keys(nextServer).length === 0) {
      setReviewing(true);
    }
  };

  const send = () => {
    if (remember) {
      void wifiPasswordStore.save(ssid, password);
    }
    pairing.provisionExperimental({ ssid, password, ...target, format });
    // The page is leaving; drop the copy held here straight away.
    setPassword('');
    setReviewing(false);
  };

  const formLocked = reviewing;

  return (
    <View>
      {pairing.device ? (
        <NeonPanel style={[styles.card, styles.panel]}>
          <DeviceConnectionStatus
            tone="success"
            title={copy.detectedTitle}
            details={[{ label: 'Device ID', value: pairing.device.deviceId }]}
          />
        </NeonPanel>
      ) : null}

      <NeonPanel style={[styles.card, styles.panelTight]}>
        <PanelHeading title={copy.wifiTitle} subtitle={copy.wifiBody} iconSet="ionicons" iconName="home-outline" iconSize={19} />
        <View style={[styles.panelBody, styles.gapTop]}>
          {pairing.canScan && (pairing.homeNetworks.length > 0 || pairing.scanningHomeNetworks) ? (
            <View style={styles.gapTop}>
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
              <View style={[styles.chipRow, styles.gapTop]} accessibilityRole="radiogroup">
                {pairing.homeNetworks.slice(0, NEARBY_SHOWN).map((network) => (
                  <FilterChip
                    key={network.ssid}
                    role="radio"
                    label={network.ssid}
                    iconSet="ionicons"
                    iconName="wifi"
                    selected={network.ssid === ssid}
                    onPress={() => {
                      if (!formLocked) void chooseNetwork(network.ssid);
                    }}
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
            errors={wifiErrors}
            editable={!formLocked}
            style={styles.gapTop}
          />

          <AppText variant="tileCaption" color={theme.colors.textSupport} style={styles.gapTop}>
            {pairing.homeNetwork && ssid === pairing.homeNetwork ? `${copy.wifiDetected(pairing.homeNetwork)} ` : ''}
            {passwordRemembered ? copy.wifiPasswordRemembered : copy.wifiPasswordNote}
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
                disabled={formLocked}
              />
            </View>
          ) : null}
        </View>
      </NeonPanel>

      <NeonPanel style={[styles.card, styles.panelTight]}>
        <PanelHeading
          title={copy.provisionTitle}
          iconSet="ionicons"
          iconName="send-outline"
          iconSize={19}
          trailing={<StatusChip label={copy.provisionUnverified} tone="slate" />}
        />
        <View style={[styles.panelBody, styles.gapTop]}>
          <AppText variant="tileCaption" color={theme.colors.textSupport}>
            {copy.provisionExplainer}
          </AppText>

          <View style={[styles.toggleRow, styles.gapTop]}>
            <View style={styles.flex}>
              <AppText variant="statValue">{copy.experimentalLabel}</AppText>
              <AppText variant="tileCaption" color={theme.colors.warning}>
                Community method, not verified on this plug
              </AppText>
            </View>
            <ToggleSwitch
              value={experimental}
              onValueChange={(next) => {
                setExperimental(next);
                setReviewing(false);
              }}
              accessibilityLabel={copy.experimentalLabel}
              disabled={formLocked}
            />
          </View>

          {!experimental ? (
            <Notice tone="info" style={styles.gapTop}>
              {copy.provisionUnsupported}
            </Notice>
          ) : (
            <>
              <View style={styles.divider} />
              <AppText variant="statValue">{copy.serverTitle}</AppText>
              <AppText variant="tileCaption" color={theme.colors.textSupport} style={styles.gapTopSmall}>
                {copy.serverExplainer}
              </AppText>
              <View style={[styles.optionList, styles.gapTopSmall]} accessibilityRole="radiogroup">
                {[...dispatchServerPresets.map((entry) => ({
                  id: entry.id as ServerChoice,
                  title: entry.label,
                  body: `${entry.serverName}:${entry.port} · ${entry.source}`,
                })), { id: 'custom' as ServerChoice, title: copy.serverCustom, body: 'A server you run, e.g. on your LAN.' }].map(
                  (option) => {
                    const selected = server === option.id;
                    return (
                      <Pressable
                        key={option.id}
                        disabled={formLocked}
                        onPress={() => {
                          setServer(option.id);
                          setServerErrors({});
                        }}
                        accessibilityRole="radio"
                        accessibilityState={{ checked: selected, disabled: formLocked }}
                        style={({ pressed }) => [styles.option, selected && styles.optionSelected, pressed && styles.pressed]}
                      >
                        <Ionicons
                          name={selected ? 'radio-button-on' : 'radio-button-off'}
                          size={ROW_ICON_SIZE}
                          color={selected ? theme.colors.electricCyan : theme.colors.textSupport}
                        />
                        <View style={styles.optionText}>
                          <AppText variant="statValue">{option.title}</AppText>
                          <AppText variant="tileCaption" color={theme.colors.textSupport}>
                            {option.body}
                          </AppText>
                        </View>
                      </Pressable>
                    );
                  },
                )}
              </View>
              {serverErrors.server ? (
                <AppText variant="tileCaption" color={theme.colors.magenta} style={styles.gapTopSmall}>
                  {serverErrors.server}
                </AppText>
              ) : null}
              {server === 'custom' ? (
                <View style={[styles.portRow, styles.gapTopSmall]}>
                  <AppInput
                    variant="field"
                    height={FIELD_HEIGHT}
                    label={copy.serverHost}
                    placeholder="server.example.lan"
                    value={host}
                    onChangeText={setHost}
                    error={serverErrors.host}
                    editable={!formLocked}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="url"
                    containerStyle={styles.hostField}
                  />
                  <AppInput
                    variant="field"
                    height={FIELD_HEIGHT}
                    label={copy.serverPort}
                    value={port}
                    onChangeText={setPort}
                    error={serverErrors.port}
                    editable={!formLocked}
                    keyboardType="number-pad"
                    containerStyle={styles.portField}
                  />
                </View>
              ) : null}

              <AppText variant="statValue" style={styles.gapTop}>
                {copy.formatTitle}
              </AppText>
              <View style={[styles.optionList, styles.gapTopSmall]} accessibilityRole="radiogroup">
                {payloadFormats.map((option) => {
                  const selected = format === option.id;
                  return (
                    <Pressable
                      key={option.id}
                      disabled={formLocked}
                      onPress={() => setFormat(option.id)}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: selected, disabled: formLocked }}
                      style={({ pressed }) => [styles.option, selected && styles.optionSelected, pressed && styles.pressed]}
                    >
                      <Ionicons
                        name={selected ? 'radio-button-on' : 'radio-button-off'}
                        size={ROW_ICON_SIZE}
                        color={selected ? theme.colors.electricCyan : theme.colors.textSupport}
                      />
                      <View style={styles.optionText}>
                        <AppText variant="statValue">{option.label}</AppText>
                        <AppText variant="tileCaption" color={theme.colors.textSupport}>
                          {option.body}
                        </AppText>
                      </View>
                    </Pressable>
                  );
                })}
              </View>
              <View style={styles.chipRow}>
                <TextAction title="Source: official app capture" onPress={() => void Linking.openURL(apProvisioningSources.ewelinkApp)} />
                <TextAction title="Source: SonOTA" onPress={() => void Linking.openURL(apProvisioningSources.sonotaV4)} />
              </View>

              {reviewing ? (
                <Notice
                  tone="warning"
                  title={copy.confirmTitle}
                  style={styles.gapTop}
                  actions={
                    <View style={[styles.actionRow, styles.flex]}>
                      <SecondaryAction title={copy.confirmBack} onPress={() => setReviewing(false)} style={styles.actionCell} />
                      <PrimaryAction title={copy.confirmSend} onPress={send} style={styles.actionCell} />
                    </View>
                  }
                >
                  <AppText variant="tileCaption" color={theme.colors.textPrimary} selectable>
                    {[
                      'To: http://10.10.7.1/ap',
                      `Wi-Fi: ${ssid}`,
                      `Password: ${password ? `${'•'.repeat(8)} (${password.length} characters)` : 'none (open network)'}`,
                      `Server: ${target.serverName}:${target.port}`,
                      `Format: ${payloadFormats.find((entry) => entry.id === format)?.label ?? format}`,
                    ].join('\n')}
                  </AppText>
                  <AppText variant="tileCaption" color={theme.colors.textSupport}>
                    {copy.confirmWarning}
                  </AppText>
                </Notice>
              ) : (
                <PrimaryAction title={copy.review} onPress={review} style={styles.gapTop} />
              )}
            </>
          )}
        </View>
      </NeonPanel>

      <NeonPanel style={[styles.card, styles.panelTight]}>
        <PanelHeading title={copy.alreadySetUpTitle} iconSet="ionicons" iconName="refresh-circle-outline" iconSize={19} />
        <View style={[styles.panelBody, styles.gapTop]}>
          <AppText variant="tileCaption" color={theme.colors.textSupport}>
            {copy.alreadySetUpBody}
          </AppText>
          <SecondaryAction
            title={copy.alreadySetUpAction}
            icon="search-outline"
            onPress={pairing.skipProvisioning}
            disabled={formLocked}
            style={styles.gapTop}
          />
        </View>
      </NeonPanel>
    </View>
  );
}
