import { useState } from 'react';
import { View } from 'react-native';

import { AppButton } from '../../components/common/AppButton';
import { AppText } from '../../components/common/AppText';
import { GlassSurface } from '../../components/common/GlassSurface';
import { Notice } from '../../components/feedback/Notice';
import { NeonPanel } from '../../components/ui/NeonPanel';
import { PanelHeading } from '../../components/ui/PanelHeading';
import { StatusChip } from '../../components/ui/StatusChip';
import { batteryLabel, batteryTone, lastSeenLabel, memberState } from '../../features/circles/services/circleRules';
import type { Circle, CircleMember } from '../../features/circles/types';
import { EmsError } from '../../features/ems/services/emsHttp';
import { useAppTheme } from '../../hooks/useAppTheme';
import { circleCopy as copy } from './CircleScreen.data';
import { SMALL_BUTTON_HEIGHT, type createStyles } from './CircleScreen.styles';

interface MembersPanelProps {
  circle: Circle;
  /** Owners remove someone; with the person's own id, they leave. */
  removeMember: (circleId: string, userId: string) => Promise<unknown>;
  styles: ReturnType<typeof createStyles>;
}

/** Who is in the Circle: when each sharing member was last seen and their battery. Owners remove people; anyone leaves. */
export function MembersPanel({ circle, removeMember, styles }: MembersPanelProps) {
  const theme = useAppTheme();
  const [confirming, setConfirming] = useState<string | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  const [failure, setFailure] = useState<{ id: string; message: string } | null>(null);
  const me = circle.members.find((member) => member.you);

  const remove = async (userId: string, fallback: string) => {
    setWorking(userId);
    setFailure(null);
    try {
      await removeMember(circle.id, userId);
      setConfirming(null);
    } catch (error) {
      setFailure({ id: userId, message: error instanceof EmsError ? error.message : fallback });
    } finally {
      setWorking(null);
    }
  };

  const status = (member: CircleMember) => {
    switch (memberState(member)) {
      case 'located':
        return copy.seen(lastSeenLabel(member.location!.at));
      case 'waiting':
        return copy.waiting;
      case 'notSharing':
        return copy.notSharing;
    }
  };

  const renderRow = (member: CircleMember) => {
    const removable = circle.role === 'owner' && !member.you;
    return (
      <GlassSurface
        key={member.userId}
        radius={theme.borderRadius.sm}
        blurred={false}
        strokeColors={[theme.colors.cardStrokeFrom, theme.colors.featureStrokeTo]}
        fillOpacity={theme.glass.subtleFillOpacity}
        style={styles.item}
      >
        <View style={styles.itemRow}>
          <View style={styles.text}>
            <AppText variant="statValue">{member.name}</AppText>
            <AppText variant="tileCaption" color={theme.colors.textSupport}>
              {status(member)}
            </AppText>
          </View>
          {member.you ? <StatusChip label={copy.you} tone="teal" icon="person-outline" /> : null}
          {member.role === 'owner' ? <StatusChip label={copy.owner} tone="slate" icon="key-outline" /> : null}
        </View>
        {member.battery ? (
          <View style={styles.row}>
            <StatusChip
              label={batteryLabel(member.battery)}
              tone={batteryTone(member.battery)}
              icon={member.battery.charging ? 'battery-charging-outline' : 'battery-half-outline'}
            />
          </View>
        ) : null}
        {removable && confirming === member.userId ? (
          <Notice
            tone="warning"
            actions={
              <>
                <AppButton
                  title={copy.removeConfirm}
                  variant="secondary"
                  height={SMALL_BUTTON_HEIGHT}
                  loading={working === member.userId}
                  onPress={() => void remove(member.userId, copy.removeFailed)}
                />
                <AppButton title={copy.cancel} variant="secondary" height={SMALL_BUTTON_HEIGHT} disabled={working === member.userId} onPress={() => setConfirming(null)} />
              </>
            }
          >
            {copy.removeWarning(member.name)}
          </Notice>
        ) : removable ? (
          <View style={styles.row}>
            <AppButton
              title={copy.remove}
              variant="secondary"
              height={SMALL_BUTTON_HEIGHT}
              onPress={() => {
                setConfirming(member.userId);
                setFailure(null);
              }}
              accessibilityLabel={`${copy.remove} ${member.name}`}
              style={styles.action}
            />
          </View>
        ) : null}
        {failure?.id === member.userId ? <Notice tone="error">{failure.message}</Notice> : null}
      </GlassSurface>
    );
  };

  return (
    <NeonPanel style={styles.panel}>
      <PanelHeading title={copy.membersTitle} subtitle={circle.name} iconSet="ionicons" iconName="people-outline" divider />
      {circle.members.map(renderRow)}
      {me && confirming === me.userId ? (
        <Notice
          tone="warning"
          actions={
            <>
              <AppButton title={copy.leaveConfirm} variant="secondary" height={SMALL_BUTTON_HEIGHT} loading={working === me.userId} onPress={() => void remove(me.userId, copy.leaveFailed)} />
              <AppButton title={copy.cancel} variant="secondary" height={SMALL_BUTTON_HEIGHT} disabled={working === me.userId} onPress={() => setConfirming(null)} />
            </>
          }
        >
          {copy.leaveWarning}
        </Notice>
      ) : me ? (
        <AppButton
          title={copy.leave}
          variant="secondary"
          height={SMALL_BUTTON_HEIGHT}
          onPress={() => {
            setConfirming(me.userId);
            setFailure(null);
          }}
        />
      ) : null}
      {me && failure?.id === me.userId ? <Notice tone="error">{failure.message}</Notice> : null}
    </NeonPanel>
  );
}
