import { StackActions, useNavigation } from '@react-navigation/native';
import { useMemo, useState } from 'react';
import { View } from 'react-native';

import { AppText } from '../../components/common/AppText';
import { ConfirmSheet } from '../../features/health/components/ConfirmSheet';
import { HealthFrame } from '../../features/health/components/HealthFrame';
import { ResourceView } from '../../features/health/components/LoadState';
import { profileLine, sharedLabel } from '../../features/health/components/presenters';
import { InfoRow } from '../../components/ui/Controls';
import { Panel } from '../../components/ui/Panel';
import { ParkingButton } from '../../components/ui/ParkingButton';
import { ListRow } from '../../components/ui/ListRow';
import { useAppTheme } from '../../hooks/useAppTheme';
import { useHealth } from '../../features/health/hooks/useHealth';
import { useHealthProfiles } from '../../features/health/hooks/useHealthData';
import type { HealthProfile } from '../../types/health.types';
import type { RootStackScreenProps } from '../../types/navigation.types';
import { dataUsePoints } from '../../features/health/services/dataUse';
import { settingsCopy } from './HealthSettingsScreen.data';
import { createStyles } from './HealthSettingsScreen.styles';

type Pending = { kind: 'wipe' | 'remove' | 'leave'; profile: HealthProfile } | { kind: 'withdraw' };

/**
 * Family profiles, sharing them with the apartment and the records others
 * share, the same plain-language account of data use as onboarding, and the
 * two destructive actions, each behind a typed confirmation: deleting one
 * person's data, and withdrawing consent, which deletes everyone's.
 */
export function HealthSettingsScreen() {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const navigation = useNavigation<RootStackScreenProps<'HealthSettings'>['navigation']>();
  const { lang, t, deleteProfile, leaveSharedProfile, setConsent } = useHealth();
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
    if (pending.kind === 'leave') {
      return { title: copy.leaveTitle(name), body: copy.leaveBody(pending.profile.shared_by ?? ''), label: copy.leaveConfirm, typeToConfirm: undefined };
    }
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
    if (pending.kind === 'leave') await leaveSharedProfile(pending.profile.id);
    else await deleteProfile(pending.profile.id);
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
        {(all) => {
          const kept = all.filter((profile) => profile.access === 'owner');
          const shared = all.filter((profile) => profile.access !== 'owner');
          return (
            <>
              <Panel icon="people-outline" title={copy.family} subtitle={copy.familyHint}>
                {kept.map((profile, index) => (
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
              <Panel icon="share-social-outline" title={copy.share} subtitle={copy.shareHint}>
                {kept.map((profile, index) => (
                  <ListRow
                    key={profile.id}
                    divided={index > 0}
                    icon={profile.shared_with ? 'people-outline' : 'lock-closed-outline'}
                    title={profile.name}
                    lines={[profile.shared_with ? copy.sharedCount(profile.shared_with) : copy.onlyYou]}
                    onPress={() => navigation.navigate('HealthShare', { profileId: profile.id })}
                  />
                ))}
              </Panel>
              {shared.length > 0 ? (
                <Panel icon="eye-outline" title={copy.sharedWithYou} subtitle={copy.sharedWithYouHint}>
                  {shared.map((profile, index) => (
                    <ListRow
                      key={profile.id}
                      divided={index > 0}
                      icon={profile.access === 'edit' ? 'create-outline' : 'eye-outline'}
                      title={profile.name}
                      lines={[sharedLabel(profile, t) ?? '']}
                      statusLabel={t.shared.access[profile.access === 'edit' ? 'edit' : 'view']}
                      statusTone={profile.access === 'edit' ? 'teal' : 'slate'}
                      onPress={() => setPending({ kind: 'leave', profile })}
                    />
                  ))}
                </Panel>
              ) : null}
              <Panel icon="trash-outline" title={copy.deleteData} subtitle={copy.deleteDataHint}>
                {kept.map((profile) => (
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
          );
        }}
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
        options={[{ id: 'confirm', label: sheet?.label ?? '', tone: 'danger', icon: pending?.kind === 'leave' ? 'eye-off-outline' : 'trash-outline' }]}
        onSelect={run}
        onClose={() => setPending(null)}
      />
    </HealthFrame>
  );
}
