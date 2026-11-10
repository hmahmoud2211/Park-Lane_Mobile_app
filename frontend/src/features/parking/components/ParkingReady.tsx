import { useEffect, useMemo, type ComponentType } from 'react';
import { StyleSheet } from 'react-native';

import { ErrorNotice } from '../../../components/feedback/ErrorNotice';
import { LoadingState } from '../../../components/feedback/LoadingState';
import { Notice } from '../../../components/feedback/Notice';
import { InnerScreenFrame } from '../../../components/layout/InnerScreenFrame';
import { NAV_BAR_CLEARANCE } from '../../../components/layout/BottomBar';
import { PageHeader } from '../../../components/layout/PageHeader';
import { useAppTheme } from '../../../hooks/useAppTheme';
import { layout } from '../../../theme';
import type { AppTheme } from '../../../types/theme.types';
import { MAX_CONTENT_WIDTH } from '../../../utils/responsive';
import { useParking } from '../hooks/useParking';

const copy = {
  title: 'Parking',
  loading: 'Loading parking…',
  failed: 'Couldn’t load parking',
  retry: 'Try again',
  noHomeTitle: 'Not linked to an apartment yet',
  noHomeBody: 'Ask building management to add your account to your apartment. You can then book visitor parking here.',
} as const;

/**
 * Parking screens read the parking store as soon as they draw. With the backend's store, that waits for the first
 * snapshot: until then this shows the screen's frame with a loading, error or "no apartment" state instead.
 */
export function withParkingReady<P extends object>(Screen: ComponentType<P>): ComponentType<P> {
  function Ready(props: P) {
    const { status, error, reload, retain } = useParking();
    useEffect(() => retain(), [retain]);
    const theme = useAppTheme();
    const styles = useMemo(() => createStyles(theme), [theme]);
    if (status === 'ready') return <Screen {...props} />;
    return (
      <InnerScreenFrame contentStyle={styles.content}>
        <PageHeader title={copy.title} style={styles.header} />
        {status === 'loading' ? (
          <LoadingState label={copy.loading} />
        ) : status === 'no_home' ? (
          <Notice tone="info" title={copy.noHomeTitle}>
            {copy.noHomeBody}
          </Notice>
        ) : (
          <ErrorNotice title={copy.failed} retryLabel={copy.retry} onRetry={reload}>
            {error ?? ''}
          </ErrorNotice>
        )}
      </InnerScreenFrame>
    );
  }
  Ready.displayName = `WithParkingReady(${Screen.displayName ?? Screen.name ?? 'Screen'})`;
  return Ready;
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    content: {
      width: '100%',
      maxWidth: MAX_CONTENT_WIDTH,
      alignSelf: 'center',
      paddingTop: theme.spacing.headerTop,
      paddingHorizontal: layout.innerScreen.gutter,
      paddingBottom: NAV_BAR_CLEARANCE + layout.innerScreen.cardGap,
      gap: layout.innerScreen.cardGap,
    },
    header: {
      marginHorizontal: layout.innerScreen.headerGutter - layout.innerScreen.gutter,
      marginBottom: layout.innerScreen.headerToContent - layout.innerScreen.cardGap,
    },
  });
}
