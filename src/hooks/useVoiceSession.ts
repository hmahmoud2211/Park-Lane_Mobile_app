import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Animated, AppState, Platform } from 'react-native';

import { assistantConfig } from '../constants/assistantConfig';
import type { AnswerSummary, RealtimeServerEvent } from '../services/assistant/assistant.types';
import { useVoiceAudio } from '../services/assistant/audio/useVoiceAudio';
import type { DuplexMode } from '../services/assistant/audio/voiceAudio.types';
import { RealtimeVoiceClient, type RealtimeCloseInfo } from '../services/assistant/realtimeClient';

/**
 * What the voice session is doing, in the order the UI cares about:
 * `hearing` is the resident talking, `searching` a database lookup and
 * `looking` a camera frame being analysed.
 */
export type VoicePhase =
  | 'idle'
  | 'connecting'
  | 'listening'
  | 'hearing'
  | 'thinking'
  | 'searching'
  | 'looking'
  | 'speaking'
  | 'error';

export interface VoiceQueryResult {
  /** `query_building_systems` or `query_resident_services`. */
  fn: string;
  found: boolean;
  recordsFound: number;
  summary: AnswerSummary;
}

export interface VoiceTurn {
  /** The Realtime item id, so late transcripts land on the right turn. */
  id: string;
  role: 'user' | 'assistant';
  text: string;
  final: boolean;
  /** Cut off by the resident talking over it or tapping to stop. */
  interrupted?: boolean;
  /** The lookup behind an assistant reply. */
  query?: VoiceQueryResult;
}

export interface VoiceSessionOptions {
  residentId: number | null;
  cameraEnabled: boolean;
  /** Base64 JPEG of the current camera frame, or '' when there is none. */
  captureFrame: () => Promise<string>;
}

type Status = 'idle' | 'connecting' | 'live' | 'error';

interface Flags {
  status: Status;
  userSpeaking: boolean;
  /** Between the resident going quiet and the reply starting. */
  awaitingReply: boolean;
  responseActive: boolean;
  /** The last response was a function call; the spoken one follows. */
  followUpExpected: boolean;
  queries: Set<string>;
  /** The function of the latest lookup, for the status label. */
  lastQueryFn: string | null;
  looking: boolean;
  playing: boolean;
}

const freshFlags = (status: Status): Flags => ({
  status,
  userSpeaking: false,
  awaitingReply: false,
  responseActive: false,
  followUpExpected: false,
  queries: new Set(),
  lastQueryFn: null,
  looking: false,
  playing: false,
});

function phaseOf(flags: Flags): VoicePhase {
  switch (flags.status) {
    case 'idle':
    case 'connecting':
    case 'error':
      return flags.status;
  }
  if (flags.looking) return 'looking';
  if (flags.queries.size > 0) return 'searching';
  if (flags.playing) return 'speaking';
  if (flags.userSpeaking) return 'hearing';
  if (flags.responseActive || flags.followUpExpected || flags.awaitingReply) return 'thinking';
  return 'listening';
}

const MAX_TURNS = 40;
/** If no reply has started this long after the resident stops, stop waiting for one. */
const REPLY_WAIT_MS = 10_000;
/** The level meter's attack and release, per frame. */
const LEVEL_RISE = 0.55;
const LEVEL_FALL = 0.16;

/**
 * Drives one realtime voice conversation (FRONTEND_INTEGRATION.md §5): opens
 * the socket, streams the mic once the session is ready, plays the replies,
 * answers camera requests and keeps a running transcript.
 *
 * `level` is an Animated value (0..1) of whoever is talking, updated every
 * frame without re-rendering, for the orb to breathe with.
 */
export function useVoiceSession({ residentId, cameraEnabled, captureFrame }: VoiceSessionOptions) {
  const engine = useVoiceAudio();
  const [phase, setPhase] = useState<VoicePhase>('idle');
  const [turns, setTurns] = useState<readonly VoiceTurn[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [queryFn, setQueryFn] = useState<string | null>(null);
  const [level] = useState(() => new Animated.Value(0));

  const flags = useRef<Flags>(freshFlags('idle'));
  const turnsRef = useRef<VoiceTurn[]>([]);
  const turnsFrame = useRef<number | null>(null);
  const mutedRef = useRef(false);
  const cameraRef = useRef(cameraEnabled);
  const captureRef = useRef(captureFrame);
  const pendingQuery = useRef<VoiceQueryResult | null>(null);
  const replyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ready = useRef(false);
  const handlers = useRef<{
    handleEvent: (event: RealtimeServerEvent) => void;
    handleClose: (info: RealtimeCloseInfo) => void;
  } | null>(null);
  // One client per hook; its callbacks reach the latest handlers through a ref.
  const [client] = useState(
    () =>
      new RealtimeVoiceClient({
        onEvent: (event) => handlers.current?.handleEvent(event),
        onClose: (info) => handlers.current?.handleClose(info),
      }),
  );

  const refresh = useCallback(() => {
    const f = flags.current;
    setPhase(phaseOf(f));
    setQueryFn(f.queries.size > 0 ? f.lastQueryFn : null);
  }, []);

  // Transcript deltas arrive dozens of times a second; publish once a frame.
  const publishTurns = useCallback(() => {
    if (turnsFrame.current !== null) {
      return;
    }
    turnsFrame.current = requestAnimationFrame(() => {
      turnsFrame.current = null;
      setTurns([...turnsRef.current]);
    });
  }, []);

  const updateTurn = useCallback(
    (id: string, role: VoiceTurn['role'], change: (turn: VoiceTurn) => VoiceTurn | null) => {
      const list = turnsRef.current;
      const index = list.findIndex((turn) => turn.id === id);
      const existing = index >= 0 ? list[index] : { id, role, text: '', final: false };
      const updated = change(existing);
      if (index >= 0) {
        if (updated) {
          list[index] = updated;
        } else {
          list.splice(index, 1);
        }
      } else if (updated) {
        list.push(updated);
        if (list.length > MAX_TURNS) {
          list.splice(0, list.length - MAX_TURNS);
        }
      }
      publishTurns();
    },
    [publishTurns],
  );

  /** Marks the reply in progress as cut short. */
  const interruptOpenReply = useCallback(() => {
    const open = [...turnsRef.current].reverse().find((turn) => turn.role === 'assistant' && !turn.final);
    if (open) {
      updateTurn(open.id, 'assistant', (turn) => ({ ...turn, final: true, interrupted: true }));
    }
  }, [updateTurn]);

  const clearReplyTimer = () => {
    if (replyTimer.current) {
      clearTimeout(replyTimer.current);
      replyTimer.current = null;
    }
  };

  const sendChunk = useCallback((pcm: ArrayBuffer) => {
    if (!mutedRef.current) {
      client.sendAudio(pcm);
    }
  }, [client]);

  const fail = useCallback(
    (message: string) => {
      clearReplyTimer();
      client.close();
      engine.stopCapture();
      engine.flushPlayback();
      ready.current = false;
      flags.current = freshFlags('error');
      setError(message);
      refresh();
    },
    [client, engine, refresh],
  );

  const startMic = useCallback(async () => {
    try {
      await engine.startCapture(sendChunk);
    } catch {
      fail('The microphone could not be started. Close other apps using it and try again.');
    }
  }, [engine, fail, sendChunk]);

  /**
   * Half-duplex engines pause the mic while the assistant speaks; this
   * reopens it once nothing more is coming.
   */
  const resumeMicIfDue = useCallback(() => {
    const f = flags.current;
    if (
      engine.duplex === 'half-duplex' &&
      f.status === 'live' &&
      !f.playing &&
      !f.responseActive &&
      !f.followUpExpected &&
      !engine.isCapturing
    ) {
      void startMic();
    }
  }, [engine, startMic]);

  const handleEvent = useCallback(
    (event: RealtimeServerEvent) => {
      const f = flags.current;
      switch (event.type) {
        case 'session.updated':
          if (!ready.current) {
            ready.current = true;
            f.status = 'live';
            // Re-sent on every connection, as the server forgets it.
            if (cameraRef.current) {
              client.sendCameraStatus(true);
            }
            void startMic();
          }
          break;

        case 'input_audio_buffer.speech_started':
          f.userSpeaking = true;
          if (event.item_id) {
            updateTurn(event.item_id, 'user', (turn) => turn);
          }
          break;

        case 'x.barge_in':
          // Sent on every speech start; only matters while a reply is playing.
          if (engine.isPlaying) {
            engine.flushPlayback();
            interruptOpenReply();
          }
          f.playing = false;
          break;

        case 'input_audio_buffer.speech_stopped':
          f.userSpeaking = false;
          f.awaitingReply = true;
          clearReplyTimer();
          replyTimer.current = setTimeout(() => {
            flags.current.awaitingReply = false;
            refresh();
          }, REPLY_WAIT_MS);
          break;

        case 'conversation.item.input_audio_transcription.delta':
          updateTurn(event.item_id, 'user', (turn) => ({ ...turn, text: turn.text + event.delta }));
          break;

        case 'conversation.item.input_audio_transcription.completed': {
          const text = event.transcript.trim();
          updateTurn(event.item_id, 'user', (turn) => (text ? { ...turn, text, final: true } : null));
          break;
        }

        case 'conversation.item.input_audio_transcription.failed':
          updateTurn(event.item_id, 'user', () => null);
          break;

        case 'response.created':
          f.responseActive = true;
          f.followUpExpected = false;
          f.awaitingReply = false;
          clearReplyTimer();
          break;

        case 'response.output_audio.delta':
          if (!f.playing && engine.duplex === 'half-duplex' && engine.isCapturing) {
            engine.stopCapture();
          }
          f.playing = true;
          engine.enqueuePlayback(event.delta);
          break;

        case 'response.output_audio.done':
          engine.finishPlayback();
          break;

        case 'response.output_audio_transcript.delta':
          updateTurn(event.item_id, 'assistant', (turn) => {
            const query = turn.query ?? pendingQuery.current ?? undefined;
            pendingQuery.current = null;
            return { ...turn, text: turn.text + event.delta, query };
          });
          break;

        case 'response.output_audio_transcript.done':
          updateTurn(event.item_id, 'assistant', (turn) =>
            turn.interrupted ? turn : { ...turn, text: event.transcript || turn.text, final: true },
          );
          break;

        case 'response.done': {
          f.responseActive = false;
          const outputs = event.response?.output ?? [];
          f.followUpExpected =
            event.response?.status === 'completed' && outputs.some((item) => item.type === 'function_call');
          resumeMicIfDue();
          break;
        }

        case 'x.db_query_started':
          f.queries.add(event.call_id);
          f.lastQueryFn = event.function;
          break;

        case 'x.db_query_complete':
          f.queries.delete(event.call_id);
          pendingQuery.current = {
            fn: event.function,
            found: event.found,
            recordsFound: event.records_found,
            summary: event.result_summary ?? {},
          };
          break;

        case 'x.capture_camera_frame': {
          f.looking = true;
          const callId = event.call_id;
          const budget = new Promise<string>((resolve) =>
            setTimeout(() => resolve(''), assistantConfig.cameraReplyBudgetMs),
          );
          Promise.race([captureRef.current().catch(() => ''), budget]).then((image) => {
            client.sendCameraFrame(callId, image);
          });
          break;
        }

        case 'x.vision_analysis_started':
          f.looking = true;
          break;

        case 'x.vision_analysis_complete':
        case 'x.vision_error':
          f.looking = false;
          break;

        case 'error':
          // Usually recoverable (e.g. cancelling a reply that already ended).
          // A fatal one is followed by the socket closing, handled in onClose.
          if (__DEV__) {
            console.warn('[assistant] realtime error:', event.error?.message);
          }
          break;
      }
      refresh();
    },
    [client, engine, interruptOpenReply, refresh, resumeMicIfDue, startMic, updateTurn],
  );

  const handleClose = useCallback(
    (info: RealtimeCloseInfo) => {
      if (info.intentional) {
        return;
      }
      fail(info.message);
    },
    [fail],
  );

  useLayoutEffect(() => {
    handlers.current = { handleEvent, handleClose };
    captureRef.current = captureFrame;
  });

  // Playback running dry may be the moment to reopen the mic.
  useEffect(
    () =>
      engine.onPlaybackIdle(() => {
        flags.current.playing = false;
        resumeMicIfDue();
        refresh();
      }),
    [engine, refresh, resumeMicIfDue],
  );

  const stop = useCallback(() => {
    clearReplyTimer();
    client.close();
    engine.stopCapture();
    engine.flushPlayback();
    ready.current = false;
    pendingQuery.current = null;
    interruptOpenReply();
    flags.current = freshFlags('idle');
    refresh();
  }, [client, engine, interruptOpenReply, refresh]);

  const start = useCallback(() => {
    const { status } = flags.current;
    if (status === 'connecting' || status === 'live') {
      return;
    }
    // Inside the tap: browsers only allow audio to start from a gesture.
    engine.prepare();
    ready.current = false;
    pendingQuery.current = null;
    turnsRef.current = [];
    setTurns([]);
    setError(null);
    flags.current = freshFlags('connecting');
    refresh();

    void (async () => {
      const granted = await engine.requestPermission().catch(() => false);
      if (flags.current.status !== 'connecting') {
        return; // hung up while the permission prompt was open
      }
      if (!granted) {
        fail('Allow microphone access to talk to the assistant.');
        return;
      }
      client.connect({
        residentId,
        sessionId: `parklane-${Date.now().toString(36)}`,
      });
    })();
  }, [client, engine, fail, refresh, residentId]);

  /** "Stop talking": cuts the reply short and hands the floor back. */
  const interrupt = useCallback(() => {
    const f = flags.current;
    if (f.status !== 'live' || (!f.playing && !f.responseActive)) {
      return;
    }
    client.cancelResponse();
    engine.flushPlayback();
    interruptOpenReply();
    f.playing = false;
    f.responseActive = false;
    f.followUpExpected = false;
    resumeMicIfDue();
    refresh();
  }, [client, engine, interruptOpenReply, refresh, resumeMicIfDue]);

  const toggleMute = useCallback(() => {
    mutedRef.current = !mutedRef.current;
    setMuted(mutedRef.current);
  }, []);

  // Tell the server whenever the camera is switched on or off.
  useEffect(() => {
    cameraRef.current = cameraEnabled;
    if (flags.current.status === 'live') {
      client.sendCameraStatus(cameraEnabled);
    }
  }, [cameraEnabled, client]);

  // The connection is bound to one resident; switching ends it.
  const residentRef = useRef(residentId);
  useEffect(() => {
    if (residentRef.current !== residentId) {
      residentRef.current = residentId;
      if (flags.current.status !== 'idle') {
        stop();
      }
    }
  }, [residentId, stop]);

  // On a phone, leaving the app ends the call rather than holding the mic.
  useEffect(() => {
    if (Platform.OS === 'web') {
      return undefined;
    }
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active' && flags.current.status !== 'idle') {
        stop();
      }
    });
    return () => subscription.remove();
  }, [stop]);

  // Feeds the orb: the assistant's voice while it speaks, the mic otherwise.
  const live = phase !== 'idle' && phase !== 'error';
  useEffect(() => {
    if (!live) {
      level.setValue(0);
      return undefined;
    }
    let frame = 0;
    let current = 0;
    let handle = requestAnimationFrame(function tick() {
      frame++;
      // Every other frame is plenty for a glow, and halves the bridge traffic.
      if (frame % 2 === 0) {
        const target = flags.current.playing
          ? engine.outputLevel()
          : mutedRef.current
            ? 0
            : engine.inputLevel();
        current += (target - current) * (target > current ? LEVEL_RISE : LEVEL_FALL);
        level.setValue(current);
      }
      handle = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(handle);
  }, [engine, level, live]);

  // Hang up on unmount.
  useEffect(
    () => () => {
      clearReplyTimer();
      client.close();
      if (turnsFrame.current !== null) {
        cancelAnimationFrame(turnsFrame.current);
      }
    },
    [client],
  );

  return {
    phase,
    /** While `phase` is `searching`: which lookup is running. */
    queryFn,
    turns,
    error,
    muted,
    level,
    duplex: engine.duplex as DuplexMode,
    isActive: live && phase !== 'connecting',
    start,
    stop,
    interrupt,
    toggleMute,
  };
}
