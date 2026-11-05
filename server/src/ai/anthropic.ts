import { config } from '../config.ts';
import { ApiError } from '../errors.ts';
import { log } from '../log.ts';
import { RetryableAiError, type ModelAnswer, type ModelRequest } from './types.ts';

/**
 * Claude, over the Messages API (AI_PROVIDER=anthropic):
 *   - pages as image or PDF document blocks before the prompt;
 *   - JSON answers with structured outputs (`output_config.format`);
 *   - adaptive thinking (the model's default) at ANTHROPIC_EFFORT;
 *   - server-side fallbacks (`fallbacks: "default"`), and a `refusal` that
 *     still comes back reported as an error, never parsed.
 */

const API_VERSION = '2026-10-21';
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
const RETRYABLE = new Set([408, 409, 429, 500, 502, 503, 504, 529]);

interface MessagesResponse {
  model?: string;
  stop_reason?: string;
  content?: { type: string; text?: string }[];
  usage?: { input_tokens?: number; output_tokens?: number };
  error?: { type?: string };
}

function block(page: { mimeType: string; data: Buffer }) {
  const source = { type: 'base64', media_type: page.mimeType, data: page.data.toString('base64') };
  return page.mimeType === 'application/pdf' ? { type: 'document', source } : { type: 'image', source };
}

export async function anthropicGenerate(request: ModelRequest): Promise<ModelAnswer> {
  const { anthropic } = config.ai;
  const body = {
    model: anthropic.model,
    max_tokens: request.maxTokens ?? 16_000,
    system: request.system,
    messages: [{ role: 'user', content: [...(request.media ?? []).map(block), { type: 'text', text: request.prompt }] }],
    output_config: {
      effort: anthropic.effort,
      ...(request.schema ? { format: { type: 'json_schema', schema: request.schema } } : {}),
    },
    fallbacks: 'default',
  };

  const started = Date.now();
  let response: Response;
  try {
    response = await fetch(`${anthropic.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropic.apiKey,
        'anthropic-version': API_VERSION,
        'anthropic-beta': FALLBACK_BETA,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(config.ai.timeoutMs),
    });
  } catch (error) {
    const timedOut = (error as Error).name === 'TimeoutError';
    log.warn('AI request failed to complete', { purpose: request.purpose, provider: 'anthropic', timedOut, ms: Date.now() - started });
    throw new RetryableAiError(timedOut ? 'The AI service took too long. Try again.' : 'Could not reach the AI service.');
  }

  const reply = (await response.json().catch(() => ({}))) as MessagesResponse;
  if (!response.ok) {
    log.warn('AI request refused', { purpose: request.purpose, provider: 'anthropic', status: response.status, ms: Date.now() - started, type: reply.error?.type ?? null });
    if (RETRYABLE.has(response.status)) throw new RetryableAiError('The AI service is busy. Try again in a minute.');
    throw new ApiError('ai_failed', 'The AI service could not process this request.');
  }
  log.info('AI request done', {
    purpose: request.purpose,
    provider: 'anthropic',
    ms: Date.now() - started,
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
    .filter((part) => part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('');
  return { text, model: reply.model ?? anthropic.model };
}
