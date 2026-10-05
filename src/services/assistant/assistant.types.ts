/**
 * Wire types for the Parklane Assistant backend, as documented in
 * FRONTEND_INTEGRATION.md. Only the `summary` flags and `intent` are stable;
 * every other `summary` field may change, so it stays loosely typed.
 */

export type AssistantIntent =
  | 'building_overview'
  | 'alarms'
  | 'device_status'
  | 'energy'
  | 'resident_profile'
  | 'unit_finance'
  | 'parking'
  | 'visitors'
  | 'maintenance'
  | 'community'
  | 'weather'
  | 'general_knowledge';

/** The structured data behind an answer. Shared by `/chat` and `x.db_query_complete`. */
export interface AnswerSummary {
  intent?: AssistantIntent | string;
  records_found?: number;
  /** Personal question asked without a resident: offer sign-in. */
  resident_required?: boolean;
  /** Readings older than 15 minutes. Also set per entry of `devices`. */
  possibly_offline?: boolean;
  latest_data_timestamp?: string;
  /** False when the nearest period stood in for the one asked about. */
  is_exact?: boolean;
  requested?: string;
  data_period?: string;
  is_future?: boolean;
  as_of?: string;
  error?: string;
  devices?: readonly AnswerDevice[];
  [field: string]: unknown;
}

export interface AnswerDevice {
  device?: string;
  label_ar?: string;
  category?: string;
  possibly_offline?: boolean;
  latest_data_timestamp?: string;
  [field: string]: unknown;
}

export interface ChatRequest {
  message: string;
  resident_id?: number;
  session_id?: string;
  response_mode?: 'summary' | 'raw';
  user_id?: string;
}

export interface ChatResponse {
  ok: boolean;
  session_id: string;
  answer: string;
  summary: AnswerSummary;
  plan: Record<string, unknown>;
  docs_count: number;
  docs_preview: Record<string, unknown>[];
}

export interface AssistantResident {
  residentId: number;
  name: string;
  unitCode: string;
}

export interface AssistantHealth {
  status: string;
  db: { db_ok: boolean; error?: string; [field: string]: unknown };
}

/*
 * Realtime (WebSocket) events. The stream carries the whole OpenAI Realtime
 * event set; only the ones the client acts on are modelled.
 */

export type QueryFunction = 'query_building_systems' | 'query_resident_services';

export type RealtimeServerEvent =
  | { type: 'session.created' }
  | { type: 'session.updated' }
  | { type: 'input_audio_buffer.speech_started'; item_id?: string }
  | { type: 'input_audio_buffer.speech_stopped'; item_id?: string }
  | { type: 'x.barge_in' }
  | { type: 'conversation.item.input_audio_transcription.delta'; item_id: string; delta: string }
  | { type: 'conversation.item.input_audio_transcription.completed'; item_id: string; transcript: string }
  | { type: 'conversation.item.input_audio_transcription.failed'; item_id: string }
  | { type: 'response.created' }
  | { type: 'response.output_audio.delta'; item_id: string; response_id: string; delta: string }
  | { type: 'response.output_audio.done'; item_id: string; response_id: string }
  | { type: 'response.output_audio_transcript.delta'; item_id: string; response_id: string; delta: string }
  | { type: 'response.output_audio_transcript.done'; item_id: string; response_id: string; transcript: string }
  | {
      type: 'response.done';
      response?: { status?: string; output?: readonly { type?: string }[] };
    }
  | { type: 'x.db_query_started'; call_id: string; function: QueryFunction | string }
  | {
      type: 'x.db_query_complete';
      call_id: string;
      function: QueryFunction | string;
      found: boolean;
      records_found: number;
      result_summary: AnswerSummary;
    }
  | { type: 'x.capture_camera_frame'; call_id: string }
  | { type: 'x.vision_analysis_started'; call_id: string }
  | { type: 'x.vision_analysis_complete'; call_id: string; description?: string }
  | { type: 'x.vision_error'; call_id: string; error?: string }
  | { type: 'error'; error?: { message?: string; code?: string } };

export type RealtimeEventType = RealtimeServerEvent['type'];
