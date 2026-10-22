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
import { NeonPanel } from '../../components/ui/NeonPanel';
import { useAppTheme } from '../../hooks/useAppTheme';
import type { ChatMessage } from '../../hooks/useAssistantChat';
import { useReduceMotion } from '../../hooks/useReduceMotion';
import { useScreenLayout } from '../../hooks/useScreenLayout';
import { assistantCopy as copy, chatSuggestions } from './AssistantScreen.data';
import { createStyles, emptyOrbSizeFor } from './AssistantScreen.styles';

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

/** The text conversation: a welcome card and suggestions, then the thread and composer. */
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
  // The frame, not the window: beside the side rail the two differ.
  const { frameWidth } = useScreenLayout();
  const orbSize = emptyOrbSizeFor(frameWidth);
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
              <NeonPanel style={styles.hero}>
                <Pressable
                  onPress={onVoice}
                  accessibilityRole="button"
                  accessibilityLabel="Talk to the assistant"
                >
                  <AssistantOrb size={orbSize} mood="idle" />
                </Pressable>
                <View style={styles.heroText}>
                  <AppText variant="bodySmall">{copy.greeting(residentName)}</AppText>
                  <AppText variant="subheading" accessibilityRole="header" style={styles.heroTitle}>
                    {copy.headline}
                  </AppText>
                  <AppText variant="statLabel" style={styles.heroBody}>
                    {copy.intro}
                  </AppText>
                </View>
              </NeonPanel>
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
