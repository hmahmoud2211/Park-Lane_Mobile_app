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

/**
 * Everything Health Passport asks of the app's backend. The app never talks
 * to the AI server itself: the backend reads documents and writes summaries,
 * and this is the only way in. Two implementations share it, a mock and the
 * real HTTP client (see createHealthService), chosen by one config flag.
 */
export interface HealthService {
  readonly kind: 'mock' | 'http';

  getConsent(): Promise<Consent>;
  /** `false` withdraws consent, and the backend deletes every profile's health data. */
  setConsent(given: boolean): Promise<Consent>;

  listProfiles(): Promise<HealthProfile[]>;
  addProfile(input: ProfileInput): Promise<HealthProfile>;
  updateProfile(id: string, input: ProfileInput): Promise<HealthProfile>;
  /** Removes the profile and all of its health data. */
  deleteProfile(id: string): Promise<void>;

  getRecord(profileId: string): Promise<HealthRecord>;
  createItem<S extends RecordSection>(profileId: string, section: S, data: ItemData<S>): Promise<SectionItems[S]>;
  updateItem<S extends RecordSection>(
    profileId: string,
    section: S,
    itemId: string,
    data: ItemData<S>,
  ): Promise<SectionItems[S]>;
  deleteItem(profileId: string, section: RecordSection, itemId: string): Promise<void>;

  listDocuments(profileId: string): Promise<HealthDocument[]>;
  uploadDocument(
    profileId: string,
    input: UploadInput,
    options?: { onProgress?: (fraction: number) => void; signal?: AbortSignal },
  ): Promise<UploadResult>;
  getDocument(docId: string): Promise<HealthDocument>;
  /** Saves the confirmed items; may be called more than once while reviewing. */
  confirmDocument(docId: string, input: ConfirmInput): Promise<HealthDocument>;
  deleteDocument(docId: string, deleteItems: boolean): Promise<void>;

  /**
   * The summary for this language and specialty, or without a specialty the
   * newest in that language: ready, still being made, or failed. Null when
   * none has ever been made in this language.
   */
  getSummary(profileId: string, lang: HealthLang, specialty?: string | null): Promise<SummaryState | null>;
  /**
   * Asks for a summary. A current one comes back ready at once; otherwise
   * the server starts making it in the background (or returns the job
   * already running for it) and the caller polls getSummary.
   */
  generateSummary(profileId: string, request: SummaryRequest): Promise<SummaryState>;

  /** Headers to fetch `file_url` and `audio_url` with: the session and the UI language. */
  mediaHeaders(): Record<string, string>;
}

/**
 * `unauthorized` is a 401 (the app signs out), `too_large` a 413, `invalid`
 * a 422, `busy` a 503 (the AI server is busy or down), `not_found` a 404.
 */
export type HealthErrorKind =
  | 'network'
  | 'timeout'
  | 'aborted'
  | 'unauthorized'
  | 'not_found'
  | 'too_large'
  | 'invalid'
  | 'busy'
  | 'server';

export class HealthError extends Error {
  readonly kind: HealthErrorKind;
  readonly status?: number;
  /** The backend's own explanation, e.g. which field a 422 refused. Shown as given. */
  readonly detail?: string;

  constructor(kind: HealthErrorKind, message: string, options: { status?: number; detail?: string } = {}) {
    super(message);
    this.name = 'HealthError';
    this.kind = kind;
    this.status = options.status;
    this.detail = options.detail;
  }
}

export const isHealthError = (error: unknown): error is HealthError => error instanceof HealthError;

export function errorKindForStatus(status: number): HealthErrorKind {
  switch (status) {
    case 401:
      return 'unauthorized';
    case 404:
      return 'not_found';
    case 413:
      return 'too_large';
    case 422:
      return 'invalid';
    case 503:
      return 'busy';
    default:
      return 'server';
  }
}

/** Upload limits, checked on the phone before anything is sent. */
export const uploadLimits = {
  maxPages: 10,
  maxFileBytes: 10 * 1024 * 1024,
  /** Long side of a photo after compression: small enough to send, large enough to read. */
  maxImageSide: 2500,
  jpegQuality: 0.85,
} as const;
