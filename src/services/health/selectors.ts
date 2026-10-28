import type {
  DocumentType,
  ExtractedItem,
  HealthDocument,
  HealthGap,
  HealthLang,
  HealthRecord,
  ItemData,
  LabResult,
  Medication,
  RecordSection,
  SectionItems,
  Summary,
} from './health.types';
import { formatDate, healthStrings, num } from './i18n';

/* -------------------------------------------------------------- Labs */

export type LabFlag = 'high' | 'low' | null;

export function labFlag(lab: Pick<LabResult, 'value' | 'ref_low' | 'ref_high'>): LabFlag {
  if (lab.ref_high != null && lab.value > lab.ref_high) return 'high';
  if (lab.ref_low != null && lab.value < lab.ref_low) return 'low';
  return null;
}

export interface LabGroup {
  test: string;
  /** Newest first. */
  results: LabResult[];
}

/** Results grouped by test, the most recently tested first. */
export function groupLabs(labs: readonly LabResult[]): LabGroup[] {
  const groups = new Map<string, LabResult[]>();
  for (const lab of labs) {
    const key = lab.test.trim().toLowerCase();
    groups.set(key, [...(groups.get(key) ?? []), lab]);
  }
  return [...groups.values()]
    .map((results) => {
      const sorted = [...results].sort((a, b) => b.date.localeCompare(a.date));
      return { test: sorted[0].test, results: sorted };
    })
    .sort((a, b) => b.results[0].date.localeCompare(a.results[0].date));
}

/* ------------------------------------------------------- Medications */

export const isCurrentMedication = (m: Pick<Medication, 'end'>, today = todayIso()) => m.end === null || m.end >= today;

export function splitMedications(meds: readonly Medication[]) {
  const today = todayIso();
  return {
    current: meds.filter((m) => isCurrentMedication(m, today)),
    past: meds.filter((m) => !isCurrentMedication(m, today)),
  };
}

/* --------------------------------------------------------------- Record */

export const hasSevereAllergy = (record: Pick<HealthRecord, 'allergies'>) =>
  record.allergies.some((a) => a.severity === 'severe');

export function itemsIn<S extends RecordSection>(record: HealthRecord, section: S): SectionItems[S][] {
  return record[section] as SectionItems[S][];
}

/** Every record item that came from this document. */
export function itemsFromDocument(record: HealthRecord, docId: string) {
  return (['allergies', 'medications', 'conditions', 'labs', 'procedures', 'visits'] as const).flatMap((section) =>
    (record[section] as { id: string; source: string | null }[])
      .filter((item) => item.source === docId)
      .map((item) => ({ section, item: item as SectionItems[typeof section] })),
  );
}

/** The summary was made before the record last changed. */
export const summaryIsStale = (summary: Summary, recordUpdatedAt: string | undefined) =>
  Date.parse(recordUpdatedAt ?? summary.record_updated_at) > Date.parse(summary.generated_at);

/* ---------------------------------------------------------------- Gaps */

export type GapFix =
  | { kind: 'profile' }
  | { kind: 'add'; section: RecordSection; labTest?: string }
  | { kind: 'upload'; type: DocumentType };

/** The shortcut that fixes a completeness nudge, from the kind the backend gives it. */
export function gapFix(gap: HealthGap): GapFix {
  switch (gap.kind) {
    case 'missing_blood_type':
      return { kind: 'profile' };
    case 'stale_lab':
      return { kind: 'add', section: 'labs', labTest: gap.test };
    case 'no_recent_labs':
      return { kind: 'upload', type: 'lab_report' };
    case 'no_allergies_recorded':
      return { kind: 'add', section: 'allergies' };
  }
}

/* ----------------------------------------------------------- Documents */

export const awaitingReview = (docs: readonly HealthDocument[]) => docs.filter((d) => d.status === 'needs_review');
export const inProgress = (docs: readonly HealthDocument[]) => docs.filter((d) => d.status === 'processing');

/** Low-confidence items first, so they are checked while attention is fresh. */
export function orderForReview(items: readonly ExtractedItem[]): ExtractedItem[] {
  return [...items].sort((a, b) => Number(b.confidence === 'low') - Number(a.confidence === 'low'));
}

/* ------------------------------------------------------- Presentation */

export interface ItemSummary {
  title: string;
  /** Doses, values and dates: drawn larger, as a misread number matters most. */
  emphasis?: string;
  lines: string[];
}

/** One item's headline and supporting lines, for lists, reviews and confirmations. */
export function describeItem<S extends RecordSection>(section: S, data: ItemData<S>, lang: HealthLang): ItemSummary {
  const t = healthStrings[lang];
  const date = (value: string | null | undefined) => formatDate(value, lang);
  switch (section) {
    case 'allergies': {
      const d = data as ItemData<'allergies'>;
      return {
        title: d.substance,
        emphasis: t.severity[d.severity],
        lines: d.reaction ? [`${t.fields.reaction}: ${d.reaction}`] : [],
      };
    }
    case 'medications': {
      const d = data as ItemData<'medications'>;
      const span = [d.start ? t.sinceDate(date(d.start)) : '', d.end ? t.untilDate(date(d.end)) : ''].filter(Boolean);
      return {
        title: d.name,
        emphasis: [d.dose, d.frequency].filter(Boolean).join(' · ') || undefined,
        lines: span.length ? [span.join(' · ')] : [],
      };
    }
    case 'conditions': {
      const d = data as ItemData<'conditions'>;
      return {
        title: d.name,
        lines: [t.conditionStatus[d.status], d.diagnosed ? `${t.fields.diagnosed}: ${date(d.diagnosed)}` : ''].filter(Boolean),
      };
    }
    case 'labs': {
      const d = data as ItemData<'labs'>;
      return {
        title: d.test,
        emphasis: [num(d.value, lang), d.unit].filter(Boolean).join(' '),
        lines: [date(d.date), rangeText(d, lang)].filter(Boolean),
      };
    }
    case 'procedures': {
      const d = data as ItemData<'procedures'>;
      return { title: d.name, lines: d.date ? [date(d.date)] : [] };
    }
    case 'visits': {
      const d = data as ItemData<'visits'>;
      return {
        title: d.specialty || t.sections.visits.one,
        emphasis: date(d.date),
        lines: d.reason ? [d.reason] : [],
      };
    }
  }
  return { title: '', lines: [] };
}

export function rangeText(lab: Pick<LabResult, 'ref_low' | 'ref_high' | 'unit'>, lang: HealthLang): string {
  const t = healthStrings[lang];
  const low = lab.ref_low;
  const high = lab.ref_high;
  if (low == null && high == null) return '';
  const span = low != null && high != null ? `${num(low, lang)}–${num(high, lang)}` : low != null ? `≥ ${num(low, lang)}` : `≤ ${num(high!, lang)}`;
  return `${t.fields.normalRange}: ${span}`;
}

/* -------------------------------------------------------------- Dates */

export function todayIso(now = Date.now()): string {
  const d = new Date(now);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** A `YYYY-MM-DD` day as a local Date at midnight, for a date picker. */
export function dateFromIso(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}

/** A picked Date as the `YYYY-MM-DD` day the phone showed, whatever the time zone. */
export const isoFromDate = (date: Date) => todayIso(date.getTime());

export type DateProblem = 'format' | 'future' | null;

/** `YYYY-MM-DD`, a real calendar day, and not after today. Empty is fine; callers decide what is required. */
export function checkDate(value: string, now = Date.now()): DateProblem {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return 'format';
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day || year < 1900) {
    return 'format';
  }
  return value > todayIso(now) ? 'future' : null;
}

/** A typed number, with either decimal mark and Arabic-Indic digits accepted. */
export function parseNumber(value: string): number | null {
  const western = value
    .trim()
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[٫,]/g, '.');
  if (!/^-?\d+(\.\d+)?$/.test(western)) return null;
  return Number(western);
}
