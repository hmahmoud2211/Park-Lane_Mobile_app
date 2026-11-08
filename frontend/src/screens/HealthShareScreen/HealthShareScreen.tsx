import { useRoute } from '@react-navigation/native';
import { useMemo, useState } from 'react';
import { View } from 'react-native';

import { AppText } from '../../components/common/AppText';
import { Notice } from '../../components/feedback/Notice';
import { InfoRow } from '../../components/ui/Controls';
import { ListRow } from '../../components/ui/ListRow';
import { Panel } from '../../components/ui/Panel';
import { ConfirmSheet, type ConfirmOption } from '../../features/health/components/ConfirmSheet';
import { HealthFrame } from '../../features/health/components/HealthFrame';
import { HealthErrorNotice, ResourceView } from '../../features/health/components/LoadState';
import { useHealth } from '../../features/health/hooks/useHealth';
import { useHealthProfiles, useHealthSharing } from '../../features/health/hooks/useHealthData';
import { HealthError } from '../../features/health/services/healthService';
import { formatDate } from '../../features/health/services/i18n';
import { useAppTheme } from '../../hooks/useAppTheme';
import type { ShareAccess } from '../../types/health.types';
import type { RootStackScreenProps } from '../../types/navigation.types';
import { shareCopy } from './HealthShareScreen.data';
import { createStyles } from './HealthShareScreen.styles';

/** The person a choice is being made for: someone it is shared with already, or someone it could be. */
type Pending = { userId: string; name: string; current: ShareAccess | null };

/**
 * Who can see a record the resident keeps: the apartment's other residents,
 * each to view or to view and edit. Only the keeper reaches this screen
 * (Settings & privacy offers it for their own profiles), and the backend
 * refuses anyone else.
 */
export function HealthShareScreen() {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { params } = useRoute<RootStackScreenProps<'HealthShare'>['route']>();
  const { lang, t, shareProfile, unshareProfile } = useHealth();
  const copy = shareCopy[lang];
  const profiles = useHealthProfiles();
  const sharing = useHealthSharing(params.profileId);
  const [pending, setPending] = useState<Pending | null>(null);

  const profile = profiles.data?.find((p) => p.id === params.profileId);
  const title = !profile ? copy.titleAny : profile.relation === 'self' ? copy.titleOwn : copy.title(profile.name);

  const options: ConfirmOption[] = [
    { id: 'view', label: copy.viewOnly, icon: 'eye-outline', tone: pending?.current === 'view' ? 'primary' : 'secondary' },
    { id: 'edit', label: copy.viewAndEdit, icon: 'create-outline', tone: pending?.current === 'edit' ? 'primary' : 'secondary' },
    ...(pending?.current ? [{ id: 'stop', label: copy.stop, icon: 'person-remove-outline', tone: 'danger' } as const] : []),
  ];

  const choose = async (id: string) => {
    if (!pending) return;
    if (id === 'stop') await unshareProfile(params.profileId, pending.userId);
    else if (id !== pending.current) await shareProfile(params.profileId, pending.userId, id as ShareAccess);
    setPending(null);
  };

  return (
    <HealthFrame
      title={title}
      subtitle={copy.subtitle}
      aside={
        <Panel icon="information-circle-outline" title={copy.howTitle}>
          <View style={styles.points}>
            {copy.how.map((point) => (
              <InfoRow key={point.title} icon={point.icon} label={point.title} value={<AppText variant="caption">{point.body}</AppText>} />
            ))}
          </View>
        </Panel>
      }
    >
      {profiles.data && !profile ? <HealthErrorNotice error={new HealthError('not_found', 'Profile not found.')} /> : null}
      <ResourceView resource={sharing}>
        {(state) =>
          !state.apartment ? (
            <Notice title={copy.shareWith}>{copy.noApartment}</Notice>
          ) : (
            <>
              <Panel icon="people-outline" title={copy.sharedWith} subtitle={state.shares.length ? copy.sharedWithHint : undefined}>
                {state.shares.length === 0 ? (
                  <AppText variant="caption" style={styles.muted}>
                    {copy.nobodyYet}
                  </AppText>
                ) : (
                  state.shares.map((share, index) => (
                    <ListRow
                      key={share.user_id}
                      divided={index > 0}
                      icon={share.access === 'edit' ? 'create-outline' : 'eye-outline'}
                      title={share.name}
                      lines={[copy.since(formatDate(share.since.slice(0, 10), lang))]}
                      statusLabel={t.shared.access[share.access]}
                      statusTone={share.access === 'edit' ? 'teal' : 'slate'}
                      onPress={() => setPending({ userId: share.user_id, name: share.name, current: share.access })}
                    />
                  ))
                )}
              </Panel>
              <Panel icon="person-add-outline" title={copy.shareWith} subtitle={state.members.length ? copy.shareWithHint : undefined}>
                {state.members.length === 0 ? (
                  <AppText variant="caption" style={styles.muted}>
                    {copy.noMembers}
                  </AppText>
                ) : (
                  state.members.map((member, index) => (
                    <ListRow
                      key={member.user_id}
                      divided={index > 0}
                      icon="person-outline"
                      title={member.name}
                      onPress={() => setPending({ userId: member.user_id, name: member.name, current: null })}
                    />
                  ))
                )}
              </Panel>
            </>
          )
        }
      </ResourceView>

      <ConfirmSheet
        key={pending?.userId ?? 'none'}
        visible={pending !== null}
        title={pending ? (pending.current ? copy.changeTitle(pending.name) : copy.chooseTitle(pending.name)) : ''}
        body={pending?.current ? t.shared.access[pending.current] : undefined}
        options={options}
        onSelect={choose}
        onClose={() => setPending(null)}
      />
    </HealthFrame>
  );
}
