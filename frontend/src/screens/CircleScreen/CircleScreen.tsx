import { useIsFocused, useNavigation } from '@react-navigation/native';
import { useMemo, useState } from 'react';
import { Platform, View } from 'react-native';

import { AppButton } from '../../components/common/AppButton';
import { AppText } from '../../components/common/AppText';
import { ErrorNotice } from '../../components/feedback/ErrorNotice';
import { LoadingState } from '../../components/feedback/LoadingState';
import { Notice } from '../../components/feedback/Notice';
import { InnerScreenFrame } from '../../components/layout/InnerScreenFrame';
import { PageHeader } from '../../components/layout/PageHeader';
import { FilterChip } from '../../components/ui/FilterChip';
import { NeonPanel } from '../../components/ui/NeonPanel';
import { PanelHeading } from '../../components/ui/PanelHeading';
import { StatusChip } from '../../components/ui/StatusChip';
import { CircleMap } from '../../features/circles/components/CircleMap';
import { useCircleInvites } from '../../features/circles/hooks/useCircleInvites';
import { useCircles } from '../../features/circles/hooks/useCircles';
import { useLiveWatch } from '../../features/circles/hooks/useLiveWatch';
import { useLocationSharing } from '../../features/circles/hooks/useLocationSharing';
import { locatedMembers } from '../../features/circles/services/circleRules';
import type { Circle } from '../../features/circles/types';
import { useEms } from '../../features/ems/hooks/useEms';
import { useAppTheme } from '../../hooks/useAppTheme';
import type { RootStackScreenProps } from '../../types/navigation.types';
import { circleCopy as copy } from './CircleScreen.data';
import { BUTTON_HEIGHT, SMALL_BUTTON_HEIGHT, createStyles } from './CircleScreen.styles';
import { InvitePanel } from './InvitePanel';
import { MembersPanel } from './MembersPanel';
import { SharingPanel } from './SharingPanel';
import { StartPanel } from './StartPanel';

/**
 * Family Circle (docs/plans/FAMILY_CIRCLE_PLAN.md): the people in your Circles on a map, when each was last seen and
 * their battery, and your own sharing switch. Without a Circle, make one or join with a code. Owners invite anyone
 * with the app, also people outside the compound. Positions arrive live; the web app shows the list without a map.
 */
export function CircleScreen() {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const navigation = useNavigation<RootStackScreenProps<'Circle'>['navigation']>();
  const ems = useEms();
  const circles = useCircles();
  const list = circles.state.status === 'ready' ? circles.state.circles : null;
  const sharing = useLocationSharing(list, circles.setSharing);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const selected: Circle | null = list?.find((circle) => circle.id === selectedId) ?? list?.[0] ?? null;
  const invites = useCircleInvites(selected?.role === 'owner' ? selected.id : null);
  // The same list while nothing changed, so the map's pins don't restart their slide on every render.
  const located = useMemo(() => (selected ? locatedMembers(selected) : []), [selected]);
  // Live view: while this screen is in front, the people who share here send fast updates.
  const someoneShares = selected?.members.some((member) => member.sharing && !member.you) ?? false;
  const live = useLiveWatch(someoneShares && selected ? selected.id : null, useIsFocused());

  const onStarted = (circle: Circle, note: string | null) => {
    setSelectedId(circle.id);
    setMessage(note);
    setAdding(false);
  };

  const renderSignedOut = () => (
    <NeonPanel style={styles.panel}>
      <PanelHeading title={copy.signInTitle} iconSet="ionicons" iconName="log-in-outline" divider />
      <AppText variant="bodySmall" color={theme.colors.textSupport}>
        {copy.signInBody}
      </AppText>
      <AppButton title={copy.signIn} variant="gradient" height={BUTTON_HEIGHT} onPress={() => navigation.reset({ index: 0, routes: [{ name: 'Login' }] })} />
    </NeonPanel>
  );

  const renderCircle = (circle: Circle, all: readonly Circle[]) => {
    return (
      <>
        {all.length > 1 ? (
          <View style={styles.chips} accessibilityLabel={copy.circlesLabel}>
            {all.map((item) => (
              <FilterChip
                key={item.id}
                label={item.name}
                iconSet="ionicons"
                iconName="people-outline"
                selected={item.id === circle.id}
                onPress={() => setSelectedId(item.id)}
                role="tab"
              />
            ))}
          </View>
        ) : null}

        {Platform.OS !== 'web' && located.length > 0 ? (
          <NeonPanel style={styles.mapPanel}>
            {/* A new key per Circle opens the map on that Circle's people. */}
            <CircleMap key={circle.id} members={located} style={styles.map} />
          </NeonPanel>
        ) : null}
        {located.length === 0 ? <Notice tone="info">{copy.mapEmpty}</Notice> : null}
        {live.state === 'live' ? (
          <View style={styles.itemRow}>
            <StatusChip label={copy.liveChip} tone="red" icon="radio-outline" glow />
            <AppText variant="tileCaption" color={theme.colors.textSupport} style={styles.text}>
              {copy.liveNote}
            </AppText>
          </View>
        ) : live.state === 'paused' ? (
          <Notice tone="info" actions={<AppButton title={copy.liveResume} variant="secondary" height={SMALL_BUTTON_HEIGHT} onPress={live.resume} />}>
            {copy.livePaused}
          </Notice>
        ) : located.length > 0 ? (
          <AppText variant="tileCaption" color={theme.colors.textSupport}>
            {copy.mapNote}
          </AppText>
        ) : null}

        <SharingPanel
          circle={circle}
          access={sharing.access}
          busy={sharing.busy}
          turnOn={sharing.turnOn}
          turnOff={sharing.turnOff}
          askAlways={sharing.askAlways}
          openSettings={sharing.openSettings}
          styles={styles}
        />
        <MembersPanel circle={circle} removeMember={circles.removeMember} styles={styles} />
        {circle.role === 'owner' ? (
          <InvitePanel circleName={circle.name} open={invites.open} create={invites.create} cancel={invites.cancel} styles={styles} />
        ) : (
          <Notice tone="info">{copy.memberOnly}</Notice>
        )}

        {adding ? (
          <>
            <StartPanel create={circles.create} check={circles.check} join={circles.join} onDone={onStarted} styles={styles} />
            <AppButton title={copy.less} variant="secondary" height={SMALL_BUTTON_HEIGHT} onPress={() => setAdding(false)} />
          </>
        ) : (
          <AppButton title={copy.more} variant="secondary" height={SMALL_BUTTON_HEIGHT} onPress={() => setAdding(true)} />
        )}
      </>
    );
  };

  const renderBody = () => {
    if (ems.status !== 'signedIn' || ems.passwordChangeRequired) {
      return ems.status === 'loading' ? <LoadingState label={copy.loading} /> : renderSignedOut();
    }
    const { state } = circles;
    switch (state.status) {
      case 'loading':
        return <LoadingState label={copy.loading} />;
      case 'error':
        return (
          <ErrorNotice title={copy.loadFailed} retryLabel={copy.retry} onRetry={circles.reload} buttonHeight={SMALL_BUTTON_HEIGHT} tone="warning">
            {state.message}
          </ErrorNotice>
        );
      case 'hidden':
        return (
          <Notice tone="info" title={copy.unavailableTitle}>
            {copy.unavailableBody}
          </Notice>
        );
      case 'ready':
        return selected ? (
          renderCircle(selected, state.circles)
        ) : (
          <StartPanel create={circles.create} check={circles.check} join={circles.join} onDone={onStarted} styles={styles} />
        );
    }
  };

  return (
    <InnerScreenFrame contentStyle={styles.content}>
      <PageHeader title={copy.title} subtitle={copy.subtitle} style={styles.header} />
      {message ? <Notice tone="success">{message}</Notice> : null}
      {renderBody()}
    </InnerScreenFrame>
  );
}
