import { ChipGroup, CheckRow, Field } from '../parking/Controls';
import { DateField } from './DateField';
import { useHealth } from '../../hooks/useHealth';
import type { RecordSection } from '../../services/health/health.types';
import type { Draft, DraftError, DraftErrors } from '../../services/health/itemForm';

export interface ItemFieldsProps {
  section: RecordSection;
  draft: Draft;
  onChange: (next: Draft) => void;
  errors: DraftErrors;
}

const errorText = {
  en: {
    required: 'This is required.',
    date: 'Choose a valid date.',
    future: 'This can’t be in the future.',
    number: 'Enter a number, e.g. 7.6',
    year: 'Enter a year, e.g. 2019.',
    endBeforeStart: 'This is before the start date.',
  },
  ar: {
    required: 'هذا الحقل مطلوب.',
    date: 'اختر تاريخًا صحيحًا.',
    future: 'لا يمكن أن يكون في المستقبل.',
    number: 'أدخل رقمًا، مثل 7.6',
    year: 'أدخل سنة، مثل 2019.',
    endBeforeStart: 'هذا التاريخ قبل تاريخ البدء.',
  },
} satisfies Record<'en' | 'ar', Record<DraftError, string>>;

/**
 * The fields of one record item, for adding by hand, editing, and correcting
 * an extracted item during review. Names, doses and units are free text,
 * kept exactly as typed; dates are typed as YYYY-MM-DD.
 */
export function ItemFields({ section, draft, onChange, errors }: ItemFieldsProps) {
  const { lang, t } = useHealth();
  const f = t.fields;
  const set = (key: string) => (value: string) => onChange({ ...draft, [key]: value });
  const error = (key: string) => {
    const code = errors[key];
    return code ? errorText[lang][code] : undefined;
  };
  const text = (key: string, label: string, extra: Partial<Parameters<typeof Field>[0]> = {}) => (
    <Field key={key} label={label} value={draft[key] ?? ''} onChangeText={set(key)} error={error(key)} {...extra} />
  );
  const date = (key: string, label: string, options: { required?: boolean; allowFuture?: boolean; minimumDate?: string } = {}) => (
    <DateField
      key={key}
      label={label}
      value={draft[key] ?? ''}
      onChange={set(key)}
      error={error(key)}
      optional={!options.required}
      allowFuture={options.allowFuture}
      minimumDate={options.minimumDate}
    />
  );
  const number = (key: string, label: string) => text(key, label, { keyboardType: 'decimal-pad' });

  switch (section) {
    case 'allergies':
      return (
        <>
          {text('substance', f.substance)}
          {text('reaction', f.reaction)}
          <ChipGroup
            label={f.severity}
            options={(['mild', 'moderate', 'severe'] as const).map((value) => ({ value, label: t.severity[value] }))}
            value={draft.severity}
            onChange={set('severity')}
          />
        </>
      );
    case 'medications':
      return (
        <>
          {text('name', f.name)}
          {text('dose', f.dose, { placeholder: '500 mg' })}
          {text('frequency', f.frequency)}
          {date('start', f.start)}
          <CheckRow
            label={f.stillTaking}
            checked={draft.stillTaking === 'yes'}
            onChange={(checked) => onChange({ ...draft, stillTaking: checked ? 'yes' : 'no' })}
          />
          {/* A course can be planned to end later, but not before it started. */}
          {draft.stillTaking === 'yes' ? null : date('end', f.end, { allowFuture: true, minimumDate: draft.start || undefined })}
        </>
      );
    case 'conditions':
      return (
        <>
          {text('name', f.name)}
          {text('diagnosed', f.yearDiagnosed, { keyboardType: 'number-pad', maxLength: 4, placeholder: '2019' })}
          <ChipGroup
            label={f.status}
            options={(['active', 'resolved'] as const).map((value) => ({ value, label: t.conditionStatus[value] }))}
            value={draft.status}
            onChange={set('status')}
          />
        </>
      );
    case 'procedures':
      return (
        <>
          {text('name', f.name)}
          {date('date', f.date)}
        </>
      );
    case 'labs':
      return (
        <>
          {text('test', f.test)}
          {number('value', f.value)}
          {text('unit', f.unit, { placeholder: 'mg/dL', autoCapitalize: 'none' })}
          {date('date', f.date, { required: true })}
          {number('ref_low', f.refLow)}
          {number('ref_high', f.refHigh)}
        </>
      );
    case 'visits':
      return (
        <>
          {date('date', f.date, { required: true })}
          {text('specialty', f.specialty)}
          {text('reason', f.reason, { multiline: true })}
        </>
      );
  }
}
