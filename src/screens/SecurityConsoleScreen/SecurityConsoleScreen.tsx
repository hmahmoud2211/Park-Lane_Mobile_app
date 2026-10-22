import Ionicons from '@expo/vector-icons/Ionicons';
import { useMemo, useState } from 'react';
import { View } from 'react-native';

import { AppText } from '../../components/common/AppText';
import { ChipGroup, Field, type ChipOption } from '../../components/parking/Controls';
import { Notice, type NoticeTone } from '../../components/parking/Notice';
import { Panel } from '../../components/parking/Panel';
import { ParkingButton } from '../../components/parking/ParkingButton';
import { ParkingFrame } from '../../components/parking/ParkingFrame';
import { QrScanner } from '../../components/parking/QrScanner';
import { ListRow } from '../../components/parking/Rows';
import { notificationIcon } from '../../components/parking/presenters';
import { useAppTheme } from '../../hooks/useAppTheme';
import { useParking } from '../../hooks/useParking';
import type { ScanResult } from '../../services/parking/gate';
import { notificationsFor, reservationView } from '../../services/parking/selectors';
import { formatDateTime, formatTime, ms } from '../../services/parking/time';
import { expectedArrivals, type ExpectedArrival } from '../../services/parking/tracking';
import { ParkingError } from '../../services/parking/tx';
import type { OccupancyState, ScanDirection } from '../../services/parking/types';
import {
  arrivalChip,
  arrivalPicked,
  arrivalScan,
  consoleCopy as copy,
  keepTogether,
  needsBayChip,
  resultTone,
} from './SecurityConsoleScreen.data';
import { createStyles } from './SecurityConsoleScreen.styles';

type Feedback = { tone: NoticeTone; text: string };

/**
 * The security desk's view (demo role): scan or paste a pass at a chosen
 * gate, see the decision and its reason, work the exception queue and
 * record logged overrides.
 */
export function SecurityConsoleScreen() {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { db, now, service } = useParking();

  const [gateId, setGateId] = useState(db.gates[0]?.id ?? '');
  const gate = db.gates.find((g) => g.id === gateId);
  const [direction, setDirection] = useState<ScanDirection>('entry');
  const effectiveDirection: ScanDirection = gate?.direction === 'exit' ? 'exit' : gate?.direction === 'entry' ? 'entry' : direction;

  const [camera, setCamera] = useState(false);
  const [pasted, setPasted] = useState('');
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [arrivalId, setArrivalId] = useState<string | null>(null);

  const [manualId, setManualId] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [plate, setPlate] = useState('');
  const [bayId, setBayId] = useState<string | null>(null);
  const [bayNote, setBayNote] = useState('');

  const reservations = useMemo(
    () => [...db.reservations].sort((a, b) => ms(b.scheduledStart) - ms(a.scheduledStart)).map((r) => reservationView(db, r, now)),
    [db, now],
  );
  const passOptions: ChipOption<string>[] = reservations.map((v) => ({
    value: v.reservation.id,
    label: `${v.title} · ${v.space.label}`,
    detail: `${v.status.label} · ${formatTime(v.reservation.scheduledStart)}`,
  }));
  const openOptions = passOptions.filter((o) => {
    const r = db.reservations.find((x) => x.id === o.value);
    return r?.status === 'confirmed' || r?.status === 'checked-in';
  });
  const exceptions = notificationsFor(db, 'operator').filter((n) => !n.resolvedAt);
  const arrivals = expectedArrivals(db, now, 60);
  // Gone from the list once the car is in, so its prompt goes too.
  const arrival = arrivals.find((a) => a.reservationId === arrivalId);
  const gateShort = (id: string) => db.gates.find((g) => g.id === id)?.name.split(' · ')[0] ?? '';
  const recentScans = [...db.scanEvents].sort((a, b) => ms(b.at) - ms(a.at)).slice(0, 8);

  const scan = async (input: string) => {
    if (!gate) return;
    setFeedback(null);
    try {
      setResult(await service.scan(input, gate.id, effectiveDirection));
    } catch (e) {
      setResult(null);
      setFeedback({ tone: 'error', text: e instanceof ParkingError ? e.message : 'Scan failed.' });
    }
  };

  const act = async (action: () => Promise<unknown>, success: string) => {
    setFeedback(null);
    try {
      const outcome = await action();
      if (outcome && typeof outcome === 'object' && 'outcome' in outcome) {
        setResult(outcome as ScanResult);
      } else {
        setFeedback({ tone: 'success', text: success });
      }
    } catch (e) {
      setFeedback({ tone: 'error', text: e instanceof ParkingError ? e.message : 'That did not work.' });
    }
  };

  /** Sets the console up for an expected car: its gate, the entry lane and its pass. */
  const prepareArrival = (picked: ExpectedArrival) => {
    setGateId(picked.gateId);
    setDirection('entry');
    setPickedId(picked.reservationId);
    setArrivalId(picked.reservationId);
    setResult(null);
    setFeedback(null);
  };

  const scanArrival = (picked: ExpectedArrival) => {
    const r = db.reservations.find((x) => x.id === picked.reservationId);
    const token = db.credentials.find((c) => c.id === r?.credentialId)?.displayToken;
    setArrivalId(null);
    if (token) void scan(token);
  };

  const picked = db.reservations.find((r) => r.id === pickedId);
  const pickedCredentials = picked ? db.credentials.filter((c) => c.reservationId === picked.id) : [];
  const olderCredential = pickedCredentials.find((c) => c.id !== picked?.credentialId);
  const manual = db.reservations.find((r) => r.id === manualId);
  const manualView = manual ? reservationView(db, manual, now) : null;
  const bay = db.spaces.find((s) => s.id === bayId);

  // The desk on wide screens: the gate and arrivals on the left, tools and logs on the right.
  const tools = (
    <>
      <Panel title="Simulate a scan" icon="phone-portrait-outline" subtitle="Pick any demo pass and scan it at the gate above.">
        <ChipGroup scroll options={passOptions} value={pickedId} onChange={setPickedId} />
        <View style={styles.row}>
          <ParkingButton
            label="Scan current QR"
            icon="qr-code-outline"
            disabled={!picked}
            onPress={() => {
              const token = pickedCredentials.find((c) => c.id === picked?.credentialId)?.displayToken;
              if (token) void scan(token);
            }}
            style={styles.grow}
          />
          {olderCredential ? (
            <ParkingButton label="Scan replaced QR" icon="refresh-outline" onPress={() => void scan(olderCredential.displayToken)} style={styles.grow} />
          ) : null}
        </View>
      </Panel>

      <Panel title={`Exceptions (${exceptions.length})`} icon="alert-circle-outline">
        {exceptions.length === 0 ? (
          <AppText variant="caption" color={theme.colors.textSecondary}>
            Nothing needs attention.
          </AppText>
        ) : (
          exceptions.map((n, index) => {
            const r = db.reservations.find((x) => x.id === n.reservationId);
            return (
              <View key={n.id}>
                <ListRow divided={index > 0} icon={notificationIcon[n.kind]} title={n.title} lines={[n.body, formatDateTime(n.at)]} />
                <View style={styles.row}>
                  {r?.needsReassignment && r.status === 'confirmed' ? (
                    <ParkingButton compact tone="primary" label="Reassign bay" onPress={() => void act(() => service.reassign(r.id, 'operator'), 'Reassigned to the nearest free bay.')} style={styles.grow} />
                  ) : null}
                  {r ? <ParkingButton compact label="Resolve manually" onPress={() => setManualId(r.id)} style={styles.grow} /> : null}
                  <ParkingButton compact label="Mark handled" onPress={() => void act(() => service.resolveNotification(n.id, 'operator', 'Handled at the desk'), 'Marked as handled.')} style={styles.grow} />
                </View>
              </View>
            );
          })
        )}
      </Panel>

      <Panel title="Manual resolution" icon="hand-left-outline" subtitle="Lost pass, unreadable code or a stuck session. Every override is logged with its reason.">
        <ChipGroup scroll options={openOptions} value={manualId} onChange={setManualId} />
        {manualView ? (
          <>
            <AppText variant="caption" color={theme.colors.textSecondary}>
              {`${manualView.reservation.reference} · ${manualView.reservation.vehiclePlate ?? 'no plate'} · ${manualView.space.label} · ${manualView.status.label}`}
            </AppText>
            <Field label="Reason (logged)" value={reason} onChangeText={setReason} placeholder="e.g. Phone battery dead, checked ID" icon="create-outline" />
            {manual?.status === 'confirmed' && !manual.vehiclePlate ? (
              <Field label="Plate seen at the gate" value={plate} onChangeText={setPlate} autoCapitalize="characters" icon="car-outline" />
            ) : null}
            <View style={styles.row}>
              {manual?.status === 'confirmed' ? (
                <ParkingButton compact label={`Admit at ${gate?.name.split(' · ')[0]}`} icon="log-in-outline" onPress={() => void act(() => service.operatorEntry(manual.id, gateId, reason, plate || undefined), '')} style={styles.grow} />
              ) : null}
              {manual?.status === 'checked-in' ? (
                <ParkingButton compact label={`Record exit at ${gate?.name.split(' · ')[0]}`} icon="log-out-outline" onPress={() => void act(() => service.operatorExit(manual.id, gateId, reason), '')} style={styles.grow} />
              ) : null}
              {manual?.status === 'checked-in' && manual.parkingType === 'ev' && !manual.bayVacatedAt ? (
                <ParkingButton compact label="Moved out of EV bay" icon="swap-horizontal-outline" onPress={() => void act(() => service.markMovedOut(manual.id, 'operator', reason || undefined), 'EV bay released. The visit stays open until the car exits.')} style={styles.grow} />
              ) : null}
              {manualView.charging?.state === 'charging' ? (
                <ParkingButton compact label="Stop charging" icon="stop-circle-outline" onPress={() => void act(() => service.stopCharging(manual!.id, 'operator'), 'Charging stopped by security.')} style={styles.grow} />
              ) : null}
            </View>
            <AppText variant="label" color={theme.colors.textMuted}>
              {copy.emergency}
            </AppText>
          </>
        ) : null}
      </Panel>

      <Panel title="Bay status" icon="grid-outline" subtitle="Correct a bay that is reported wrongly.">
        <ChipGroup scroll options={db.spaces.map((s) => ({ value: s.id, label: s.label, detail: s.serviceability === 'in-service' ? s.occupancy : `${s.occupancy} · ${s.serviceability.replace(/-/g, ' ')}` }))} value={bayId} onChange={setBayId} />
        {bay ? (
          <>
            <Field label="Note (logged)" value={bayNote} onChangeText={setBayNote} placeholder="e.g. Checked on patrol" icon="create-outline" />
            <View style={styles.row}>
              {(['vacant', 'occupied', 'unknown'] as OccupancyState[]).map((state) => (
                <ParkingButton
                  key={state}
                  compact
                  label={state === bay.occupancy ? `${state} (now)` : `Mark ${state}`}
                  disabled={state === bay.occupancy}
                  onPress={() => void act(() => service.setOccupancy(bay.id, state, 'operator', bayNote), `${bay.label} marked ${state}.`)}
                  style={styles.grow}
                />
              ))}
            </View>
          </>
        ) : null}
      </Panel>

      <Panel title="Gate log" icon="list-outline">
        {recentScans.map((e, index) => {
          const g = db.gates.find((x) => x.id === e.gateId);
          const r = db.reservations.find((x) => x.id === e.reservationId);
          return (
            <ListRow
              key={e.id}
              divided={index > 0}
              icon={e.direction === 'entry' ? 'log-in-outline' : 'log-out-outline'}
              title={`${e.outcome === 'accepted' ? 'Opened' : 'Refused'} · ${g?.name.split(' · ')[0]} ${e.direction}`}
              lines={[`${r?.guest?.name ?? r?.reference ?? 'Unknown pass'} · ${formatDateTime(e.at)}`, e.operatorOverride ? `Override: ${e.operatorOverride.reason}` : e.message]}
              statusLabel={e.outcome === 'accepted' ? 'Opened' : 'Refused'}
              statusTone={e.outcome === 'accepted' ? 'teal' : 'red'}
            />
          );
        })}
        <AppText variant="label" color={theme.colors.textMuted}>
          {copy.entryNote}
        </AppText>
      </Panel>
    </>
  );

  return (
    <ParkingFrame title={copy.title} bottomBar={false} aside={tools}>
      <Notice>{copy.roleNote}</Notice>

      <Panel title="Gate" icon="git-merge-outline">
        <ChipGroup
          options={db.gates.map((g) => ({ value: g.id, label: g.name, detail: g.direction === 'both' ? 'Entry and exit' : 'Exit only' }))}
          value={gateId}
          onChange={setGateId}
        />
        <ChipGroup
          label="Lane"
          options={[
            { value: 'entry', label: 'Entry', icon: 'log-in-outline', disabled: gate?.direction === 'exit' },
            { value: 'exit', label: 'Exit', icon: 'log-out-outline', disabled: gate?.direction === 'entry' },
          ]}
          value={effectiveDirection}
          onChange={setDirection}
        />
      </Panel>

      <Panel title="Scan a pass" icon="scan-outline" subtitle={`${gate?.name} · ${effectiveDirection === 'entry' ? 'entry lane' : 'exit lane'}`}>
        {camera ? (
          <QrScanner onScan={(data) => void scan(data)} onClose={() => setCamera(false)} />
        ) : (
          <ParkingButton label="Scan with camera" icon="camera-outline" tone="primary" onPress={() => setCamera(true)} />
        )}
        <Field
          label="Or paste a code or link"
          value={pasted}
          onChangeText={setPasted}
          placeholder="plq_…"
          autoCapitalize="none"
          autoCorrect={false}
          icon="clipboard-outline"
        />
        <ParkingButton label="Validate pasted code" icon="checkmark-done-outline" disabled={!pasted.trim()} onPress={() => void scan(pasted.trim())} />
      </Panel>

      {result ? (
        <Notice tone={resultTone(result)} title={result.title}>
          <View style={styles.result}>
            <Ionicons
              name={result.gateOpened ? 'lock-open-outline' : result.outcome === 'already-processed' ? 'information-circle-outline' : 'lock-closed-outline'}
              size={36}
              color={result.gateOpened ? theme.colors.success : result.outcome === 'already-processed' ? theme.colors.warning : theme.colors.error}
            />
            <AppText variant="bodyStrong" align="center">
              {result.gateOpened ? 'Barrier opened (simulated)' : 'Barrier stays closed'}
            </AppText>
            <AppText variant="caption" align="center" color={theme.colors.textSecondary}>
              {result.message}
            </AppText>
          </View>
        </Notice>
      ) : null}
      {feedback ? <Notice tone={feedback.tone}>{feedback.text}</Notice> : null}
      {arrival ? (
        <Notice
          title={`${arrival.name} · ${arrival.plate ?? copy.plateToCome}`}
          actions={
            <>
              <ParkingButton
                compact
                tone="primary"
                icon="qr-code-outline"
                label={arrivalScan(gateShort(arrival.gateId))}
                onPress={() => scanArrival(arrival)}
              />
              <ParkingButton compact label="Not now" onPress={() => setArrivalId(null)} />
            </>
          }
        >
          {arrivalPicked(gateShort(arrival.gateId))}
        </Notice>
      ) : null}

      <Panel title={`Expected arrivals (${arrivals.length})`} icon="time-outline" subtitle={copy.arrivalsNote}>
        {arrivals.length === 0 ? (
          <AppText variant="caption" color={theme.colors.textSecondary}>
            {copy.noArrivals}
          </AppText>
        ) : (
          arrivals.map((a, index) => {
            const chip = a.needsBay ? needsBayChip : arrivalChip[a.phase];
            return (
              <ListRow
                key={a.reservationId}
                divided={index > 0}
                icon={a.ev ? 'flash-outline' : 'car-outline'}
                title={`${a.name} · ${a.plate ?? copy.plateToCome}`}
                lines={[keepTogether(`${a.spaceLabel} · ${a.zoneName} · ${gateShort(a.gateId)}`), keepTogether(a.when)]}
                statusLabel={chip.label}
                statusTone={chip.tone}
                onPress={() => prepareArrival(a)}
                accessibilityHint={copy.arrivalHint}
              />
            );
          })
        )}
      </Panel>
    </ParkingFrame>
  );
}
