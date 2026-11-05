import { config } from '../../config.ts';
import { ApiError } from '../../errors.ts';
import { log } from '../../log.ts';
import { anthropicGenerate } from './anthropic.ts';
import { geminiGenerate } from './gemini.ts';
import { RetryableAiError, type ModelAnswer, type ModelRequest } from './types.ts';

export type { Media, ModelAnswer, ModelRequest } from './types.ts';

/**
 * The one way the backend asks an AI service for anything: Gemini or
 * Claude (AI_PROVIDER), over their documented HTTP APIs with fetch, as the
 * backend's other clients do. A request is a system prompt, a user prompt,
 * optional images or PDFs, and optionally a JSON schema the answer must
 * follow; the answer is its text, or the parsed JSON.
 *
 * Prompts and answers hold medical data, so neither is ever logged: only
 * the purpose, the model, the stop reason and token counts.
 */

export function aiConfigured(): boolean {
  return Boolean(config.ai.provider === 'gemini' ? config.ai.gemini.apiKey : config.ai.anthropic.apiKey);
}

export function aiModelName(task: ModelRequest['task'] = 'general'): string {
  if (config.ai.provider === 'anthropic') return config.ai.anthropic.model;
  return task === 'documents' ? config.ai.gemini.documentModel : config.ai.gemini.model;
}

/** One answer, retried once if the service was busy. Throws `not_configured` without a key, `ai_failed` otherwise. */
export async function generate(request: ModelRequest): Promise<ModelAnswer> {
  if (!aiConfigured()) {
    const key = config.ai.provider === 'gemini' ? 'GEMINI_API_KEY' : 'ANTHROPIC_API_KEY';
    throw new ApiError('not_configured', `AI is not set up on this server (${key}).`);
  }
  const send = config.ai.provider === 'gemini' ? geminiGenerate : anthropicGenerate;
  try {
    return await send(request);
  } catch (error) {
    if (!(error instanceof RetryableAiError)) throw error;
    log.warn('AI request will be retried', { purpose: request.purpose, provider: config.ai.provider });
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    return send(request);
  }
}

/** An answer that must be JSON matching `schema`, parsed. */
export async function generateJson<T>(request: ModelRequest & { schema: Record<string, unknown> }): Promise<{ value: T; model: string }> {
  const answer = await generate(request);
  try {
    return { value: JSON.parse(answer.text) as T, model: answer.model };
  } catch {
    throw new ApiError('ai_failed', 'The AI answer could not be read. Try again.');
  }
}

/** A JSON Schema value that may also be null, in the form both providers accept. */
export const nullable = (schema: Record<string, unknown>) => ({ anyOf: [schema, { type: 'null' }] });
