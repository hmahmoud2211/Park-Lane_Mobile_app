import { useCameraPermissions } from 'expo-camera';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Pressable, View, useWindowDimensions } from 'react-native';

import { AssistantOrb, moodForPhase } from '../../components/assistant/AssistantOrb';
import { CameraPeek, type CameraPeekHandle } from '../../components/assistant/CameraPeek';
import { FadeSwap } from '../../components/assistant/FadeSwap';
import type { IntentMeta } from '../../components/assistant/insights';
import { VoiceControls } from '../../components/assistant/VoiceControls';
import { VoiceStatusPill } from '../../components/assistant/VoiceStatusPill';
import { VoiceTranscript } from '../../components/assistant/VoiceTranscript';
import { AppText } from '../../components/common/AppText';
import { useAppTheme } from '../../hooks/useAppTheme';
import { useVoiceSession, type VoicePhase } from '../../hooks/useVoiceSession';
import { assistantCopy as copy, voiceExamples } from './AssistantScreen.data';
import { VOICE_ORB_SIZE, VOICE_ORB_SIZE_COMPACT, createStyles } from './AssistantScreen.styles';

export interface VoicePanelProps {
  residentId: number | null;
  onSignIn: () => void;
  onOpenRoute: (route: NonNullable<IntentMeta['route']>) => void;
}

/** Below this height the orb shrinks so the captions keep their room. */
const COMPACT_HEIGHT = 760;

/** Phases where a tap on the orb cuts the assistant off. */
const INTERRUPTIBLE: readonly VoicePhase[] = ['speaking', 'thinking', 'searching', 'looking'];

/**
 * The realtime conversation: the orb, live captions, and call controls, with
 * an optional camera the assistant can look through. Leaving voice mode
 * unmounts this panel, which hangs up.
 */
export function VoicePanel({ residentId, onSignIn, onOpenRoute }: VoicePanelProps) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { height } = useWindowDimensions();
  const orbSize = height < COMPACT_HEIGHT ? VOICE_ORB_SIZE_COMPACT : VOICE_ORB_SIZE;

  const [cameraOn, setCameraOn] = useState(false);
  const [cameraNotice, setCameraNotice] = useState<string | null>(null);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const camera = useRef<CameraPeekHandle>(null);
  const captureFrame = useCallback(() => camera.current?.capture() ?? Promise.resolve(''), []);

  const session = useVoiceSession({ residentId, cameraEnabled: cameraOn, captureFrame });
  const { phase } = session;
  const inCall = phase !== 'idle' && phase !== 'error';

  const toggleCamera = useCallback(async () => {
    setCameraNotice(null);
    if (cameraOn) {
      setCameraOn(false);
      return;
    }
    const granted = cameraPermission?.granted || (await requestCameraPermission()).granted;
    if (!granted) {
      setCameraNotice(copy.cameraDenied);
      return;
    }
    setCameraOn(true);
  }, [cameraOn, cameraPermission?.granted, requestCameraPermission]);

  const onOrbPress = useCallback(() => {
    if (phase === 'idle' || phase === 'error') {
      session.start();
    } else if (INTERRUPTIBLE.includes(phase)) {
      session.interrupt();
    }
  }, [phase, session]);

  const hint = hintFor(phase, session.duplex, session.error);

  return (
    <View style={styles.voice}>
      <VoiceStatusPill phase={phase} queryFn={session.queryFn} muted={session.muted} />

      <Pressable
        onPress={onOrbPress}
        accessibilityRole="button"
        accessibilityLabel={
          inCall ? (INTERRUPTIBLE.includes(phase) ? 'Interrupt the assistant' : 'Assistant') : 'Start voice chat'
        }
        style={styles.voiceOrb}
      >
        <AssistantOrb size={orbSize} mood={moodForPhase(phase)} level={session.level} />
      </Pressable>

      <FadeSwap swapKey={hint.text} style={styles.voiceHint}>
        <AppText
          variant="chatBody"
          align="center"
          color={hint.error ? theme.colors.error : theme.colors.textSecondary}
        >
          {hint.text}
        </AppText>
      </FadeSwap>

      {cameraNotice ? (
        <AppText variant="chatMeta" align="center" color={theme.colors.warning} style={styles.voiceNotice}>
          {cameraNotice}
        </AppText>
      ) : null}

      {session.turns.length > 0 ? (
        <VoiceTranscript
          turns={session.turns}
          onOpenRoute={onOpenRoute}
          onSignIn={onSignIn}
          style={styles.voiceTranscript}
        />
      ) : (
        <FadeSwap swapKey={inCall ? 'live' : 'idle'} style={styles.voiceIntro}>
          {inCall ? null : (
            <>
              <AppText variant="sectionTitle" align="center">
                {copy.voiceIdleTitle}
              </AppText>
              <AppText
                variant="chatBody"
                align="center"
                color={theme.colors.textSecondary}
                style={styles.voiceIntroBody}
              >
                {copy.voiceIdleBody}
              </AppText>
            </>
          )}
          <AppText variant="chatMeta" align="center" color={theme.colors.textMuted} style={styles.voiceTry}>
            {copy.voiceTryLabel}
          </AppText>
          <View style={styles.voiceExamples}>
            {voiceExamples.map((example) => (
              <View key={example} style={styles.voiceExample}>
                <AppText variant="chipLabel" color={theme.colors.textAccentSoft}>
                  {`“${example}”`}
                </AppText>
              </View>
            ))}
          </View>
          <AppText variant="chatMeta" align="center" color={theme.colors.textMuted} style={styles.voiceNote}>
            {copy.voiceLanguageNote}
          </AppText>
        </FadeSwap>
      )}

      <VoiceControls
        inCall={inCall}
        muted={session.muted}
        cameraOn={cameraOn}
        onStart={session.start}
        onEnd={session.stop}
        onToggleMute={session.toggleMute}
        onToggleCamera={toggleCamera}
        style={styles.voiceControls}
      />

      {cameraOn ? <CameraPeek ref={camera} scanning={phase === 'looking'} style={styles.camera} /> : null}
    </View>
  );
}

function hintFor(
  phase: VoicePhase,
  duplex: 'duplex' | 'half-duplex',
  error: string | null,
): { text: string; error?: boolean } {
  switch (phase) {
    case 'error':
      return { text: error ?? 'Something went wrong. Tap start to try again.', error: true };
    case 'idle':
      return { text: 'Tap the orb or Start to begin' };
    case 'connecting':
      return { text: 'Setting up a secure line…' };
    case 'listening':
    case 'hearing':
      return { text: copy.listeningHint };
    case 'speaking':
    case 'thinking':
    case 'searching':
    case 'looking':
      return { text: duplex === 'duplex' ? copy.interruptDuplex : copy.interruptHalfDuplex };
  }
}
