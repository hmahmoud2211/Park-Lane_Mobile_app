import { config } from '../../config.ts';
import { ApiError } from '../../errors.ts';
import { log } from '../../log.ts';
import { RetryableAiError, type ModelAnswer, type ModelRequest } from './types.ts';

/**
 * Gemini, over generateContent (POST /v1beta/models/{model}:generateContent),
 * which Google documents as fully supported:
 *   - the system prompt as `systemInstruction`;
 *   - pages as `inlineData` parts before the prompt;
 *   - JSON answers with `responseMimeType` and `responseJsonSchema`;
 *   - `thinkingConfig.thinkingLevel` (GEMINI_THINKING_LEVEL);
 *   - a stop for safety, recitation or length reported as an error, never parsed.
 *
 * Use a paid (billing-enabled) Gemini API project for patient data: Google
 * does not use paid-tier prompts to improve its products.
 */

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
  modelVersion?: string;
  error?: { status?: string };
}

/** Clinical text names drugs, doses and conditions; only clearly harmful content should be blocked. */
const SAFETY = ['HARM_CATEGORY_HARASSMENT', 'HARM_CATEGORY_HATE_SPEECH', 'HARM_CATEGORY_SEXUALLY_EXPLICIT', 'HARM_CATEGORY_DANGEROUS_CONTENT'].map(
  (category) => ({ category, threshold: 'BLOCK_ONLY_HIGH' }),
);

const RETRYABLE = new Set([408, 429, 500, 502, 503, 504]);
const DECLINED = new Set(['SAFETY', 'RECITATION', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII', 'IMAGE_SAFETY', 'LANGUAGE', 'OTHER']);

export async function geminiGenerate(request: ModelRequest): Promise<ModelAnswer> {
  const { gemini } = config.ai;
  const model = request.task === 'documents' ? gemini.documentModel : gemini.model;
  const body = {
    systemInstruction: { parts: [{ text: request.system }] },
    contents: [
      {
        role: 'user',
        parts: [
          ...(request.media ?? []).map((page) => ({ inlineData: { mimeType: page.mimeType, data: page.data.toString('base64') } })),
          { text: request.prompt },
        ],
      },
    ],
    generationConfig: {
      maxOutputTokens: request.maxTokens ?? 16_384,
      thinkingConfig: { thinkingLevel: gemini.thinkingLevel },
      ...(request.schema ? { responseMimeType: 'application/json', responseJsonSchema: request.schema } : {}),
    },
    safetySettings: SAFETY,
  };

  const started = Date.now();
  let response: Response;
  try {
    response = await fetch(`${gemini.baseUrl}/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': gemini.apiKey },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(config.ai.timeoutMs),
    });
  } catch (error) {
    const timedOut = (error as Error).name === 'TimeoutError';
    log.warn('AI request failed to complete', { purpose: request.purpose, provider: 'gemini', timedOut, ms: Date.now() - started });
    throw new RetryableAiError(timedOut ? 'The AI service took too long. Try again.' : 'Could not reach the AI service.');
  }

  const reply = (await response.json().catch(() => ({}))) as GeminiResponse;
  if (!response.ok) {
    log.warn('AI request refused', { purpose: request.purpose, provider: 'gemini', status: response.status, ms: Date.now() - started, reason: reply.error?.status ?? null });
    if (RETRYABLE.has(response.status)) throw new RetryableAiError('The AI service is busy. Try again in a minute.');
    throw new ApiError(
      'ai_failed',
      response.status === 400 || response.status === 403 ? 'The AI service rejected this server’s request or key.' : 'The AI service could not process this request.',
    );
  }

  const candidate = reply.candidates?.[0];
  log.info('AI request done', {
    purpose: request.purpose,
    provider: 'gemini',
    ms: Date.now() - started,
    model: reply.modelVersion ?? model,
    stop: candidate?.finishReason ?? reply.promptFeedback?.blockReason ?? null,
    inputTokens: reply.usageMetadata?.promptTokenCount ?? null,
    outputTokens: reply.usageMetadata?.candidatesTokenCount ?? null,
    thinkingTokens: reply.usageMetadata?.thoughtsTokenCount ?? null,
  });
  if (reply.promptFeedback?.blockReason || (candidate?.finishReason && DECLINED.has(candidate.finishReason))) {
    throw new ApiError('ai_failed', 'The AI service declined to process this record. Continue without it.');
  }
  if (candidate?.finishReason === 'MAX_TOKENS') {
    throw new ApiError('ai_failed', 'The AI answer was cut short. Try again.');
  }
  const text = (candidate?.content?.parts ?? [])
    .filter((part) => !part.thought && typeof part.text === 'string')
    .map((part) => part.text)
    .join('');
  if (!text.trim()) throw new RetryableAiError('The AI service returned nothing. Try again.');
  return { text, model: reply.modelVersion ?? model };
}
