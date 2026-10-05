import { assistantConfig } from '../../constants/assistantConfig';
import type {
  AssistantHealth,
  AssistantResident,
  ChatRequest,
  ChatResponse,
} from './assistant.types';

/**
 * `ok: false` answers are not errors: they arrive as a 200 with an apology
 * in `answer`, and are shown like any other reply. These cover the rest.
 */
export type AssistantErrorKind = 'network' | 'timeout' | 'validation' | 'not_found' | 'server' | 'aborted';

export class AssistantApiError extends Error {
  readonly kind: AssistantErrorKind;
  readonly status?: number;

  constructor(kind: AssistantErrorKind, message: string, status?: number) {
    super(message);
    this.name = 'AssistantApiError';
    this.kind = kind;
    this.status = status;
  }
}

const url = (path: string) => `${assistantConfig.httpBase}${assistantConfig.apiPrefix}${path}`;

/** FastAPI puts errors in `detail`: a string, or a list of `{ msg }` for a 422. */
function detailMessage(body: unknown): string | undefined {
  if (!body || typeof body !== 'object' || !('detail' in body)) {
    return undefined;
  }
  const { detail } = body as { detail: unknown };
  if (typeof detail === 'string') {
    return detail;
  }
  if (Array.isArray(detail)) {
    return detail
      .map((entry) => (entry && typeof entry === 'object' && 'msg' in entry ? String(entry.msg) : ''))
      .filter(Boolean)
      .join('; ');
  }
  return undefined;
}

async function request<T>(
  path: string,
  init: RequestInit,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const forwardAbort = () => controller.abort();
  signal?.addEventListener('abort', forwardAbort);

  try {
    let response: Response;
    try {
      response = await fetch(url(path), { ...init, signal: controller.signal });
    } catch {
      if (timedOut) {
        throw new AssistantApiError('timeout', 'The assistant took too long to answer.');
      }
      if (signal?.aborted) {
        throw new AssistantApiError('aborted', 'Request cancelled.');
      }
      throw new AssistantApiError('network', 'Could not reach the assistant.');
    }

    const body: unknown = await response.json().catch(() => undefined);
    if (response.ok) {
      return body as T;
    }

    const message = detailMessage(body) ?? `HTTP ${response.status}`;
    switch (response.status) {
      case 404:
        throw new AssistantApiError('not_found', message, 404);
      case 422:
        throw new AssistantApiError('validation', message, 422);
      default:
        throw new AssistantApiError('server', message, response.status);
    }
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', forwardAbort);
  }
}

/** One question to the text assistant. Send `session_id` back for follow-ups. */
export function sendChatMessage(body: ChatRequest, signal?: AbortSignal): Promise<ChatResponse> {
  return request<ChatResponse>(
    '/chat',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    },
    assistantConfig.chatTimeoutMs,
    signal,
  );
}

/** Demo residents, for the developer picker only (see assistantConfig). */
export async function fetchResidents(signal?: AbortSignal): Promise<readonly AssistantResident[]> {
  const body = await request<{ residents?: AssistantResident[] }>(
    '/residents',
    { method: 'GET', headers: { Accept: 'application/json' } },
    assistantConfig.lookupTimeoutMs,
    signal,
  );
  return body.residents ?? [];
}

export function fetchHealth(signal?: AbortSignal): Promise<AssistantHealth> {
  return request<AssistantHealth>(
    '/health',
    { method: 'GET', headers: { Accept: 'application/json' } },
    assistantConfig.lookupTimeoutMs,
    signal,
  );
}
