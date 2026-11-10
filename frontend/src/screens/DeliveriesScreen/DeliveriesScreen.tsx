import { useEffect, useMemo } from 'react';
import { View } from 'react-native';

import type { Parcel } from '../../../../shared/contracts/parcels';
import { AppText } from '../../components/common/AppText';
import { ErrorNotice } from '../../components/feedback/ErrorNotice';
import { LoadingState } from '../../components/feedback/LoadingState';
import { Notice } from '../../components/feedback/Notice';
import { InnerScreenFrame } from '../../components/layout/InnerScreenFrame';
import { PageHeader } from '../../components/layout/PageHeader';
import { NeonPanel } from '../../components/ui/NeonPanel';
import { StatusChip } from '../../components/ui/StatusChip';
import { useEms } from '../../features/ems/hooks/useEms';
import { listParcels } from '../../features/parcels/services/parcelsApi';
import { useAppTheme } from '../../hooks/useAppTheme';
import { useFocusQuery } from '../../hooks/useFocusQuery';
import { deliveriesCopy as copy, receivedAt, statusLook } from './DeliveriesScreen.data';
import { createStyles } from './DeliveriesScreen.styles';

/** Parcels the gate logged for the apartment: what waits to be collected, and the last 30 days. Live. */
export function DeliveriesScreen() {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const query = useFocusQuery(listParcels);
  const { onRealtimeEvent } = useEms();
  const reload = query.reload;

  useEffect(
    () =>
      onRealtimeEvent((event) => {
        if (event.type === 'parcel.updated' || event.type === 'ready') reload();
      }),
    [onRealtimeEvent, reload],
  );

  const list = (parcels: readonly Parcel[], empty: string) =>
    parcels.length === 0 ? (
      <AppText variant="bodySmall" color={theme.colors.textSecondary}>
        {empty}
      </AppText>
    ) : (
      parcels.map((parcel) => (
        <View key={parcel.id} style={styles.row}>
          <View style={styles.rowText}>
            <AppText variant="bodyStrong">{[parcel.carrier, parcel.description].filter(Boolean).join(' · ') || parcel.reference}</AppText>
            <AppText variant="caption" color={theme.colors.textSupport}>
              {`${parcel.reference} · ${receivedAt(parcel.receivedAt)}`}
            </AppText>
          </View>
          <StatusChip label={statusLook[parcel.status].label} tone={statusLook[parcel.status].tone} />
        </View>
      ))
    );

  const body = () => {
    if (query.error?.code === 'no_home') {
      return (
        <Notice tone="info" title={copy.noHomeTitle}>
          {copy.noHomeBody}
        </Notice>
      );
    }
    if (query.error) {
      return (
        <ErrorNotice title={copy.loadFailed} retryLabel={copy.retry} onRetry={query.reload}>
          {query.error.message}
        </ErrorNotice>
      );
    }
    if (!query.data) return <LoadingState />;
    const waiting = query.data.filter((parcel) => parcel.status === 'waiting');
    const done = query.data.filter((parcel) => parcel.status !== 'waiting');
    return (
      <>
        <NeonPanel style={styles.panel}>
          <AppText variant="bodyStrong" accessibilityRole="header">
            {copy.waitingHeading}
          </AppText>
          {list(waiting, copy.noWaiting)}
          {waiting.length > 0 ? (
            <AppText variant="caption" color={theme.colors.textSecondary}>
              {copy.howToCollect}
            </AppText>
          ) : null}
        </NeonPanel>
        <NeonPanel style={styles.panel}>
          <AppText variant="bodyStrong" accessibilityRole="header">
            {copy.historyHeading}
          </AppText>
          {list(done, copy.noHistory)}
        </NeonPanel>
      </>
    );
  };

  return (
    <InnerScreenFrame contentStyle={styles.content}>
      <PageHeader title={copy.title} subtitle={copy.subtitle} style={styles.header} />
      {body()}
    </InnerScreenFrame>
  );
}
