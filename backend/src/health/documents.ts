import { randomUUID } from 'node:crypto';

import { generateJson, nullable, type Media } from '../integrations/ai/model.ts';
import { ApiError } from '../errors.ts';
import { transaction } from '../ems/db.ts';
import { normalize } from '../lib/text.ts';
import { seal, unseal } from '../ems/secrets.ts';
import { log } from '../log.ts';
import {
  completeDocumentReading,
  deleteHealthDocument,
  failDocumentReading,
  findHealthDocument,
  insertHealthDocument,
  listProcessingDocumentIds,
  listProfileDocuments,
  updateDocumentReview,
  type DocumentRow,
} from '../repositories/healthDocuments.ts';
import { clearHealthItemsSource, deleteHealthItemsFromSource, replaceHealthItem } from '../repositories/healthItems.ts';
import { readStoredFile, removeFiles, signedUrl, storeFile } from './files.ts';
import { enqueue } from './jobs.ts';
import { cleanItem, insertItem, isSection, profileFor, readSections, touch, type Access, type HealthLang, type Section } from './passport.ts';

/**
 * Health Passport documents: the resident photographs or uploads a medical
 * paper, the AI reads it page by page into record items, and the resident
 * checks every item before anything is saved (confirm). Pages are kept
 * sealed so the resident can compare the items with the original.
 *
 * The AI never writes to the record. What it read waits in the document
 * (`extracted_items`) with a confidence and, where it looks like something
 * already recorded, the item it may repeat.
 */

export const DOCUMENT_SYSTEM_PROMPT = `ROLE
You are a meticulous medical records clerk in Egypt. You read one medical document (a prescription,
lab report, discharge summary, imaging report, or other medical paper) and convert it into
structured data for the patient's record. A doctor will rely on this data, and the patient will
check it before it is saved, so accuracy matters more than completeness: never guess.

The document may be printed or handwritten, in Arabic, English, or both, photographed at an angle,
with stamps, logos and signatures. Ignore letterheads, addresses, phone numbers, logos and stamps
except for the clinic or doctor specialty and the document date.

OUTPUT: exactly ONE JSON object, no text before or after it:
{
  "document_date": "YYYY-MM-DD or null",
  "text": "faithful transcription",
  "items": [ {"section": "...", "data": {...}, "confidence": "high" or "low"} ]
}

"text": transcribe all readable medical content line by line, in the original language(s),
keeping numbers and units exactly as printed. Write [unreadable] for parts you cannot read.

ITEM TYPES ("section" and its "data")
- "medications": {"name", "dose", "frequency", "start", "end"}
  name: the drug exactly as written, brand or generic; do not convert brands to generics; add the
  form only if it is part of the name. dose: strength per unit as written, e.g. "500 mg", "5 ml",
  "1000 IU". frequency: plain English, e.g. "once daily", "twice daily", "three times daily as
  needed", "once daily at night", "once daily for 3 days". start: the prescription date. end: null.
- "allergies": {"substance", "reaction", "severity"}  only when an allergy is explicitly stated.
  severity only if written (mild, moderate, severe), otherwise null. "No known allergies" is not an item.
- "conditions": {"name", "diagnosed", "status"}  only diagnoses explicitly written as a diagnosis
  (Diagnosis, Dx, Final diagnosis, Impression, التشخيص). Not symptoms, not lab comments, not
  "rule out" or "suspected". name in English (translate Arabic diagnoses). diagnosed: the document
  date. status: "active" unless the document says resolved or history of.
- "procedures": {"name", "date"}  operations, endoscopies, catheterisations, and imaging studies
  (e.g. "Chest X-ray", "Abdominal ultrasound", "Brain MRI"). For an imaging report, also add each
  diagnosis stated in its Impression as a "conditions" item.
- "labs": {"test", "value", "unit", "date", "ref_low", "ref_high"}  one item per test result.
  test: the standard short English name, e.g. "HbA1c", "Fasting blood glucose", "Creatinine"
  (not "Serum creatinine"), "Hemoglobin", "LDL cholesterol", "HDL cholesterol", "Triglycerides",
  "Total cholesterol", "TSH", "Free T4", "Vitamin D", "ALT", "AST", "Platelet count", "WBC count".
  value: a plain number only. If the result is not a plain number (e.g. "<0.01", "Negative",
  "Positive", "+++", "Trace"), do NOT create a lab item; it stays in "text".
  unit: exactly as printed (mg/dL, mmol/L, %, g/dL, x10^3/uL, mIU/L, ng/mL).
  Reference range: "70 - 100" means ref_low 70, ref_high 100; "< 200" means ref_low null,
  ref_high 200; "> 40" means ref_low 40, ref_high null. Ignore H/L flags; they are computed.
  date: the sample or report date.
- "visits": {"date", "specialty", "reason"}  one per consultation or hospital stay described:
  a prescription is a visit to the prescribing doctor (specialty from the letterhead, reason =
  the diagnosis if written); a discharge summary is an admission (date = admission date, reason
  = reason for admission).

EGYPTIAN CONVENTIONS
- Dates are written DAY/MONTH/YEAR: "02/09/2026" is 2 September 2026, "2026-09-02". Never read
  them month-first. Convert every date to YYYY-MM-DD; if only month and year, use YYYY-MM.
- Arabic-Indic digits (٠١٢٣٤٥٦٧٨٩) are normal digits; "٫" is a decimal point.
- Dosing notation "1 x 3" or "1×3" = 1 unit three times daily; "1 x 2" = twice daily;
  "1 x 1" = once daily. "قبل الأكل" = before meals, "بعد الأكل" = after meals,
  "عند اللزوم" = as needed, "مساءً" / "قبل النوم" = at night, "صباحاً" = in the morning,
  "لمدة 5 أيام" = for 5 days. Put these into "frequency" in English.
- Abbreviations: OD = once daily, BID = twice daily, TID = three times daily, QID = four times
  daily, PRN = as needed, HS = at night, tab = tablet, cap = capsule, amp = ampoule.

DATES OF ITEMS
"document_date" is the date printed on the document (prescription date, report date, discharge
date). Use it for items that have no date of their own. For labs, prefer the sample date.

CONFIDENCE
Use "high" only when the item is printed clearly and every field is certain. Use "low" when
anything is handwritten, blurred, cut off, or partly covered by a stamp; when a digit could be
read two ways (1/7, 0/6, 5/6); when the dose looks unusual for that drug; or when you had to
interpret an abbreviation. When in doubt, use "low": the patient will check it.

STRICT RULES
- Only what is written. Never add a drug, test, value, unit, date or diagnosis that is not on the
  page, and never correct a value you think is wrong.
- Do not repeat the same item twice. One item per drug and per test result.
- If this is page N of several, extract only what is on this page.
- If nothing medical is readable, return {"document_date": null, "text": "", "items": []}.`;

export const DOCUMENT_TYPES = ['prescription', 'lab_report', 'discharge_summary', 'imaging_report', 'other'] as const;
export const UPLOAD_LIMITS = { maxPages: 10, maxFileBytes: 10 * 1024 * 1024 } as const;
const PAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf']);

// ---- The answer's schema ------------------------------------------------------------------

const text = { type: 'string' };
const optionalText = nullable(text);
const optionalNumber = nullable({ type: 'number' });
const object = (properties: Record<string, unknown>) => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties });
const item = (section: Section, data: Record<string, unknown>) =>
  object({ section: { type: 'string', enum: [section] }, data: object(data), confidence: { type: 'string', enum: ['high', 'low'] } });

const SCHEMA = object({
  document_date: optionalText,
  text,
  items: {
    type: 'array',
    items: {
      anyOf: [
        item('medications', { name: text, dose: optionalText, frequency: optionalText, start: optionalText, end: optionalText }),
        item('allergies', { substance: text, reaction: optionalText, severity: nullable({ type: 'string', enum: ['mild', 'moderate', 'severe'] }) }),
        item('conditions', { name: text, diagnosed: optionalText, status: { type: 'string', enum: ['active', 'resolved'] } }),
        item('procedures', { name: text, date: optionalText }),
        item('labs', { test: text, value: { type: 'number' }, unit: optionalText, date: optionalText, ref_low: optionalNumber, ref_high: optionalNumber }),
        item('visits', { date: optionalText, specialty: optionalText, reason: optionalText }),
      ],
    },
  },
});

interface PageReading {
  document_date: string | null;
  text: string;
  items: { section: string; data: Record<string, unknown>; confidence: 'high' | 'low' }[];
}

export interface ExtractedItem {
  item_id: string;
  section: Section;
  data: Record<string, unknown>;
  confidence: 'high' | 'low';
  possible_duplicate_of: string | null;
}

// ---- Turning a reading into reviewable items --------------------------------------------------

/** YYYY-MM-DD as is; a month alone (YYYY-MM) becomes its first day, and the item is marked for checking. */
function dateOf(value: unknown): { date: string | null; uncertain: boolean } {
  if (typeof value !== 'string') return { date: null, uncertain: false };
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed) && !Number.isNaN(Date.parse(trimmed))) return { date: trimmed, uncertain: false };
  if (/^\d{4}-\d{2}$/.test(trimmed) && !Number.isNaN(Date.parse(`${trimmed}-01`))) return { date: `${trimmed}-01`, uncertain: true };
  return { date: null, uncertain: trimmed !== '' };
}

const textOf = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim().slice(0, 200) : null);
const numberOf = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : null);

/**
 * One read item as the app's item data, or null when it lacks what the
 * section needs. Missing dates take the document's; anything uncertain
 * (a month-only date, an allergy without a written severity, a lab without
 * a date) is lowered to "low" confidence so the resident checks it by hand.
 */
export function toItemData(section: Section, raw: Record<string, unknown>, documentDate: string | null): { data: Record<string, unknown>; uncertain: boolean } | null {
  let uncertain = false;
  const date = (value: unknown, fallback: string | null = documentDate) => {
    const parsed = dateOf(value);
    if (parsed.uncertain) uncertain = true;
    return parsed.date ?? fallback;
  };
  switch (section) {
    case 'medications': {
      const name = textOf(raw.name);
      if (!name) return null;
      return { data: { name, dose: textOf(raw.dose), frequency: textOf(raw.frequency), start: date(raw.start), end: date(raw.end, null) }, uncertain };
    }
    case 'allergies': {
      const substance = textOf(raw.substance);
      if (!substance) return null;
      const severity = ['mild', 'moderate', 'severe'].includes(String(raw.severity)) ? raw.severity : null;
      // Left empty, not guessed: the resident chooses it when checking the item.
      if (!severity) uncertain = true;
      return { data: { substance, reaction: textOf(raw.reaction), severity }, uncertain };
    }
    case 'conditions': {
      const name = textOf(raw.name);
      if (!name) return null;
      return { data: { name, diagnosed: date(raw.diagnosed), status: raw.status === 'resolved' ? 'resolved' : 'active' }, uncertain };
    }
    case 'procedures': {
      const name = textOf(raw.name);
      if (!name) return null;
      return { data: { name, date: date(raw.date) }, uncertain };
    }
    case 'labs': {
      const test = textOf(raw.test);
      const value = numberOf(raw.value);
      if (!test || value === null) return null;
      const on = date(raw.date);
      if (!on) uncertain = true;
      return { data: { test, value, unit: textOf(raw.unit), date: on, ref_low: numberOf(raw.ref_low), ref_high: numberOf(raw.ref_high) }, uncertain };
    }
    case 'visits': {
      const on = date(raw.date);
      if (!on) return null;
      return { data: { date: on, specialty: textOf(raw.specialty), reason: textOf(raw.reason) }, uncertain };
    }
  }
}

/** The record item this one may repeat: same medicine, allergy, condition or procedure; the same lab result; a visit on the same day. */
function duplicateKey(section: Section, data: Record<string, unknown>): string {
  const n = (value: unknown) => normalize(String(value ?? ''));
  switch (section) {
    case 'medications':
    case 'conditions':
    case 'procedures':
      return n(data.name);
    case 'allergies':
      return n(data.substance);
    case 'labs':
      return `${n(data.test)}|${data.date}|${data.value}`;
    case 'visits':
      return `${data.date}|${n(data.specialty)}`;
  }
}

function review(pages: PageReading[], profileId: string, documentDate: string | null): ExtractedItem[] {
  const record = readSections(profileId);
  const items: ExtractedItem[] = [];
  const seen = new Set<string>();
  for (const page of pages) {
    for (const raw of page.items ?? []) {
      if (!isSection(raw.section) || !raw.data || typeof raw.data !== 'object') continue;
      const read = toItemData(raw.section, raw.data, documentDate);
      if (!read) continue;
      const key = duplicateKey(raw.section, read.data);
      const signature = `${raw.section}|${JSON.stringify(read.data)}`;
      if (seen.has(signature)) continue;
      seen.add(signature);
      const existing = record[raw.section].find((entry) => duplicateKey(raw.section as Section, entry) === key);
      items.push({
        item_id: randomUUID().slice(0, 8),
        section: raw.section,
        data: read.data,
        confidence: raw.confidence === 'high' && !read.uncertain ? 'high' : 'low',
        possible_duplicate_of: existing?.id ?? null,
      });
    }
  }
  return items;
}

// ---- Storage, reading and review ---------------------------------------------------------

const ERROR_TEXT: Record<string, Record<HealthLang, string>> = {
  unreadable: {
    en: 'The photos are too blurry to read. Try again in good light, with the whole page in the frame.',
    ar: 'الصور غير واضحة بما يكفي للقراءة. حاول مرة أخرى في إضاءة جيدة مع ظهور الصفحة كاملة.',
  },
  reading_failed: {
    en: 'The document couldn’t be read right now. Upload it again in a few minutes.',
    ar: 'تعذّرت قراءة المستند الآن. ارفعه مرة أخرى بعد دقائق.',
  },
};

const now = () => new Date().toISOString();

/** A document of a profile the resident may use as `need` asks, or 404/403. */
export function documentFor(userId: string, docId: string, need: Access): DocumentRow {
  const row = findHealthDocument(docId);
  if (!row) throw new ApiError('not_found', 'Document not found.');
  profileFor(userId, row.profile_id, need);
  return row;
}

/** The document as the app reads it (src/services/health/health.types.ts, HealthDocument). */
export function presentDocument(row: DocumentRow, lang: HealthLang, base: string) {
  const pages = JSON.parse(row.pages) as { file: string; mime: string }[];
  const readable = row.status === 'needs_review' || row.status === 'confirmed';
  return {
    id: row.id,
    profile_id: row.profile_id,
    type: row.type,
    document_date: row.document_date,
    uploaded_at: row.uploaded_at,
    status: row.status,
    error: row.status === 'failed' ? (ERROR_TEXT[row.error_code ?? '']?.[lang] ?? ERROR_TEXT.reading_failed[lang]) : null,
    page_count: pages.length,
    file_url: pages.length ? signedUrl(base, `/health/media/document/${row.id}/1`) : null,
    extracted_text: readable && row.extracted_text ? unseal(row.extracted_text) : null,
    extracted_items: row.status === 'needs_review' && row.extracted_items ? (JSON.parse(unseal(row.extracted_items)) as ExtractedItem[]) : readable ? [] : null,
  };
}

export function listDocuments(userId: string, profileId: string, lang: HealthLang, base: string) {
  profileFor(userId, profileId, 'view');
  return listProfileDocuments(profileId).map((row) => presentDocument(row, lang, base));
}

export interface UploadedPage {
  name: string;
  mimeType: string;
  bytes: Buffer;
}

/** Stores the pages and queues the reading; the document is `processing` until it is read. */
export function createDocument(userId: string, profileId: string, input: { type: unknown; document_date: unknown; pages: UploadedPage[] }) {
  profileFor(userId, profileId, 'edit');
  if (!DOCUMENT_TYPES.includes(input.type as (typeof DOCUMENT_TYPES)[number])) {
    throw new ApiError('invalid', 'Choose the type of document.', 'type');
  }
  if (input.pages.length === 0 || input.pages.length > UPLOAD_LIMITS.maxPages) {
    throw new ApiError('invalid', 'A document has 1 to 10 pages.', 'files');
  }
  for (const page of input.pages) {
    if (page.bytes.length > UPLOAD_LIMITS.maxFileBytes) throw new ApiError('too_large', 'A file is larger than 10 MB.');
    if (!PAGE_TYPES.has(page.mimeType)) throw new ApiError('invalid', 'Upload photos (JPEG, PNG, HEIC) or a PDF.', 'files');
  }
  const given = input.document_date ? dateOf(input.document_date) : { date: null, uncertain: false };
  if (input.document_date && (!given.date || given.uncertain)) throw new ApiError('invalid', 'document_date must be a date (YYYY-MM-DD).', 'document_date');

  const id = randomUUID();
  const pages = input.pages.map((page) => ({ file: storeFile(page.bytes), mime: page.mimeType }));
  const at = now();
  insertHealthDocument({ id, profileId, type: input.type as string, documentDate: given.date, pages: JSON.stringify(pages), at });
  queueReading(id);
  return { id, status: 'processing' as const };
}

export function queueReading(docId: string): void {
  enqueue(`document:${docId}`, () => readDocument(docId));
}

/** The background job: each page read on its own, the readings merged, then waiting for the resident. */
async function readDocument(docId: string): Promise<void> {
  const row = findHealthDocument(docId);
  if (!row || row.status !== 'processing') return;
  const pages = JSON.parse(row.pages) as { file: string; mime: string }[];
  const readings: PageReading[] = [];
  try {
    for (const [index, page] of pages.entries()) {
      const bytes = readStoredFile(page.file);
      if (!bytes) throw new ApiError('internal', 'A stored page is missing.');
      const media: Media[] = [{ mimeType: page.mime, data: bytes }];
      const hints = [
        `The patient chose the document type: ${row.type.replace(/_/g, ' ')}.`,
        row.document_date ? `The patient gave the document date as ${row.document_date}.` : 'The patient did not give a date.',
        `This is page ${index + 1} of ${pages.length}.`,
      ];
      const { value } = await generateJson<PageReading>({
        purpose: 'document_reading',
        task: 'documents',
        system: DOCUMENT_SYSTEM_PROMPT,
        prompt: `Read this page and return the JSON object.\n${hints.join('\n')}`,
        media,
        schema: SCHEMA,
        maxTokens: 32_768,
      });
      readings.push(value);
    }
  } catch (error) {
    log.warn('Document reading failed', { pages: pages.length, reason: error instanceof ApiError ? error.code : 'unexpected' });
    failDocumentReading(docId, 'reading_failed', now());
    return;
  }

  const documentDate = row.document_date ?? readings.map((reading) => dateOf(reading.document_date)).find((parsed) => parsed.date && !parsed.uncertain)?.date ?? null;
  const transcript = readings
    .map((reading, index) => (pages.length > 1 ? `— ${index + 1} —\n${reading.text ?? ''}` : (reading.text ?? '')))
    .join('\n\n')
    .trim();
  const items = review(readings, row.profile_id, documentDate);
  if (!transcript && items.length === 0) {
    failDocumentReading(docId, 'unreadable', now());
    return;
  }
  completeDocumentReading(docId, { documentDate, extractedText: seal(transcript), extractedItems: seal(JSON.stringify(items)), updatedAt: now() });
}

/**
 * The resident's decisions on read items, as the mock does them: add,
 * replace an existing item, or reject (dropped for good). Each saved item is
 * validated like a typed one and remembers the document as its source.
 */
export function confirmDocument(userId: string, docId: string, body: Record<string, unknown>) {
  return transaction(() => {
    const row = documentFor(userId, docId, 'edit');
    if (row.status !== 'needs_review') throw new ApiError('invalid', 'This document is not waiting for review.');
    const pending = row.extracted_items ? (JSON.parse(unseal(row.extracted_items)) as ExtractedItem[]) : [];
    const decisions = Array.isArray(body.items) ? (body.items as Record<string, unknown>[]) : [];
    let changed = false;
    for (const decision of decisions) {
      const read = pending.find((entry) => entry.item_id === decision.item_id);
      if (!read) throw new ApiError('invalid', `Unknown item ${String(decision.item_id)}.`, 'items');
      if (decision.action === 'reject') continue;
      const data = cleanItem(read.section, (decision.data ?? {}) as Record<string, unknown>);
      if (decision.action === 'replace') {
        const replaced = replaceHealthItem({
          id: String(decision.replace_id ?? ''),
          profileId: row.profile_id,
          section: read.section,
          data: seal(JSON.stringify(data)),
          source: docId,
          updatedAt: now(),
        });
        if (!replaced) throw new ApiError('invalid', 'The item to replace no longer exists.', 'replace_id');
      } else if (decision.action === 'add') {
        insertItem(row.profile_id, read.section, data, docId);
      } else {
        throw new ApiError('invalid', 'action must be add, replace or reject.', 'action');
      }
      changed = true;
    }
    const decided = new Set(decisions.map((decision) => decision.item_id));
    const remaining = pending.filter((entry) => !decided.has(entry.item_id));
    const finished = body.finished === true || remaining.length === 0;
    updateDocumentReview(docId, finished ? 'confirmed' : 'needs_review', seal(JSON.stringify(finished ? [] : remaining)), now());
    if (changed) touch(row.profile_id);
    return findHealthDocument(docId) as DocumentRow;
  });
}

/** Removes the document and its pages; its items go too, or stay as typed-in items. */
export function deleteDocument(userId: string, docId: string, deleteItems: boolean): void {
  const pages = transaction(() => {
    const row = documentFor(userId, docId, 'edit');
    if (deleteItems) {
      deleteHealthItemsFromSource(docId, row.profile_id);
      touch(row.profile_id);
    } else {
      clearHealthItemsSource(docId, row.profile_id);
    }
    deleteHealthDocument(docId);
    return JSON.parse(row.pages) as { file: string }[];
  });
  removeFiles(pages.map((page) => page.file));
}

/** A page of the original, for the resident who owns it. */
export function documentPage(docId: string, page: number): { mime: string; bytes: Buffer } | null {
  const row = findHealthDocument(docId);
  const pages = row ? (JSON.parse(row.pages) as { file: string; mime: string }[]) : [];
  const entry = pages[page - 1];
  const bytes = entry ? readStoredFile(entry.file) : null;
  return entry && bytes ? { mime: entry.mime, bytes } : null;
}

/** The profile a document belongs to, for its media links. */
export function documentProfileId(docId: string): string | null {
  return findHealthDocument(docId)?.profile_id ?? null;
}

/** After a restart: documents still being read are read again. */
export function resumeReading(): number {
  const ids = listProcessingDocumentIds();
  ids.forEach((id) => queueReading(id));
  return ids.length;
}
