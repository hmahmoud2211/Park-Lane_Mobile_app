import type { AnswerSummary } from './services/assistant.types';

/** The assistant's chat and voice state, as the hooks hold it and the components draw it. */

/**
 * `answered` and `declined` are both replies from the assistant (`ok` true
 * or false); `failed` means it could not be reached, and offers a retry.
 */
export type ChatMessageStatus = 'sent' | 'answered' | 'declined' | 'failed';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  status: ChatMessageStatus;
  createdAt: number;
  summary?: AnswerSummary;
  /** On a failed reply: the question to send again. */
  retryText?: string;
}

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
  /** `query_building_systems`, `query_resident_services`, or one of HOME_FUNCTIONS. */
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
