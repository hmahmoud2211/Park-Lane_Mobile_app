import type { ConditionStatus, ItemData, RecordSection, Severity } from './health.types';
import { checkDate, parseNumber, todayIso } from './selectors';

/**
 * An item being typed or corrected: every field as the text in its box, so
 * a half-typed number or date survives until it is checked on save.
 */
export type Draft = Record<string, string>;

export type DraftError = 'required' | 'date' | 'future' | 'number' | 'year' | 'endBeforeStart';
export type DraftErrors = Partial<Record<string, DraftError>>;

const text = (value: unknown) => (value === null || value === undefined ? '' : String(value));

export function emptyDraft(section: RecordSection): Draft {
  switch (section) {
    case 'allergies':
      return { substance: '', reaction: '', severity: 'moderate' };
    case 'medications':
      return { name: '', dose: '', frequency: '', start: '', end: '', stillTaking: 'yes' };
    case 'conditions':
      return { name: '', diagnosed: '', status: 'active' };
    case 'procedures':
      return { name: '', date: '' };
    case 'labs':
      return { test: '', value: '', unit: '', date: '', ref_low: '', ref_high: '' };
    case 'visits':
      return { date: '', specialty: '', reason: '' };
  }
}

export function draftFrom<S extends RecordSection>(section: S, data: ItemData<S>): Draft {
  const fields = data as Record<string, unknown>;
  const draft = emptyDraft(section);
  for (const key of Object.keys(draft)) {
    if (key in fields) draft[key] = text(fields[key]);
  }
  if (section === 'medications') draft.stillTaking = fields.end ? 'no' : 'yes';
  // The form asks for the year a condition was diagnosed; the full date is kept if the year stays the same.
  if (section === 'conditions') draft.diagnosed = text(fields.diagnosed).slice(0, 4);
  return draft;
}

const orNull = (value: string) => (value.trim() ? value.trim() : null);

/** The draft as the API's item shape. Only call once `validateDraft` finds nothing. */
export function dataFrom<S extends RecordSection>(section: S, draft: Draft, previous?: ItemData<S> | null): ItemData<S> {
  const d = (key: string) => (draft[key] ?? '').trim();
  switch (section) {
    case 'allergies':
      return { substance: d('substance'), reaction: orNull(d('reaction')), severity: d('severity') as Severity } as unknown as ItemData<S>;
    case 'medications':
      return {
        name: d('name'),
        dose: orNull(d('dose')),
        frequency: orNull(d('frequency')),
        start: orNull(d('start')),
        end: draft.stillTaking === 'yes' ? null : orNull(d('end')),
      } as unknown as ItemData<S>;
    case 'conditions': {
      const before = (previous as ItemData<'conditions'> | null | undefined)?.diagnosed ?? null;
      const year = d('diagnosed');
      const diagnosed = !year ? null : before && before.startsWith(year) ? before : `${year}-01-01`;
      return { name: d('name'), diagnosed, status: d('status') as ConditionStatus } as unknown as ItemData<S>;
    }
    case 'procedures':
      return { name: d('name'), date: orNull(d('date')) } as unknown as ItemData<S>;
    case 'labs':
      return {
        test: d('test'),
        value: parseNumber(d('value')) as number,
        unit: orNull(d('unit')),
        date: d('date'),
        ref_low: d('ref_low') ? parseNumber(d('ref_low')) : null,
        ref_high: d('ref_high') ? parseNumber(d('ref_high')) : null,
      } as unknown as ItemData<S>;
    case 'visits':
      return { date: d('date'), specialty: orNull(d('specialty')), reason: orNull(d('reason')) } as unknown as ItemData<S>;
  }
  throw new Error(`Unknown section ${String(section)}`);
}

/** Required fields per section; everything else is optional. */
const REQUIRED: Record<RecordSection, readonly string[]> = {
  allergies: ['substance'],
  medications: ['name'],
  conditions: ['name'],
  procedures: ['name'],
  labs: ['test', 'value', 'date'],
  visits: ['date'],
};

const DATE_FIELDS: Record<RecordSection, readonly string[]> = {
  allergies: [],
  medications: ['start', 'end'],
  conditions: [],
  procedures: ['date'],
  labs: ['date'],
  visits: ['date'],
};

export function validateDraft(section: RecordSection, draft: Draft, now = Date.now()): DraftErrors {
  const errors: DraftErrors = {};
  const d = (key: string) => (draft[key] ?? '').trim();
  for (const key of REQUIRED[section]) {
    if (!d(key)) errors[key] = 'required';
  }
  for (const key of DATE_FIELDS[section]) {
    if (section === 'medications' && key === 'end' && draft.stillTaking === 'yes') continue;
    const problem = checkDate(d(key), now);
    // A course of medicine may be planned to end after today; no other date may be in the future.
    const futureAllowed = section === 'medications' && key === 'end';
    if (problem === 'format' && !errors[key]) errors[key] = 'date';
    if (problem === 'future' && !futureAllowed && !errors[key]) errors[key] = 'future';
  }
  if (section === 'medications' && draft.stillTaking !== 'yes' && d('start') && d('end') && d('end') < d('start') && !errors.end) {
    errors.end = 'endBeforeStart';
  }
  if (section === 'conditions' && d('diagnosed')) {
    const year = Number(d('diagnosed'));
    if (!/^\d{4}$/.test(d('diagnosed')) || year < 1900) errors.diagnosed = 'year';
    else if (year > Number(todayIso(now).slice(0, 4))) errors.diagnosed = 'future';
  }
  if (section === 'labs') {
    for (const key of ['value', 'ref_low', 'ref_high']) {
      if (d(key) && parseNumber(d(key)) === null) errors[key] = 'number';
    }
  }
  return errors;
}
