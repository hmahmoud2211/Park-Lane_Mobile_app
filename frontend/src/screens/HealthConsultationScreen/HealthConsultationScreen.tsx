import { useNavigation, useRoute } from '@react-navigation/native';
import { useCallback, useMemo } from 'react';
import { View } from 'react-native';

import { AppText } from '../../components/common/AppText';
import { BidiText } from '../../features/health/components/BidiText';
import { HealthFrame } from '../../features/health/components/HealthFrame';
import { ResourceView } from '../../features/health/components/LoadState';
import { Notice } from '../../components/feedback/Notice';
import { Panel } from '../../components/ui/Panel';
import { ParkingButton } from '../../components/ui/ParkingButton';
import { StatusChip } from '../../components/ui/StatusChip';
import { useAppTheme } from '../../hooks/useAppTheme';
import { useHealth } from '../../features/health/hooks/useHealth';
import { useHealthResource } from '../../features/health/hooks/useHealthData';
import { pick } from '../../features/clinic/components/presenters';
import type { ClinicConsultation } from '../../types/health.types';
import { healthKeys } from '../../features/health/services/healthStore';
import { formatDate } from '../../features/health/services/i18n';
import type { RootStackScreenProps } from '../../types/navigation.types';
import { consultationCopy } from './HealthConsultationScreen.data';
import { createStyles } from './HealthConsultationScreen.styles';

type Props = RootStackScreenProps<'HealthConsultation'>;

/**
 * A clinic visit in Health Passport, as its doctor approved it: why the
 * resident came, what the doctor found and decided, the medicines, tests
 * and follow-up, and plain-language instructions. Never the transcript or
 * anything the AI wrote that the doctor did not approve.
 */
export function HealthConsultationScreen() {
  const { params } = useRoute<Props['route']>();
  const { lang, service } = useHealth();
  const copy = consultationCopy[lang];
  const fetcher = useCallback(() => service.getConsultation(params.consultationId), [service, params.consultationId]);
  const visit = useHealthResource(healthKeys.consultation(params.consultationId), fetcher);

  return (
    <HealthFrame title={copy.title} subtitle={visit.data ? formatDate(visit.data.date, lang) : undefined}>
      <ResourceView resource={visit}>{(data) => <Visit visit={data} />}</ResourceView>
    </HealthFrame>
  );
}

function Visit({ visit }: { visit: ClinicConsultation }) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const navigation = useNavigation<Props['navigation']>();
  const { lang } = useHealth();
  const copy = consultationCopy[lang];
  const note = visit.note;
  const doctor = pick(visit.doctor.name, lang);

  return (
    <>
      <Panel icon="medkit-outline" title={doctor} subtitle={[visit.doctor_title, pick(visit.doctor.specialty, lang)].filter(Boolean).join(' · ')}>
        {note.chief_complaint ? (
          <View>
            <AppText variant="label" color={theme.colors.textSupport}>
              {copy.reason}
            </AppText>
            <BidiText variant="bodyStrong">{note.chief_complaint}</BidiText>
          </View>
        ) : null}
        {note.diagnoses.length ? (
          <View style={styles.lines}>
            <AppText variant="label" color={theme.colors.textSupport}>
              {copy.diagnosis}
            </AppText>
            {note.diagnoses.map((diagnosis, index) => (
              <View key={index} style={styles.line}>
                <BidiText variant="bodyStrong">{diagnosis.name}</BidiText>
                {diagnosis.certainty === 'provisional' ? <StatusChip label={copy.provisional} tone="amber" /> : null}
              </View>
            ))}
          </View>
        ) : null}
        {note.assessment ? (
          <View>
            <AppText variant="label" color={theme.colors.textSupport}>
              {copy.assessment}
            </AppText>
            <BidiText variant="caption">{note.assessment}</BidiText>
          </View>
        ) : null}
      </Panel>

      {note.patient_instructions ? (
        <Panel icon="information-circle-outline" title={copy.instructions}>
          <BidiText variant="body">{note.patient_instructions}</BidiText>
        </Panel>
      ) : null}

      {note.plan || note.medications.length || note.investigations.length ? (
        <Panel icon="medical-outline" title={copy.plan}>
          {note.plan ? <BidiText variant="caption">{note.plan}</BidiText> : null}
          {note.medications.length ? (
            <View style={styles.lines}>
              <AppText variant="label" color={theme.colors.textSupport}>
                {copy.medications}
              </AppText>
              {note.medications.map((med, index) => (
                <View key={index}>
                  <BidiText variant="bodyStrong">{med.name}</BidiText>
                  <AppText variant="caption" style={styles.muted}>
                    {[med.dose, med.route, med.frequency, med.duration_days ? copy.forDays(med.duration_days) : '', med.instructions].filter(Boolean).join(' · ')}
                  </AppText>
                </View>
              ))}
            </View>
          ) : null}
          {note.investigations.length ? (
            <View>
              <AppText variant="label" color={theme.colors.textSupport}>
                {copy.tests}
              </AppText>
              <BidiText variant="caption">{note.investigations.join(lang === 'ar' ? '، ' : ', ')}</BidiText>
            </View>
          ) : null}
        </Panel>
      ) : null}

      {note.follow_up.needed ? (
        <Panel icon="calendar-outline" title={copy.followUp} subtitle={note.follow_up.in_days ? copy.followUpIn(note.follow_up.in_days) : copy.followUpSoon}>
          {note.follow_up.instructions ? <BidiText variant="caption">{note.follow_up.instructions}</BidiText> : null}
          <ParkingButton compact tone="primary" icon="calendar-outline" label={copy.book} onPress={() => navigation.navigate('ClinicDoctor', { doctorId: visit.doctor.id })} />
        </Panel>
      ) : null}

      {note.symptoms.length || note.examination || note.vitals.length ? (
        <Panel icon="reader-outline" title={copy.details}>
          {note.symptoms.length ? (
            <AppText variant="caption" style={styles.muted}>
              {`${copy.symptoms}: ${note.symptoms.join(lang === 'ar' ? '، ' : ', ')}`}
            </AppText>
          ) : null}
          {note.examination ? <BidiText variant="caption">{`${copy.examination}: ${note.examination}`}</BidiText> : null}
          {note.vitals.length ? (
            <AppText variant="caption" style={styles.muted}>
              {note.vitals.map((vital) => `${vital.name} ${vital.value}`).join(' · ')}
            </AppText>
          ) : null}
        </Panel>
      ) : null}

      {visit.addenda.length ? (
        <Panel icon="create-outline" title={copy.addenda}>
          {visit.addenda.map((addendum, index) => (
            <View key={index}>
              <BidiText variant="caption">{addendum.text}</BidiText>
              <AppText variant="label" style={styles.muted}>
                {`${addendum.author} · ${formatDate(addendum.created_at, lang)}`}
              </AppText>
            </View>
          ))}
        </Panel>
      ) : null}

      <Notice tone="info" title={copy.approved(visit.approved_by, formatDate(visit.finalized_at, lang))}>
        {visit.ai_assisted ? copy.aiAssisted : undefined}
      </Notice>
    </>
  );
}
