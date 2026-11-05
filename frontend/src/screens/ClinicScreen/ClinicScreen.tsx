import { useNavigation } from '@react-navigation/native';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';

import { AppText } from '../../components/common/AppText';
import { HealthFrame } from '../../features/health/components/HealthFrame';
import { LoadingPanel } from '../../features/health/components/LoadState';
import { ChipGroup, Field } from '../../components/ui/Controls';
import { Notice } from '../../components/feedback/Notice';
import { Panel } from '../../components/ui/Panel';
import { ParkingButton } from '../../components/ui/ParkingButton';
import { ListRow } from '../../components/ui/ListRow';
import { useAppTheme } from '../../hooks/useAppTheme';
import { useClinicQuery, type ClinicQuery } from '../../features/clinic/hooks/useClinicQuery';
import { useEms } from '../../features/ems/hooks/useEms';
import { useHealth } from '../../features/health/hooks/useHealth';
import type { Appointment } from '../../features/clinic/types';
import { clinicApi } from '../../features/clinic/services/clinicApi';
import { clock, pick, STATUS_LABEL, STATUS_TONE } from '../../features/clinic/components/presenters';
import { formatDate } from '../../features/health/services/i18n';
import type { RootStackScreenProps } from '../../types/navigation.types';
import { ALL, clinicCopy, SEARCH_DELAY_MS } from './ClinicScreen.data';
import { createStyles } from './ClinicScreen.styles';
import { DoctorCard } from '../../features/clinic/components/DoctorCard';

type Navigation = RootStackScreenProps<'Clinic'>['navigation'];

function QueryError<T>({ query }: { query: ClinicQuery<T> }) {
  const { t } = useHealth();
  if (!query.error) return null;
  return (
    <Notice tone="warning" title={query.error.message} actions={<ParkingButton compact icon="refresh" label={t.actions.retry} onPress={query.reload} />} />
  );
}

/**
 * Clinical Appointment: the clinic's doctors, filtered by specialty and
 * searched by name, and the resident's own appointments. It uses the session
 * from the app's sign-in, so a guest is sent there; this section has no
 * sign-in of its own.
 */
export function ClinicScreen() {
  const navigation = useNavigation<Navigation>();
  const { status, configured } = useEms();
  const { lang } = useHealth();
  const copy = clinicCopy[lang];

  if (status === 'signedIn') {
    return <Directory />;
  }
  return (
    <HealthFrame title={copy.title} subtitle={copy.subtitle}>
      {status === 'loading' ? (
        <LoadingPanel />
      ) : configured ? (
        <Notice
          tone="info"
          title={copy.signIn}
          actions={
            <ParkingButton
              tone="primary"
              icon="log-in-outline"
              label={copy.signInAction}
              onPress={() => navigation.reset({ index: 0, routes: [{ name: 'Login' }] })}
            />
          }
        />
      ) : (
        <Notice tone="warning" title={copy.notConfigured} />
      )}
    </HealthFrame>
  );
}

function Directory() {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const navigation = useNavigation<Navigation>();
  const { lang } = useHealth();
  const copy = clinicCopy[lang];
  const [specialty, setSpecialty] = useState<string>(ALL);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [search]);

  const specialties = useClinicQuery(clinicApi.specialties);
  const doctors = useClinicQuery(
    useCallback(() => clinicApi.doctors({ specialty: specialty === ALL ? null : specialty, q: query }), [specialty, query]),
  );
  const appointments = useClinicQuery(clinicApi.myAppointments);

  // Still to come: active, and not more than an hour past its end when the list was loaded.
  const upcoming = (appointments.data ?? [])
    .filter((entry) => ['scheduled', 'checked_in', 'waiting', 'in_consultation'].includes(entry.status) && Date.parse(entry.ends_at) > appointments.loadedAt - 3600_000)
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const past = (appointments.data ?? []).filter((entry) => !upcoming.includes(entry)).slice(0, 10);

  const row = (entry: Appointment, index: number) => (
    <ListRow
      key={entry.id}
      divided={index > 0}
      icon={entry.consultation_id ? 'document-text-outline' : 'calendar-outline'}
      title={pick(entry.doctor.name, lang)}
      lines={[
        copy.at(formatDate(entry.date, lang), clock(entry.time, lang)),
        [copy.for(entry.patient.name), pick(entry.doctor.specialty.name, lang)].join(' · '),
        ...(entry.consultation_id ? [copy.visitRecord] : []),
      ]}
      statusLabel={STATUS_LABEL[lang][entry.status]}
      statusTone={STATUS_TONE[entry.status]}
      onPress={() => navigation.navigate('ClinicAppointment', { appointmentId: entry.id })}
    />
  );

  return (
    <HealthFrame
      title={copy.title}
      subtitle={copy.subtitle}
      aside={
        <Panel icon="calendar-outline" title={copy.mine}>
          <QueryError query={appointments} />
          {appointments.data && appointments.data.length === 0 ? (
            <AppText variant="caption" style={styles.empty}>
              {copy.none}
            </AppText>
          ) : null}
          {upcoming.length > 0 ? (
            <View>
              <AppText variant="label" color={theme.colors.textSupport}>
                {copy.upcoming}
              </AppText>
              {upcoming.map(row)}
            </View>
          ) : null}
          {past.length > 0 ? (
            <View>
              <AppText variant="label" color={theme.colors.textSupport}>
                {copy.past}
              </AppText>
              {past.map(row)}
            </View>
          ) : null}
        </Panel>
      }
    >
      <Field label={copy.search} value={search} onChangeText={setSearch} icon="search-outline" autoCorrect={false} returnKeyType="search" />
      <QueryError query={specialties} />
      {specialties.data && specialties.data.length > 0 ? (
        <ChipGroup
          scroll
          label={copy.specialties}
          options={[
            { value: ALL, label: copy.all },
            ...specialties.data.map((entry) => ({ value: entry.id, label: pick(entry.name, lang), detail: copy.doctors(entry.doctor_count) })),
          ]}
          value={specialty}
          onChange={setSpecialty}
        />
      ) : null}
      <QueryError query={doctors} />
      <View style={styles.list}>
        {doctors.data?.map((doctor) => (
          <DoctorCard
            key={doctor.id}
            doctor={doctor}
            lang={lang}
            years={copy.years}
            minutes={copy.minutes}
            onPress={() => navigation.navigate('ClinicDoctor', { doctorId: doctor.id })}
          />
        ))}
        {doctors.data && doctors.data.length === 0 ? (
          <Panel>
            <AppText variant="caption" style={styles.empty}>
              {copy.noDoctors}
            </AppText>
          </Panel>
        ) : null}
      </View>
    </HealthFrame>
  );
}
