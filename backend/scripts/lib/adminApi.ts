/** The backend's admin API (Authorization: Bearer ADMIN_API_KEY), for the development scripts. */

export class AdminApiError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'AdminApiError';
    this.code = code;
  }
}

/** A caller bound to one backend and key; it resolves with `data` or throws AdminApiError. Network failures throw as fetch does. */
export function adminApi(baseUrl: string, apiKey: string) {
  return async function call<T = Record<string, string>>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const parsed = (await response.json()) as { ok: boolean; data: T; error?: { code: string; message: string } };
    if (!parsed.ok) {
      throw new AdminApiError(String(parsed.error?.code), String(parsed.error?.message));
    }
    return parsed.data;
  };
}
