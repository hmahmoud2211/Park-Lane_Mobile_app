import { ApiError } from '../errors.ts';
import { normalize } from '../lib/text.ts';
import { generate } from '../integrations/ai/model.ts';
import { log } from '../log.ts';
import type { Gap, HealthLang, Item, RecordSections } from './passport.ts';

/**
 * The spoken handover: a 60-90 second script a doctor listens to at the
 * start of a consultation, written by the AI from the patient's record and
 * read aloud by ElevenLabs. Used by Health Passport's "Summary for doctor"
 * and by the clinic's "Listen to summary".
 *
 * The record is given to the model as `facts` (shape below, as the prompt
 * describes it). The script that comes back is checked here against those
 * facts, as the prompt promises: every allergy and current medicine named,
 * no number that is not in the facts, no symbols or unit abbreviations,
 * "Important" before a severe allergy, a sensible length. A script that
 * fails is sent back once with what was wrong; failing again, it is
 * rejected. The closing line is added here, not by the model.
 */

export const SPOKEN_SYSTEM_PROMPT = `ROLE
You are a clinical documentation assistant. You turn a patient's verified medical record into a
short spoken handover that a physician LISTENS to in the first minute of a consultation, the way an
experienced colleague would brief them: accurate, prioritised, neutral, and easy to follow by ear.

INPUT
A JSON object:
- "language": "ar" or "en" (the language to speak).
- "doctor_specialty": the specialty of the doctor who will listen, or null for a general doctor.
- "facts": the ONLY source of truth. Fields that may appear:
  patient {name, sex, age, blood_type}; allergies [{substance, reaction, severity}];
  current_medications / past_medications [{name, dose, frequency, start, end}];
  active_conditions / resolved_conditions [{name, diagnosed, status}];
  procedures [{name, date}]; lab_trends [{test, direction, values[{value, unit, date}]}];
  abnormal_latest_labs [{test, value, unit, date, ref_low, ref_high, flag}];
  recent_visits [{date, specialty, reason}]; gaps [{kind, text, text_ar}].
  Missing fields mean "not recorded".

ACCURACY RULES (these are checked automatically; a script that breaks them is rejected)
1. Use only facts from the JSON. Never add, assume, interpret, diagnose, explain causes, or
   recommend tests or treatment. Do not describe something as worrying, controlled or normal
   unless the facts say so (a "flag" of high or low may be stated).
2. Mention EVERY allergy and EVERY current medication, using the name exactly as written in the facts.
3. Write every number with digits (500, 7.6, 2022), never as words, and copy it exactly.
4. Say each number right after the name of the item it belongs to. Never put a number from one
   item next to another item's name.
5. Never calculate anything: no durations ("for 5 years"), no ages at diagnosis, no differences,
   no averages, no counts except the number of results in a lab trend.
6. If a value has no date, do not invent one. If something is not in the facts, do not mention it,
   except the gaps listed in "gaps".

ORDER AND PRIORITY
1. Opening: patient's first name, age, sex. One sentence.
2. Safety first: allergies with their reaction; say "Important" (Arabic: "مهم") before any allergy
   whose severity is severe. If there are no allergies in the facts, say allergies are not recorded.
3. Current medications: name, dose, frequency. Say high-alert medicines first if present
   (anticoagulants, antiplatelets, insulin, other diabetes medicines, opioids, immunosuppressants,
   anti-epileptics, chemotherapy), then the rest.
4. Active conditions with the year or month diagnosed.
5. Recent and abnormal results: lab trends first (direction, the values in order, latest date),
   then other abnormal latest results with value, unit and whether high or low.
6. Relevant history: procedures with dates, then stopped medications with when they stopped,
   then resolved conditions. Keep this brief.
7. Recent visits, only if they add something not already said.
8. Gaps in the record, briefly (use "text" in English, "text_ar" in Arabic).

SPECIALTY FOCUS (only when doctor_specialty is given)
Keep the order above, but inside each part say first what matters most to that specialty, and keep
unrelated history shorter. Never drop allergies or current medications. Guidance:
cardiology: blood pressure and heart medicines, antiplatelets/anticoagulants, lipids, diabetes,
kidney function, cardiac procedures. Endocrinology: diabetes medicines, HbA1c and glucose, thyroid
tests, lipids, weight-related conditions. Nephrology: creatinine and kidney tests, blood pressure,
diabetes, medicines cleared by the kidney. Gastroenterology: digestive conditions and procedures,
liver tests, anticoagulants. Neurology: anti-epileptics, stroke risk factors, anticoagulants.
Pulmonology: inhalers, respiratory conditions, chest imaging. Orthopedics or surgery:
anticoagulants/antiplatelets, diabetes, previous operations, allergies to anaesthetic or antibiotic.
Gynecology: pregnancy-relevant medicines and conditions. Pediatrics: say the age clearly; keep the
same safety order. Other specialties: use clinical judgment about relevance.

SPOKEN STYLE
- Written for the ear: short sentences of one idea each, no lists, bullets, tables, brackets,
  abbreviations of units, symbols (%, /, +) or markdown.
- Units as English words: milligrams, micrograms, units, milligrams per deciliter, percent.
- Dates as month name and year, e.g. "November 2022"; in Arabic use Egyptian month names, e.g. "نوفمبر 2022".
- Length: about 60 to 90 seconds of speech (English about 150 to 220 words, Arabic about 120 to 180
  words). If the record is long, shorten history, never safety items or current medicines.
- No greeting, no sign-off, no closing disclaimer (it is added automatically), no mention of
  being an AI or of the JSON.

LANGUAGE
- "en": concise clinical English, third person ("He takes ...", "She was diagnosed with ...").
- "ar": Egyptian Arabic as Egyptian doctors speak to each other (not formal MSA), third person,
  matching the patient's sex (بياخد / بتاخد، عنده / عندها). Keep drug names, test names and
  medical terms in English, in Latin letters, exactly as written in the facts. Natural phrases:
  "اتشخص بـ"، "بياخد ... مرتين في اليوم"، "عمل عملية"، "آخر نتيجة"، "وقف ... في".

OUTPUT
Return ONLY the script as plain text, one paragraph, nothing before or after it.`;

/** Added after every script, in its language. */
export const CLOSING: Record<HealthLang, string> = {
  en: 'This summary was prepared automatically from the patient’s Health Passport records. Please confirm important details with the patient.',
  ar: 'الملخص ده اتعمل أوتوماتيك من سجلات الجواز الصحي للمريض. من فضلك اتأكد من التفاصيل المهمة مع المريض.',
};

type Plain = Record<string, unknown>;

export interface Facts {
  patient: Plain;
  allergies?: Plain[];
  current_medications?: Plain[];
  past_medications?: Plain[];
  active_conditions?: Plain[];
  resolved_conditions?: Plain[];
  procedures?: Plain[];
  lab_trends?: { test: string; direction: 'rising' | 'falling' | 'stable'; values: Plain[] }[];
  abnormal_latest_labs?: Plain[];
  recent_visits?: Plain[];
  gaps?: Plain[];
}

/** Without nulls and empty lists: the prompt reads a missing field as "not recorded". */
function compact<T>(value: T): T {
  if (Array.isArray(value)) return value.map(compact) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Plain)
        .filter(([, entry]) => entry !== null && entry !== undefined && entry !== '' && !(Array.isArray(entry) && entry.length === 0))
        .map(([key, entry]) => [key, compact(entry)]),
    ) as T;
  }
  return value;
}

const pickFields = (item: Item, fields: readonly string[]) => Object.fromEntries(fields.map((field) => [field, item[field] ?? null]));

const TWO_YEARS_MS = 2 * 365.25 * 24 * 3600_000;

/**
 * The prompt's `facts` from a Health Passport record: medicines split by
 * whether they have ended, conditions by status, labs into trends (a test
 * with two or more results, oldest first) and abnormal latest results, and
 * visits from the last two years. Item ids and sources are left out.
 */
export function buildFacts(
  patient: { first_name: string; sex: string | null; age: number | null; blood_type: string | null },
  sections: RecordSections,
  gaps: { en: Gap[]; ar: Gap[] },
  nowMs = Date.now(),
): Facts {
  const today = new Date(nowMs).toISOString().slice(0, 10);
  const meds = sections.medications.map((item) => pickFields(item, ['name', 'dose', 'frequency', 'start', 'end']));
  const labs = sections.labs as unknown as { test: string; value: number; unit: string | null; date: string; ref_low?: number | null; ref_high?: number | null }[];
  const byTest = new Map<string, typeof labs>();
  for (const lab of labs) byTest.set(lab.test, [...(byTest.get(lab.test) ?? []), lab]);
  const trends: NonNullable<Facts['lab_trends']> = [];
  const abnormal: Plain[] = [];
  for (const [test, results] of byTest) {
    const ordered = [...results].sort((a, b) => a.date.localeCompare(b.date));
    if (ordered.length >= 2) {
      const recent = ordered.slice(-4);
      const [first, last] = [recent[0].value, recent[recent.length - 1].value];
      trends.push({
        test,
        direction: last > first ? 'rising' : last < first ? 'falling' : 'stable',
        values: recent.map((lab) => ({ value: lab.value, unit: lab.unit, date: lab.date })),
      });
      continue;
    }
    const latest = ordered[ordered.length - 1];
    const flag =
      typeof latest.ref_high === 'number' && latest.value > latest.ref_high ? 'high' : typeof latest.ref_low === 'number' && latest.value < latest.ref_low ? 'low' : null;
    if (flag) {
      abnormal.push({ test, value: latest.value, unit: latest.unit, date: latest.date, ref_low: latest.ref_low ?? null, ref_high: latest.ref_high ?? null, flag });
    }
  }
  const visits = (sections.visits as unknown as { date: string; specialty: string | null; reason: string | null }[])
    .filter((visit) => nowMs - Date.parse(visit.date) <= TWO_YEARS_MS)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 5)
    .map((visit) => ({ date: visit.date, specialty: visit.specialty, reason: visit.reason }));
  const arabic = new Map(gaps.ar.map((gap) => [`${gap.kind}|${gap.test ?? ''}`, gap.text]));

  return compact({
    patient: { name: patient.first_name, sex: patient.sex, age: patient.age, blood_type: patient.blood_type },
    allergies: sections.allergies.map((item) => pickFields(item, ['substance', 'reaction', 'severity'])),
    current_medications: meds.filter((med) => !med.end || String(med.end) >= today),
    past_medications: meds.filter((med) => med.end && String(med.end) < today),
    active_conditions: sections.conditions.filter((item) => item.status === 'active').map((item) => pickFields(item, ['name', 'diagnosed', 'status'])),
    resolved_conditions: sections.conditions.filter((item) => item.status !== 'active').map((item) => pickFields(item, ['name', 'diagnosed', 'status'])),
    procedures: sections.procedures.map((item) => pickFields(item, ['name', 'date'])),
    lab_trends: trends,
    abnormal_latest_labs: abnormal,
    recent_visits: visits,
    gaps: gaps.en.map((gap) => ({ kind: gap.kind, text: gap.text, text_ar: arabic.get(`${gap.kind}|${gap.test ?? ''}`) ?? null })),
  });
}

// ---- The automatic check ------------------------------------------------------------------

const ARABIC_DIGITS = /[٠-٩]/g;
const toLatinDigits = (text: string) => text.replace(ARABIC_DIGITS, (digit) => String(digit.charCodeAt(0) - 0x660)).replace(/(\d)٫(\d)/g, '$1.$2');

function numbersIn(text: string): number[] {
  return (toLatinDigits(text).match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
}

const SYMBOLS = /[%/+()[\]{}*#•|<>=_~`]/;
const UNIT_ABBREVIATION = /\d\s*(mg|mcg|µg|ug|ml|g|kg|mmol|mol|dl|iu|bpm|mmhg)\b/i;
const MENTIONS_AI = /\b(AI|artificial intelligence|JSON|language model)\b|ذكاء اصطناعي/i;
const WORDS = { en: [60, 330], ar: [45, 300] } as const;

/** Everything wrong with a script, in words the model can act on; empty when it passes. */
export function checkScript(script: string, facts: Facts, lang: HealthLang): string[] {
  const problems: string[] = [];
  const text = script.trim();
  const plain = normalize(text);
  if (SYMBOLS.test(text)) problems.push('It uses symbols or brackets (for example %, /, +, parentheses or markdown). Write them as words.');
  if (UNIT_ABBREVIATION.test(toLatinDigits(text))) problems.push('It abbreviates units (for example mg or mmol). Write units as English words.');
  if (MENTIONS_AI.test(text)) problems.push('It mentions being an AI or the JSON.');

  const allowed = new Set(numbersIn(JSON.stringify(facts)));
  for (const trend of facts.lab_trends ?? []) allowed.add(trend.values.length);
  const strays = [...new Set(numbersIn(text).filter((value) => !allowed.has(value)))];
  if (strays.length) problems.push(`It contains numbers that are not in the facts: ${strays.join(', ')}. Copy numbers exactly and never calculate.`);

  const missing = [
    ...(facts.allergies ?? []).map((item) => String(item.substance)),
    ...(facts.current_medications ?? []).map((item) => String(item.name)),
  ].filter((name) => !plain.includes(normalize(name)));
  if (missing.length) problems.push(`It does not mention, exactly as written: ${missing.join(', ')}. Mention every allergy and every current medication.`);

  const important = lang === 'ar' ? 'مهم' : 'important';
  for (const allergy of (facts.allergies ?? []).filter((item) => item.severity === 'severe')) {
    const at = plain.indexOf(normalize(String(allergy.substance)));
    const flagged = at > 0 && plain.slice(0, at).includes(normalize(important));
    if (at >= 0 && !flagged) problems.push(`It does not say "${important}" before the severe allergy ${String(allergy.substance)}.`);
  }
  if (!(facts.allergies ?? []).length && !(lang === 'ar' ? /حساسي/.test(text) : /allerg/i.test(text))) {
    problems.push('It does not say that allergies are not recorded.');
  }

  const words = text.split(/\s+/).filter(Boolean).length;
  const [fewest, most] = WORDS[lang];
  if (words < fewest || words > most) problems.push(`It is ${words} words long; keep it to about ${lang === 'ar' ? '120 to 180' : '150 to 220'} words.`);
  return problems;
}

/** "internal_medicine" as the prompt reads it; null for a general doctor. */
export function specialtyName(key: string | null): string | null {
  if (!key || key === 'general') return null;
  return key === 'ent' ? 'ear, nose and throat' : key.replace(/_/g, ' ');
}

/**
 * The script for these facts, checked, with the closing line added. Throws
 * `ai_failed` when it still fails its check after one correction.
 */
export async function writeSpokenSummary(facts: Facts, lang: HealthLang, specialty: string | null, purpose: string): Promise<string> {
  const input = JSON.stringify({ language: lang, doctor_specialty: specialty, facts });
  let feedback = '';
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const answer = await generate({
      purpose,
      system: SPOKEN_SYSTEM_PROMPT,
      prompt: feedback ? `${input}\n\nYour previous script was rejected by the automatic check:\n${feedback}\nWrite the script again, following every rule.` : input,
      maxTokens: 4_096,
    });
    const script = answer.text.replace(/\s+/g, ' ').trim();
    const problems = checkScript(script, facts, lang);
    if (problems.length === 0) return `${script}\n\n${CLOSING[lang]}`;
    // What failed, never the script: it is medical content.
    log.warn('Spoken summary failed its check', { purpose, attempt, problems: problems.length });
    feedback = problems.map((problem) => `- ${problem}`).join('\n');
  }
  throw new ApiError('ai_failed', 'The summary did not pass its accuracy check. Try again.');
}
