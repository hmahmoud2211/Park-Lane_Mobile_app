import type {
  ConfirmInput,
  Consent,
  HealthDocument,
  HealthGap,
  HealthLang,
  HealthProfile,
  HealthRecord,
  ItemData,
  ProfileInput,
  RecordItem,
  RecordSection,
  SectionItems,
  Summary,
  SummaryRequest,
  SummaryState,
  UploadInput,
  UploadResult,
} from './health.types';
import { HealthError, uploadLimits, type HealthService } from './healthService';
import {
  CHILD_ID,
  GAP_TEXT,
  SUMMARY_FAILED_TEXT,
  SUMMARY_SCRIPTS,
  extractionFor,
  seedDocuments,
  seedProfiles,
  seedRecords,
  seedSummaries,
  type MockDocument,
  type MockRecord,
} from './mockData';

/** Time as the mock sees it; the checks swap in one that runs instantly. */
export interface MockClock {
  now(): number;
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
}

export const realClock: MockClock = {
  now: () => Date.now(),
  sleep: (ms, signal) =>
    new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new HealthError('aborted', 'Cancelled.'));
        return;
      }
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      const onAbort = () => {
        clearTimeout(timer);
        reject(new HealthError('aborted', 'Cancelled.'));
      };
      signal?.addEventListener('abort', onAbort, { once: true });
    }),
};

export const MOCK_TIMINGS = {
  /** A typical round trip. */
  latency: 350,
  upload: 2_000,
  /** From upload to "needs review". */
  processing: 20_000,
  /** A background summary: writing, then recording; about 8 s in all. */
  summaryWriting: 4_000,
  summaryRecording: 4_000,
};

/** A summary being made in the background. */
interface SummaryJob {
  startedAt: number;
  /** When the worker gets to it: later than `startedAt` while another job runs first. */
  workFrom: number;
  doneAt: number;
  /** The record version it is written from. */
  recordUpdatedAt: string;
  fails: boolean;
}

/** Everything known about one profile's summary in one language and specialty. */
interface SummarySlot {
  profileId: string;
  lang: HealthLang;
  specialty: string;
  ready?: Summary;
  job?: SummaryJob;
  failed?: { startedAt: number; failedAt: number };
}

export interface MockOptions {
  clock?: MockClock;
  timings?: Partial<typeof MOCK_TIMINGS>;
  /** Chance of a simulated 503 on reads, uploads and summaries, to exercise the error paths. */
  busyRate?: number;
  random?: () => number;
  /** The UI language, standing in for Accept-Language. */
  getLang?: () => HealthLang;
}

const YEAR_MS = 365.25 * 24 * 60 * 60 * 1000;

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/**
 * An in-memory backend with the real one's behaviour: documents take a
 * while to read and then wait for review; summaries are made in the
 * background one at a time, a fresh general one after every record change,
 * and a current one is reused; and the AI server is now and then too busy
 * to answer. Everything resets when the app restarts.
 */
export class MockHealthService implements HealthService {
  readonly kind = 'mock';

  private readonly clock: MockClock;
  private readonly timings: typeof MOCK_TIMINGS;
  private readonly busyRate: number;
  private readonly random: () => number;
  private readonly getLang: () => HealthLang;

  private consent: Consent = { given: false, given_at: null };
  private profiles: HealthProfile[] = [];
  private records: Record<string, MockRecord> = {};
  private documents: MockDocument[] = [];
  private summaries: SummarySlot[] = [];
  /** Profiles whose first summary has already failed: it fails once, then works. */
  private failedOnce = new Set<string>();
  private counter = 100;

  constructor(options: MockOptions = {}) {
    this.clock = options.clock ?? realClock;
    this.timings = { ...MOCK_TIMINGS, ...options.timings };
    this.busyRate = options.busyRate ?? 0.08;
    this.random = options.random ?? Math.random;
    this.getLang = options.getLang ?? (() => 'en');
    this.reset();
  }

  /** Back to the sample data, as after a fresh install. */
  reset() {
    this.consent = { given: false, given_at: null };
    this.profiles = seedProfiles();
    this.records = seedRecords();
    this.documents = seedDocuments(this.clock.now());
    this.summaries = seedSummaries().map((ready) => ({
      profileId: this.profiles[0].id,
      lang: ready.lang,
      specialty: ready.specialty ?? 'general',
      ready,
    }));
    this.failedOnce = new Set();
  }

  mediaHeaders(): Record<string, string> {
    return { 'Accept-Language': this.getLang() };
  }

  /* ----------------------------------------------------- Consent */

  async getConsent(): Promise<Consent> {
    await this.wait();
    return { ...this.consent };
  }

  async setConsent(given: boolean): Promise<Consent> {
    await this.wait();
    if (given) {
      this.consent = { given: true, given_at: this.iso() };
    } else {
      // Withdrawing deletes the health data; the resident's own profile stays, empty.
      const self = this.profiles.find((p) => p.relation === 'self') ?? this.profiles[0];
      this.consent = { given: false, given_at: null };
      this.profiles = [{ ...self, blood_type: null }];
      this.records = { [self.id]: this.emptyRecord() };
      this.documents = [];
      this.summaries = [];
    }
    return { ...this.consent };
  }

  /* ---------------------------------------------------- Profiles */

  async listProfiles(): Promise<HealthProfile[]> {
    await this.wait();
    this.requireConsent();
    return clone(this.profiles);
  }

  async addProfile(input: ProfileInput): Promise<HealthProfile> {
    await this.wait();
    this.requireConsent();
    this.validateProfile(input);
    const profile: HealthProfile = { ...input, id: this.id('fam') };
    this.profiles.push(profile);
    this.records[profile.id] = this.emptyRecord();
    return clone(profile);
  }

  async updateProfile(id: string, input: ProfileInput): Promise<HealthProfile> {
    await this.wait();
    this.requireConsent();
    this.validateProfile(input);
    const index = this.profiles.findIndex((p) => p.id === id);
    if (index < 0) throw new HealthError('not_found', 'Profile not found.', { status: 404 });
    this.profiles[index] = { ...input, id, relation: this.profiles[index].relation };
    this.touch(id);
    return clone(this.profiles[index]);
  }

  async deleteProfile(id: string): Promise<void> {
    await this.wait();
    this.requireConsent();
    const profile = this.profiles.find((p) => p.id === id);
    if (!profile) throw new HealthError('not_found', 'Profile not found.', { status: 404 });
    if (profile.relation === 'self') {
      // The resident's own profile can't go; its data is wiped instead.
      this.records[id] = this.emptyRecord();
      this.profiles = this.profiles.map((p) => (p.id === id ? { ...p, blood_type: null } : p));
    } else {
      this.profiles = this.profiles.filter((p) => p.id !== id);
      delete this.records[id];
    }
    this.documents = this.documents.filter((d) => d.profile_id !== id);
    this.summaries = this.summaries.filter((s) => s.profileId !== id);
  }

  /* ------------------------------------------------------ Record */

  async getRecord(profileId: string): Promise<HealthRecord> {
    await this.wait();
    this.maybeBusy();
    this.requireConsent();
    const profile = this.profile(profileId);
    const record = this.record(profileId);
    const { relation: _relation, ...patient } = profile;
    return clone({ patient, ...record, gaps: this.gapsFor(profile, record) });
  }

  async createItem<S extends RecordSection>(profileId: string, section: S, data: ItemData<S>): Promise<SectionItems[S]> {
    await this.wait();
    this.requireConsent();
    this.validateItem(section, data);
    const item = { ...data, id: this.id(section.charAt(0)), source: null } as unknown as SectionItems[S];
    this.list(profileId, section).push(item);
    this.touch(profileId);
    return clone(item);
  }

  async updateItem<S extends RecordSection>(
    profileId: string,
    section: S,
    itemId: string,
    data: ItemData<S>,
  ): Promise<SectionItems[S]> {
    await this.wait();
    this.requireConsent();
    this.validateItem(section, data);
    const list = this.list(profileId, section);
    const index = list.findIndex((item) => item.id === itemId);
    if (index < 0) throw new HealthError('not_found', 'Item not found.', { status: 404 });
    const updated = { ...data, id: itemId, source: list[index].source } as unknown as SectionItems[S];
    list[index] = updated;
    this.touch(profileId);
    return clone(updated);
  }

  async deleteItem(profileId: string, section: RecordSection, itemId: string): Promise<void> {
    await this.wait();
    this.requireConsent();
    const list = this.list(profileId, section);
    const index = list.findIndex((item) => item.id === itemId);
    if (index < 0) throw new HealthError('not_found', 'Item not found.', { status: 404 });
    list.splice(index, 1);
    this.touch(profileId);
  }

  /* --------------------------------------------------- Documents */

  async listDocuments(profileId: string): Promise<HealthDocument[]> {
    await this.wait();
    this.maybeBusy();
    this.requireConsent();
    this.profile(profileId);
    return this.documents
      .filter((d) => d.profile_id === profileId)
      .map((d) => this.present(d))
      .sort((a, b) => b.uploaded_at.localeCompare(a.uploaded_at));
  }

  async uploadDocument(
    profileId: string,
    input: UploadInput,
    options: { onProgress?: (fraction: number) => void; signal?: AbortSignal } = {},
  ): Promise<UploadResult> {
    this.requireConsent();
    this.profile(profileId);
    if (input.files.length === 0 || input.files.length > uploadLimits.maxPages) {
      throw new HealthError('invalid', 'A document has 1 to 10 pages.', { status: 422 });
    }
    if (input.files.some((f) => f.size > uploadLimits.maxFileBytes)) {
      throw new HealthError('too_large', 'A file is larger than 10 MB.', { status: 413 });
    }
    const steps = 10;
    for (let step = 1; step <= steps; step++) {
      await this.clock.sleep(this.timings.upload / steps, options.signal);
      options.onProgress?.(step / steps);
    }
    this.maybeBusy();

    const record = this.record(profileId);
    const allergy = record.allergies[0];
    const extraction = extractionFor(
      input.type,
      input.document_date,
      allergy ? { section: 'allergies', id: allergy.id, substance: allergy.substance } : null,
      () => this.id('x'),
    );
    const doc: MockDocument = {
      id: this.id('doc'),
      profile_id: profileId,
      type: input.type,
      document_date: input.document_date,
      uploaded_at: this.iso(),
      status: 'processing',
      page_count: input.files.length,
      file_url: input.files[0].uri,
      readyAt: this.clock.now() + this.timings.processing,
      pendingItems: extraction.items,
      pendingText: extraction.text,
    };
    this.documents.push(doc);
    return { id: doc.id, status: 'processing' };
  }

  async getDocument(docId: string): Promise<HealthDocument> {
    await this.wait();
    this.requireConsent();
    return this.present(this.document(docId));
  }

  async confirmDocument(docId: string, input: ConfirmInput): Promise<HealthDocument> {
    await this.wait();
    this.requireConsent();
    const doc = this.document(docId);
    this.advance(doc);
    if (doc.status !== 'needs_review') {
      throw new HealthError('invalid', 'This document is not waiting for review.', { status: 422 });
    }
    const pending = doc.extracted_items ?? [];
    for (const entry of input.items) {
      const extracted = pending.find((item) => item.item_id === entry.item_id);
      if (!extracted) {
        throw new HealthError('invalid', `Unknown item ${entry.item_id}.`, { status: 422 });
      }
      // A rejected item is dropped from the document for good; nothing is saved.
      if (entry.action === 'reject') continue;
      this.validateItem(extracted.section, entry.data);
      const list = this.list(doc.profile_id, extracted.section);
      const saved = { ...entry.data, id: this.id(extracted.section.charAt(0)), source: doc.id } as RecordItem;
      if (entry.action === 'replace') {
        const index = list.findIndex((item) => item.id === entry.replace_id);
        if (index < 0) throw new HealthError('invalid', 'The item to replace no longer exists.', { status: 422 });
        list[index] = { ...saved, id: entry.replace_id };
      } else {
        list.push(saved);
      }
    }
    const sent = new Set(input.items.map((item) => item.item_id));
    doc.extracted_items = pending.filter((item) => !sent.has(item.item_id));
    if (input.finished || doc.extracted_items.length === 0) {
      doc.status = 'confirmed';
      doc.extracted_items = [];
    }
    if (input.items.some((item) => item.action !== 'reject')) this.touch(doc.profile_id);
    return this.present(doc);
  }

  async deleteDocument(docId: string, deleteItems: boolean): Promise<void> {
    await this.wait();
    this.requireConsent();
    const doc = this.document(docId);
    const record = this.records[doc.profile_id];
    if (record) {
      for (const section of Object.keys(record) as (keyof MockRecord)[]) {
        const list = record[section];
        if (!Array.isArray(list)) continue;
        const items = list as RecordItem[];
        // Kept items stay, marked as no longer backed by a document.
        record[section] = (
          deleteItems
            ? items.filter((item) => item.source !== docId)
            : items.map((item) => (item.source === docId ? { ...item, source: null } : item))
        ) as never;
      }
      if (deleteItems) this.touch(doc.profile_id);
    }
    this.documents = this.documents.filter((d) => d.id !== docId);
  }

  /* --------------------------------------------------- Summaries */

  async getSummary(profileId: string, lang: HealthLang, specialty?: string | null): Promise<SummaryState | null> {
    await this.wait();
    this.requireConsent();
    this.profile(profileId);
    this.settleSummaries();
    const slots = this.summaries.filter((slot) => slot.profileId === profileId && slot.lang === lang);
    const slot = specialty
      ? slots.find((entry) => entry.specialty === specialty)
      : slots.sort((a, b) => this.lastActivity(b) - this.lastActivity(a))[0];
    return slot ? this.summaryState(slot) : null;
  }

  async generateSummary(profileId: string, request: SummaryRequest): Promise<SummaryState> {
    await this.wait();
    this.requireConsent();
    if (request.consent !== true) {
      throw new HealthError('invalid', 'Consent is required to generate a summary.', { status: 422 });
    }
    this.profile(profileId);
    this.maybeBusy();
    this.settleSummaries();
    const slot = this.summarySlot(profileId, request.lang, request.specialty ?? 'general');
    const record = this.record(profileId);
    // Asking again while one is being made returns that one rather than starting another.
    if (slot.job) return this.summaryState(slot)!;
    if (slot.ready && slot.ready.record_updated_at === record.record_updated_at && !this.failedAfterReady(slot)) {
      return { ...slot.ready, cached: true };
    }
    const fails = profileId === CHILD_ID && !this.failedOnce.has(profileId);
    if (fails) this.failedOnce.add(profileId);
    this.startSummary(slot, record.record_updated_at, fails);
    return this.summaryState(slot)!;
  }

  /** What the server does after every record change: start a fresh general Arabic summary. */
  private prepareGeneralSummary(profileId: string) {
    this.settleSummaries();
    const slot = this.summarySlot(profileId, 'ar', 'general');
    if (!slot.job) this.startSummary(slot, this.record(profileId).record_updated_at, false);
  }

  private summarySlot(profileId: string, lang: HealthLang, specialty: string): SummarySlot {
    let slot = this.summaries.find((s) => s.profileId === profileId && s.lang === lang && s.specialty === specialty);
    if (!slot) {
      slot = { profileId, lang, specialty };
      this.summaries.push(slot);
    }
    return slot;
  }

  /** One worker, as on a single CPU: a new job waits for the ones already queued. */
  private startSummary(slot: SummarySlot, recordUpdatedAt: string, fails: boolean) {
    const now = this.clock.now();
    const queueEnd = Math.max(now, ...this.summaries.map((s) => s.job?.doneAt ?? 0));
    slot.job = {
      startedAt: now,
      workFrom: queueEnd,
      doneAt: queueEnd + this.timings.summaryWriting + this.timings.summaryRecording,
      recordUpdatedAt,
      fails,
    };
  }

  /** Jobs whose time is up become summaries, or failures. */
  private settleSummaries() {
    const now = this.clock.now();
    for (const slot of this.summaries) {
      const job = slot.job;
      if (!job || now < job.doneAt) continue;
      slot.job = undefined;
      if (job.fails) {
        slot.failed = { startedAt: job.startedAt, failedAt: job.doneAt };
        continue;
      }
      const script = SUMMARY_SCRIPTS[slot.profileId]?.[slot.lang] ?? SUMMARY_SCRIPTS[this.profiles[0].id][slot.lang];
      slot.ready = {
        status: 'ready',
        lang: slot.lang,
        specialty: slot.specialty,
        transcript: script.transcript,
        audio_url: script.audio,
        cached: false,
        generated_at: this.iso(job.doneAt),
        record_updated_at: job.recordUpdatedAt,
      };
      slot.failed = undefined;
    }
  }

  private failedAfterReady(slot: SummarySlot) {
    return Boolean(slot.failed && (!slot.ready || slot.failed.failedAt > Date.parse(slot.ready.generated_at)));
  }

  private lastActivity(slot: SummarySlot) {
    return Math.max(
      slot.job?.startedAt ?? 0,
      slot.failed?.failedAt ?? 0,
      slot.ready ? Date.parse(slot.ready.generated_at) : 0,
    );
  }

  private summaryState(slot: SummarySlot): SummaryState | null {
    const { job } = slot;
    if (job) {
      const now = this.clock.now();
      return {
        status: 'generating',
        lang: slot.lang,
        specialty: slot.specialty,
        started_at: this.iso(job.startedAt),
        phase: now < job.workFrom ? 'waiting' : now < job.workFrom + this.timings.summaryWriting ? 'writing' : 'recording',
      };
    }
    if (slot.failed && this.failedAfterReady(slot)) {
      return {
        status: 'failed',
        lang: slot.lang,
        specialty: slot.specialty,
        started_at: this.iso(slot.failed.startedAt),
        error: SUMMARY_FAILED_TEXT[this.getLang()],
        failed_at: this.iso(slot.failed.failedAt),
      };
    }
    return slot.ready ? { ...slot.ready, cached: false } : null;
  }

  /* ----------------------------------------------------- Helpers */

  private iso(at = this.clock.now()) {
    return new Date(at).toISOString();
  }

  private id(prefix: string) {
    this.counter += 1;
    return `${prefix}-${this.counter}`;
  }

  private wait(signal?: AbortSignal) {
    return this.clock.sleep(this.timings.latency, signal);
  }

  private maybeBusy() {
    if (this.busyRate > 0 && this.random() < this.busyRate) {
      throw new HealthError('busy', 'The health assistant is busy. Try again in a minute.', { status: 503 });
    }
  }

  private requireConsent() {
    if (!this.consent.given) {
      throw new HealthError('invalid', 'Health data consent has not been given.', { status: 422 });
    }
  }

  private profile(id: string): HealthProfile {
    const profile = this.profiles.find((p) => p.id === id);
    if (!profile) throw new HealthError('not_found', 'Profile not found.', { status: 404 });
    return profile;
  }

  private record(profileId: string): MockRecord {
    this.profile(profileId);
    this.records[profileId] ??= this.emptyRecord();
    return this.records[profileId];
  }

  private list<S extends RecordSection>(profileId: string, section: S): SectionItems[S][] {
    return this.record(profileId)[section] as SectionItems[S][];
  }

  private document(docId: string): MockDocument {
    const doc = this.documents.find((d) => d.id === docId);
    if (!doc) throw new HealthError('not_found', 'Document not found.', { status: 404 });
    return doc;
  }

  private emptyRecord(): MockRecord {
    return {
      record_updated_at: this.iso(),
      allergies: [],
      medications: [],
      conditions: [],
      procedures: [],
      labs: [],
      visits: [],
    };
  }

  private touch(profileId: string) {
    this.record(profileId).record_updated_at = this.iso();
    this.prepareGeneralSummary(profileId);
  }

  /** A processing document finishes once its time is up. */
  private advance(doc: MockDocument) {
    if (doc.status === 'processing' && doc.readyAt !== undefined && this.clock.now() >= doc.readyAt) {
      doc.status = 'needs_review';
      doc.extracted_items = doc.pendingItems ?? [];
      doc.extracted_text = doc.pendingText ?? '';
      delete doc.pendingItems;
      delete doc.pendingText;
      delete doc.readyAt;
    }
  }

  private present(doc: MockDocument): HealthDocument {
    this.advance(doc);
    const { errorText, readyAt: _readyAt, pendingItems: _items, pendingText: _text, ...rest } = doc;
    const shown: HealthDocument = { ...clone(rest), error: errorText ? errorText[this.getLang()] : null };
    if (shown.status === 'processing' || shown.status === 'failed') {
      shown.extracted_items = null;
      shown.extracted_text = null;
    }
    return shown;
  }

  private gapsFor(profile: HealthProfile, record: MockRecord): HealthGap[] {
    const lang = this.getLang();
    const gaps: HealthGap[] = [];
    if (!profile.blood_type) gaps.push({ kind: 'missing_blood_type', text: GAP_TEXT.missing_blood_type[lang] });
    if (record.allergies.length === 0) {
      gaps.push({ kind: 'no_allergies_recorded', text: GAP_TEXT.no_allergies_recorded[lang] });
    }
    const now = this.clock.now();
    if (!record.labs.some((l) => now - Date.parse(l.date) < YEAR_MS)) {
      gaps.push({ kind: 'no_recent_labs', text: GAP_TEXT.no_recent_labs[lang] });
    }
    const latestByTest = new Map<string, string>();
    for (const lab of record.labs) {
      if ((latestByTest.get(lab.test) ?? '') < lab.date) latestByTest.set(lab.test, lab.date);
    }
    for (const [test, date] of latestByTest) {
      if (now - Date.parse(date) > 2 * YEAR_MS) gaps.push({ kind: 'stale_lab', text: GAP_TEXT.stale_lab[lang](test, date), test });
    }
    return gaps;
  }

  private validateProfile(input: ProfileInput) {
    if (!input.name.trim()) throw new HealthError('invalid', 'A name is required.', { status: 422, detail: 'name' });
    if (input.date_of_birth && Date.parse(input.date_of_birth) > this.clock.now()) {
      throw new HealthError('invalid', 'Date of birth is in the future.', { status: 422, detail: 'date_of_birth' });
    }
  }

  private validateItem(section: RecordSection, data: object) {
    const fields = data as Record<string, unknown>;
    const required: Record<RecordSection, string> = {
      allergies: 'substance',
      medications: 'name',
      conditions: 'name',
      procedures: 'name',
      labs: 'test',
      visits: 'date',
    };
    const key = required[section];
    if (typeof fields[key] !== 'string' || !(fields[key] as string).trim()) {
      throw new HealthError('invalid', `${key} is required.`, { status: 422, detail: key });
    }
    if (section === 'labs' && !Number.isFinite(fields.value)) {
      throw new HealthError('invalid', 'A lab value must be a number.', { status: 422, detail: 'value' });
    }
  }
}
