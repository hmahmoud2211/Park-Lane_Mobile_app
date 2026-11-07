import { healthConfig } from '../../../config/health';
import { jsonRequest, timedFetch, type NoAnswer } from '../../../lib/http/request';
import { timedUpload } from '../../../lib/http/upload';
import type {
  ClinicConsultation,
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
} from '../../../types/health.types';
import { HealthError, errorKindForStatus, type HealthService } from './healthService';
import { appendFile } from './uploadForm';

export interface HttpHealthOptions {
  baseUrl?: string;
  /** The signed-in session's bearer token, read on every call. */
  getToken: () => string | null;
  getLang: () => HealthLang;
  /** A 401: the session is over and the app signs out. */
  onUnauthorized: () => void;
  /** A 403 `password_change_required`: the account must choose its own password first. */
  onPasswordChangeRequired?: () => void;
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

function uploadFailure({ timedOut, aborted }: NoAnswer): HealthError {
  if (timedOut) return new HealthError('timeout', 'The upload timed out.');
  return aborted ? new HealthError('aborted', 'Cancelled.') : new HealthError('network', 'No connection.');
}

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

  private requireBackend() {
    if (!this.baseUrl) {
      throw new HealthError('network', 'The health backend is not configured (EXPO_PUBLIC_HEALTH_API_URL).');
    }
  }

  private fail(status: number, body: unknown): never {
    const kind = errorKindForStatus(status);
    if (kind === 'unauthorized') this.options.onUnauthorized();
    if (status === 403 && (body as { error?: { code?: unknown } } | undefined)?.error?.code === 'password_change_required') {
      this.options.onPasswordChangeRequired?.();
    }
    throw new HealthError(kind, detailOf(body) ?? `HTTP ${status}`, { status, detail: detailOf(body) });
  }

  private async call<T>(
    method: Method,
    path: string,
    init: { body?: unknown; timeoutMs?: number; signal?: AbortSignal; allow404?: boolean } = {},
  ): Promise<T> {
    this.requireBackend();
    const request = jsonRequest(method, init.body, this.options.getToken());
    return timedFetch(`${this.baseUrl}${path}`, {
      init: { ...request, headers: { ...request.headers, 'Accept-Language': this.options.getLang() } },
      timeoutMs: init.timeoutMs ?? healthConfig.requestTimeoutMs,
      signal: init.signal,
      noAnswer: ({ timedOut, aborted }) =>
        timedOut
          ? new HealthError('timeout', 'The request timed out.')
          : aborted
            ? new HealthError('aborted', 'Cancelled.')
            : new HealthError('network', 'No connection.'),
      read: async (response) => {
        const hasBody = response.status !== 204;
        const body: unknown = hasBody ? await response.json().catch(() => undefined) : undefined;
        if (response.ok) {
          // Every answer but a 204 is JSON, so this one was cut off or timed out while it was read.
          if (hasBody && body === undefined) throw new HealthError('server', `HTTP ${response.status}`, { status: response.status });
          return body as T;
        }
        if (response.status === 404 && init.allow404) return null as T;
        return this.fail(response.status, body);
      },
    });
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

  getConsultation = (consultationId: string) =>
    this.call<ClinicConsultation>('GET', `/health/consultations/${enc(consultationId)}`);

  /** Multipart, with progress: see timedUpload. */
  async uploadDocument(
    profileId: string,
    input: UploadInput,
    options: { onProgress?: (fraction: number) => void; signal?: AbortSignal } = {},
  ): Promise<UploadResult> {
    this.requireBackend();
    const form = new FormData();
    for (const file of input.files) {
      await appendFile(form, 'files[]', file);
    }
    form.append('type', input.type);
    if (input.document_date) form.append('document_date', input.document_date);

    return timedUpload(`${this.baseUrl}/health/profiles/${enc(profileId)}/documents`, {
      form,
      headers: { Accept: 'application/json', ...this.mediaHeaders() },
      timeoutMs: healthConfig.uploadTimeoutMs,
      signal: options.signal,
      onProgress: options.onProgress,
      noAnswer: uploadFailure,
      read: (status, text) => {
        let body: unknown;
        try {
          body = text ? JSON.parse(text) : undefined;
        } catch {
          body = undefined;
        }
        if (status >= 200 && status < 300) return body as UploadResult;
        return this.fail(status, body);
      },
    });
  }
}
