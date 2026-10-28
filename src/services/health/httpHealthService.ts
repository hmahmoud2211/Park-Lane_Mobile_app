import { healthConfig } from '../../constants/healthConfig';
import type {
  ConfirmInput,
  Consent,
  HealthDocument,
  HealthLang,
  HealthProfile,
  HealthRecord,
  ItemData,
  ProfileInput,
  RecordSection,
  SectionItems,
  SummaryRequest,
  SummaryState,
  UploadInput,
  UploadResult,
} from './health.types';
import { HealthError, errorKindForStatus, type HealthService } from './healthService';
import { appendFile } from './uploadForm';

export interface HttpHealthOptions {
  baseUrl?: string;
  /** The signed-in session's bearer token, read on every call. */
  getToken: () => string | null;
  getLang: () => HealthLang;
  /** A 401: the session is over and the app signs out. */
  onUnauthorized: () => void;
}

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';

/** The message a backend error body carries, whichever shape it uses. */
function detailOf(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const value = body as { detail?: unknown; message?: unknown; error?: { message?: unknown } };
  if (typeof value.detail === 'string') return value.detail;
  if (Array.isArray(value.detail)) {
    return value.detail
      .map((entry) => (entry && typeof entry === 'object' && 'msg' in entry ? String(entry.msg) : ''))
      .filter(Boolean)
      .join('; ');
  }
  if (typeof value.message === 'string') return value.message;
  if (typeof value.error?.message === 'string') return value.error.message;
  return undefined;
}

const enc = encodeURIComponent;

/**
 * The real endpoints, on the app's own backend with the app's own session.
 * Errors come back as HealthError kinds the screens explain in the UI's
 * language; nothing here logs request or response bodies, which hold
 * medical data.
 */
export class HttpHealthService implements HealthService {
  readonly kind = 'http';

  private readonly baseUrl: string;

  constructor(private readonly options: HttpHealthOptions) {
    this.baseUrl = (options.baseUrl ?? healthConfig.baseUrl).replace(/\/+$/, '');
  }

  mediaHeaders(): Record<string, string> {
    const token = this.options.getToken();
    return {
      'Accept-Language': this.options.getLang(),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
  }

  private fail(status: number, body: unknown): never {
    const kind = errorKindForStatus(status);
    if (kind === 'unauthorized') this.options.onUnauthorized();
    throw new HealthError(kind, detailOf(body) ?? `HTTP ${status}`, { status, detail: detailOf(body) });
  }

  private async call<T>(
    method: Method,
    path: string,
    init: { body?: unknown; timeoutMs?: number; signal?: AbortSignal; allow404?: boolean } = {},
  ): Promise<T> {
    if (!this.baseUrl) {
      throw new HealthError('network', 'The health backend is not configured (EXPO_PUBLIC_HEALTH_API_URL).');
    }
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, init.timeoutMs ?? healthConfig.requestTimeoutMs);
    const forwardAbort = () => controller.abort();
    init.signal?.addEventListener('abort', forwardAbort);

    try {
      let response: Response;
      try {
        response = await fetch(`${this.baseUrl}${path}`, {
          method,
          headers: {
            Accept: 'application/json',
            ...this.mediaHeaders(),
            ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          },
          body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
          signal: controller.signal,
        });
      } catch {
        if (timedOut) throw new HealthError('timeout', 'The request timed out.');
        if (init.signal?.aborted) throw new HealthError('aborted', 'Cancelled.');
        throw new HealthError('network', 'No connection.');
      }
      const body: unknown = response.status === 204 ? undefined : await response.json().catch(() => undefined);
      if (response.ok) return body as T;
      if (response.status === 404 && init.allow404) return null as T;
      return this.fail(response.status, body);
    } finally {
      clearTimeout(timer);
      init.signal?.removeEventListener('abort', forwardAbort);
    }
  }

  getConsent = () => this.call<Consent>('GET', '/health/consent');
  setConsent = (given: boolean) => this.call<Consent>('POST', '/health/consent', { body: { given } });

  listProfiles = () => this.call<HealthProfile[]>('GET', '/health/profiles');
  addProfile = (input: ProfileInput) => this.call<HealthProfile>('POST', '/health/profiles', { body: input });
  updateProfile = (id: string, input: ProfileInput) =>
    this.call<HealthProfile>('PUT', `/health/profiles/${enc(id)}`, { body: input });
  deleteProfile = async (id: string) => {
    await this.call<void>('DELETE', `/health/profiles/${enc(id)}`);
  };

  getRecord = (profileId: string) => this.call<HealthRecord>('GET', `/health/profiles/${enc(profileId)}/record`);

  createItem<S extends RecordSection>(profileId: string, section: S, data: ItemData<S>) {
    return this.call<SectionItems[S]>('POST', `/health/profiles/${enc(profileId)}/${section}`, { body: data });
  }

  updateItem<S extends RecordSection>(profileId: string, section: S, itemId: string, data: ItemData<S>) {
    return this.call<SectionItems[S]>('PUT', `/health/profiles/${enc(profileId)}/${section}/${enc(itemId)}`, {
      body: data,
    });
  }

  deleteItem = async (profileId: string, section: RecordSection, itemId: string) => {
    await this.call<void>('DELETE', `/health/profiles/${enc(profileId)}/${section}/${enc(itemId)}`);
  };

  listDocuments = (profileId: string) =>
    this.call<HealthDocument[]>('GET', `/health/profiles/${enc(profileId)}/documents`);

  getDocument = (docId: string) => this.call<HealthDocument>('GET', `/health/documents/${enc(docId)}`);

  confirmDocument = (docId: string, input: ConfirmInput) =>
    this.call<HealthDocument>('POST', `/health/documents/${enc(docId)}/confirm`, { body: input });

  deleteDocument = async (docId: string, deleteItems: boolean) => {
    await this.call<void>('DELETE', `/health/documents/${enc(docId)}?delete_items=${deleteItems}`);
  };

  /** 200 (ready or failed) and 202 (still being made) both carry the state in `status`; 404 is "none yet". */
  getSummary = (profileId: string, lang: HealthLang, specialty?: string | null) =>
    this.call<SummaryState | null>(
      'GET',
      `/health/profiles/${enc(profileId)}/summary?lang=${lang}${specialty ? `&specialty=${enc(specialty)}` : ''}`,
      { allow404: true },
    );

  /** Answers at once: 200 with a current summary, or 202 with the background job. */
  generateSummary = (profileId: string, request: SummaryRequest) =>
    this.call<SummaryState>('POST', `/health/profiles/${enc(profileId)}/summary`, { body: request });

  /** Multipart over XMLHttpRequest, since fetch reports no upload progress. */
  async uploadDocument(
    profileId: string,
    input: UploadInput,
    options: { onProgress?: (fraction: number) => void; signal?: AbortSignal } = {},
  ): Promise<UploadResult> {
    const form = new FormData();
    for (const file of input.files) {
      await appendFile(form, 'files[]', file);
    }
    form.append('type', input.type);
    if (input.document_date) form.append('document_date', input.document_date);

    return new Promise<UploadResult>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${this.baseUrl}/health/profiles/${enc(profileId)}/documents`);
      xhr.timeout = healthConfig.uploadTimeoutMs;
      xhr.setRequestHeader('Accept', 'application/json');
      for (const [name, value] of Object.entries(this.mediaHeaders())) {
        xhr.setRequestHeader(name, value);
      }
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable && event.total > 0) options.onProgress?.(event.loaded / event.total);
      };
      const onAbort = () => xhr.abort();
      options.signal?.addEventListener('abort', onAbort, { once: true });
      const done = () => options.signal?.removeEventListener('abort', onAbort);

      xhr.onload = () => {
        done();
        let body: unknown;
        try {
          body = xhr.responseText ? JSON.parse(xhr.responseText) : undefined;
        } catch {
          body = undefined;
        }
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(body as UploadResult);
          return;
        }
        try {
          this.fail(xhr.status, body);
        } catch (error) {
          reject(error);
        }
      };
      xhr.onerror = () => {
        done();
        reject(new HealthError('network', 'No connection.'));
      };
      xhr.ontimeout = () => {
        done();
        reject(new HealthError('timeout', 'The upload timed out.'));
      };
      xhr.onabort = () => {
        done();
        reject(new HealthError('aborted', 'Cancelled.'));
      };
      xhr.send(form);
    });
  }
}
