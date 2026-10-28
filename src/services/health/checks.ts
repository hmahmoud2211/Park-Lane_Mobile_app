/**
 * Acceptance checks for Health Passport's mock service, document polling,
 * review rules and form validation. Each runs against its own mock with a
 * clock it controls, so nothing waits in real time.
 *
 * Run in Node: npm run check:health
 */
import { healthConfig } from '../../constants/healthConfig';
import { StatusPoller, nextPollDelay, type PollSchedule } from './statusPoller';
import type { ExtractedItem, HealthDocument, HealthLang, SummaryState, UploadFile } from './health.types';
import { HealthError, isHealthError } from './healthService';
import { textDirection } from './i18n';
import { dataFrom, emptyDraft, validateDraft } from './itemForm';
import { CHILD_ID, RESIDENT_ID } from './mockData';
import { MOCK_TIMINGS, MockHealthService, type MockClock } from './mockHealthService';
import { canConfirm, canConfirmAll, confirmRemaining, savedCount, startReview, toConfirmInput, update } from './review';
import { checkDate, dateFromIso, gapFix, groupLabs, isoFromDate, labFlag, parseNumber, summaryIsStale } from './selectors';

export interface CheckResult {
  id: number;
  name: string;
  passed: boolean;
  detail: string;
}

const T0 = Date.UTC(2026, 9, 26, 8, 0);
const SECOND = 1_000;
const MINUTE = 60 * SECOND;

function fakeClock(start = T0): MockClock & { advance(ms: number): void } {
  let now = start;
  return {
    now: () => now,
    sleep: async (ms, signal) => {
      if (signal?.aborted) throw new HealthError('aborted', 'Cancelled.');
      now += ms;
    },
    advance: (ms) => {
      now += ms;
    },
  };
}

function harness(options: { lang?: HealthLang; busyRate?: number } = {}) {
  const clock = fakeClock();
  let lang: HealthLang = options.lang ?? 'en';
  const service = new MockHealthService({ clock, busyRate: options.busyRate ?? 0, random: () => 0.5, getLang: () => lang });
  return {
    clock,
    service,
    setLang: (next: HealthLang) => {
      lang = next;
    },
  };
}

async function consented(options?: Parameters<typeof harness>[0]) {
  const h = harness(options);
  await h.service.setConsent(true);
  return h;
}

async function errorKind(run: () => Promise<unknown>) {
  try {
    await run();
    return 'none';
  } catch (error) {
    return isHealthError(error) ? error.kind : 'unexpected';
  }
}

const photo = (name: string, size = 1_200_000): UploadFile => ({ uri: `file:///tmp/${name}`, name, mimeType: 'image/jpeg', size });

/** Timers that run only when told to, for the poller. */
function fakeTimers(start = T0) {
  let now = start;
  let seq = 0;
  const timers = new Map<number, { at: number; run: () => void }>();
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
  return {
    now: () => now,
    setTimer: (run: () => void, ms: number) => {
      seq += 1;
      timers.set(seq, { at: now + ms, run });
      return seq as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimer: (handle: ReturnType<typeof setTimeout>) => {
      timers.delete(handle as unknown as number);
    },
    pending: () => timers.size,
    async advance(ms: number) {
      const end = now + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        now = due[1].at;
        due[1].run();
        await flush();
        await flush();
      }
      now = end;
    },
  };
}

const SCHEDULE: PollSchedule = { fastIntervalMs: 5 * SECOND, fastForMs: MINUTE, slowIntervalMs: 20 * SECOND, giveUpAfterMs: 15 * MINUTE };

function docWith(status: HealthDocument['status']): HealthDocument {
  return {
    id: 'doc-x',
    profile_id: RESIDENT_ID,
    type: 'prescription',
    document_date: null,
    uploaded_at: new Date(T0).toISOString(),
    status,
    error: null,
    page_count: 1,
    file_url: null,
  };
}

type Check = { name: string; run: () => Promise<string> | string };

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const checks: Check[] = [
  {
    name: 'Nothing is readable before consent; consent unlocks it',
    run: async () => {
      const { service } = harness();
      assert((await service.getConsent()).given === false, 'consent should start withheld');
      assert((await errorKind(() => service.getRecord(RESIDENT_ID))) === 'invalid', 'record readable without consent');
      const consent = await service.setConsent(true);
      assert(consent.given && consent.given_at, 'consent not recorded');
      const record = await service.getRecord(RESIDENT_ID);
      return `consent at ${consent.given_at}; record for ${record.patient.name}`;
    },
  },
  {
    name: 'The resident’s record matches the API sample, with gaps',
    run: async () => {
      const { service } = await consented();
      const record = await service.getRecord(RESIDENT_ID);
      assert(record.patient.name === 'Ahmed' && record.patient.blood_type === null, 'patient differs');
      assert(record.allergies[0].severity === 'severe', 'severe penicillin allergy missing');
      const blood = record.gaps.find((g) => g.kind === 'missing_blood_type');
      const stale = record.gaps.find((g) => g.kind === 'stale_lab');
      assert(blood?.text === 'Blood type is not recorded.', 'blood type gap missing');
      assert(stale?.test === 'LDL cholesterol' && stale.text.includes('2024-03-01'), 'stale LDL gap missing or untagged');
      return record.gaps.map((g) => `${g.kind}${g.test ? `(${g.test})` : ''}`).join(', ');
    },
  },
  {
    name: 'The child’s nearly empty record shows its gaps',
    run: async () => {
      const { service } = await consented();
      const record = await service.getRecord(CHILD_ID);
      assert(record.allergies.length === 0 && record.medications.length === 0, 'child record not empty');
      const kinds = record.gaps.map((g) => g.kind);
      assert(kinds.includes('no_allergies_recorded') && kinds.includes('no_recent_labs'), `kinds ${kinds.join(',')}`);
      assert(!kinds.includes('missing_blood_type'), 'blood type is recorded for the child');
      return kinds.join(', ');
    },
  },
  {
    name: 'Gaps and failure reasons follow Accept-Language',
    run: async () => {
      const h = await consented();
      h.setLang('ar');
      const record = await h.service.getRecord(RESIDENT_ID);
      const failed = (await h.service.listDocuments(RESIDENT_ID)).find((d) => d.status === 'failed');
      assert(record.gaps.find((g) => g.kind === 'missing_blood_type')?.text === 'فصيلة الدم غير مسجلة.', 'Arabic blood type gap missing');
      assert(failed && failed.error && textDirection(failed.error, 'en') === 'rtl', 'failure reason not in Arabic');
      return record.gaps[0].text;
    },
  },
  {
    name: 'Seeded documents: one processing, one failed, one without its original',
    run: async () => {
      const { service } = await consented();
      const docs = await service.listDocuments(RESIDENT_ID);
      const statuses = docs.map((d) => d.status);
      assert(statuses.includes('processing') && statuses.includes('failed'), `statuses ${statuses.join(',')}`);
      assert(docs.some((d) => d.status === 'confirmed' && d.file_url === null), 'no confirmed document without original');
      assert(docs.find((d) => d.status === 'processing')?.extracted_items == null, 'processing document exposes items');
      return statuses.join(', ');
    },
  },
  {
    name: 'A document moves from processing to needs_review after ~20 s',
    run: async () => {
      const { service, clock } = await consented();
      assert((await service.getDocument('doc-009')).status === 'processing', 'should start processing');
      clock.advance(MOCK_TIMINGS.processing);
      const doc = await service.getDocument('doc-009');
      const items = doc.extracted_items ?? [];
      assert(doc.status === 'needs_review', `status ${doc.status}`);
      assert(items.some((i) => i.confidence === 'low'), 'no low-confidence item');
      assert(items.some((i) => i.possible_duplicate_of === 'm1'), 'no duplicate of m1');
      assert(doc.extracted_text, 'no extracted text');
      return `${items.length} items, ${items.filter((i) => i.confidence === 'low').length} low, duplicate of m1`;
    },
  },
  {
    name: 'Upload enforces the 10 page and 10 MB limits and reports progress',
    run: async () => {
      const { service, clock } = await consented();
      const eleven = Array.from({ length: 11 }, (_, i) => photo(`p${i}.jpg`));
      assert((await errorKind(() => service.uploadDocument(RESIDENT_ID, { files: eleven, type: 'other', document_date: null }))) === 'invalid', '11 pages accepted');
      assert(
        (await errorKind(() => service.uploadDocument(RESIDENT_ID, { files: [photo('big.jpg', 11 * 1024 * 1024)], type: 'other', document_date: null }))) === 'too_large',
        '11 MB accepted',
      );
      const progress: number[] = [];
      const result = await service.uploadDocument(
        RESIDENT_ID,
        { files: [photo('a.jpg'), photo('b.jpg')], type: 'lab_report', document_date: '2026-10-01' },
        { onProgress: (f) => progress.push(f) },
      );
      assert(result.status === 'processing', 'upload not processing');
      assert(progress.at(-1) === 1, 'progress never reached 100%');
      clock.advance(MOCK_TIMINGS.processing);
      const doc = await service.getDocument(result.id);
      assert(doc.status === 'needs_review' && doc.page_count === 2, `status ${doc.status}, pages ${doc.page_count}`);
      assert(doc.extracted_items?.some((i) => i.confidence === 'low'), 'upload has no low-confidence item');
      assert(doc.extracted_items?.some((i) => i.possible_duplicate_of), 'upload has no possible duplicate');
      return `${progress.length} progress steps; ${doc.extracted_items?.length} items read`;
    },
  },
  {
    name: 'Partial confirm saves only what was sent, from that document',
    run: async () => {
      const { service, clock } = await consented();
      clock.advance(MOCK_TIMINGS.processing);
      const before = await service.getRecord(RESIDENT_ID);
      const doc = await service.getDocument('doc-009');
      const visit = doc.extracted_items!.find((i) => i.section === 'visits')!;
      clock.advance(MINUTE);
      const after = await service.confirmDocument(doc.id, { items: [{ item_id: visit.item_id, data: visit.data, action: 'add' }] });
      const record = await service.getRecord(RESIDENT_ID);
      assert(after.status === 'needs_review', 'partial confirm finished the review');
      assert(after.extracted_items!.length === doc.extracted_items!.length - 1, 'confirmed item still pending');
      assert(record.visits.some((v) => v.source === 'doc-009'), 'visit not saved with its source');
      assert(record.record_updated_at > before.record_updated_at, 'record_updated_at unchanged');
      return `${after.extracted_items!.length} items left to review`;
    },
  },
  {
    name: '“Replace existing” replaces the duplicate rather than adding a second',
    run: async () => {
      const { service, clock } = await consented();
      clock.advance(MOCK_TIMINGS.processing);
      const doc = await service.getDocument('doc-009');
      const dup = doc.extracted_items!.find((i) => i.possible_duplicate_of === 'm1')!;
      const edited = { ...(dup.data as object), dose: '1000 mg' } as ExtractedItem['data'];
      const done = await service.confirmDocument(doc.id, {
        items: [{ item_id: dup.item_id, data: edited, action: 'replace', replace_id: 'm1' }],
        finished: true,
      });
      const meds = (await service.getRecord(RESIDENT_ID)).medications.filter((m) => m.name === 'Metformin');
      assert(meds.length === 1 && meds[0].id === 'm1' && meds[0].dose === '1000 mg', 'Metformin duplicated or not replaced');
      assert(done.status === 'confirmed', 'finished review not confirmed');
      return `Metformin now ${meds[0].dose}; document ${done.status}`;
    },
  },
  {
    name: 'A summary is made in the background: writing, recording, then ready',
    run: async () => {
      const { service, clock } = await consented();
      const record = await service.getRecord(RESIDENT_ID);
      const general = await service.getSummary(RESIDENT_ID, 'ar', 'general');
      assert(general?.status === 'ready' && !summaryIsStale(general, record.record_updated_at), 'seeded general Arabic summary not ready');
      const oldEnglish = await service.getSummary(RESIDENT_ID, 'en');
      assert(oldEnglish?.status === 'ready' && summaryIsStale(oldEnglish, record.record_updated_at), 'seeded English summary should be stale');

      const request = { lang: 'ar', specialty: 'cardiology', consent: true, async: true } as const;
      const started = await service.generateSummary(RESIDENT_ID, request);
      assert(started.status === 'generating' && started.phase === 'writing', `started as ${started.status}`);
      const again = await service.generateSummary(RESIDENT_ID, request);
      assert(again.status === 'generating' && again.started_at === started.started_at, 'asking again started a second job');

      clock.advance(MOCK_TIMINGS.summaryWriting);
      const recording = await service.getSummary(RESIDENT_ID, 'ar', 'cardiology');
      assert(recording?.status === 'generating' && recording.phase === 'recording', `phase ${JSON.stringify(recording)}`);

      clock.advance(MOCK_TIMINGS.summaryRecording);
      const ready = await service.getSummary(RESIDENT_ID, 'ar', 'cardiology');
      assert(ready?.status === 'ready' && !ready.cached, 'not ready after both phases');
      assert(textDirection(ready.transcript, 'en') === 'rtl', 'Arabic transcript not right-to-left');
      assert(!summaryIsStale(ready, record.record_updated_at), 'fresh summary marked stale');
      const reused = await service.generateSummary(RESIDENT_ID, request);
      assert(reused.status === 'ready' && reused.cached, 'an unchanged record made a new summary');
      const newest = await service.getSummary(RESIDENT_ID, 'ar');
      assert(newest?.specialty === 'cardiology', 'newest Arabic summary is not the cardiology one');
      return `${started.phase} → ${recording.phase} → ready, then reused`;
    },
  },
  {
    name: 'One job at a time; a record change queues a fresh general summary',
    run: async () => {
      const { service, clock } = await consented();
      const first = await service.generateSummary(RESIDENT_ID, { lang: 'en', specialty: 'cardiology', consent: true, async: true });
      const second = await service.generateSummary(RESIDENT_ID, { lang: 'en', specialty: 'neurology', consent: true, async: true });
      assert(first.status === 'generating' && first.phase === 'writing', 'first job not writing');
      assert(second.status === 'generating' && second.phase === 'waiting', 'second job not waiting');
      await service.createItem(RESIDENT_ID, 'allergies', { substance: 'Latex', reaction: null, severity: 'mild' });
      const updating = await service.getSummary(RESIDENT_ID, 'ar', 'general');
      assert(updating?.status === 'generating', 'a record change did not start a general summary');
      const newestAr = await service.getSummary(RESIDENT_ID, 'ar');
      assert(newestAr?.status === 'generating', 'newest Arabic summary should be the one being prepared');
      clock.advance(MOCK_TIMINGS.summaryWriting + MOCK_TIMINGS.summaryRecording);
      const done = await service.getSummary(RESIDENT_ID, 'en', 'cardiology');
      const next = await service.getSummary(RESIDENT_ID, 'en', 'neurology');
      assert(done?.status === 'ready', 'first job not done');
      assert(next?.status === 'generating' && next.phase === 'writing', 'second job did not start next');
      return 'queued in order';
    },
  },
  {
    name: 'A failed summary says why, and trying again works',
    run: async () => {
      const { service, clock } = await consented();
      const total = MOCK_TIMINGS.summaryWriting + MOCK_TIMINGS.summaryRecording;
      const request = { lang: 'en', specialty: null, consent: true, async: true } as const;
      await service.generateSummary(CHILD_ID, request);
      clock.advance(total);
      const failed = await service.getSummary(CHILD_ID, 'en', 'general');
      assert(failed?.status === 'failed' && failed.error.length > 0, `expected a failure, got ${failed?.status}`);
      const retry = await service.generateSummary(CHILD_ID, request);
      assert(retry.status === 'generating', 'retry did not start a job');
      clock.advance(total);
      const ready = await service.getSummary(CHILD_ID, 'en', 'general');
      assert(ready?.status === 'ready', 'retry did not finish');
      return failed.error;
    },
  },
  {
    name: 'No summary yet in a language answers “none”, not an error',
    run: async () => {
      const { service } = await consented();
      assert((await service.getSummary(CHILD_ID, 'ar')) === null, 'child has an Arabic summary already');
      return 'none';
    },
  },
  {
    name: 'Deleting a document keeps or deletes its items, as chosen',
    run: async () => {
      const keep = await consented();
      await keep.service.deleteDocument('doc-003', false);
      const kept = (await keep.service.getRecord(RESIDENT_ID)).allergies.find((a) => a.id === 'a1');
      assert(kept && kept.source === null, 'kept allergy should become manual');
      const drop = await consented();
      await drop.service.deleteDocument('doc-003', true);
      const dropped = (await drop.service.getRecord(RESIDENT_ID)).allergies.find((a) => a.id === 'a1');
      assert(!dropped, 'allergy should be deleted with its document');
      return 'kept as manual / deleted';
    },
  },
  {
    name: 'Withdrawing consent deletes the health data',
    run: async () => {
      const { service } = await consented();
      await service.setConsent(false);
      await service.setConsent(true);
      const profiles = await service.listProfiles();
      const record = await service.getRecord(profiles[0].id);
      const docs = await service.listDocuments(profiles[0].id);
      assert(profiles.length === 1 && record.allergies.length === 0 && docs.length === 0, 'data survived withdrawal');
      return `${profiles.length} profile, empty record`;
    },
  },
  {
    name: 'The AI server can be busy (503)',
    run: async () => {
      const { service } = await consented({ busyRate: 1 });
      const kind = await errorKind(() => service.getRecord(RESIDENT_ID));
      assert(kind === 'busy', `got ${kind}`);
      return 'busy';
    },
  },
  {
    name: 'Polling schedules for documents and summaries',
    run: () => {
      const at = (ms: number) => nextPollDelay(ms, SCHEDULE);
      assert(at(0) === 5 * SECOND && at(59 * SECOND) === 5 * SECOND, 'fast phase wrong');
      assert(at(MINUTE) === 20 * SECOND && at(10 * MINUTE) === 20 * SECOND, 'slow phase wrong');
      assert(at(15 * MINUTE - 5 * SECOND) === 5 * SECOND, 'last check overruns the deadline');
      assert(at(15 * MINUTE) === null, 'never gives up');
      const summary = (ms: number) => nextPollDelay(ms, healthConfig.summaryPoll);
      assert(summary(0) === 5 * SECOND && summary(MINUTE) === 10 * SECOND, 'summary schedule wrong');
      assert(summary(19 * MINUTE) === 10 * SECOND && summary(20 * MINUTE) === null, 'summary deadline wrong');
      return 'documents 5 s → 20 s → stop at 15 min; summaries 5 s → 10 s → stop at 20 min';
    },
  },
  {
    name: 'The poller reports a document ready exactly once, then stops',
    run: async () => {
      const timers = fakeTimers();
      let calls = 0;
      const settled: string[] = [];
      const poller = new StatusPoller<HealthDocument>({
        schedule: SCHEDULE,
        ...timers,
        isPending: (doc) => doc.status === 'processing',
        fetch: async () => {
          calls += 1;
          return docWith(calls >= 3 ? 'needs_review' : 'processing');
        },
        onUpdate: () => undefined,
        onSettled: (doc) => settled.push(doc.status),
        onGiveUp: () => undefined,
      });
      poller.track('doc-x', T0);
      await timers.advance(30 * SECOND);
      assert(settled.length === 1 && settled[0] === 'needs_review', `settled ${settled.join(',')}`);
      assert(calls === 3 && !poller.isTracking('doc-x') && timers.pending() === 0, `calls ${calls}`);
      return `${calls} checks, ready after ${calls * 5} s`;
    },
  },
  {
    name: 'A running summary is followed until ready, at the summary pace',
    run: async () => {
      const timers = fakeTimers();
      const phases: SummaryState['status'][] = ['generating', 'generating', 'generating', 'ready'];
      const asked: number[] = [];
      const settled: string[] = [];
      const poller = new StatusPoller<SummaryState>({
        schedule: healthConfig.summaryPoll,
        ...timers,
        isPending: (state) => state.status === 'generating',
        fetch: async () => {
          asked.push(timers.now() - T0);
          const status = phases[Math.min(asked.length - 1, phases.length - 1)];
          return { status, lang: 'ar', specialty: 'general' } as SummaryState;
        },
        onUpdate: () => undefined,
        onSettled: (state, key) => settled.push(`${key}:${state.status}`),
        onGiveUp: () => undefined,
      });
      poller.track('res-0001|ar|general', T0);
      await timers.advance(2 * MINUTE);
      assert(settled.length === 1 && settled[0] === 'res-0001|ar|general:ready', `settled ${settled.join(',')}`);
      assert(asked.join(',') === '5000,10000,15000,20000', `asked at ${asked.join(',')}`);
      return `ready after ${asked.length} checks`;
    },
  },
  {
    name: 'No polling in the background; returning checks at once',
    run: async () => {
      const timers = fakeTimers();
      let calls = 0;
      const poller = new StatusPoller<HealthDocument>({
        schedule: SCHEDULE,
        ...timers,
        isPending: (doc) => doc.status === 'processing',
        fetch: async () => {
          calls += 1;
          return docWith('processing');
        },
        onUpdate: () => undefined,
        onSettled: () => undefined,
        onGiveUp: () => undefined,
      });
      poller.track('doc-x', T0);
      poller.setForeground(false);
      await timers.advance(2 * MINUTE);
      const checks = () => calls;
      assert(checks() === 0 && timers.pending() === 0, `polled ${checks()} times in the background`);
      poller.setForeground(true);
      await timers.advance(0);
      assert(checks() === 1, `expected an immediate check, got ${checks()}`);
      assert(timers.pending() === 1, 'schedule not resumed');
      poller.clear();
      return 'paused, then one check on return';
    },
  },
  {
    name: 'After 15 minutes the poller gives up (“Taking longer than expected”)',
    run: async () => {
      const timers = fakeTimers();
      const gaveUp: string[] = [];
      let calls = 0;
      const poller = new StatusPoller<HealthDocument>({
        schedule: SCHEDULE,
        ...timers,
        isPending: (doc) => doc.status === 'processing',
        fetch: async () => {
          calls += 1;
          return docWith('processing');
        },
        onUpdate: () => undefined,
        onSettled: () => undefined,
        onGiveUp: (id) => gaveUp.push(id),
      });
      poller.track('doc-x', T0);
      await timers.advance(16 * MINUTE);
      assert(gaveUp.length === 1 && !poller.isTracking('doc-x'), 'did not give up');
      // 12 checks in the first minute, then every 20 s for the remaining 14.
      assert(calls >= 50 && calls <= 56, `unexpected ${calls} checks`);
      return `${calls} checks, then stopped`;
    },
  },
  {
    name: 'Review: low confidence first; “confirm all” waits for flagged items',
    run: async () => {
      const { service, clock } = await consented();
      clock.advance(MOCK_TIMINGS.processing);
      const doc = await service.getDocument('doc-009');
      let entries = startReview(doc.extracted_items!);
      assert(entries[0].item.confidence === 'low', 'low-confidence item not first');
      assert(!canConfirmAll(entries), 'gate open before flagged items were checked');
      const low = entries[0].item.item_id;
      const dup = entries.find((e) => e.item.possible_duplicate_of)!.item.item_id;
      assert(!canConfirm(entries.find((e) => e.item.item_id === dup)!), 'duplicate confirmable without a choice');
      entries = update(entries, low, { state: 'removed' });
      assert(!canConfirmAll(entries), 'gate open before the duplicate was decided');
      entries = update(entries, dup, { duplicate: 'replace', state: 'confirmed' });
      assert(canConfirmAll(entries), 'gate still closed');
      entries = confirmRemaining(entries);
      const input = toConfirmInput(entries, true);
      assert(input.items.some((i) => i.item_id === low && i.action === 'reject'), 'removed item not sent as reject');
      assert(input.items.some((i) => i.action === 'replace' && i.replace_id === 'm1'), 'replace not sent');
      assert(input.finished === true, 'not finished');
      return `${input.items.length} decisions sent, ${savedCount(input)} saved`;
    },
  },
  {
    name: 'A rejected item is dropped for good, even on a partial save',
    run: async () => {
      const { service, clock } = await consented();
      clock.advance(MOCK_TIMINGS.processing);
      const doc = await service.getDocument('doc-009');
      const low = doc.extracted_items!.find((i) => i.confidence === 'low')!;
      const before = await service.getRecord(RESIDENT_ID);
      const after = await service.confirmDocument(doc.id, { items: [{ item_id: low.item_id, action: 'reject' }] });
      const record = await service.getRecord(RESIDENT_ID);
      assert(after.status === 'needs_review', 'a partial save closed the review');
      assert(!after.extracted_items!.some((i) => i.item_id === low.item_id), 'rejected item offered again');
      assert(!record.medications.some((m) => m.name === 'Atorvastatin'), 'rejected item was saved');
      assert(record.record_updated_at === before.record_updated_at, 'a reject alone changed the record');
      return `${after.extracted_items!.length} items left to review`;
    },
  },
  {
    name: 'Manual entry: future dates, numbers and date order are checked',
    run: () => {
      const now = T0;
      const lab = { ...emptyDraft('labs'), test: 'HbA1c', value: 'seven', date: '2030-01-01' };
      const labErrors = validateDraft('labs', lab, now);
      assert(labErrors.value === 'number' && labErrors.date === 'future', JSON.stringify(labErrors));
      const med = { ...emptyDraft('medications'), name: 'Metformin', start: '2024-05-01', end: '2024-04-01', stillTaking: 'no' };
      assert(validateDraft('medications', med, now).end === 'endBeforeStart', 'end before start accepted');
      const planned = { ...med, start: '2026-10-20', end: '2026-11-03' };
      assert(!validateDraft('medications', planned, now).end, 'a planned end date was refused');
      assert(validateDraft('medications', { ...planned, start: '2026-12-01' }, now).start === 'future', 'future start accepted');
      assert(isoFromDate(dateFromIso('2024-02-29')) === '2024-02-29', 'picker date round trip changed the day');
      assert(checkDate('2026-02-30', now) === 'format', 'impossible date accepted');
      const arabic = dataFrom('labs', { ...emptyDraft('labs'), test: 'HbA1c', value: '٧٫٦', date: '2026-08-19' });
      assert(arabic.value === 7.6 && parseNumber('7,6') === 7.6, 'Arabic digits not parsed');
      return 'all caught';
    },
  },
  {
    name: 'Presentation helpers: direction, lab flags, grouping, gap shortcuts',
    run: async () => {
      assert(textDirection('Metformin 500 mg', 'ar') === 'ltr' && textDirection('ميتفورمين', 'en') === 'rtl', 'direction');
      assert(labFlag({ value: 7.6, ref_high: 5.7 }) === 'high' && labFlag({ value: 60, ref_low: 70 }) === 'low', 'flags');
      const { service } = await consented();
      const groups = groupLabs((await service.getRecord(RESIDENT_ID)).labs);
      const hba1c = groups.find((g) => g.test === 'HbA1c')!;
      assert(hba1c.results.length === 3 && hba1c.results[0].date === '2026-08-19', 'HbA1c not grouped newest first');
      assert(gapFix({ kind: 'missing_blood_type', text: '' }).kind === 'profile', 'blood type fix');
      const stale = gapFix({ kind: 'stale_lab', text: '', test: 'LDL cholesterol' });
      assert(stale.kind === 'add' && stale.section === 'labs' && stale.labTest === 'LDL cholesterol', 'stale lab fix');
      const recent = gapFix({ kind: 'no_recent_labs', text: '' });
      assert(recent.kind === 'upload' && recent.type === 'lab_report', 'recent labs fix');
      const allergy = gapFix({ kind: 'no_allergies_recorded', text: '' });
      assert(allergy.kind === 'add' && allergy.section === 'allergies', 'allergy fix');
      return `${groups.length} lab groups`;
    },
  },
];

export async function runHealthChecks(): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  for (const [index, check] of checks.entries()) {
    try {
      results.push({ id: index + 1, name: check.name, passed: true, detail: await check.run() });
    } catch (error) {
      results.push({ id: index + 1, name: check.name, passed: false, detail: error instanceof Error ? error.message : String(error) });
    }
  }
  return results;
}
