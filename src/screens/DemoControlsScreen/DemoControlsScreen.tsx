import { useNavigation } from '@react-navigation/native';
import { useMemo, useState } from 'react';
import { View } from 'react-native';

import { AppText } from '../../components/common/AppText';
import { ChipGroup, type ChipOption } from '../../components/parking/Controls';
import { Notice, type NoticeTone } from '../../components/parking/Notice';
import { Panel } from '../../components/parking/Panel';
import { ParkingButton } from '../../components/parking/ParkingButton';
import { ParkingFrame } from '../../components/parking/ParkingFrame';
import { ListRow } from '../../components/parking/Rows';
import { chargingStateLabel } from '../../components/parking/presenters';
import { useAppTheme } from '../../hooks/useAppTheme';
import { useParking } from '../../hooks/useParking';
import { runAcceptanceChecks, type CheckResult } from '../../services/parking/checks';
import type { ScanResult } from '../../services/parking/gate';
import type { PolicySettings } from '../../services/parking/policy';
import { reservationView } from '../../services/parking/selectors';
import { formatDateTime, formatDuration, ms } from '../../services/parking/time';
import { ParkingError } from '../../services/parking/tx';
import type { OccupancyState, Serviceability } from '../../services/parking/types';
import type { RootStackScreenProps } from '../../types/navigation.types';
import { clockSteps, demoCopy as copy, policyLabels } from './DemoControlsScreen.data';
import { createStyles } from './DemoControlsScreen.styles';

type Feedback = { tone: NoticeTone; text: string };

export function DemoControlsScreen() {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const navigation = useNavigation<RootStackScreenProps<'DemoControls'>['navigation']>();
  const { db, now, service, storageKind } = useParking();

  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [visitorId, setVisitorId] = useState<string | null>(null);
  const [simId, setSimId] = useState<string | null>(null);
  const [evId, setEvId] = useState<string | null>(null);
  const [bayId, setBayId] = useState<string | null>(null);
  const [checks, setChecks] = useState<CheckResult[] | null>(null);
  const [checking, setChecking] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  const views = useMemo(
    () => [...db.reservations].sort((a, b) => ms(a.scheduledStart) - ms(b.scheduledStart)).map((r) => reservationView(db, r, now)),
    [db, now],
  );
  const option = (v: (typeof views)[number]): ChipOption<string> => ({
    value: v.reservation.id,
    label: `${v.title} · ${v.space.label}`,
    detail: v.charging && v.reservation.status === 'checked-in' ? chargingStateLabel[v.charging.state] : v.status.label,
  });
  const open = views.filter((v) => v.reservation.status === 'confirmed' || v.reservation.status === 'checked-in');
  const guestPasses = views.filter((v) => v.reservation.bookedFor === 'guest');
  const evOpen = open.filter((v) => v.reservation.parkingType === 'ev');

  const run = async (action: () => Promise<unknown>, success: string | ((value: unknown) => Feedback)) => {
    setFeedback(null);
    try {
      const value = await action();
      setFeedback(typeof success === 'string' ? { tone: 'success', text: success } : success(value));
    } catch (e) {
      setFeedback({ tone: 'error', text: e instanceof ParkingError ? e.message : 'That did not work.' });
    }
  };

  const simulateGate = (direction: 'entry' | 'exit') => {
    const v = views.find((x) => x.reservation.id === simId);
    const token = v?.credential?.displayToken;
    if (!v || !token) return;
    const gateId = direction === 'entry' ? v.space.gateId : v.reservation.entryGateId ?? v.space.gateId;
    void run(
      () => service.scan(token, gateId, direction),
      (value) => {
        const result = value as ScanResult;
        const tone: NoticeTone =
          result.outcome === 'accepted' ? 'success' : result.outcome === 'already-processed' ? 'warning' : 'error';
        return { tone, text: `${result.title}: ${result.message}` };
      },
    );
  };

  const ev = views.find((x) => x.reservation.id === evId);
  const bay = db.spaces.find((s) => s.id === bayId);

  return (
    <ParkingFrame title={copy.title} bottomBar={false}>
      <Notice>{copy.intro}</Notice>
      {feedback ? <Notice tone={feedback.tone}>{feedback.text}</Notice> : null}

      <Panel title="Demo clock" icon="time-outline" subtitle={copy.clockNote}>
        <AppText variant="figure">{formatDateTime(now)}</AppText>
        <AppText variant="label" color={theme.colors.textSupport}>
          {db.clockOffsetMs > 0 ? `${formatDuration(db.clockOffsetMs / 60_000)} ahead of real time · Cairo` : 'Real time · Cairo'}
        </AppText>
        <View style={styles.row}>
          {clockSteps.map((step) => (
            <ParkingButton
              key={step.label}
              compact
              label={step.label}
              onPress={() => void run(() => service.advanceClock(step.ms), `Clock moved ${step.label}. Expiries, overstays and charging updated.`)}
              style={styles.quarter}
            />
          ))}
        </View>
      </Panel>

      <Panel title="View as" icon="people-outline" subtitle="Switch role to present each side of the flow.">
        <View style={styles.row}>
          <ParkingButton label="Resident" icon="home-outline" onPress={() => navigation.navigate('Parking')} style={styles.grow} />
          <ParkingButton label="Security" icon="shield-checkmark-outline" onPress={() => navigation.navigate('SecurityConsole')} style={styles.grow} />
        </View>
        <ChipGroup label="Visitor: open a guest's pass" scroll options={guestPasses.map(option)} value={visitorId} onChange={setVisitorId} />
        <ParkingButton
          label="Open as visitor"
          icon="phone-portrait-outline"
          disabled={!visitorId}
          onPress={() => {
            const invite = views.find((x) => x.reservation.id === visitorId)?.invitation?.inviteToken;
            if (invite) navigation.navigate('GuestPass', { invite });
          }}
        />
      </Panel>

      <Panel title="Simulate gate" icon="git-merge-outline" subtitle="Scans the pass's current QR at its assigned gate.">
        <ChipGroup scroll options={open.map(option)} value={simId} onChange={setSimId} />
        <View style={styles.row}>
          <ParkingButton compact label="Simulate entry" icon="log-in-outline" disabled={!simId} onPress={() => simulateGate('entry')} style={styles.grow} />
          <ParkingButton compact label="Simulate exit" icon="log-out-outline" disabled={!simId} onPress={() => simulateGate('exit')} style={styles.grow} />
        </View>
      </Panel>

      <Panel title="Simulate charging" icon="flash-outline">
        <ChipGroup scroll options={evOpen.map(option)} value={evId} onChange={setEvId} />
        {ev ? (
          <View style={styles.row}>
            <ParkingButton compact label="Plug in" disabled={ev.charging?.state !== 'waiting-for-plug-in'} onPress={() => void run(() => service.plugIn(ev.reservation.id, 'demo'), 'Plugged in; charging started.')} style={styles.grow} />
            <ParkingButton compact label="Charging complete" disabled={ev.charging?.state !== 'charging'} onPress={() => void run(() => service.simulateChargingComplete(ev.reservation.id), 'Charging completed. The bay stays occupied until the car moves.')} style={styles.grow} />
            <ParkingButton compact label="Moved out of EV bay" disabled={ev.reservation.status !== 'checked-in' || Boolean(ev.reservation.bayVacatedAt)} onPress={() => void run(() => service.markMovedOut(ev.reservation.id, 'demo', 'Simulated bay sensor'), 'Bay released; the visit is still inside the compound.')} style={styles.grow} />
            <ParkingButton compact label="Open session" onPress={() => navigation.navigate('ChargingSession', { reservationId: ev.reservation.id })} style={styles.grow} />
          </View>
        ) : null}
        {db.chargers.map((c, index) => (
          <View key={c.id}>
            <ListRow divided={index > 0 || Boolean(ev)} icon="flash-outline" title={c.label} lines={[`Up to ${c.maxConcurrent} car${c.maxConcurrent > 1 ? 's' : ''} at once · ${db.connectors.filter((x) => x.chargerId === c.id).map((x) => x.type).join(', ')}`]} statusLabel={c.status === 'available' ? 'In service' : 'Fault'} statusTone={c.status === 'available' ? 'teal' : 'red'} />
            <ParkingButton
              compact
              label={c.status === 'available' ? 'Simulate charger fault' : 'Restore charger'}
              tone={c.status === 'available' ? 'danger' : 'secondary'}
              onPress={() =>
                void (c.status === 'available'
                  ? run(() => service.faultCharger(c.id), `${c.label} faulted. Active sessions interrupted; upcoming bookings flagged.`)
                  : run(() => service.restoreCharger(c.id), `${c.label} back in service.`))
              }
            />
          </View>
        ))}
      </Panel>

      <Panel title="Simulate bays" icon="grid-outline" subtitle="Bay sensors and maintenance status.">
        <ChipGroup scroll options={db.spaces.map((s) => ({ value: s.id, label: s.label, detail: `${s.occupancy} · ${s.serviceability}` }))} value={bayId} onChange={setBayId} />
        {bay ? (
          <>
            <View style={styles.row}>
              {(['occupied', 'vacant', 'unknown'] as OccupancyState[]).map((state) => (
                <ParkingButton key={state} compact label={`Mark ${state}`} disabled={bay.occupancy === state} onPress={() => void run(() => service.setOccupancy(bay.id, state, 'demo', 'Simulated sensor'), `${bay.label} is now ${state}.`)} style={styles.quarter} />
              ))}
            </View>
            <View style={styles.row}>
              {(['in-service', 'maintenance', 'out-of-service'] as Serviceability[]).map((state) => (
                <ParkingButton key={state} compact label={state.replace(/-/g, ' ')} disabled={bay.serviceability === state} onPress={() => void run(() => service.setServiceability(bay.id, state, 'demo', 'Simulated'), `${bay.label} set to ${state.replace(/-/g, ' ')}.`)} style={styles.quarter} />
              ))}
            </View>
          </>
        ) : null}
      </Panel>

      <Panel title="Acceptance checks" icon="checkmark-done-outline" subtitle="Runs the scenarios on a private copy; your demo data is not touched.">
        <ParkingButton
          label={checks ? 'Run again' : 'Run acceptance checks'}
          icon="play-outline"
          tone="primary"
          loading={checking}
          onPress={() => {
            setChecking(true);
            void runAcceptanceChecks()
              .then(setChecks)
              .finally(() => setChecking(false));
          }}
        />
        {checks ? (
          <>
            <AppText variant="bodyStrong">{`${checks.filter((c) => c.passed).length} of ${checks.length} passed`}</AppText>
            {checks.map((c, index) => (
              <ListRow key={c.id} divided={index > 0} icon={c.passed ? 'checkmark-circle-outline' : 'close-circle-outline'} title={`${c.id}. ${c.name}`} lines={[c.detail]} statusLabel={c.passed ? 'Pass' : 'Fail'} statusTone={c.passed ? 'teal' : 'red'} />
            ))}
          </>
        ) : null}
      </Panel>

      <Panel title="Data" icon="server-outline">
        <AppText variant="caption" color={theme.colors.textSecondary}>
          {copy.storage[storageKind]}
        </AppText>
        <AppText variant="label" color={theme.colors.textMuted}>
          {`${db.reservations.length} bookings · ${db.scanEvents.length} gate events · ${db.audit.length} audit entries · revision ${db.revision}`}
        </AppText>
        {confirmReset ? (
          <Notice
            tone="warning"
            title="Reset demo data?"
            actions={
              <>
                <ParkingButton compact label="Keep data" onPress={() => setConfirmReset(false)} />
                <ParkingButton
                  compact
                  tone="danger"
                  label="Reset"
                  onPress={() => {
                    setConfirmReset(false);
                    void run(() => service.resetDemo(), 'Demo data reset to the seed at the current time.');
                  }}
                />
              </>
            }
          >
            {copy.resetConfirm}
          </Notice>
        ) : (
          <ParkingButton label="Reset demo data" icon="refresh-outline" tone="danger" onPress={() => setConfirmReset(true)} />
        )}
      </Panel>

      <Panel title="Policy settings" icon="options-outline" subtitle="Configuration in services/parking/policy.ts">
        {(Object.keys(policyLabels) as (keyof PolicySettings)[]).map((key) => (
          <View key={key} style={styles.policyRow}>
            <AppText variant="caption" color={theme.colors.textSecondary} style={styles.policyLabel}>
              {policyLabels[key][0]}
            </AppText>
            <AppText variant="bodyStrong">{`${db.policy[key]} ${policyLabels[key][1]}`}</AppText>
          </View>
        ))}
      </Panel>
    </ParkingFrame>
  );
}
