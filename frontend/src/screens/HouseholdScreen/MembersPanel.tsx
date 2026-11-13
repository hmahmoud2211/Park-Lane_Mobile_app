import { useState } from 'react';
import { View } from 'react-native';

import { AppButton } from '../../components/common/AppButton';
import { AppText } from '../../components/common/AppText';
import { GlassSurface } from '../../components/common/GlassSurface';
import { Notice } from '../../components/feedback/Notice';
import { NeonPanel } from '../../components/ui/NeonPanel';
import { PanelHeading } from '../../components/ui/PanelHeading';
import { StatusChip } from '../../components/ui/StatusChip';
import { EmsError } from '../../features/ems/services/emsHttp';
import { memberRows, type MemberRow } from '../../features/unit/services/unitRules';
import type { MyUnit } from '../../features/unit/types';
import { useAppTheme } from '../../hooks/useAppTheme';
import { householdCopy as copy } from './HouseholdScreen.data';
import { SMALL_BUTTON_HEIGHT, type createStyles } from './HouseholdScreen.styles';

interface MembersPanelProps {
  unit: MyUnit;
  removeMember: (userId: string) => Promise<void>;
  styles: ReturnType<typeof createStyles>;
}

/** Who shares the apartment; an owner can remove anyone but themselves, after one confirmation. */
export function MembersPanel({ unit, removeMember, styles }: MembersPanelProps) {
  const theme = useAppTheme();
  const [confirming, setConfirming] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [failure, setFailure] = useState<{ id: string; message: string } | null>(null);

  const remove = async (row: MemberRow) => {
    setRemoving(row.userId);
    setFailure(null);
    try {
      await removeMember(row.userId);
      setConfirming(null);
    } catch (error) {
      setFailure({ id: row.userId, message: error instanceof EmsError ? error.message : copy.removeFailed });
    } finally {
      setRemoving(null);
    }
  };

  const renderRow = (row: MemberRow) => (
    <GlassSurface
      key={row.userId}
      radius={theme.borderRadius.sm}
      blurred={false}
      strokeColors={[theme.colors.cardStrokeFrom, theme.colors.featureStrokeTo]}
      fillOpacity={theme.glass.subtleFillOpacity}
      style={styles.item}
    >
      <View style={styles.itemRow}>
        <View style={styles.text}>
          <AppText variant="statValue">{row.name}</AppText>
          {row.email ? (
            <AppText variant="tileCaption" color={theme.colors.textSupport} selectable>
              {row.email}
            </AppText>
          ) : null}
        </View>
        {row.you ? <StatusChip label={copy.you} tone="teal" icon="person-outline" /> : null}
        <StatusChip label={copy.role(row.role)} tone="slate" icon={row.role === 'owner' ? 'key-outline' : undefined} />
      </View>
      {row.removable && confirming === row.userId ? (
        <Notice
          tone="warning"
          actions={
            <>
              <AppButton title={copy.removeConfirm} variant="secondary" height={SMALL_BUTTON_HEIGHT} loading={removing === row.userId} onPress={() => void remove(row)} />
              <AppButton title={copy.cancel} variant="secondary" height={SMALL_BUTTON_HEIGHT} disabled={removing === row.userId} onPress={() => setConfirming(null)} />
            </>
          }
        >
          {copy.removeWarning(row.name)}
        </Notice>
      ) : row.removable ? (
        <View style={styles.row}>
          <AppButton
            title={copy.remove}
            variant="secondary"
            height={SMALL_BUTTON_HEIGHT}
            onPress={() => {
              setConfirming(row.userId);
              setFailure(null);
            }}
            accessibilityLabel={`${copy.remove} ${row.name}`}
            accessibilityHint={copy.removeWarning(row.name)}
            style={styles.action}
          />
        </View>
      ) : null}
      {failure?.id === row.userId ? <Notice tone="error">{failure.message}</Notice> : null}
    </GlassSurface>
  );

  return (
    <NeonPanel style={styles.panel}>
      <PanelHeading title={copy.membersTitle} subtitle={unit.unit.building ? `${unit.unit.name} · ${unit.unit.building}` : unit.unit.name} iconSet="ionicons" iconName="people-outline" divider />
      {memberRows(unit).map(renderRow)}
    </NeonPanel>
  );
}
