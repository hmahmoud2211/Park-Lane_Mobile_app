import { config } from '../../config.ts';
import { ApiError } from '../../errors.ts';
import { log } from '../../log.ts';

/**
 * Claude, over the Messages API. The backend stays dependency-free, as the
 * CUBE and Amazon clients do, so this is plain fetch against the documented
 * HTTP shape:
 *
 *   - structured outputs (`output_config.format` with a JSON schema), so a
 *     reply is always the shape the clinic expects;
 *   - adaptive thinking (the model's default) at CLINIC_AI_EFFORT;
 *   - server-side fallbacks (`fallbacks: "default"`), so a safety decline is
 *     retried on Anthropic's recommended model, and a `refusal` that still
 *     comes back is reported, never parsed.
 *
 * Prompts and replies hold clinical data, so neither is ever logged; only
 * the purpose, status and token counts are.
 */

const API_VERSION = '2026-10-21';
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

export const aiConfigured = () => Boolean(config.ai.apiKey);

export interface StructuredRequest {
  /** What the call is for, for the logs: e.g. 'history_summary'. */
  purpose: string;
  system: string;
  prompt: string;
  schema: Record<string, unknown>;
  maxTokens?: number;
}

interface MessagesResponse {
  model?: string;
  stop_reason?: string;
  content?: { type: string; text?: string }[];
  usage?: { input_tokens?: number; output_tokens?: number };
  error?: { type?: string };
}

const RETRYABLE = new Set([408, 409, 429, 500, 502, 503, 504, 529]);

async function post(body: unknown): Promise<Response> {
  return fetch(`${config.ai.baseUrl}/v1/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.ai.apiKey,
      'anthropic-version': API_VERSION,
      'anthropic-beta': FALLBACK_BETA,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(config.ai.timeoutMs),
  });
}

/** One structured answer, parsed. Throws `not_configured` without a key and `ai_failed` on any failure. */
export async function structured<T>(request: StructuredRequest): Promise<{ value: T; model: string }> {
  if (!aiConfigured()) {
    throw new ApiError('not_configured', 'AI assistance is not set up on this server (ANTHROPIC_API_KEY).');
  }
  const body = {
    model: config.ai.model,
    max_tokens: request.maxTokens ?? 16_000,
    system: request.system,
    messages: [{ role: 'user', content: request.prompt }],
    output_config: { effort: config.ai.effort, format: { type: 'json_schema', schema: request.schema } },
    fallbacks: 'default',
  };

  let response: Response | null = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      response = await post(body);
    } catch (error) {
      const timedOut = (error as Error).name === 'TimeoutError';
      log.warn('AI request failed to complete', { purpose: request.purpose, timedOut, attempt });
      if (timedOut || attempt === 1) {
        throw new ApiError('ai_failed', timedOut ? 'The AI service took too long. Try again.' : 'Could not reach the AI service.');
      }
      continue;
    }
    if (response.ok || !RETRYABLE.has(response.status) || attempt === 1) break;
    log.warn('AI request will be retried', { purpose: request.purpose, status: response.status });
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  if (!response) throw new ApiError('ai_failed', 'Could not reach the AI service.');

  const reply = (await response.json().catch(() => ({}))) as MessagesResponse;
  if (!response.ok) {
    log.warn('AI request refused', { purpose: request.purpose, status: response.status, type: reply.error?.type ?? null });
    throw new ApiError(
      'ai_failed',
      RETRYABLE.has(response.status) ? 'The AI service is busy. Try again in a minute.' : 'The AI service could not process this request.',
    );
  }
  log.info('AI request done', {
    purpose: request.purpose,
    model: reply.model ?? null,
    stop: reply.stop_reason ?? null,
    inputTokens: reply.usage?.input_tokens ?? null,
    outputTokens: reply.usage?.output_tokens ?? null,
  });
  if (reply.stop_reason === 'refusal') {
    throw new ApiError('ai_failed', 'The AI service declined to process this record. Continue without it.');
  }
  if (reply.stop_reason === 'max_tokens') {
    throw new ApiError('ai_failed', 'The AI answer was cut short. Try again.');
  }
  const text = (reply.content ?? [])
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('');
  try {
    return { value: JSON.parse(text) as T, model: reply.model ?? config.ai.model };
  } catch {
    throw new ApiError('ai_failed', 'The AI answer could not be read. Try again.');
  }
}
