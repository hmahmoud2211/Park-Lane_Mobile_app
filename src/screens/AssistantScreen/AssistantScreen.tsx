import Ionicons from '@expo/vector-icons/Ionicons';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';

import { FadeSwap } from '../../components/assistant/FadeSwap';
import type { IntentMeta } from '../../components/assistant/insights';
import { ModeSwitch, type AssistantMode } from '../../components/assistant/ModeSwitch';
import { ResidentChip, type AssistantHealthState } from '../../components/assistant/ResidentChip';
import { AppText } from '../../components/common/AppText';
import { PageHeader } from '../../components/layout/PageHeader';
import { ScreenWrapper } from '../../components/layout/ScreenWrapper';
import { AppMenu, type AppMenuItem } from '../../components/ui/AppMenu';
import { images } from '../../constants/images';
import { useAppContext } from '../../hooks/useAppContext';
import { useAppTheme } from '../../hooks/useAppTheme';
import { useAssistantChat } from '../../hooks/useAssistantChat';
import type { AssistantResident } from '../../services/assistant/assistant.types';
import { fetchHealth, fetchResidents } from '../../services/assistant/assistantApi';
import type { RootStackScreenProps } from '../../types/navigation.types';
import { assistantCopy as copy } from './AssistantScreen.data';
import { createStyles } from './AssistantScreen.styles';
import { ChatPanel } from './ChatPanel';
import { VoicePanel } from './VoicePanel';

const GUEST_ID = 'guest';
const NEW_CHAT_ID = 'new-chat';
const residentItemId = (id: number) => `resident-${id}`;
/** Slide distance when switching between chat and voice. */
const PANE_SHIFT = 24;

/**
 * The Parklane Assistant: text chat over REST and a realtime voice
 * conversation over WebSocket, both answered from the building's live data
 * (FRONTEND_INTEGRATION.md).
 */
export function AssistantScreen({ navigation, route }: RootStackScreenProps<'Assistant'>) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { residentId, setResidentId } = useAppContext();
  const [mode, setMode] = useState<AssistantMode>(route.params?.mode ?? 'chat');
  const [menuOpen, setMenuOpen] = useState(false);
  const [residents, setResidents] = useState<readonly AssistantResident[]>([]);
  const [health, setHealth] = useState<AssistantHealthState>('checking');
  const chat = useAssistantChat(residentId);
  const resetChat = chat.reset;

  const probeHealth = useCallback((signal?: AbortSignal) => {
    fetchHealth(signal)
      .then((result) => setHealth(result.db?.db_ok ? 'online' : 'degraded'))
      .catch(() => {
        if (!signal?.aborted) {
          setHealth('offline');
        }
      });
  }, []);

  const retryHealth = useCallback(() => {
    setHealth('checking');
    probeHealth();
  }, [probeHealth]);

  useEffect(() => {
    const controller = new AbortController();
    probeHealth(controller.signal);
    fetchResidents(controller.signal)
      .then(setResidents)
      .catch(() => undefined);
    return () => controller.abort();
  }, [probeHealth]);

  // Re-opening the screen from Home's mic button lands in voice mode. Adjusted
  // during render, as React recommends for state that follows a prop.
  const requestedMode = route.params?.mode;
  const [lastRequestedMode, setLastRequestedMode] = useState(requestedMode);
  if (requestedMode !== lastRequestedMode) {
    setLastRequestedMode(requestedMode);
    if (requestedMode) {
      setMode(requestedMode);
    }
  }

  const resident = residents.find((entry) => entry.residentId === residentId);
  const residentName = resident?.name ?? (residentId != null ? `Resident ${residentId}` : null);

  const openRoute = useCallback(
    (target: NonNullable<IntentMeta['route']>) => navigation.navigate(target),
    [navigation],
  );
  const openResidentMenu = useCallback(() => setMenuOpen(true), []);
  const showVoice = useCallback(() => setMode('voice'), []);

  const menuItems = useMemo<readonly AppMenuItem[]>(() => {
    const choose = (id: number | null) => () => {
      setMenuOpen(false);
      setResidentId(id);
    };
    return [
      {
        id: NEW_CHAT_ID,
        label: copy.newConversation,
        icon: 'create-outline',
        onPress: () => {
          setMenuOpen(false);
          resetChat();
          setMode('chat');
        },
      },
      ...residents.map((entry) => ({
        id: residentItemId(entry.residentId),
        label: `${entry.name} · ${entry.unitCode}`,
        icon: 'person-outline' as const,
        onPress: choose(entry.residentId),
      })),
      { id: GUEST_ID, label: copy.guest, icon: 'person-remove-outline', onPress: choose(null) },
    ];
  }, [resetChat, residents, setResidentId]);

  return (
    <ScreenWrapper backgroundSource={images.homeBackground} withScrim={false} backgroundOverlay={0.5}>
      <StatusBar style="light" />

      <View style={styles.page}>
        <View style={styles.header}>
          <PageHeader title={copy.title} onMenuPress={openResidentMenu} />
        </View>

        <View style={styles.toolbar}>
          <ResidentChip
            name={residentName}
            unitCode={resident?.unitCode}
            health={health}
            onPress={openResidentMenu}
          />
          <ModeSwitch mode={mode} onChange={setMode} style={styles.modeSwitch} />
        </View>

        {health === 'offline' ? (
          <FadeSwap swapKey="offline" rise={-8}>
            <View style={styles.banner} accessibilityRole="alert">
              <Ionicons name="cloud-offline-outline" size={16} color={theme.colors.error} />
              <AppText variant="chatMeta" color={theme.colors.emergencyText} style={styles.bannerText}>
                {copy.offline}
              </AppText>
              <Pressable
                onPress={retryHealth}
                accessibilityRole="button"
                style={({ pressed }) => [styles.bannerAction, pressed && styles.pressed]}
              >
                <AppText variant="chatMeta">{copy.retry}</AppText>
              </Pressable>
            </View>
          </FadeSwap>
        ) : null}

        {/* Keyed by mode, so each switch slides the new pane in. Voice
            unmounts when left, which ends its call. */}
        <FadeSwap
          key={mode}
          swapKey={mode}
          rise={0}
          shift={mode === 'voice' ? PANE_SHIFT : -PANE_SHIFT}
          duration={360}
          style={styles.pane}
        >
          {mode === 'chat' ? (
            <ChatPanel
              messages={chat.messages}
              pending={chat.pending}
              residentName={resident?.name ?? null}
              onSend={chat.send}
              onRetry={chat.retry}
              onVoice={showVoice}
              onSignIn={openResidentMenu}
              onOpenRoute={openRoute}
            />
          ) : (
            <VoicePanel residentId={residentId} onSignIn={openResidentMenu} onOpenRoute={openRoute} />
          )}
        </FadeSwap>
      </View>

      <AppMenu
        visible={menuOpen}
        onClose={() => setMenuOpen(false)}
        items={menuItems}
        align="right"
        selectedId={residentId != null ? residentItemId(residentId) : GUEST_ID}
      />
    </ScreenWrapper>
  );
}
