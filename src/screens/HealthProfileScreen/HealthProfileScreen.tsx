import { useNavigation, useRoute } from '@react-navigation/native';
import { useMemo, useState } from 'react';
import { View } from 'react-native';

import { AppText } from '../../components/common/AppText';
import { DateField } from '../../components/health/DateField';
import { HealthFrame } from '../../components/health/HealthFrame';
import { ErrorNotice, ResourceView } from '../../components/health/LoadState';
import { ChipGroup, Field } from '../../components/parking/Controls';
import { Panel } from '../../components/parking/Panel';
import { ParkingButton } from '../../components/parking/ParkingButton';
import { useAppTheme } from '../../hooks/useAppTheme';
import { useHealth } from '../../hooks/useHealth';
import { useHealthProfiles } from '../../hooks/useHealthData';
import type { BloodType, HealthProfile, ProfileInput, Relation, Sex } from '../../services/health/health.types';
import { HealthError, isHealthError } from '../../services/health/healthService';
import type { RootStackScreenProps } from '../../types/navigation.types';
import {
  BLOOD_TYPES,
  FAMILY_RELATIONS,
  SEXES,
  UNKNOWN,
  profileCopy,
  validateProfile,
  type ProfileErrors,
} from './HealthProfileScreen.data';
import { createStyles } from './HealthProfileScreen.styles';

/** A profile's basic details, or a new family member when opened without one. */
export function HealthProfileScreen() {
  const { params } = useRoute<RootStackScreenProps<'HealthProfile'>['route']>();
  const { lang } = useHealth();
  const profiles = useHealthProfiles();
  const copy = profileCopy[lang];
  const profileId = params?.profileId;

  if (!profileId) return <ProfileForm profile={null} />;
  const profile = profiles.data?.find((p) => p.id === profileId);
  if (profile) return <ProfileForm key={profile.id} profile={profile} />;
  return (
    <HealthFrame title={copy.editTitle}>
      <ResourceView resource={profiles}>
        {() => <ErrorNotice error={new HealthError('not_found', 'Profile not found.')} />}
      </ResourceView>
    </HealthFrame>
  );
}

function ProfileForm({ profile }: { profile: HealthProfile | null }) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const navigation = useNavigation<RootStackScreenProps<'HealthProfile'>['navigation']>();
  const { lang, t, saveProfile, setActiveProfileId } = useHealth();
  const copy = profileCopy[lang];

  const [name, setName] = useState(profile?.name ?? '');
  const [relation, setRelation] = useState<Relation>(profile?.relation ?? 'child');
  const [sex, setSex] = useState<Sex | null>(profile?.sex ?? null);
  const [dob, setDob] = useState(profile?.date_of_birth ?? '');
  const [blood, setBlood] = useState<BloodType | typeof UNKNOWN>(profile?.blood_type ?? UNKNOWN);
  const [errors, setErrors] = useState<ProfileErrors>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<HealthError | null>(null);

  const input: ProfileInput = {
    name: name.trim(),
    relation,
    sex,
    date_of_birth: dob.trim() || null,
    blood_type: blood === UNKNOWN ? null : blood,
  };

  const save = async () => {
    const found = validateProfile(input, lang);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setBusy(true);
    setError(null);
    try {
      const saved = await saveProfile(profile?.id ?? null, input);
      if (!profile) setActiveProfileId(saved.id);
      navigation.goBack();
    } catch (caught) {
      if (isHealthError(caught)) setError(caught);
    } finally {
      setBusy(false);
    }
  };

  return (
    <HealthFrame
      title={profile ? copy.editTitle : copy.addTitle}
      subtitle={copy.subtitle}
      bottomBar={false}
      sideNav
      footer={
        <ParkingButton tone="primary" icon="checkmark" label={profile ? copy.save : copy.add} loading={busy} onPress={() => void save()} />
      }
    >
      <Panel>
        <Field label={copy.name} value={name} onChangeText={setName} error={errors.name} autoCapitalize="words" icon="person-outline" />
        {!profile || profile.relation !== 'self' ? (
          <ChipGroup
            label={copy.relation}
            options={FAMILY_RELATIONS.map((value) => ({ value, label: t.relation[value] }))}
            value={relation}
            onChange={setRelation}
          />
        ) : null}
        <ChipGroup label={copy.sex} options={SEXES.map((value) => ({ value, label: t.sex[value] }))} value={sex} onChange={setSex} />
        <DateField label={copy.dateOfBirth} value={dob} onChange={setDob} error={errors.date_of_birth} optional />
      </Panel>
      <Panel icon="water-outline" title={copy.bloodType}>
        <View>
          <ChipGroup
            options={[
              ...BLOOD_TYPES.map((value) => ({ value, label: value })),
              { value: UNKNOWN, label: t.bloodType(null) },
            ]}
            value={blood}
            onChange={(value) => setBlood(value as BloodType | typeof UNKNOWN)}
          />
          <AppText variant="label" style={styles.hint}>
            {copy.bloodTypeHint}
          </AppText>
        </View>
      </Panel>
      {error ? <ErrorNotice error={error} onRetry={() => void save()} /> : null}
    </HealthFrame>
  );
}
