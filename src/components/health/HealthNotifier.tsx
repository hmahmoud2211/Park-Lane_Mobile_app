import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useMemo, useRef } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAppTheme } from '../../hooks/useAppTheme';
import { useHealth } from '../../hooks/useHealth';
import { useHealthState } from '../../hooks/useHealthData';
import type { HealthNotice } from '../../services/health/healthStore';
import type { AppTheme } from '../../types/theme.types';
import { AppText } from '../common/AppText';
import { DirectionView } from '../common/DirectionView';
import { FadeIn } from '../common/FadeIn';
import { ParkingButton } from '../parking/ParkingButton';

export interface HealthNotifierProps {
  /** The screen on top, to stay out of the way where it isn't wanted. */
  routeName: string | undefined;
  routeParams: object | undefined;
  onOpen: (notice: HealthNotice) => void;
  /** The backend refused the session: send the resident to sign in again. */
  onSessionEnded: () => void;
}

const copy = {
  en: {
    readyTitle: 'Your document is ready to review',
    readyBody: 'Check what we read before it’s added to your record.',
    failedTitle: 'We couldn’t read a document',
    failedBody: 'See why, then try again or add the details yourself.',
    review: 'Review now',
    view: 'View',
    dismiss: 'Dismiss',
    summaryReadyTitle: 'Your summary is ready',
    summaryReadyBody: 'Play it for your doctor whenever you’re ready.',
    summaryFailedTitle: 'Your summary couldn’t be made',
    summaryFailedBody: 'See what happened and try again.',
    play: 'Play',
  },
  ar: {
    readyTitle: 'مستندك جاهز للمراجعة',
    readyBody: 'راجع ما قرأناه قبل إضافته إلى سجلك.',
    failedTitle: 'تعذّرت قراءة أحد المستندات',
    failedBody: 'اعرف السبب، ثم حاول مرة أخرى أو أضف البيانات بنفسك.',
    review: 'راجع الآن',
    view: 'عرض',
    dismiss: 'إغلاق',
    summaryReadyTitle: 'ملخصك جاهز',
    summaryReadyBody: 'شغّله لطبيبك متى شئت.',
    summaryFailedTitle: 'تعذّر إعداد ملخصك',
    summaryFailedBody: 'اعرف ما حدث وحاول مرة أخرى.',
    play: 'تشغيل',
  },
} as const;

/** Where the resident isn't signed in, so no Health Passport data should exist. */
const SIGNED_OUT = new Set(['FirstScreen', 'Login', 'GuestPass']);

/**
 * Health Passport's in-app notifications, over every screen: a document
 * finished reading (or failed), or a summary the resident asked for is
 * ready (or failed), while they were elsewhere. The app has
 * no push notifications, so this banner is the alert, as the spec allows.
 *
 * It also clears the feature's cache whenever the app returns to sign-in,
 * which is how every "Log out" in the app ends, and routes there when the
 * backend ends the session.
 */
export function HealthNotifier({ routeName, routeParams, onOpen, onSessionEnded }: HealthNotifierProps) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const insets = useSafeAreaInsets();
  const { lang, store, clearSession, sessionEndedAt } = useHealth();
  const { notices } = useHealthState();
  const t = copy[lang];

  const signedOut = routeName !== undefined && SIGNED_OUT.has(routeName);
  useEffect(() => {
    if (signedOut) clearSession();
  }, [signedOut, clearSession]);

  const handledEnd = useRef<number | null>(null);
  useEffect(() => {
    if (sessionEndedAt && handledEnd.current !== sessionEndedAt) {
      handledEnd.current = sessionEndedAt;
      onSessionEnded();
    }
  }, [sessionEndedAt, onSessionEnded]);

  // Nothing about what's already on screen: the document being reviewed, or this profile's summaries.
  const params = routeParams as { docId?: string; profileId?: string } | undefined;
  const onScreen = (n: HealthNotice) =>
    n.kind === 'ready' || n.kind === 'failed'
      ? (routeName === 'HealthReview' || routeName === 'HealthDocument') && params?.docId === n.docId
      : routeName === 'HealthSummary' && params?.profileId === n.profileId;
  const notice = [...notices].reverse().find((n) => !onScreen(n));
  if (!notice || signedOut) return null;

  const isSummary = notice.kind === 'summary_ready' || notice.kind === 'summary_failed';
  const ready = notice.kind === 'ready' || notice.kind === 'summary_ready';
  const title = isSummary ? (ready ? t.summaryReadyTitle : t.summaryFailedTitle) : ready ? t.readyTitle : t.failedTitle;
  const body = isSummary ? (ready ? t.summaryReadyBody : t.summaryFailedBody) : ready ? t.readyBody : t.failedBody;
  const action = isSummary ? (ready ? t.play : t.view) : ready ? t.review : t.view;
  return (
    <View style={[styles.layer, { top: insets.top + 8 }]} pointerEvents="box-none">
      <FadeIn key={notice.id} style={styles.wrap}>
        <DirectionView direction={lang === 'ar' ? 'rtl' : 'ltr'} style={styles.banner}>
          <View style={styles.row} accessibilityRole="alert" accessibilityLiveRegion="polite">
            <Ionicons
              name={ready ? (isSummary ? 'volume-high-outline' : 'document-text-outline') : 'alert-circle-outline'}
              size={22}
              color={ready ? theme.colors.success : theme.colors.warning}
            />
            <View style={styles.text}>
              <AppText variant="bodyStrong">{title}</AppText>
              <AppText variant="label" color={theme.colors.textSecondary}>
                {body}
              </AppText>
            </View>
            <Pressable
              onPress={() => store.dismissNotice(notice.id)}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={t.dismiss}
              style={({ pressed }) => [styles.close, pressed && styles.pressed]}
            >
              <Ionicons name="close" size={20} color={theme.colors.textPrimary} />
            </Pressable>
          </View>
          <ParkingButton
            compact
            tone="primary"
            label={action}
            onPress={() => {
              store.dismissNotice(notice.id);
              onOpen(notice);
            }}
          />
        </DirectionView>
      </FadeIn>
    </View>
  );
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    layer: {
      position: 'absolute',
      left: 0,
      right: 0,
      alignItems: 'center',
      paddingHorizontal: theme.spacing.md,
    },
    wrap: {
      width: '100%',
      maxWidth: theme.layout.phoneMaxWidth,
    },
    banner: {
      gap: 10,
      padding: 12,
      borderRadius: theme.borderRadius.md,
      borderWidth: 1,
      borderColor: theme.colors.infoStroke,
      backgroundColor: theme.colors.cameraFill,
      ...theme.shadows.card,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 10,
    },
    text: {
      flex: 1,
      gap: 2,
    },
    close: {
      width: 32,
      height: 32,
      alignItems: 'center',
      justifyContent: 'center',
    },
    pressed: {
      opacity: 0.6,
    },
  });
}
