import { useNavigation, useRoute } from '@react-navigation/native';
import { useCallback, useMemo, useState } from 'react';
import { View } from 'react-native';

import { AppText } from '../../components/common/AppText';
import { BidiText } from '../../components/health/BidiText';
import { ConfirmSheet } from '../../components/health/ConfirmSheet';
import { HealthFrame } from '../../components/health/HealthFrame';
import { LoadingPanel } from '../../components/health/LoadState';
import { CheckRow, FactGrid } from '../../components/parking/Controls';
import { Notice } from '../../components/parking/Notice';
import { Panel } from '../../components/parking/Panel';
import { ParkingButton } from '../../components/parking/ParkingButton';
import { StatusChip } from '../../components/ui/StatusChip';
import { useAppTheme } from '../../hooks/useAppTheme';
import { useClinicQuery } from '../../hooks/useClinicQuery';
import { useHealth } from '../../hooks/useHealth';
import type { Appointment } from '../../services/clinic/clinic.types';
import { syncReminders } from '../../services/clinic/appointmentReminders';
import { clinicApi } from '../../services/clinic/clinicApi';
import { clock, pick, STATUS_LABEL, STATUS_TONE } from '../../services/clinic/presenters';
import { EmsError } from '../../services/ems/emsApi';
import { formatDate } from '../../services/health/i18n';
import type { RootStackScreenProps } from '../../types/navigation.types';
import { appointmentCopy } from './ClinicAppointmentScreen.data';
import { ReminderNotice } from './ReminderNotice';
import { createStyles } from './ClinicAppointmentScreen.styles';

type Props = RootStackScreenProps<'ClinicAppointment'>;

/**
 * One of the resident's appointments: its status as the clinic sets it, the
 * choices the visit may use (changed at once on the server), moving or
 * cancelling it, and, once the doctor has approved it, the visit record.
 */
export function ClinicAppointmentScreen() {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const navigation = useNavigation<Props['navigation']>();
  const { params } = useRoute<Props['route']>();
  const { lang, t } = useHealth();
  const copy = appointmentCopy[lang];
  const { appointmentId } = params;
  const query = useClinicQuery(useCallback(() => clinicApi.appointment(appointmentId), [appointmentId]));
  // What a change just returned, shown until the screen next loads the appointment from the server.
  const [changed, setChanged] = useState<{ from: Appointment | undefined; value: Appointment } | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const appointment = changed && changed.from === query.data ? changed.value : query.data;
  const setShown = (value: Appointment) => setChanged({ from: query.data, value });

  if (!appointment) {
    return (
      <HealthFrame title={copy.title}>
        {query.error ? (
          <Notice tone="error" title={query.error.message} actions={<ParkingButton compact icon="refresh" label={t.actions.retry} onPress={query.reload} />} />
        ) : (
          <LoadingPanel />
        )}
      </HealthFrame>
    );
  }

  const consent = async (change: { share_history?: boolean; ai_consent?: boolean }) => {
    setError(null);
    try {
      setShown(await clinicApi.setConsents(appointment.id, change));
    } catch (caught) {
      setError(caught instanceof EmsError ? caught.message : 'Something went wrong.');
    }
  };

  const doctorName = pick(appointment.doctor.name, lang);

  return (
    <HealthFrame title={copy.title} subtitle={doctorName}>
      {params.justBooked && appointment.status === 'scheduled' ? (
        <Notice tone="success" title={copy.booked}>
          {copy.bookedBody}
        </Notice>
      ) : null}

      <ReminderNotice appointment={appointment} />

      <Panel
        icon="calendar-outline"
        title={`${formatDate(appointment.date, lang)}, ${clock(appointment.time, lang)}`}
        subtitle={copy.status[appointment.status]}
        trailing={<StatusChip label={STATUS_LABEL[lang][appointment.status]} tone={STATUS_TONE[appointment.status]} />}
      >
        <FactGrid
          facts={[
            { icon: 'medkit-outline', label: copy.doctor, value: doctorName, detail: pick(appointment.doctor.specialty.name, lang) },
            { icon: 'person-outline', label: copy.patient, value: appointment.patient.name },
          ]}
        />
        {appointment.reason ? (
          <View>
            <AppText variant="label" color={theme.colors.textSupport}>
              {copy.reason}
            </AppText>
            <BidiText variant="caption">{appointment.reason}</BidiText>
          </View>
        ) : null}
      </Panel>

      {appointment.consultation_id ? (
        <Notice
          tone="success"
          title={copy.recordBody}
          actions={
            <ParkingButton
              compact
              tone="primary"
              icon="document-text-outline"
              label={copy.record}
              onPress={() => navigation.navigate('HealthConsultation', { consultationId: appointment.consultation_id as string })}
            />
          }
        />
      ) : null}

      {appointment.status === 'rescheduled' && appointment.rescheduled_to ? (
        <Notice
          tone="info"
          title={copy.moved}
          actions={<ParkingButton compact icon="arrow-forward" label={copy.openNew} onPress={() => navigation.replace('ClinicAppointment', { appointmentId: appointment.rescheduled_to as string })} />}
        />
      ) : null}

      <Panel icon="shield-checkmark-outline" title={copy.privacy} subtitle={appointment.can_change_consent ? undefined : copy.privacyClosed}>
        <CheckRow
          label={copy.share}
          detail={copy.shareDetail}
          checked={appointment.share_history}
          onChange={(checked) => appointment.can_change_consent && void consent({ share_history: checked })}
        />
        <CheckRow
          label={copy.ai}
          detail={copy.aiDetail}
          checked={appointment.ai_consent}
          onChange={(checked) => appointment.can_change_consent && void consent({ ai_consent: checked })}
        />
        {error ? <Notice tone="error" title={error} /> : null}
      </Panel>

      {appointment.can_reschedule || appointment.can_cancel ? (
        <View style={styles.actions}>
          {appointment.can_reschedule ? (
            <ParkingButton
              icon="time-outline"
              label={copy.reschedule}
              onPress={() => navigation.navigate('ClinicDoctor', { doctorId: appointment.doctor.id, rescheduleOf: appointment.id })}
            />
          ) : null}
          {appointment.can_cancel ? <ParkingButton tone="danger" icon="close-circle-outline" label={copy.cancel} onPress={() => setCancelling(true)} /> : null}
        </View>
      ) : null}

      <ConfirmSheet
        visible={cancelling}
        title={copy.cancelTitle}
        body={copy.cancelBody}
        options={[{ id: 'cancel', label: copy.cancelConfirm, tone: 'danger', icon: 'close-circle-outline' }]}
        onSelect={async () => {
          setShown(await clinicApi.cancel(appointment.id));
          setCancelling(false);
          void clinicApi.myAppointments().then((list) => syncReminders(list, lang)).catch(() => undefined);
        }}
        onClose={() => setCancelling(false)}
      />
    </HealthFrame>
  );
}
