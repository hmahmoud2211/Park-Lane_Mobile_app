import { useRoute } from '@react-navigation/native';
import { useMemo, useState } from 'react';
import { View } from 'react-native';

import { AppText } from '../../components/common/AppText';
import { InfoRow } from '../../components/parking/Controls';
import { Notice, type NoticeTone } from '../../components/parking/Notice';
import { Panel } from '../../components/parking/Panel';
import { ParkingButton } from '../../components/parking/ParkingButton';
import { ParkingFrame } from '../../components/parking/ParkingFrame';
import { chargingStateLabel } from '../../components/parking/presenters';
import { ProgressBar } from '../../components/ui/ProgressBar';
import { StatusChip, type StatusTone } from '../../components/ui/StatusChip';
import { useAppTheme } from '../../hooks/useAppTheme';
import { useParking } from '../../hooks/useParking';
import { chargingRateKw, moveOutDeadline } from '../../services/parking/charging';
import { findReservation, reservationView } from '../../services/parking/selectors';
import { formatDuration, formatTime, ms } from '../../services/parking/time';
import { ParkingError } from '../../services/parking/tx';
import type { ChargingState } from '../../services/parking/types';
import type { RootStackScreenProps } from '../../types/navigation.types';
import { chargingCopy as copy } from './ChargingSessionScreen.data';
import { createStyles } from './ChargingSessionScreen.styles';

const stateTone: Record<ChargingState, StatusTone> = {
  reserved: 'violet',
  'waiting-for-plug-in': 'indigo',
  charging: 'teal',
  completed: 'slate',
  interrupted: 'amber',
  faulted: 'red',
};

export function ChargingSessionScreen() {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { params } = useRoute<RootStackScreenProps<'ChargingSession'>['route']>();
  const { db, now, service } = useParking();
  const [message, setMessage] = useState<{ tone: NoticeTone; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const reservation = findReservation(db, params.reservationId);
  const view = useMemo(() => (reservation ? reservationView(db, reservation, now) : null), [db, reservation, now]);

  if (!view || !view.charging || !view.allocation) {
    return (
      <ParkingFrame title={copy.title}>
        <Notice tone="warning">This booking has no charging slot.</Notice>
      </ParkingFrame>
    );
  }

  const { charging, allocation, charger, connector, space } = view;
  const r = view.reservation;
  const projection = view.chargingProjection!;
  const rate = charging.rateKw || (charger ? chargingRateKw(charger, view.vehicle) : 0);
  const remainingKwh = projection.targetKwh ? Math.max(0, projection.targetKwh - projection.energyKwh) : null;
  const moveOutBy = moveOutDeadline(db, charging);

  const run = async (key: string, action: () => Promise<unknown>, success: string) => {
    setBusy(key);
    setMessage(null);
    try {
      await action();
      setMessage({ tone: 'success', text: success });
    } catch (e) {
      setMessage({ tone: 'error', text: e instanceof ParkingError ? e.message : 'That did not work. Please try again.' });
    } finally {
      setBusy(null);
    }
  };

  return (
    <ParkingFrame title={copy.title}>
      <Panel
        title={`${space.label} · ${charger?.label ?? ''}`}
        subtitle={`${view.title} · ${connector?.type ?? ''}`}
        icon="flash-outline"
        trailing={<StatusChip label={chargingStateLabel[charging.state]} tone={stateTone[charging.state]} glow />}
      >
        <View style={styles.figures}>
          <View style={styles.figure}>
            <AppText variant="label" color={theme.colors.textSupport}>
              Energy delivered
            </AppText>
            <AppText variant="figure">{`${projection.energyKwh} kWh`}</AppText>
          </View>
          <View style={styles.figure}>
            <AppText variant="label" color={theme.colors.textSupport}>
              Charging rate
            </AppText>
            <AppText variant="figure">{charging.state === 'charging' ? `${rate} kW` : '—'}</AppText>
          </View>
        </View>
        <ProgressBar progress={projection.progress} height={10} accessibilityLabel="Charging progress" />
        <AppText variant="label" color={theme.colors.textSupport}>
          {projection.targetKwh ? `Target ${projection.targetKwh} kWh` : `Charging until ${formatTime(allocation.end)}`}
          {charging.state === 'charging' && projection.completesAt
            ? ` · expected to finish about ${formatTime(projection.completesAt)} (estimate)`
            : ''}
        </AppText>
        <AppText variant="label" color={theme.colors.textMuted}>
          {copy.demoValues}
        </AppText>
      </Panel>

      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}

      {charging.state === 'reserved' ? <Notice>{r.status === 'confirmed' ? copy.entryNote : 'Waiting for the car to arrive.'}</Notice> : null}
      {charging.state === 'waiting-for-plug-in' ? (
        <Notice
          title="Car is in the bay"
          actions={
            <ParkingButton
              label="Plug in & start charging"
              icon="flash-outline"
              tone="primary"
              loading={busy === 'plug'}
              disabled={ms(allocation.start) > now}
              onPress={() => void run('plug', () => service.plugIn(r.id), 'Charging started.')}
            />
          }
        >
          {ms(allocation.start) > now
            ? `Your slot starts at ${formatTime(allocation.start)}.`
            : `Plug in by ${formatTime(ms(allocation.start) + db.policy.chargingPlugInGraceMinutes * 60_000)} to keep the slot.`}
        </Notice>
      ) : null}
      {charging.state === 'charging' ? (
        <ParkingButton
          label="Stop charging & unplug"
          icon="stop-circle-outline"
          loading={busy === 'stop'}
          onPress={() => void run('stop', () => service.stopCharging(r.id), 'Charging stopped. Please move the car out of the EV bay.')}
        />
      ) : null}
      {(charging.state === 'completed' || charging.state === 'interrupted') && r.status === 'checked-in' && !r.bayVacatedAt ? (
        <Notice tone={charging.moveOutOverstayAt ? 'error' : 'warning'} title={charging.moveOutOverstayAt ? 'Please move the car now' : 'Charging has ended'}>
          {`${charging.endReason ? `${charging.endReason}. ` : ''}Move the car out of ${space.label}${moveOutBy ? ` by ${formatTime(moveOutBy)}` : ''} so the next driver can charge. ${copy.bayNote}`}
        </Notice>
      ) : null}

      <Panel title="Details" icon="information-circle-outline">
        <InfoRow icon="time-outline" label="Charging slot" value={`${formatTime(allocation.start)}–${formatTime(allocation.end)}`} detail={formatDuration((ms(allocation.end) - ms(allocation.start)) / 60_000)} />
        <InfoRow icon="car-outline" label="Bay reserved" value={`${formatTime(r.scheduledStart)}–${formatTime(r.scheduledEnd)}`} detail={r.bayVacatedAt ? `Left the bay at ${formatTime(r.bayVacatedAt)}` : undefined} />
        {charging.startedAt ? <InfoRow icon="play-outline" label="Started" value={formatTime(charging.startedAt)} /> : null}
        {charging.endedAt ? <InfoRow icon="stop-outline" label="Ended" value={formatTime(charging.endedAt)} detail={charging.endReason} /> : null}
        {remainingKwh !== null && charging.state === 'charging' ? (
          <InfoRow icon="hourglass-outline" label="Remaining (estimate)" value={`${remainingKwh.toFixed(1)} kWh · about ${formatDuration((remainingKwh / Math.max(rate, 0.1)) * 60)}`} />
        ) : null}
      </Panel>

      <Notice>{copy.estimate}</Notice>
    </ParkingFrame>
  );
}
