import { useNavigation } from '@react-navigation/native';
import { useMemo } from 'react';
import { Pressable, View } from 'react-native';

import type { NotificationKind } from '../../../../shared/contracts/notifications';
import { AppText } from '../../components/common/AppText';
import { ToggleSwitch } from '../../components/common/ToggleSwitch';
import { ErrorNotice } from '../../components/feedback/ErrorNotice';
import { LoadingState } from '../../components/feedback/LoadingState';
import { Notice } from '../../components/feedback/Notice';
import { InnerScreenFrame } from '../../components/layout/InnerScreenFrame';
import { PageHeader } from '../../components/layout/PageHeader';
import { NeonPanel } from '../../components/ui/NeonPanel';
import { ParkingButton } from '../../components/ui/ParkingButton';
import { useNotifications } from '../../features/notifications/hooks/useNotifications';
import { useAppTheme } from '../../hooks/useAppTheme';
import type { RootStackScreenProps } from '../../types/navigation.types';
import { kindLabels, notificationsCopy as copy, timeAgo } from './NotificationsScreen.data';
import { createStyles } from './NotificationsScreen.styles';

/** The resident's inbox (every feature reports here) and which kinds they want to hear about. */
export function NotificationsScreen() {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const navigation = useNavigation<RootStackScreenProps<'Notifications'>['navigation']>();
  const { inbox, prefs, reload, loadMore, markAllRead, setPref } = useNotifications();

  const body = () => {
    if (inbox.status === 'signedOut') {
      return (
        <Notice
          tone="info"
          title={copy.guestTitle}
          actions={<ParkingButton label={copy.signIn} compact onPress={() => navigation.reset({ index: 0, routes: [{ name: 'Login' }] })} />}
        >
          {copy.guestBody}
        </Notice>
      );
    }
    if (inbox.status === 'loading') return <LoadingState />;
    if (inbox.status === 'error') {
      return (
        <ErrorNotice title={copy.errorTitle} retryLabel={copy.retry} onRetry={reload}>
          {inbox.message}
        </ErrorNotice>
      );
    }
    return (
      <>
        <NeonPanel style={styles.panel}>
          <View style={styles.headingRow}>
            <AppText variant="bodyStrong" accessibilityRole="header">
              {copy.inboxHeading}
            </AppText>
            {inbox.unread > 0 ? (
              <Pressable onPress={() => void markAllRead()} accessibilityRole="button" hitSlop={10} style={styles.link}>
                <AppText variant="bodySmall" color={theme.colors.textAccentSoft}>
                  {copy.markAllRead}
                </AppText>
              </Pressable>
            ) : null}
          </View>
          {inbox.items.length === 0 ? (
            <AppText variant="bodySmall" color={theme.colors.textSecondary}>
              {copy.empty}
            </AppText>
          ) : (
            inbox.items.map((item) => (
              <View key={item.id} style={styles.item} accessible accessibilityLabel={`${item.readAt ? '' : `${copy.unread}. `}${item.title}. ${item.body ?? ''}`}>
                <View style={[styles.dot, item.readAt ? styles.dotRead : null]} />
                <View style={styles.itemText}>
                  <AppText variant="bodyStrong">{item.title}</AppText>
                  {item.body ? (
                    <AppText variant="bodySmall" color={theme.colors.textSecondary}>
                      {item.body}
                    </AppText>
                  ) : null}
                  <AppText variant="caption" color={theme.colors.textSupport}>
                    {timeAgo(item.createdAt)}
                  </AppText>
                </View>
              </View>
            ))
          )}
          {inbox.next ? <ParkingButton label={copy.loadMore} tone="secondary" compact onPress={() => void loadMore()} /> : null}
        </NeonPanel>

        {prefs ? (
          <NeonPanel style={styles.panel}>
            <AppText variant="bodyStrong" accessibilityRole="header">
              {copy.settingsHeading}
            </AppText>
            <AppText variant="bodySmall" color={theme.colors.textSecondary}>
              {copy.settingsHint}
            </AppText>
            {(Object.keys(kindLabels) as NotificationKind[]).map((kind) => (
              <View key={kind} style={styles.prefRow}>
                <AppText variant="bodySmall" style={styles.prefLabel}>
                  {kindLabels[kind]}
                </AppText>
                <ToggleSwitch value={prefs[kind]} onValueChange={(enabled) => void setPref(kind, enabled)} accessibilityLabel={kindLabels[kind]} />
              </View>
            ))}
          </NeonPanel>
        ) : null}
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
