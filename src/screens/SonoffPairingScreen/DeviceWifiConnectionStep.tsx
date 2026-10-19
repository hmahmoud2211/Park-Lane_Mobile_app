import Ionicons from '@expo/vector-icons/Ionicons';
import { useMemo, useState } from 'react';
import { Platform, Pressable, View } from 'react-native';

import { AppText } from '../../components/common/AppText';
import { DeviceConnectionStatus, type ConnectionDetail, type ConnectionTone } from '../../components/ui/DeviceConnectionStatus';
import { NeonPanel } from '../../components/ui/NeonPanel';
import { PairingStep } from '../../components/ui/PairingStep';
import { useAppTheme } from '../../hooks/useAppTheme';
import type { SonoffPairing } from '../../hooks/useSonoffPairing';
import { canOpenWifiSettings } from '../../services/sonoff/wifiProvisioningService';
import { ErrorNotice, Notice, PrimaryAction, SecondaryAction, TextAction } from './PairingParts';
import { pairingCopy as copy, type AdviceAction } from './SonoffPairingScreen.data';
import { ROW_ICON_SIZE, createStyles } from './SonoffPairingScreen.styles';

interface DeviceWifiConnectionStepProps {
  pairing: SonoffPairing;
  onAdviceAction: (action: AdviceAction) => void;
  onOpenWifiSettings: () => void;
}

/** Signal bars for a hotspot's dBm, as Android's own picker draws them. */
function signalIcon(level: number): keyof typeof Ionicons.glyphMap {
  return level >= -60 ? 'wifi' : level >= -75 ? 'wifi-outline' : 'cellular-outline';
}

/** Stages 2 and 3: onto the plug's hotspot, then `/device` decides whether it is really there. */
export function DeviceWifiConnectionStep({ pairing, onAdviceAction, onOpenWifiSettings }: DeviceWifiConnectionStepProps) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  // With the native module the app joins for the resident; this shows the by-hand route instead.
  const [manual, setManual] = useState(!pairing.nativeWifi);
  const { device, network, busy, error } = pairing;

  const tone: ConnectionTone = device ? 'success' : busy ? 'working' : error ? 'error' : 'idle';
  const title = device ? copy.detectedTitle : busy ? (pairing.activity ?? copy.connectIdle) : copy.connectIdle;
  const caption = device ? copy.detectedCaption : busy ? undefined : copy.connectIdleCaption;

  const details: ConnectionDetail[] = device
    ? [
        { label: 'Device ID', value: device.deviceId },
        ...(device.chipId ? [{ label: 'Chip ID', value: device.chipId }] : []),
        { label: 'Model', value: 'Not reported by the device', muted: true },
        {
          label: 'Connection',
          value: network.ssid ? `Phone on ${network.ssid}` : 'Plug answering at 10.10.7.1',
        },
        { label: 'Device key', value: 'Received, kept private' },
      ]
    : [];

  const unavailable: AdviceAction[] = canOpenWifiSettings() ? [] : ['wifiSettings'];

  const goManual = () => {
    setManual(true);
    pairing.markManualJoin();
  };

  return (
    <View>
      <NeonPanel style={[styles.card, styles.panel]}>
        <DeviceConnectionStatus tone={tone} title={title} caption={caption} details={details} />
        {error && !device ? (
          <ErrorNotice
            error={error}
            onRetry={error.kind === 'unsupportedPlatform' ? undefined : pairing.retry}
            onAction={onAdviceAction}
            unavailableActions={unavailable}
            style={styles.gapTop}
          />
        ) : null}
      </NeonPanel>

      {!device && !manual && pairing.canScan ? (
        <NeonPanel style={[styles.card, styles.panel]}>
          <AppText variant="statValue" style={styles.sectionTitle}>
            {copy.hotspotsTitle}
          </AppText>
          {pairing.hotspots.length === 0 ? (
            <AppText variant="tileCaption" color={theme.colors.textSupport}>
              {copy.noHotspots}
            </AppText>
          ) : (
            <View style={[styles.optionList, styles.gapTopSmall]} accessibilityRole="radiogroup">
              {pairing.hotspots.map((hotspot) => {
                const selected = hotspot.ssid === pairing.selectedHotspot;
                return (
                  <Pressable
                    key={hotspot.ssid}
                    onPress={() => pairing.selectHotspot(hotspot.ssid)}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: selected }}
                    style={({ pressed }) => [styles.option, selected && styles.optionSelected, pressed && styles.pressed]}
                  >
                    <Ionicons name={signalIcon(hotspot.level)} size={ROW_ICON_SIZE} color={theme.colors.textPrimary} />
                    <AppText variant="statValue" style={styles.optionText} numberOfLines={1}>
                      {hotspot.ssid}
                    </AppText>
                    {selected ? (
                      <Ionicons name="checkmark-circle" size={ROW_ICON_SIZE} color={theme.colors.electricCyan} />
                    ) : null}
                  </Pressable>
                );
              })}
            </View>
          )}
          <SecondaryAction
            title={copy.scanAgain}
            icon="refresh"
            onPress={() => void pairing.scanHotspots()}
            disabled={busy}
            style={styles.gapTop}
          />
        </NeonPanel>
      ) : null}

      {!device && manual ? (
        <NeonPanel style={[styles.card, styles.panel]}>
          <AppText variant="statValue" style={styles.sectionTitle}>
            {copy.manualTitle}
          </AppText>
          <View style={styles.gapTopSmall}>
            {copy.manualSteps.map((step, index) => (
              <PairingStep
                key={step}
                index={index + 1}
                title={step}
                connector={index < copy.manualSteps.length - 1}
              />
            ))}
          </View>
        </NeonPanel>
      ) : null}

      {!device && Platform.OS !== 'web' ? (
        <Notice tone="info" style={styles.card}>
          {copy.noInternetNote}
        </Notice>
      ) : null}

      <View style={styles.actions}>
        {device ? (
          <PrimaryAction title={copy.continue} onPress={pairing.continueToWifi} />
        ) : manual ? (
          <>
            <PrimaryAction title={copy.checkForPlug} onPress={() => void pairing.detect()} loading={busy} />
            {canOpenWifiSettings() ? (
              <SecondaryAction title={copy.openWifiSettings} icon="settings-outline" onPress={onOpenWifiSettings} />
            ) : null}
          </>
        ) : (
          <>
            <PrimaryAction
              title={pairing.selectedHotspot ? copy.joinNamed(pairing.selectedHotspot) : copy.joinPrompt}
              onPress={() => void pairing.joinHotspot()}
              disabled={pairing.canScan && !pairing.selectedHotspot}
              loading={busy}
            />
            <TextAction title={copy.useSettingsInstead} onPress={goManual} />
          </>
        )}
      </View>
    </View>
  );
}
