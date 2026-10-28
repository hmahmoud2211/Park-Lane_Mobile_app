import type {
  DocumentType,
  ExtractedItem,
  HealthDocument,
  HealthLang,
  HealthProfile,
  HealthRecord,
  Summary,
} from './health.types';

/**
 * Sample data for the mock service: the resident from the API spec, with a
 * full record and documents in every state, and a child whose record is
 * almost empty, so the empty states and completeness nudges show.
 *
 * Plain data only (no React Native), so the Node checks can load it.
 */

/** Media the mock points at; services/health/media resolves these to bundled files. */
export const MOCK_MEDIA = {
  audioAhmedEn: 'mock://audio/ahmed-en',
  audioAhmedAr: 'mock://audio/ahmed-ar',
  audioLailaEn: 'mock://audio/laila-en',
  audioLailaAr: 'mock://audio/laila-ar',
  prescription: 'mock://files/prescription',
  labReport: 'mock://files/lab-report',
  discharge: 'mock://files/discharge',
} as const;

export const RESIDENT_ID = 'res-0001';
export const CHILD_ID = 'fam-0002';

export type MockRecord = Omit<HealthRecord, 'gaps' | 'patient'>;

export interface MockDocument extends Omit<HealthDocument, 'error'> {
  /** The failure reason in both languages; the mock answers in the request's. */
  errorText?: Record<HealthLang, string>;
  /** When a `processing` document becomes ready for review, in ms. */
  readyAt?: number;
  /** What the server "reads" from it once ready. */
  pendingItems?: ExtractedItem[];
  pendingText?: string;
}

export function seedProfiles(): HealthProfile[] {
  return [
    { id: RESIDENT_ID, name: 'Ahmed', sex: 'male', date_of_birth: '1968-03-14', blood_type: null, relation: 'self' },
    { id: CHILD_ID, name: 'Laila', sex: 'female', date_of_birth: '2016-05-02', blood_type: 'O+', relation: 'child' },
  ];
}

export function seedRecords(): Record<string, MockRecord> {
  return {
    [RESIDENT_ID]: {
      record_updated_at: '2026-10-20T09:12:00Z',
      allergies: [{ id: 'a1', substance: 'Penicillin', reaction: 'rash and swelling', severity: 'severe', source: 'doc-003' }],
      medications: [
        { id: 'm1', name: 'Metformin', dose: '500 mg', frequency: 'twice daily', start: '2019-06-01', end: null, source: 'doc-001' },
        { id: 'm2', name: 'Amoxicillin', dose: '250 mg', frequency: 'three times daily', start: '2018-02-10', end: '2018-02-17', source: null },
      ],
      conditions: [{ id: 'c1', name: 'Type 2 diabetes', diagnosed: '2019-05-20', status: 'active', source: 'doc-001' }],
      procedures: [{ id: 'p1', name: 'Gallbladder removal', date: '2022-11-03', source: 'doc-005' }],
      labs: [
        { id: 'l1', test: 'HbA1c', value: 7.6, unit: '%', date: '2026-08-19', ref_high: 5.7, source: 'doc-008' },
        { id: 'l2', test: 'HbA1c', value: 7.9, unit: '%', date: '2026-02-12', ref_high: 5.7, source: null },
        { id: 'l3', test: 'HbA1c', value: 8.1, unit: '%', date: '2025-09-10', ref_high: 5.7, source: null },
        { id: 'l4', test: 'Fasting glucose', value: 142, unit: 'mg/dL', date: '2026-08-19', ref_low: 70, ref_high: 100, source: 'doc-008' },
        { id: 'l5', test: 'LDL cholesterol', value: 3.6, unit: 'mmol/L', date: '2024-03-01', ref_high: 3.0, source: null },
      ],
      visits: [{ id: 'v1', date: '2026-08-20', specialty: 'Internal medicine', reason: 'Diabetes follow-up', source: 'doc-008' }],
    },
    [CHILD_ID]: {
      record_updated_at: '2026-09-01T10:00:00Z',
      allergies: [],
      medications: [],
      conditions: [],
      procedures: [],
      labs: [],
      visits: [{ id: 'v2', date: '2026-04-11', specialty: 'Pediatrics', reason: 'Vaccination', source: null }],
    },
  };
}

const PRESCRIPTION_TEXT = [
  'Dr. Karim Mansour — Cardiology Clinic, New Cairo',
  'Date: 25/10/2026',
  'Patient: Ahmed, 58 y',
  '',
  'Rx',
  '1. Metformin 500 mg — 1 tab twice daily after meals',
  '2. Atorvastatin 20 mg (?) — 1 tab at night',
  '',
  'Diagnosis: Dyslipidaemia; T2DM on treatment',
  'Follow-up in 3 months with lipid profile.',
].join('\n');

/** The resident's documents: one of each status, and one whose original has been deleted. */
export function seedDocuments(startedAt: number): MockDocument[] {
  return [
    {
      id: 'doc-009',
      profile_id: RESIDENT_ID,
      type: 'prescription',
      document_date: '2026-10-25',
      uploaded_at: new Date(startedAt - 60_000).toISOString(),
      status: 'processing',
      page_count: 1,
      file_url: MOCK_MEDIA.prescription,
      readyAt: startedAt + 20_000,
      pendingText: PRESCRIPTION_TEXT,
      pendingItems: [
        {
          item_id: 'x1',
          section: 'medications',
          data: { name: 'Metformin', dose: '500 mg', frequency: 'twice daily', start: null, end: null },
          confidence: 'high',
          possible_duplicate_of: 'm1',
        },
        {
          item_id: 'x2',
          section: 'medications',
          data: { name: 'Atorvastatin', dose: '20 mg', frequency: 'once at night', start: '2026-10-25', end: null },
          confidence: 'low',
          possible_duplicate_of: null,
        },
        {
          item_id: 'x3',
          section: 'conditions',
          data: { name: 'High cholesterol', diagnosed: '2026-10-25', status: 'active' },
          confidence: 'high',
          possible_duplicate_of: null,
        },
        {
          item_id: 'x4',
          section: 'visits',
          data: { date: '2026-10-25', specialty: 'Cardiology', reason: 'Raised cholesterol, diabetes review' },
          confidence: 'high',
          possible_duplicate_of: null,
        },
      ],
    },
    {
      id: 'doc-010',
      profile_id: RESIDENT_ID,
      type: 'lab_report',
      document_date: null,
      uploaded_at: '2026-10-22T17:05:00Z',
      status: 'failed',
      page_count: 2,
      file_url: null,
      errorText: {
        en: 'The photos are too blurry to read. Try again in good light, with the whole page in the frame.',
        ar: 'الصور غير واضحة بما يكفي للقراءة. حاول مرة أخرى في إضاءة جيدة مع ظهور الصفحة كاملة.',
      },
    },
    {
      id: 'doc-008',
      profile_id: RESIDENT_ID,
      type: 'lab_report',
      document_date: '2026-08-19',
      uploaded_at: '2026-08-21T07:30:00Z',
      status: 'confirmed',
      page_count: 1,
      file_url: MOCK_MEDIA.labReport,
      extracted_text: [
        'Al Shams Laboratories — Patient: Ahmed — Collected 19/08/2026',
        'HbA1c ............ 7.6 %        (4.0 – 5.7)  H',
        'Fasting glucose .. 142 mg/dL    (70 – 100)   H',
        'Referring: Internal medicine clinic, visit 20/08/2026 — diabetes follow-up',
      ].join('\n'),
      extracted_items: [],
    },
    {
      id: 'doc-005',
      profile_id: RESIDENT_ID,
      type: 'discharge_summary',
      document_date: '2022-11-05',
      uploaded_at: '2026-03-02T12:00:00Z',
      status: 'confirmed',
      page_count: 2,
      file_url: MOCK_MEDIA.discharge,
      extracted_text: [
        'Discharge summary — General Surgery',
        'Admitted 02/11/2022, discharged 05/11/2022',
        'Procedure: Laparoscopic cholecystectomy (gallbladder removal) on 03/11/2022',
        'Recovery uneventful. Follow-up with surgeon in 2 weeks.',
      ].join('\n'),
      extracted_items: [],
    },
    {
      id: 'doc-003',
      profile_id: RESIDENT_ID,
      type: 'discharge_summary',
      document_date: '2021-07-14',
      uploaded_at: '2026-03-02T11:52:00Z',
      status: 'confirmed',
      page_count: 1,
      file_url: MOCK_MEDIA.discharge,
      extracted_text: [
        'Emergency department note',
        'Reaction after first dose of penicillin: generalised rash and facial swelling.',
        'Treated and observed. ALLERGY: PENICILLIN — SEVERE. Avoid all penicillins.',
      ].join('\n'),
      extracted_items: [],
    },
    {
      id: 'doc-001',
      profile_id: RESIDENT_ID,
      type: 'prescription',
      document_date: '2019-06-01',
      uploaded_at: '2026-03-01T09:00:00Z',
      status: 'confirmed',
      page_count: 1,
      // Confirmed long ago: the backend has since deleted the original.
      file_url: null,
      extracted_text: [
        'Internal medicine clinic — 01/06/2019',
        'Diagnosis: Type 2 diabetes mellitus (diagnosed 20/05/2019)',
        'Rx: Metformin 500 mg twice daily',
      ].join('\n'),
      extracted_items: [],
    },
  ];
}

/** What the mock "reads" from a new upload: a type-specific item, a low-confidence one, and a likely duplicate. */
export function extractionFor(
  type: DocumentType,
  documentDate: string | null,
  duplicateOf: { section: 'allergies'; id: string; substance: string } | null,
  nextId: () => string,
): { text: string; items: ExtractedItem[] } {
  const date = documentDate ?? new Date().toISOString().slice(0, 10);
  const items: ExtractedItem[] = [];
  switch (type) {
    case 'prescription':
      items.push({
        item_id: nextId(),
        section: 'medications',
        data: { name: 'Amlodipine', dose: '5 mg', frequency: 'once daily', start: date, end: null },
        confidence: 'high',
        possible_duplicate_of: null,
      });
      break;
    case 'lab_report':
      items.push({
        item_id: nextId(),
        section: 'labs',
        data: { test: 'LDL cholesterol', value: 3.2, unit: 'mmol/L', date, ref_high: 3.0 },
        confidence: 'high',
        possible_duplicate_of: null,
      });
      break;
    case 'discharge_summary':
      items.push({
        item_id: nextId(),
        section: 'procedures',
        data: { name: 'Cardiac stress test', date },
        confidence: 'high',
        possible_duplicate_of: null,
      });
      break;
    case 'imaging_report':
      items.push({
        item_id: nextId(),
        section: 'visits',
        data: { date, specialty: 'Radiology', reason: 'Chest X-ray: no abnormality seen' },
        confidence: 'high',
        possible_duplicate_of: null,
      });
      break;
    case 'other':
      items.push({
        item_id: nextId(),
        section: 'visits',
        data: { date, specialty: 'General', reason: 'Check-up' },
        confidence: 'high',
        possible_duplicate_of: null,
      });
      break;
  }
  items.push({
    item_id: nextId(),
    section: 'medications',
    data: { name: 'Aspirin', dose: '81 mg', frequency: 'once daily', start: null, end: null },
    confidence: 'low',
    possible_duplicate_of: null,
  });
  if (duplicateOf) {
    items.push({
      item_id: nextId(),
      section: 'allergies',
      data: { substance: duplicateOf.substance, reaction: 'rash', severity: 'severe' },
      confidence: 'high',
      possible_duplicate_of: duplicateOf.id,
    });
  }
  const text = [
    `Document dated ${date}`,
    ...items.map((item) => `• ${Object.values(item.data).filter((v) => v !== null && v !== undefined).join(' — ')}`),
  ].join('\n');
  return { text, items };
}

/* ------------------------------------------------------------ Gaps */

/** The text the mock sends with each gap kind, in the request's language. */
export const GAP_TEXT = {
  missing_blood_type: { en: 'Blood type is not recorded.', ar: 'فصيلة الدم غير مسجلة.' },
  no_allergies_recorded: {
    en: 'No allergies are recorded. Add any you know of, even mild ones.',
    ar: 'لا توجد حساسية مسجلة. أضف أي حساسية تعرفها، حتى البسيطة.',
  },
  no_recent_labs: { en: 'No lab results in the last 12 months.', ar: 'لا توجد نتائج تحاليل خلال آخر ١٢ شهرًا.' },
  stale_lab: {
    en: (test: string, date: string) => `Last ${test} result is from ${date} (over 2 years ago).`,
    ar: (test: string, date: string) => `آخر نتيجة لتحليل ${test} بتاريخ ${date} (منذ أكثر من سنتين).`,
  },
} as const;

/* -------------------------------------------------------- Summaries */

const AHMED_EN = [
  'Medical summary for Ahmed, male, born 14 March 1968, aged 58. Blood type is not recorded.',
  'Allergies: penicillin, severe. It causes a rash and swelling.',
  'Current medication: Metformin, 500 milligrams, twice daily, since June 2019.',
  'Chronic conditions: type 2 diabetes, diagnosed in May 2019, active.',
  'Recent lab results: HbA1c was 7.6 percent on 19 August 2026, above the normal limit of 5.7, and down from 8.1 a year earlier.',
  'Fasting glucose was 142 milligrams per decilitre on the same day, above normal.',
  'The last LDL cholesterol result, 3.6 millimoles per litre, is from March 2024, more than two years ago.',
  'Past procedures: gallbladder removal in November 2022.',
  'Last visit: internal medicine on 20 August 2026, for a diabetes follow-up.',
].join('\n\n');

const AHMED_AR = [
  'ملخص طبي لأحمد، ذكر، مواليد ١٤ مارس ١٩٦٨، العمر ٥٨ عامًا. فصيلة الدم غير مسجلة.',
  'الحساسية: البنسلين (Penicillin)، شديدة، وتسبب طفحًا جلديًا وتورمًا.',
  'الدواء الحالي: Metformin بجرعة ٥٠٠ ملغ مرتين يوميًا منذ يونيو ٢٠١٩.',
  'الأمراض المزمنة: السكري من النوع الثاني، تم تشخيصه في مايو ٢٠١٩، ولا يزال نشطًا.',
  'أحدث التحاليل: HbA1c بنسبة ٧٫٦٪ بتاريخ ١٩ أغسطس ٢٠٢٦، أعلى من الحد الطبيعي ٥٫٧، وانخفض من ٨٫١ قبل عام.',
  'سكر صائم ١٤٢ ملغ/دسل في اليوم نفسه، أعلى من الطبيعي.',
  'آخر نتيجة كوليسترول LDL كانت ٣٫٦ مليمول/لتر في مارس ٢٠٢٤، أي منذ أكثر من سنتين.',
  'العمليات السابقة: استئصال المرارة في نوفمبر ٢٠٢٢.',
  'آخر زيارة: الباطنة بتاريخ ٢٠ أغسطس ٢٠٢٦ لمتابعة السكري.',
].join('\n\n');

const LAILA_EN = [
  'Medical summary for Laila, female, born 2 May 2016, aged 10. Blood type O positive.',
  'No allergies, medications or chronic conditions are recorded.',
  'Last visit: pediatrics on 11 April 2026, for a vaccination.',
].join('\n\n');

const LAILA_AR = [
  'ملخص طبي لليلى، أنثى، مواليد ٢ مايو ٢٠١٦، العمر ١٠ سنوات. فصيلة الدم O موجب.',
  'لا توجد حساسية أو أدوية أو أمراض مزمنة مسجلة.',
  'آخر زيارة: طب الأطفال بتاريخ ١١ أبريل ٢٠٢٦ للتطعيم.',
].join('\n\n');

/** The fixed transcripts the bundled sample audio reads out. */
export const SUMMARY_SCRIPTS: Record<string, Record<HealthLang, { transcript: string; audio: string }>> = {
  [RESIDENT_ID]: {
    en: { transcript: AHMED_EN, audio: MOCK_MEDIA.audioAhmedEn },
    ar: { transcript: AHMED_AR, audio: MOCK_MEDIA.audioAhmedAr },
  },
  [CHILD_ID]: {
    en: { transcript: LAILA_EN, audio: MOCK_MEDIA.audioLailaEn },
    ar: { transcript: LAILA_AR, audio: MOCK_MEDIA.audioLailaAr },
  },
};

/**
 * Two summaries for the resident: a current general one in Arabic (the kind
 * the server prepares after every record change, so it's ready at the
 * visit) and an older English one, made before the record last changed.
 */
export function seedSummaries(): Summary[] {
  return [
    {
      status: 'ready',
      lang: 'ar',
      specialty: 'general',
      transcript: AHMED_AR,
      audio_url: MOCK_MEDIA.audioAhmedAr,
      cached: false,
      generated_at: '2026-10-20T09:24:00Z',
      record_updated_at: '2026-10-20T09:12:00Z',
    },
    {
      status: 'ready',
      lang: 'en',
      specialty: 'general',
      transcript: AHMED_EN,
      audio_url: MOCK_MEDIA.audioAhmedEn,
      cached: false,
      generated_at: '2026-10-10T08:30:00Z',
      record_updated_at: '2026-10-05T14:00:00Z',
    },
  ];
}

/** Why the mock's one simulated failure failed, in the request's language. */
export const SUMMARY_FAILED_TEXT = {
  en: 'The summary couldn’t be finished. Please try again.',
  ar: 'تعذّر إكمال الملخص. يرجى المحاولة مرة أخرى.',
} as const;
