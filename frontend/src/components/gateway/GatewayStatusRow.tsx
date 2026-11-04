import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import type { GatewayStatus } from '../../context/GatewayContext';
import { useAppTheme } from '../../hooks/useAppTheme';
import type { AppTheme } from '../../types/theme.types';
import { AppButton } from '../common/AppButton';
import { AppText } from '../common/AppText';
import { StatusChip, type StatusTone } from '../ui/StatusChip';

const LOOK: Record<GatewayStatus, { label: string; tone: StatusTone }> = {
  loading: { label: 'Gateway', tone: 'slate' },
  none: { label: 'No gateway', tone: 'slate' },
  connecting: { label: 'Connecting', tone: 'slate' },
  online: { label: 'Gateway online', tone: 'teal' },
  offline: { label: 'Gateway offline', tone: 'amber' },
  unauthorized: { label: 'Gateway access ended', tone: 'red' },
};

const BUTTON_HEIGHT = 36;

/** The CUBE Gateway's state in one line, with a way to its settings. */
export function GatewayStatusRow({
  status,
  name,
  detail,
  onManage,
  manageLabel = 'Gateway',
}: {
  status: GatewayStatus;
  name: string | null;
  detail?: string | null;
  onManage: () => void;
  manageLabel?: string;
}) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const look = LOOK[status];

  return (
    <View style={styles.row} accessibilityLiveRegion="polite">
      <StatusChip label={look.label} tone={look.tone} icon={status === 'online' ? 'hardware-chip-outline' : 'cloud-offline-outline'} />
      <View style={styles.text}>
        {name ? (
          <AppText variant="tileCaption" numberOfLines={1}>
            {name}
          </AppText>
        ) : null}
        {detail ? (
          <AppText variant="tileCaption" color={theme.colors.textSupport} numberOfLines={2}>
            {detail}
          </AppText>
        ) : null}
      </View>
      <AppButton title={manageLabel} variant="secondary" height={BUTTON_HEIGHT} onPress={onManage} style={styles.button} />
    </View>
  );
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.sm,
    },
    text: {
      flex: 1,
      gap: 2,
    },
    button: {
      paddingHorizontal: theme.spacing.md,
    },
  });
}
