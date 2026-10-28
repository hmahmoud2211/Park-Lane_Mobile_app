import { StackActions, useNavigation } from '@react-navigation/native';
import { useMemo, useState } from 'react';
import { View } from 'react-native';

import { AppText } from '../../components/common/AppText';
import { ConfirmSheet } from '../../components/health/ConfirmSheet';
import { HealthFrame } from '../../components/health/HealthFrame';
import { ResourceView } from '../../components/health/LoadState';
import { profileLine } from '../../components/health/presenters';
import { InfoRow } from '../../components/parking/Controls';
import { Panel } from '../../components/parking/Panel';
import { ParkingButton } from '../../components/parking/ParkingButton';
import { ListRow } from '../../components/parking/Rows';
import { useAppTheme } from '../../hooks/useAppTheme';
import { useHealth } from '../../hooks/useHealth';
import { useHealthProfiles } from '../../hooks/useHealthData';
import type { HealthProfile } from '../../services/health/health.types';
import type { RootStackScreenProps } from '../../types/navigation.types';
import { dataUsePoints } from '../HealthOnboardingScreen/HealthOnboardingScreen.data';
import { settingsCopy } from './HealthSettingsScreen.data';
import { createStyles } from './HealthSettingsScreen.styles';

type Pending = { kind: 'wipe' | 'remove'; profile: HealthProfile } | { kind: 'withdraw' };

/**
 * Family profiles, the same plain-language account of data use as
 * onboarding, and the two destructive actions, each behind a typed
 * confirmation: deleting one person's data, and withdrawing consent, which
 * deletes everyone's.
 */
export function HealthSettingsScreen() {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const navigation = useNavigation<RootStackScreenProps<'HealthSettings'>['navigation']>();
  const { lang, t, deleteProfile, setConsent } = useHealth();
  const copy = settingsCopy[lang];
  const profiles = useHealthProfiles();
  const [pending, setPending] = useState<Pending | null>(null);

  const sheet = (() => {
    if (!pending) return null;
    if (pending.kind === 'withdraw') {
      return {
        title: copy.withdrawTitle,
        body: copy.withdrawBody,
        label: copy.withdrawConfirm,
        typeToConfirm: { expected: copy.withdrawWord, label: copy.typeWord(copy.withdrawWord) },
      };
    }
    const name = pending.profile.name;
    return pending.kind === 'remove'
      ? { title: copy.deleteProfileTitle(name), body: copy.deleteProfileBody, label: copy.deleteConfirm, typeToConfirm: { expected: name, label: copy.typeName(name) } }
      : { title: copy.deleteTitle(name), body: copy.deleteBody, label: copy.deleteConfirm, typeToConfirm: { expected: name, label: copy.typeName(name) } };
  })();

  const run = async () => {
    if (!pending) return;
    if (pending.kind === 'withdraw') {
      await setConsent(false);
      setPending(null);
      navigation.dispatch(StackActions.popTo('Home'));
      return;
    }
    await deleteProfile(pending.profile.id);
    setPending(null);
  };

  return (
    <HealthFrame
      title={copy.title}
      subtitle={copy.subtitle}
      aside={
        <Panel icon="shield-checkmark-outline" title={copy.dataUse}>
          <View style={styles.points}>
            {dataUsePoints[lang].map((point) => (
              <InfoRow key={point.title} icon={point.icon} label={point.title} value={<AppText variant="caption">{point.body}</AppText>} />
            ))}
          </View>
        </Panel>
      }
    >
      <ResourceView resource={profiles}>
        {(all) => (
          <>
            <Panel icon="people-outline" title={copy.family} subtitle={copy.familyHint}>
              {all.map((profile, index) => (
                <ListRow
                  key={profile.id}
                  divided={index > 0}
                  icon={profile.relation === 'self' ? 'person-outline' : 'person-add-outline'}
                  title={`${profile.name} · ${t.relation[profile.relation]}`}
                  lines={[profileLine(profile, lang)]}
                  accessibilityHint={copy.edit}
                  onPress={() => navigation.navigate('HealthProfile', { profileId: profile.id })}
                />
              ))}
              <ParkingButton compact icon="add" label={copy.addFamily} onPress={() => navigation.navigate('HealthProfile')} />
            </Panel>
            <Panel icon="trash-outline" title={copy.deleteData} subtitle={copy.deleteDataHint}>
              {all.map((profile) => (
                <ParkingButton
                  key={profile.id}
                  compact
                  tone="danger"
                  icon={profile.relation === 'self' ? 'trash-outline' : 'person-remove-outline'}
                  label={profile.relation === 'self' ? copy.deleteFor(profile.name) : copy.remove(profile.name)}
                  onPress={() => setPending({ kind: profile.relation === 'self' ? 'wipe' : 'remove', profile })}
                />
              ))}
            </Panel>
          </>
        )}
      </ResourceView>
      <Panel icon="hand-left-outline" title={copy.withdraw}>
        <AppText variant="caption" style={styles.muted}>
          {copy.withdrawHint}
        </AppText>
        <ParkingButton tone="danger" icon="close-circle-outline" label={copy.withdraw} onPress={() => setPending({ kind: 'withdraw' })} />
      </Panel>

      <ConfirmSheet
        key={pending ? `${pending.kind}-${'profile' in pending ? pending.profile.id : ''}` : 'none'}
        visible={sheet !== null}
        title={sheet?.title ?? ''}
        body={sheet?.body}
        typeToConfirm={sheet?.typeToConfirm}
        options={[{ id: 'confirm', label: sheet?.label ?? '', tone: 'danger', icon: 'trash-outline' }]}
        onSelect={run}
        onClose={() => setPending(null)}
      />
    </HealthFrame>
  );
}
