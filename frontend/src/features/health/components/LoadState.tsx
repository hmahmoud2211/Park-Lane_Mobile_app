import type { ReactNode } from 'react';

import { ErrorNotice } from '../../../components/feedback/ErrorNotice';
import { LoadingState } from '../../../components/feedback/LoadingState';
import { Notice } from '../../../components/feedback/Notice';
import { Panel } from '../../../components/ui/Panel';
import { useHealth } from '../hooks/useHealth';
import type { HealthResource } from '../hooks/useHealthData';
import type { HealthError } from '../services/healthService';

export interface HealthErrorNoticeProps {
  error: HealthError;
  /** Offered for failures worth repeating; a 401 signs out instead. */
  onRetry?: () => void;
}

/** A failed request, explained in the UI's language, with a retry where one can help. */
export function HealthErrorNotice({ error, onRetry }: HealthErrorNoticeProps) {
  const { t } = useHealth();
  const copy = t.errors[error.kind];
  const tone = error.kind === 'busy' || error.kind === 'network' || error.kind === 'timeout' ? 'warning' : 'error';
  const body = error.kind === 'invalid' && error.detail ? `${copy.body} (${error.detail})` : copy.body;
  if (!onRetry || error.kind === 'unauthorized' || error.kind === 'aborted' || error.kind === 'not_found') {
    return (
      <Notice tone={tone} title={copy.title}>
        {body}
      </Notice>
    );
  }
  return (
    <ErrorNotice tone={tone} title={copy.title} retryLabel={t.actions.retry} onRetry={onRetry}>
      {body}
    </ErrorNotice>
  );
}

/** The panel shown while a screen's data loads. */
export function LoadingPanel({ label }: { label?: string }) {
  const { t } = useHealth();
  return (
    <Panel>
      <LoadingState label={label ?? t.loading} inset="md" />
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
        {resource.error && !resource.loading ? <HealthErrorNotice error={resource.error} onRetry={resource.reload} /> : null}
        {children(resource.data)}
      </>
    );
  }
  if (resource.error && !resource.loading) {
    return <HealthErrorNotice error={resource.error} onRetry={resource.reload} />;
  }
  return <LoadingPanel label={loadingLabel} />;
}
