/**
 * Health Passport data, exactly as the app's backend sends it (snake_case
 * kept, so the HTTP service passes bodies through untouched). Dates without
 * a time are `YYYY-MM-DD`; timestamps are ISO 8601 in UTC.
 */

export type IsoDate = string;
export type IsoTime = string;

export type HealthLang = 'en' | 'ar';

export type Sex = 'male' | 'female';
export type BloodType = 'A+' | 'A-' | 'B+' | 'B-' | 'AB+' | 'AB-' | 'O+' | 'O-';
export type Severity = 'mild' | 'moderate' | 'severe';
export type ConditionStatus = 'active' | 'resolved';

/** Who a profile is to the signed-in resident. */
export type Relation = 'self' | 'child' | 'parent' | 'spouse' | 'other';

export interface Patient {
  id: string;
  name: string;
  sex: Sex | null;
  date_of_birth: IsoDate | null;
  blood_type: BloodType | null;
}

/** One person whose record the resident keeps: themself or a family member. */
export interface HealthProfile extends Patient {
  relation: Relation;
}

export type ProfileInput = Omit<HealthProfile, 'id'>;

/** Every item carries the document it was read from, or null when typed in by hand. */
interface ItemBase {
  id: string;
  source: string | null;
}

export interface Allergy extends ItemBase {
  substance: string;
  reaction: string | null;
  severity: Severity;
}

export interface Medication extends ItemBase {
  name: string;
  dose: string | null;
  frequency: string | null;
  start: IsoDate | null;
  /** Null while the resident is still taking it. */
  end: IsoDate | null;
}

export interface Condition extends ItemBase {
  name: string;
  diagnosed: IsoDate | null;
  status: ConditionStatus;
}

export interface Procedure extends ItemBase {
  name: string;
  date: IsoDate | null;
}

export interface LabResult extends ItemBase {
  test: string;
  value: number;
  unit: string | null;
  date: IsoDate;
  ref_low?: number | null;
  ref_high?: number | null;
}

export interface Visit extends ItemBase {
  date: IsoDate;
  specialty: string | null;
  reason: string | null;
}

export interface SectionItems {
  allergies: Allergy;
  medications: Medication;
  conditions: Condition;
  procedures: Procedure;
  labs: LabResult;
  visits: Visit;
}

export type RecordSection = keyof SectionItems;

export const RECORD_SECTIONS: readonly RecordSection[] = [
  'allergies',
  'medications',
  'conditions',
  'labs',
  'procedures',
  'visits',
];

export type RecordItem = SectionItems[RecordSection];

/** An item's fields without its id or source, as sent to create or update it. */
export type ItemData<S extends RecordSection> = Omit<SectionItems[S], 'id' | 'source'>;

export interface HealthRecord {
  patient: Patient;
  record_updated_at: IsoTime;
  allergies: Allergy[];
  medications: Medication[];
  conditions: Condition[];
  procedures: Procedure[];
  labs: LabResult[];
  visits: Visit[];
  gaps: HealthGap[];
}

export type GapKind = 'missing_blood_type' | 'stale_lab' | 'no_recent_labs' | 'no_allergies_recorded';

/** Something the record is missing. `text` is in the request's Accept-Language and shown as it is. */
export interface HealthGap {
  kind: GapKind;
  text: string;
  /** For `stale_lab`: the test whose last result is old, as the record names it. */
  test?: string;
}

export type DocumentType = 'prescription' | 'lab_report' | 'discharge_summary' | 'imaging_report' | 'other';

export const DOCUMENT_TYPES: readonly DocumentType[] = [
  'prescription',
  'lab_report',
  'discharge_summary',
  'imaging_report',
  'other',
];

export type DocumentStatus = 'processing' | 'needs_review' | 'confirmed' | 'failed';

export type Confidence = 'high' | 'low';

/** One fact the server read from a document, waiting for the resident's check. */
export type ExtractedItem = {
  [S in RecordSection]: {
    item_id: string;
    section: S;
    data: ItemData<S>;
    confidence: Confidence;
    /** Id of a record item in the same section that this may repeat. */
    possible_duplicate_of: string | null;
  };
}[RecordSection];

export interface HealthDocument {
  id: string;
  profile_id: string;
  type: DocumentType;
  document_date: IsoDate | null;
  uploaded_at: IsoTime;
  status: DocumentStatus;
  /** Display string when `failed`. */
  error: string | null;
  page_count: number;
  /** Null once the backend no longer keeps the original. */
  file_url: string | null;
  /** Present from `needs_review` on. */
  extracted_text?: string | null;
  extracted_items?: ExtractedItem[] | null;
}

export interface UploadFile {
  /** Local file URI, from the picker or after compression. */
  uri: string;
  name: string;
  mimeType: string;
  size: number;
}

export interface UploadInput {
  files: UploadFile[];
  type: DocumentType;
  document_date: IsoDate | null;
}

export interface UploadResult {
  id: string;
  status: 'processing';
}

/**
 * One decision on an extracted item: save it as a new record item, save it
 * over an existing one, or `reject` it, which drops it from the document for
 * good so it is not offered again.
 */
export type ConfirmItem =
  | { item_id: string; action: 'add'; data: ItemData<RecordSection> }
  | { item_id: string; action: 'replace'; data: ItemData<RecordSection>; replace_id: string }
  | { item_id: string; action: 'reject' };

export interface ConfirmInput {
  items: ConfirmItem[];
  /**
   * Closes the review and moves the document to `confirmed`. Left out for a
   * partial save, so items not yet decided stay in review.
   */
  finished?: boolean;
}

export interface Consent {
  given: boolean;
  given_at: IsoTime | null;
}

/** A finished summary, ready to play. */
export interface Summary {
  status: 'ready';
  lang: HealthLang;
  /** The specialty it was written for; summaries are kept per specialty. */
  specialty: string | null;
  transcript: string;
  audio_url: string;
  cached: boolean;
  generated_at: IsoTime;
  record_updated_at: IsoTime;
}

/**
 * Where the server is with a summary it is making in the background:
 * `waiting` for another one to finish first, then `writing`, then `recording`.
 */
export type SummaryPhase = 'waiting' | 'writing' | 'recording';

export interface SummaryGenerating {
  status: 'generating';
  lang: HealthLang;
  specialty: string | null;
  started_at: IsoTime;
  phase: SummaryPhase;
}

export interface SummaryFailed {
  status: 'failed';
  lang: HealthLang;
  specialty: string | null;
  started_at: IsoTime;
  /** Display string, in the request's language. */
  error: string;
  failed_at: IsoTime;
}

/** What GET and POST .../summary answer with. */
export type SummaryState = Summary | SummaryGenerating | SummaryFailed;

export interface SummaryRequest {
  lang: HealthLang;
  specialty: string | null;
  consent: true;
  /** Start the summary in the background and answer at once, rather than wait for it. */
  async: true;
}
