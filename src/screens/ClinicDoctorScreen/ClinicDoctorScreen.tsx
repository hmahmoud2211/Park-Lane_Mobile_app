import { useNavigation, useRoute } from '@react-navigation/native';
import { useCallback, useMemo, useState } from 'react';
import { Image, View } from 'react-native';

import { AppText } from '../../components/common/AppText';
import { BidiText } from '../../components/health/BidiText';
import { deviceTime, TimeField } from '../../components/health/TimeField';
import { HealthFrame } from '../../components/health/HealthFrame';
import { LoadingPanel } from '../../components/health/LoadState';
import { ChipGroup, FactGrid, type Fact } from '../../components/parking/Controls';
import { Notice } from '../../components/parking/Notice';
import { Panel } from '../../components/parking/Panel';
import { ParkingButton } from '../../components/parking/ParkingButton';
import { Avatar } from '../../components/ui/Avatar';
import { useAppTheme } from '../../hooks/useAppTheme';
import { useClinicQuery } from '../../hooks/useClinicQuery';
import { useHealth } from '../../hooks/useHealth';
import { clinicApi, photoSource } from '../../services/clinic/clinicApi';
import { clock, dayChip, fee, hoursByDay, initialsOf, pick } from '../../services/clinic/presenters';
import type { RootStackScreenProps } from '../../types/navigation.types';
import { DAYS_SHOWN, doctorCopy } from './ClinicDoctorScreen.data';
import { createStyles, PHOTO_SIZE } from './ClinicDoctorScreen.styles';

type Props = RootStackScreenProps<'ClinicDoctor'>;

/**
 * A doctor's profile and their free slots: pick a date (only days with
 * free time are offered), then a time. Booked times stay visible but
 * cannot be chosen; the server checks the slot again when booking.
 *
 * When the backend allows it for testing (CLINIC_ANY_TIME_BOOKING), every
 * day is open and a time picker, set from the device's clock, replaces the
 * slots.
 */
export function ClinicDoctorScreen() {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const navigation = useNavigation<Props['navigation']>();
  const { params } = useRoute<Props['route']>();
  const { lang, t } = useHealth();
  const copy = doctorCopy[lang];
  const [chosenDate, setDate] = useState<string | null>(null);
  const [chosenStart, setStartsAt] = useState<string | null>(null);
  const [anyTimeChoice, setAnyTimeChoice] = useState(deviceTime);
  const [openedAt] = useState(() => Date.now());
  const { doctorId } = params;

  const doctor = useClinicQuery(useCallback(() => clinicApi.doctor(doctorId), [doctorId]));
  const availability = useClinicQuery(useCallback(() => clinicApi.availability(doctorId, DAYS_SHOWN), [doctorId]));
  const days = useMemo(() => availability.data?.days ?? [], [availability.data]);
  const clinicConfig = useClinicQuery(useCallback(() => clinicApi.config(), []));
  const anyTime = clinicConfig.data?.any_time_booking === true;
  // Until the resident picks one, the first day with a free slot.
  const date = chosenDate ?? (anyTime ? days[0]?.date : days.find((day) => day.available > 0)?.date) ?? null;
  const slots = useClinicQuery(useCallback(() => (date ? clinicApi.slots(doctorId, date) : Promise.resolve(null)), [doctorId, date]));
  const slotList = useMemo(() => slots.data?.slots ?? [], [slots.data]);
  // A slot taken meanwhile (the list refreshes on focus) does not stay chosen.
  const startsAt = chosenStart && slotList.some((slot) => slot.starts_at === chosenStart && slot.state === 'available') ? chosenStart : null;
  // The device's own clock decides what "4:30 PM" means here.
  const anyTimeInstant = date ? new Date(`${date}T${anyTimeChoice}:00`) : null;
  // A hint as the resident picks; the server checks against the real time when booking.
  const anyTimeLater = anyTimeInstant !== null && anyTimeInstant.getTime() > openedAt;

  const profile = doctor.data;
  if (!profile) {
    return (
      <HealthFrame title={copy.title}>
        {doctor.error ? <Notice tone="error" title={doctor.error.message} actions={<ParkingButton compact icon="refresh" label={t.actions.retry} onPress={doctor.reload} />} /> : <LoadingPanel />}
      </HealthFrame>
    );
  }

  const name = pick(profile.name, lang);
  const photo = photoSource(profile.photo_url);
  const facts: Fact[] = [
    ...(profile.years_experience !== null ? [{ icon: 'ribbon-outline' as const, label: copy.experience, value: copy.years(profile.years_experience) }] : []),
    { icon: 'time-outline', label: copy.duration, value: copy.minutes(profile.consultation_minutes) },
    ...(profile.fee_egp !== null ? [{ icon: 'cash-outline' as const, label: copy.fee, value: fee(profile.fee_egp, lang) ?? '' }] : []),
    ...(profile.languages.length ? [{ icon: 'language-outline' as const, label: copy.languages, value: profile.languages.map((code) => copy.languageNames[code] ?? code).join(lang === 'ar' ? '، ' : ', ') }] : []),
  ];

  return (
    <HealthFrame
      title={params.rescheduleOf ? copy.rescheduleTitle : name}
      subtitle={params.rescheduleOf ? name : pick(profile.specialty.name, lang)}
      bottomBar={false}
      sideNav
      footer={
        <ParkingButton
          tone="primary"
          icon="arrow-forward"
          label={startsAt || anyTime ? copy.continue : copy.pick}
          disabled={anyTime ? !anyTimeLater : !startsAt}
          onPress={() => {
            if (anyTime && anyTimeInstant && date) {
              navigation.navigate('ClinicBooking', {
                doctorId: profile.id,
                startsAt: anyTimeInstant.toISOString(),
                date,
                time: anyTimeChoice,
                rescheduleOf: params.rescheduleOf,
              });
              return;
            }
            const slot = slotList.find((entry) => entry.starts_at === startsAt);
            if (slot && date) {
              navigation.navigate('ClinicBooking', { doctorId: profile.id, startsAt: slot.starts_at, date, time: slot.time, rescheduleOf: params.rescheduleOf });
            }
          }}
        />
      }
      aside={
        <>
          {profile.bio ? (
            <Panel icon="person-outline" title={copy.about}>
              <BidiText variant="caption">{pick(profile.bio, lang)}</BidiText>
            </Panel>
          ) : null}
          {profile.schedule.length ? (
            <Panel icon="calendar-outline" title={copy.hours}>
              <View style={styles.hours}>
                {hoursByDay(profile.schedule, lang).map((line) => (
                  <AppText key={line} variant="caption" style={styles.muted}>
                    {line}
                  </AppText>
                ))}
              </View>
            </Panel>
          ) : null}
        </>
      }
    >
      <Panel>
        <View style={styles.header}>
          {photo ? <Image source={photo} style={styles.photo} accessibilityIgnoresInvertColors /> : <Avatar initials={initialsOf(name)} size={PHOTO_SIZE} labelVariant="subheading" />}
          <View style={styles.names}>
            <AppText variant="heroTitle">{name}</AppText>
            <AppText variant="caption" color={theme.colors.textSupport}>
              {[pick(profile.title, lang), pick(profile.specialty.name, lang)].filter(Boolean).join(' · ')}
            </AppText>
          </View>
        </View>
        <FactGrid facts={facts} />
      </Panel>

      <Panel icon="calendar-number-outline" title={copy.date} subtitle={copy.timezone}>
        {availability.data && !anyTime && !days.some((day) => day.available > 0) ? <Notice tone="info" title={copy.noDays} /> : null}
        {days.length > 0 ? (
          <ChipGroup
            scroll
            options={days.map((day) => {
              const chip = dayChip(day.date, lang);
              return { value: day.date, label: chip.label, detail: day.available > 0 ? copy.open(day.available) : copy.full, disabled: !anyTime && day.available === 0 };
            })}
            value={date}
            onChange={(value) => {
              setDate(value);
              setStartsAt(null);
            }}
          />
        ) : availability.loading ? (
          <LoadingPanel />
        ) : null}
      </Panel>

      {date && anyTime ? (
        <Panel icon="time-outline" title={copy.time} subtitle={copy.anyTime}>
          <TimeField label={copy.time} value={anyTimeChoice} onChange={setAnyTimeChoice} error={anyTimeLater ? undefined : copy.pastTime} />
        </Panel>
      ) : date ? (
        <Panel icon="time-outline" title={copy.times}>
          {slots.loading && !slots.data ? <LoadingPanel /> : null}
          {slots.data && !slotList.some((slot) => slot.state === 'available') ? <Notice tone="info" title={copy.noTimes} /> : null}
          {slotList.length > 0 ? (
            <ChipGroup
              options={slotList
                .filter((slot) => slot.state !== 'past')
                .map((slot) => ({
                  value: slot.starts_at,
                  label: clock(slot.time, lang),
                  detail: slot.state === 'booked' ? copy.booked : undefined,
                  disabled: slot.state !== 'available',
                }))}
              value={startsAt}
              onChange={setStartsAt}
            />
          ) : null}
        </Panel>
      ) : null}
    </HealthFrame>
  );
}
