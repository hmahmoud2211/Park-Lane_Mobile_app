import { ApiError } from '../errors.ts';

/**
 * A consultation's clinical note. The clinic fills three parts of it:
 * `diagnoses`, `medications` and `investigations` (the assessment: the lab
 * tests the patient should have), by dictation or by hand. The other
 * SOAP fields are kept for records written before that and for the
 * resident's app, which still reads them; new notes leave them empty. The
 * same shape is what the AI proposes, what the doctor edits as a draft,
 * and what the doctor approves; only the approved one is ever the patient's
 * record.
 *
 * Text fields are '' rather than null when empty, so an editor can bind them
 * directly. Nothing here is free-form JSON: `cleanNote` keeps exactly these
 * fields and refuses anything else.
 */
export interface ClinicalNote {
  /** Subjective */
  chief_complaint: string;
  /** The history of the present illness, as the patient told it. */
  history: string;
  symptoms: string[];
  symptom_duration: string;
  /** Relevant medical history the patient reported during this visit. */
  reported_history: string;
  /** Objective: only findings the doctor stated. */
  examination: string;
  vitals: Vital[];
  /** Assessment: the doctor's own, never inferred. */
  assessment: string;
  diagnoses: Diagnosis[];
  /** Plan */
  plan: string;
  medications: Prescription[];
  investigations: string[];
  follow_up: FollowUp;
  /** Plain-language instructions for the patient, shown in their Health Passport. */
  patient_instructions: string;
}

export interface Vital {
  name: string;
  value: string;
}

export interface Diagnosis {
  name: string;
  certainty: 'confirmed' | 'provisional';
}

export interface Prescription {
  name: string;
  dose: string;
  frequency: string;
  /** Null when the course is ongoing or no duration was given. */
  duration_days: number | null;
  route: string;
  instructions: string;
}

export interface FollowUp {
  needed: boolean;
  /** Suggested interval; the resident books it from the app. */
  in_days: number | null;
  instructions: string;
}

export const emptyNote = (): ClinicalNote => ({
  chief_complaint: '',
  history: '',
  symptoms: [],
  symptom_duration: '',
  reported_history: '',
  examination: '',
  vitals: [],
  assessment: '',
  diagnoses: [],
  plan: '',
  medications: [],
  investigations: [],
  follow_up: { needed: false, in_days: null, instructions: '' },
  patient_instructions: '',
});

const LONG = 8_000;
const SHORT = 300;
const MAX_LIST = 40;

function str(value: unknown, field: string, max: number): string {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw new ApiError('invalid', `${field} must be text.`, field);
  return value.trim().slice(0, max);
}

function list<T>(value: unknown, field: string, each: (entry: unknown, index: number) => T | null): T[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new ApiError('invalid', `${field} must be a list.`, field);
  return value
    .slice(0, MAX_LIST)
    .map(each)
    .filter((entry): entry is T => entry !== null);
}

function obj(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ApiError('invalid', `${field} must be an object.`, field);
  }
  return value as Record<string, unknown>;
}

function days(value: unknown, field: string): number | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 3650) {
    throw new ApiError('invalid', `${field} must be a whole number of days.`, field);
  }
  return value;
}

/** Exactly the note's fields, trimmed and bounded; empty list entries are dropped. */
export function cleanNote(input: unknown): ClinicalNote {
  const note = obj(input ?? {}, 'note');
  const follow = obj(note.follow_up ?? {}, 'follow_up');
  return {
    chief_complaint: str(note.chief_complaint, 'chief_complaint', SHORT * 2),
    history: str(note.history, 'history', LONG),
    symptoms: list(note.symptoms, 'symptoms', (entry, i) => str(entry, `symptoms[${i}]`, SHORT) || null),
    symptom_duration: str(note.symptom_duration, 'symptom_duration', SHORT),
    reported_history: str(note.reported_history, 'reported_history', LONG),
    examination: str(note.examination, 'examination', LONG),
    vitals: list(note.vitals, 'vitals', (entry, i) => {
      const vital = obj(entry, `vitals[${i}]`);
      const name = str(vital.name, `vitals[${i}].name`, SHORT);
      const value = str(vital.value, `vitals[${i}].value`, SHORT);
      return name || value ? { name, value } : null;
    }),
    assessment: str(note.assessment, 'assessment', LONG),
    diagnoses: list(note.diagnoses, 'diagnoses', (entry, i) => {
      const diagnosis = obj(entry, `diagnoses[${i}]`);
      const name = str(diagnosis.name, `diagnoses[${i}].name`, SHORT);
      if (!name) return null;
      return { name, certainty: diagnosis.certainty === 'provisional' ? 'provisional' : 'confirmed' };
    }),
    plan: str(note.plan, 'plan', LONG),
    medications: list(note.medications, 'medications', (entry, i) => {
      const med = obj(entry, `medications[${i}]`);
      const name = str(med.name, `medications[${i}].name`, SHORT);
      if (!name) return null;
      return {
        name,
        dose: str(med.dose, `medications[${i}].dose`, SHORT),
        frequency: str(med.frequency, `medications[${i}].frequency`, SHORT),
        duration_days: days(med.duration_days, `medications[${i}].duration_days`),
        route: str(med.route, `medications[${i}].route`, SHORT),
        instructions: str(med.instructions, `medications[${i}].instructions`, SHORT * 2),
      };
    }),
    investigations: list(note.investigations, 'investigations', (entry, i) => str(entry, `investigations[${i}]`, SHORT) || null),
    follow_up: {
      needed: follow.needed === true,
      in_days: days(follow.in_days, 'follow_up.in_days'),
      instructions: str(follow.instructions, 'follow_up.instructions', SHORT * 2),
    },
    patient_instructions: str(note.patient_instructions, 'patient_instructions', LONG),
  };
}

/** What a finalized note must have: at least one diagnosis. The reason for the visit comes from the booking when the note has none. */
export function assertFinalizable(note: ClinicalNote): void {
  if (note.diagnoses.length === 0 && !note.assessment) {
    throw new ApiError('invalid', 'Add the diagnosis before finalizing.', 'diagnoses');
  }
}
