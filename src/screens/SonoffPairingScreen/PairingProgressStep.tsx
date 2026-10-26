import { useMemo, useState } from 'react';
import { View } from 'react-native';

import { AppInput } from '../../components/common/AppInput';
import { AppText } from '../../components/common/AppText';
import {
  DeviceConnectionStatus,
  type ConnectionDetail,
  type ConnectionTone,
} from '../../components/ui/DeviceConnectionStatus';
import { NeonPanel } from '../../components/ui/NeonPanel';
import { PairingStep } from '../../components/ui/PairingStep';
import { PanelHeading } from '../../components/ui/PanelHeading';
import { useAppTheme } from '../../hooks/useAppTheme';
import type { ProgressPhaseId, SonoffPairing } from '../../hooks/useSonoffPairing';
import { canOpenWifiSettings } from '../../services/sonoff/wifiProvisioningService';
import type { PairingStatus } from '../../types/sonoff.types';
import { ErrorNotice, Notice, PrimaryAction, SecondaryAction } from './PairingParts';
import { pairingCopy as copy, phaseLabels, statusLabels, type AdviceAction } from './SonoffPairingScreen.data';
import { FIELD_HEIGHT, createStyles } from './SonoffPairingScreen.styles';

interface PairingProgressStepProps {
  pairing: SonoffPairing;
  onAdviceAction: (action: AdviceAction) => void;
  onDone: () => void;
}

const PHASES: readonly ProgressPhaseId[] = ['send', 'leave', 'home', 'find', 'hub'];

const TONES: Record<PairingStatus, ConnectionTone> = {
  waitingForPairing: 'idle',
  connectingToDevice: 'working',
  deviceDetected: 'success',
  configuringWifi: 'working',
  waitingForReconnection: 'working',
  deviceDiscovered: 'success',
  provisioningFailed: 'error',
  registrationRequired: 'warning',
  setupCompleted: 'success',
};

/** Stages 5 and 6: watch the plug move to home Wi-Fi, find it there, and register it with the hub. */
export function PairingProgressStep({ pairing, onAdviceAction, onDone }: PairingProgressStepProps) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [name, setName] = useState<string>(copy.defaultName);
  const [nameError, setNameError] = useState<string | undefined>();
  const { status, phases, lanDevice, registration, error, busy, controlTest } = pairing;

  const title =
    status === 'deviceDiscovered'
      ? copy.discoveredTitle
      : status === 'setupCompleted'
        ? copy.completedTitle
        : statusLabels[status];
  const caption =
    status === 'deviceDiscovered'
      ? copy.discoveredCaption
      : status === 'setupCompleted'
        ? copy.completedCaption
        : (pairing.activity ?? undefined);

  const details: ConnectionDetail[] = [];
  if (lanDevice) {
    details.push({ label: 'Address', value: `${lanDevice.host}:${lanDevice.port}` });
    details.push({
      label: 'LAN mode',
      value: lanDevice.encrypted ? 'Encrypted (stock firmware)' : 'Unencrypted (DIY mode)',
    });
    details.push({
      label: 'Key',
      value: lanDevice.keyVerified ? 'Verified' : lanDevice.keyVerified === false ? 'Did not match' : 'Not needed',
      muted: lanDevice.keyVerified !== true,
    });
    if (lanDevice.power) {
      details.push({ label: 'Power', value: lanDevice.power === 'on' ? 'On' : 'Off' });
    }
  }
  if (registration) {
    details.push({ label: 'Hub serial', value: registration.cubeSerial });
    if (registration.emsDeviceId) {
      details.push({ label: 'EMS devices', value: 'Added (app and Alexa)' });
    } else if (registration.emsError) {
      details.push({ label: 'EMS devices', value: `Not added: ${registration.emsError}`, muted: true });
    }
  }

  const addToHub = () => {
    if (!name.trim()) {
      setNameError(copy.nameMissing);
      return;
    }
    setNameError(undefined);
    void pairing.register(name.trim());
  };

  const phaseBody = (id: ProgressPhaseId): string | undefined => {
    const state = phases[id];
    if (state === 'skipped') {
      return phaseLabels[id].skipped;
    }
    if (id === 'send' && state === 'done') {
      if (pairing.provisionOutcome?.kind === 'accepted') {
        return copy.acceptedNote;
      }
      return phases.find === 'done' ? copy.noResponseJoinedNote : copy.noResponseNote;
    }
    if (id === 'leave' && pairing.skippedProvisioning && state === 'active') {
      return copy.powerCycleNote;
    }
    return undefined;
  };

  const unavailable: AdviceAction[] = canOpenWifiSettings() ? [] : ['wifiSettings'];
  const settled = status === 'provisioningFailed' || status === 'registrationRequired';

  return (
    <View>
      <NeonPanel style={[styles.card, styles.panel]}>
        <DeviceConnectionStatus
          tone={TONES[status]}
          title={title}
          caption={caption}
          from={phases.find === 'pending' ? 'phone' : 'hub'}
          details={details}
        />
      </NeonPanel>

      <NeonPanel style={[styles.card, styles.panelTight]}>
        <PanelHeading title={copy.progressTitle} iconSet="ionicons" iconName="git-commit-outline" iconSize={19} />
        <View style={[styles.panelBody, styles.gapTop]}>
          {PHASES.map((id, index) => (
            <PairingStep
              key={id}
              index={index + 1}
              title={phaseLabels[id].title}
              body={phaseBody(id)}
              state={phases[id]}
              connector={index < PHASES.length - 1}
            />
          ))}
        </View>
      </NeonPanel>

      {error && settled ? (
        <ErrorNotice
          error={error}
          onRetry={busy ? undefined : pairing.retry}
          onAction={onAdviceAction}
          unavailableActions={unavailable}
          style={styles.card}
        />
      ) : null}

      {status === 'registrationRequired' ? (
        <Notice tone="info" style={styles.card}>
          {copy.ownershipNote}
        </Notice>
      ) : null}

      {status === 'deviceDiscovered' || (status === 'registrationRequired' && lanDevice && phases.hub !== 'pending') ? (
        <NeonPanel style={[styles.card, styles.panelTight]}>
          <PanelHeading title={copy.addToHub} iconSet="material" iconName="router-wireless" iconSize={19} />
          <View style={[styles.panelBody, styles.gapTop]}>
            <AppInput
              variant="field"
              height={FIELD_HEIGHT}
              label={copy.nameLabel}
              placeholder={copy.namePlaceholder}
              value={name}
              onChangeText={setName}
              error={nameError}
              editable={!busy}
              returnKeyType="done"
              onSubmitEditing={addToHub}
            />
            <PrimaryAction title={copy.addToHub} onPress={addToHub} loading={busy} style={styles.gapTop} />
          </View>
        </NeonPanel>
      ) : null}

      {status === 'setupCompleted' ? (
        <NeonPanel style={[styles.card, styles.panelTight]}>
          <PanelHeading title={copy.testTitle} iconSet="material" iconName="power-plug-outline" iconSize={19} />
          <View style={[styles.panelBody, styles.gapTop]}>
            <View style={styles.actionRow}>
              <SecondaryAction
                title={copy.turnOn}
                icon="power"
                onPress={() => void pairing.testControl(true)}
                disabled={controlTest.state === 'busy'}
                style={styles.actionCell}
              />
              <SecondaryAction
                title={copy.turnOff}
                icon="power-outline"
                onPress={() => void pairing.testControl(false)}
                disabled={controlTest.state === 'busy'}
                style={styles.actionCell}
              />
            </View>
            {controlTest.state === 'ok' && controlTest.power ? (
              <Notice tone="success" style={styles.gapTopSmall}>
                {copy.testOk(controlTest.power)}
              </Notice>
            ) : null}
            {controlTest.state === 'failed' ? (
              <Notice tone="error" title="The hub could not switch the plug" style={styles.gapTopSmall}>
                {controlTest.message}
              </Notice>
            ) : null}
            {controlTest.state === 'busy' ? (
              <AppText variant="tileCaption" color={theme.colors.textSupport} style={styles.gapTopSmall}>
                Sending through the hub…
              </AppText>
            ) : null}
          </View>
        </NeonPanel>
      ) : null}

      <View style={styles.actions}>
        {status === 'setupCompleted' ? <PrimaryAction title={copy.done} onPress={onDone} /> : null}
        {status === 'provisioningFailed' ? (
          <SecondaryAction title={copy.editWifi} icon="create-outline" onPress={pairing.backToForm} />
        ) : null}
      </View>
    </View>
  );
}
