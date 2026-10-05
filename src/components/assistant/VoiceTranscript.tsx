import Ionicons from '@expo/vector-icons/Ionicons';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Platform, ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { useAppTheme } from '../../hooks/useAppTheme';
import type { VoiceQueryResult, VoiceTurn } from '../../hooks/useVoiceSession';
import type { AppTheme } from '../../types/theme.types';
import { AppText } from '../common/AppText';
import { AssistantAvatar } from './AssistantAvatar';
import { InsightBadges } from './InsightBadges';
import type { IntentMeta } from './insights';
import { isRtlText } from './RichText';

export interface VoiceTranscriptProps {
  turns: readonly VoiceTurn[];
  onOpenRoute?: (route: NonNullable<IntentMeta['route']>) => void;
  onSignIn?: () => void;
  style?: StyleProp<ViewStyle>;
}

const NATIVE = Platform.OS !== 'web';

/** The conversation so far, as live captions that follow the latest line. */
export function VoiceTranscript({ turns, onOpenRoute, onSignIn, style }: VoiceTranscriptProps) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const scroll = useRef<ScrollView>(null);

  return (
    <ScrollView
      ref={scroll}
      style={style}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
      onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: true })}
    >
      {turns.map((turn, index) => (
        <TurnRow
          key={turn.id}
          turn={turn}
          latest={index === turns.length - 1}
          onOpenRoute={onOpenRoute}
          onSignIn={onSignIn}
        />
      ))}
    </ScrollView>
  );
}

interface TurnRowProps {
  turn: VoiceTurn;
  latest: boolean;
  onOpenRoute?: VoiceTranscriptProps['onOpenRoute'];
  onSignIn?: () => void;
}

const TurnRow = memo(function TurnRow({ turn, latest, onOpenRoute, onSignIn }: TurnRowProps) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [appear] = useState(() => new Animated.Value(0));

  useEffect(() => {
    const animation = Animated.timing(appear, {
      toValue: 1,
      duration: 340,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: NATIVE,
    });
    animation.start();
    return () => animation.stop();
  }, [appear]);

  const rtl = isRtlText(turn.text);
  const direction = rtl ? styles.rtl : styles.ltr;
  const entry = {
    opacity: appear,
    transform: [{ translateY: appear.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }],
  };

  if (turn.role === 'user') {
    return (
      <Animated.View style={[styles.userRow, entry]}>
        <AppText variant="chatMeta" color={theme.colors.textMuted} style={styles.who}>
          You
        </AppText>
        <AppText
          variant="voiceCaptionMuted"
          color={theme.colors.textSupport}
          style={[styles.userText, direction]}
        >
          {turn.text || '…'}
        </AppText>
      </Animated.View>
    );
  }

  return (
    <Animated.View style={[styles.assistantRow, entry, !latest && styles.past]}>
      <View style={styles.assistantHead}>
        <AssistantAvatar size={14} />
        <AppText variant="chatMeta" color={theme.colors.textSupport} style={styles.assistantName}>
          Parklane Assistant
        </AppText>
        {turn.interrupted ? (
          <AppText variant="chatMeta" color={theme.colors.textMuted}>
            · interrupted
          </AppText>
        ) : null}
      </View>
      <AppText variant="voiceCaption" style={direction}>
        {turn.text}
        {!turn.final && !turn.interrupted ? <AppText variant="voiceCaption" color={theme.colors.accent}> ▍</AppText> : null}
      </AppText>
      {turn.query ? (
        <QueryCard query={turn.query} onOpenRoute={onOpenRoute} onSignIn={onSignIn} />
      ) : null}
    </Animated.View>
  );
});

/** The lookup the assistant made for this reply: where it looked and what it found. */
function QueryCard({
  query,
  onOpenRoute,
  onSignIn,
}: {
  query: VoiceQueryResult;
  onOpenRoute?: VoiceTranscriptProps['onOpenRoute'];
  onSignIn?: () => void;
}) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const resident = query.fn === 'query_resident_services';
  const records = query.recordsFound;

  return (
    <View style={styles.card}>
      <View style={styles.cardHead}>
        <View style={styles.cardIcon}>
          <Ionicons
            name={resident ? 'home-outline' : 'business-outline'}
            size={13}
            color={theme.colors.accent}
          />
        </View>
        <AppText variant="chatMeta" color={theme.colors.textAccentSoft} style={styles.cardTitle}>
          {resident ? 'Your records' : 'Building data'}
        </AppText>
        <AppText variant="chatMeta" color={query.found ? theme.colors.success : theme.colors.textMuted}>
          {query.found ? `${records} ${records === 1 ? 'record' : 'records'}` : 'Nothing found'}
        </AppText>
      </View>
      <InsightBadges summary={query.summary} onOpenRoute={onOpenRoute} onSignIn={onSignIn} style={styles.cardBadges} />
    </View>
  );
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    content: {
      paddingTop: theme.spacing.sm,
      paddingBottom: theme.spacing.md,
    },
    ltr: {
      textAlign: 'left',
      writingDirection: 'ltr',
    },
    rtl: {
      textAlign: 'right',
      writingDirection: 'rtl',
    },
    userRow: {
      marginBottom: theme.spacing.md,
    },
    who: {
      marginBottom: 2,
    },
    userText: {
      opacity: 0.95,
    },
    assistantRow: {
      marginBottom: theme.spacing.lg,
    },
    past: {
      opacity: 0.72,
    },
    assistantHead: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 4,
    },
    assistantName: {
      marginLeft: 6,
      marginRight: 4,
    },
    card: {
      marginTop: 10,
      padding: 10,
      borderRadius: theme.borderRadius.md,
      backgroundColor: theme.colors.bubbleFill,
      borderWidth: StyleSheet.hairlineWidth * 2,
      borderColor: theme.colors.bubbleStroke,
    },
    cardHead: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    cardIcon: {
      width: 22,
      height: 22,
      borderRadius: 11,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.colors.infoFill,
    },
    cardTitle: {
      flex: 1,
      marginLeft: 8,
    },
    cardBadges: {
      marginTop: 8,
    },
  });
}
