import type { ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { useAppTheme } from '../../hooks/useAppTheme';
import { useHealth } from '../../hooks/useHealth';
import type { HealthResource } from '../../hooks/useHealthData';
import type { HealthError } from '../../services/health/healthService';
import { AppText } from '../common/AppText';
import { Notice } from '../parking/Notice';
import { Panel } from '../parking/Panel';
import { ParkingButton } from '../parking/ParkingButton';

export interface ErrorNoticeProps {
  error: HealthError;
  /** Offered for failures worth repeating; a 401 signs out instead. */
  onRetry?: () => void;
}

/** A failed request, explained in the UI's language, with a retry where one can help. */
export function ErrorNotice({ error, onRetry }: ErrorNoticeProps) {
  const { t } = useHealth();
  const copy = t.errors[error.kind];
  const canRetry = onRetry && error.kind !== 'unauthorized' && error.kind !== 'aborted' && error.kind !== 'not_found';
  return (
    <Notice
      tone={error.kind === 'busy' || error.kind === 'network' || error.kind === 'timeout' ? 'warning' : 'error'}
      title={copy.title}
      actions={canRetry ? <ParkingButton compact icon="refresh" label={t.actions.retry} onPress={onRetry} /> : undefined}
    >
      {error.kind === 'invalid' && error.detail ? `${copy.body} (${error.detail})` : copy.body}
    </Notice>
  );
}

/** The panel shown while a screen's data loads. */
export function LoadingPanel({ label }: { label?: string }) {
  const theme = useAppTheme();
  const { t } = useHealth();
  return (
    <Panel>
      <View style={styles.loading} accessibilityRole="progressbar" accessibilityLabel={label ?? t.loading}>
        <ActivityIndicator color={theme.colors.textPrimary} />
        <AppText variant="caption" color={theme.colors.textSecondary}>
          {label ?? t.loading}
        </AppText>
      </View>
    </Panel>
  );
}

export interface ResourceViewProps<T> {
  resource: HealthResource<T>;
  children: (data: T) => ReactNode;
  loadingLabel?: string;
}

/**
 * Loading, then the content; or the error with "Try again" when there is
 * nothing to show yet. A failed refresh keeps the data already on screen.
 */
export function ResourceView<T>({ resource, children, loadingLabel }: ResourceViewProps<T>) {
  if (resource.data !== undefined) {
    return (
      <>
        {resource.error && !resource.loading ? <ErrorNotice error={resource.error} onRetry={resource.reload} /> : null}
        {children(resource.data)}
      </>
    );
  }
  if (resource.error && !resource.loading) {
    return <ErrorNotice error={resource.error} onRetry={resource.reload} />;
  }
  return <LoadingPanel label={loadingLabel} />;
}

const styles = StyleSheet.create({
  loading: {
    minHeight: 72,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
});
