import { useMemo, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';

import { AssistantOrb } from '../../components/assistant/AssistantOrb';
import { ChatBubble } from '../../components/assistant/ChatBubble';
import { ChatComposer } from '../../components/assistant/ChatComposer';
import { FadeSwap } from '../../components/assistant/FadeSwap';
import type { IntentMeta } from '../../components/assistant/insights';
import { SuggestionChips } from '../../components/assistant/SuggestionChips';
import { TypingIndicator } from '../../components/assistant/TypingIndicator';
import { AppText } from '../../components/common/AppText';
import { useAppTheme } from '../../hooks/useAppTheme';
import type { ChatMessage } from '../../hooks/useAssistantChat';
import { useReduceMotion } from '../../hooks/useReduceMotion';
import { assistantCopy as copy, chatSuggestions } from './AssistantScreen.data';
import { EMPTY_ORB_SIZE, createStyles } from './AssistantScreen.styles';

export interface ChatPanelProps {
  messages: readonly ChatMessage[];
  pending: boolean;
  residentName: string | null;
  onSend: (text: string) => boolean;
  onRetry: (messageId: string) => void;
  onVoice: () => void;
  onSignIn: () => void;
  onOpenRoute: (route: NonNullable<IntentMeta['route']>) => void;
}

/** The text conversation: a greeting with suggestions, then the thread and composer. */
export function ChatPanel({
  messages,
  pending,
  residentName,
  onSend,
  onRetry,
  onVoice,
  onSignIn,
  onOpenRoute,
}: ChatPanelProps) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const reduceMotion = useReduceMotion();
  const scroll = useRef<ScrollView>(null);
  // Messages already present when the panel opens are history: no entrance.
  const [history] = useState(() => new Set(messages.map((message) => message.id)));
  const empty = messages.length === 0 && !pending;

  return (
    // As on Login: iOS pads for the keyboard, Android resizes the window itself.
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        ref={scroll}
        style={styles.flex}
        contentContainerStyle={[styles.thread, empty && styles.threadEmpty]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        showsVerticalScrollIndicator={false}
        onContentSizeChange={() => {
          if (!empty) {
            scroll.current?.scrollToEnd({ animated: true });
          }
        }}
      >
        {empty ? (
          <View style={styles.welcome}>
            <FadeSwap swapKey="welcome" rise={16} duration={520}>
              <Pressable
                onPress={onVoice}
                accessibilityRole="button"
                accessibilityLabel="Talk to the assistant"
                style={styles.welcomeOrb}
              >
                <AssistantOrb size={EMPTY_ORB_SIZE} mood="idle" />
              </Pressable>
              <AppText variant="statLabel" color={theme.colors.textSupport} align="center">
                {copy.greeting(residentName)}
              </AppText>
              <AppText variant="assistantTitle" align="center" style={styles.welcomeTitle}>
                {copy.headline}
              </AppText>
              <AppText variant="chatBody" color={theme.colors.textSecondary} align="center" style={styles.welcomeBody}>
                {copy.intro}
              </AppText>
            </FadeSwap>
            <SuggestionChips suggestions={chatSuggestions} onPick={onSend} disabled={pending} />
          </View>
        ) : (
          messages.map((message) => (
            <ChatBubble
              key={message.id}
              message={message}
              animateIn={!history.has(message.id)}
              reduceMotion={reduceMotion}
              onRetry={onRetry}
              onSignIn={onSignIn}
              onOpenRoute={onOpenRoute}
            />
          ))
        )}
        {pending ? <TypingIndicator /> : null}
      </ScrollView>

      <ChatComposer onSend={onSend} onVoice={onVoice} busy={pending} style={styles.composer} />
    </KeyboardAvoidingView>
  );
}
