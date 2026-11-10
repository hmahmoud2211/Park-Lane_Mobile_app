import { useNavigation, useRoute } from '@react-navigation/native';
import { useCallback, useMemo, useState } from 'react';
import { View } from 'react-native';

import { HealthFrame } from '../../components/health/HealthFrame';
import { LoadingPanel } from '../../components/health/LoadState';
import { CheckRow, ChipGroup, Field, FactGrid } from '../../components/parking/Controls';
import { Notice } from '../../components/parking/Notice';
import { Panel } from '../../components/parking/Panel';
import { ParkingButton } from '../../components/parking/ParkingButton';
import { useAppTheme } from '../../hooks/useAppTheme';
import { useClinicQuery } from '../../hooks/useClinicQuery';
import { useHealth } from '../../hooks/useHealth';
import { syncReminders } from '../../services/clinic/appointmentReminders';
import { clinicApi } from '../../services/clinic/clinicApi';
import { clock, pick } from '../../services/clinic/presenters';
import { EmsError } from '../../services/ems/emsApi';
import { formatDate } from '../../services/health/i18n';
import type { RootStackScreenProps } from '../../types/navigation.types';
import { bookingCopy } from './ClinicBookingScreen.data';
import { createStyles } from './ClinicBookingScreen.styles';

type Props = RootStackScreenProps<'ClinicBooking'>;

/**
 * The last step of booking: who it is for (one of the resident's Health
 * Passport profiles), why, and what the visit may use. Both choices are
 * off until the resident turns them on, and can be changed until the visit.
 */
export function ClinicBookingScreen() {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const navigation = useNavigation<Props['navigation']>();
  const { params } = useRoute<Props['route']>();
  const { lang, t } = useHealth();
  const copy = bookingCopy[lang];

  const { doctorId, rescheduleOf } = params;
  const doctor = useClinicQuery(useCallback(() => clinicApi.doctor(doctorId), [doctorId]));
  const patients = useClinicQuery(clinicApi.patients);
  const previous = useClinicQuery(useCallback(() => (rescheduleOf ? clinicApi.appointment(rescheduleOf) : Promise.resolve(null)), [rescheduleOf]));

  // Until the resident changes them: a reschedule keeps the patient, reason and
  // choices of the visit it moves; a new booking is for the resident themself, sharing nothing.
  const [chosenPatient, setPatientId] = useState<string | null>(null);
  const [typedReason, setReason] = useState<string | null>(null);
  const [shareChoice, setShare] = useState<boolean | null>(null);
  const [aiChoice, setAi] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<EmsError | null>(null);
  const profiles = patients.data?.profiles ?? [];
  const patientId =
    chosenPatient ?? previous.data?.patient.profile_id ?? (rescheduleOf ? null : (profiles.find((entry) => entry.relation === 'self') ?? profiles[0])?.id ?? null);
  const reason = typedReason ?? previous.data?.reason ?? '';
  const share = shareChoice ?? previous.data?.share_history ?? false;
  const ai = aiChoice ?? previous.data?.ai_consent ?? false;

  const profile = doctor.data;
  if (!profile || !patients.data) {
    return (
      <HealthFrame title={copy.title}>
        {doctor.error || patients.error ? <Notice tone="error" title={(doctor.error ?? patients.error)?.message} /> : <LoadingPanel />}
      </HealthFrame>
    );
  }

  const doctorName = pick(profile.name, lang);

  const confirm = async () => {
    if (!patientId) return;
    setBusy(true);
    setError(null);
    try {
      const booked = await clinicApi.book({
        doctor_id: profile.id,
        starts_at: params.startsAt,
        patient_profile_id: patientId,
        reason: reason.trim() || null,
        share_history: share,
        ai_consent: ai,
        reschedule_of: params.rescheduleOf,
      });
      // Before moving on, so the next screen shows the reminder. The booking is made: a failure here must not look like it wasn't.
      await clinicApi.myAppointments().then((list) => syncReminders(list, lang)).catch(() => undefined);
      navigation.reset({
        index: 1,
        routes: [{ name: 'Clinic' }, { name: 'ClinicAppointment', params: { appointmentId: booked.id, justBooked: true } }],
      });
    } catch (caught) {
      setError(caught instanceof EmsError ? caught : new EmsError('internal', 'Something went wrong.'));
    } finally {
      setBusy(false);
    }
  };

  const noPassport = !patients.data.health_passport;

  return (
    <HealthFrame
      title={params.rescheduleOf ? copy.rescheduleTitle : copy.title}
      subtitle={doctorName}
      bottomBar={false}
      sideNav
      footer={
        noPassport ? undefined : (
          <ParkingButton
            tone="primary"
            icon="checkmark"
            label={params.rescheduleOf ? copy.confirmReschedule : copy.confirm}
            loading={busy}
            disabled={!patientId || error?.code === 'slot_taken'}
            onPress={() => void confirm()}
          />
        )
      }
    >
      <Panel icon="calendar-outline" title={copy.visit}>
        <FactGrid
          facts={[
            { icon: 'calendar-outline', label: copy.when, value: `${formatDate(params.date, lang)}, ${clock(params.time, lang)}`, wide: true },
            { icon: 'medkit-outline', label: copy.doctor, value: doctorName, detail: pick(profile.specialty.name, lang) },
            { icon: 'time-outline', label: copy.length, value: copy.minutes(profile.consultation_minutes) },
          ]}
        />
      </Panel>

      {noPassport ? (
        <Notice
          tone="info"
          title={copy.noPassport}
          actions={<ParkingButton compact tone="primary" icon="medkit-outline" label={copy.setUp} onPress={() => navigation.navigate('HealthOnboarding')} />}
        >
          {copy.noPassportBody}
        </Notice>
      ) : (
        <>
          <Panel icon="person-outline" title={copy.patient}>
            <ChipGroup
              options={patients.data.profiles.map((entry) => ({ value: entry.id, label: entry.name, detail: t.relation[entry.relation] }))}
              value={patientId}
              onChange={params.rescheduleOf ? () => undefined : setPatientId}
            />
            <Field label={copy.reason} hint={copy.reasonHint} value={reason} onChangeText={setReason} multiline maxLength={500} icon="chatbox-ellipses-outline" />
          </Panel>
          <Panel icon="shield-checkmark-outline" title={copy.privacy}>
            <View style={styles.checks}>
              <CheckRow label={copy.share(doctorName)} detail={copy.shareDetail} checked={share} onChange={setShare} />
              <CheckRow label={copy.ai} detail={copy.aiDetail} checked={ai} onChange={setAi} />
            </View>
          </Panel>
        </>
      )}

      {error?.code === 'slot_taken' ? (
        <Notice tone="warning" title={copy.taken} actions={<ParkingButton compact icon="time-outline" label={copy.pickAnother} onPress={() => navigation.goBack()} />}>
          {copy.takenBody}
        </Notice>
      ) : error ? (
        <Notice tone="error" title={error.message} />
      ) : null}
    </HealthFrame>
  );
}
