import { ApiError } from '../errors.ts';

/** What every AI provider takes and gives back (see model.ts). */

export interface Media {
  mimeType: string;
  data: Buffer;
}

export interface ModelRequest {
  /** What the call is for, for the logs: e.g. 'document_reading'. */
  purpose: string;
  system: string;
  prompt: string;
  /** Pages of a document, placed before the prompt. */
  media?: Media[];
  /** The answer must be JSON matching this schema; without it, plain text. */
  schema?: Record<string, unknown>;
  /** Documents can use their own model (GEMINI_DOCUMENT_MODEL). */
  task?: 'general' | 'documents';
  maxTokens?: number;
}

export interface ModelAnswer {
  text: string;
  model: string;
}

/** Raised by a provider for a failure worth one more try (rate limits, overload, timeouts). */
export class RetryableAiError extends ApiError {
  constructor(message: string) {
    super('ai_failed', message);
  }
}
