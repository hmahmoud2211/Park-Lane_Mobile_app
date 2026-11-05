import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';

/**
 * Health Passport's AI work over HTTP, with Gemini and ElevenLabs as
 * stand-ins on localhost that answer like generateContent and the
 * text-to-speech API: reading an uploaded document into reviewable items,
 * confirming them into the record, the spoken summary with its automatic
 * check, signed media links, and deleting everything on request.
 */

async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const { port } = probe.address() as AddressInfo;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

const [appPort, geminiPort, voicePort] = [await freePort(), await freePort(), await freePort()];
const BASE = `http://127.0.0.1:${appPort}`;
const dataDir = mkdtempSync(join(tmpdir(), 'ems-health-ai-'));

Object.assign(process.env, {
  DATA_DIR: dataDir,
  GEMINI_API_KEY: 'test-gemini-key',
  GEMINI_BASE_URL: `http://127.0.0.1:${geminiPort}`,
  GEMINI_MODEL: 'gemini-3.8-flash',
  GEMINI_THINKING_LEVEL: 'medium',
  ELEVENLABS_API_KEY: 'test-eleven-key',
  ELEVENLABS_BASE_URL: `http://127.0.0.1:${voicePort}`,
  ANTHROPIC_API_KEY: '',
  AI_PROVIDER: '',
});

const { createApp } = await import('../src/app.ts');
const { closeDb } = await import('../src/ems/db.ts');
const { resetLimits } = await import('../src/ems/rateLimit.ts');
const { idle } = await import('../src/health/jobs.ts');
const { speechParts } = await import('../src/integrations/elevenlabs.ts');
const { CLOSING, DOCUMENT_SYSTEM_PROMPT, SPOKEN_SYSTEM_PROMPT, checkScript } = {
  ...(await import('../src/health/spoken.ts')),
  ...(await import('../src/health/documents.ts')),
};

// ---- Gemini and ElevenLabs stand-ins ----------------------------------------------------------

interface GeminiCall {
  path: string;
  key: string | undefined;
  body: {
    systemInstruction: { parts: { text: string }[] };
    contents: { parts: ({ text: string } | { inlineData: { mimeType: string; data: string } })[] }[];
    generationConfig: { responseMimeType?: string; responseJsonSchema?: unknown; thinkingConfig: { thinkingLevel: string } };
  };
}

const gemini = {
  calls: [] as GeminiCall[],
  /** What the next document pages read as, page by page. */
  pages: [] as unknown[],
  /** The spoken scripts to answer with, in order; the last one repeats. */
  scripts: [] as string[],
};

const PRESCRIPTION_PAGE_1 = {
  document_date: '2026-09-02',
  text: 'Dr. Hany Saleh — Internal Medicine\n02/09/2026\nGlucophage 1000 mg 1 x 2\nMetformin 500 mg 1 x 2\nAllergy: Sulfa',
  items: [
    { section: 'medications', data: { name: 'Glucophage', dose: '1000 mg', frequency: 'twice daily', start: null, end: null }, confidence: 'high' },
    { section: 'medications', data: { name: 'Metformin', dose: '500 mg', frequency: 'twice daily', start: null, end: null }, confidence: 'high' },
    { section: 'allergies', data: { substance: 'Sulfa', reaction: null, severity: null }, confidence: 'high' },
    { section: 'medications', data: { name: '', dose: null, frequency: null, start: null, end: null }, confidence: 'low' },
  ],
};
const PRESCRIPTION_PAGE_2 = {
  document_date: null,
  text: 'HbA1c 7.2 % (sep 2026)',
  items: [{ section: 'labs', data: { test: 'HbA1c', value: 7.2, unit: '%', date: '2026-09', ref_low: null, ref_high: 5.7 }, confidence: 'high' }],
};

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

const geminiServer: Server = createServer(async (req, res) => {
  const body = JSON.parse((await readBody(req)).toString()) as GeminiCall['body'];
  gemini.calls.push({ path: req.url ?? '', key: req.headers['x-goog-api-key'] as string | undefined, body });
  const system = body.systemInstruction.parts[0].text;
  const text = system.includes('medical records clerk')
    ? JSON.stringify(gemini.pages.shift() ?? { document_date: null, text: '', items: [] })
    : (gemini.scripts.length > 1 ? gemini.scripts.shift() : gemini.scripts[0]) ?? '';
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(
    JSON.stringify({
      candidates: [{ content: { role: 'model', parts: [{ text: 'thinking about it', thought: true }, { text }] }, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 10, thoughtsTokenCount: 5 },
      modelVersion: 'gemini-3.8-flash',
    }),
  );
});

const voice = { tts: [] as { path: string; text: string; model: string; language: string | undefined }[] };
const voiceServer: Server = createServer(async (req, res) => {
  const body = JSON.parse((await readBody(req)).toString()) as { text: string; model_id: string; language_code?: string };
  voice.tts.push({ path: req.url ?? '', text: body.text, model: body.model_id, language: body.language_code });
  res.writeHead(200, { 'Content-Type': 'audio/mpeg' });
  // Each part's audio names its text, so the joined recording shows the order.
  res.end(Buffer.from(`ID3[${body.text}]`));
});

// ---- Helpers --------------------------------------------------------------------------------

async function call<T = Record<string, any>>(method: string, path: string, token: string, body?: unknown, lang = 'en') {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Accept-Language': lang, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = response.status === 204 ? undefined : await response.json();
  return { status: response.status, data: data as T };
}

let residents = 0;
async function resident() {
  residents += 1;
  resetLimits();
  const registered = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `reader${residents}@example.com`, password: 'correct horse battery', name: `Mona Adel ${residents}` }),
  });
  const { data } = (await registered.json()) as { data: { token: string } };
  await call('POST', '/health/consent', data.token, { given: true });
  const [self] = (await call<{ id: string }[]>('GET', '/health/profiles', data.token)).data;
  await call('PUT', `/health/profiles/${self.id}`, data.token, { name: `Mona Adel ${residents}`, sex: 'female', date_of_birth: '1971-01-20', blood_type: 'A+' });
  return { token: data.token, profileId: self.id };
}

function upload(token: string, profileId: string, pages: { bytes: Buffer; type: string; name: string }[], fields: Record<string, string> = { type: 'prescription' }) {
  const form = new FormData();
  for (const page of pages) form.append('files[]', new Blob([new Uint8Array(page.bytes)], { type: page.type }), page.name);
  for (const [name, value] of Object.entries(fields)) form.append(name, value);
  return fetch(`${BASE}/health/profiles/${profileId}/documents`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form });
}

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(6000, 0x42)]);
const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(3000, 0x20)]);
const filesDir = join(dataDir, 'health', 'files');

let server: Server;
before(async () => {
  await new Promise<void>((resolve) => geminiServer.listen(geminiPort, '127.0.0.1', resolve));
  await new Promise<void>((resolve) => voiceServer.listen(voicePort, '127.0.0.1', resolve));
  server = createApp();
  await new Promise<void>((resolve) => server.listen(appPort, '127.0.0.1', resolve));
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await new Promise((resolve) => geminiServer.close(resolve));
  await new Promise((resolve) => voiceServer.close(resolve));
  closeDb();
});

// ---- Tests ----------------------------------------------------------------------------------

describe('reading uploaded documents with Gemini', () => {
  let patient: Awaited<ReturnType<typeof resident>>;
  let docId: string;
  let metforminId: string;

  before(async () => {
    patient = await resident();
    metforminId = (await call<{ id: string }>('POST', `/health/profiles/${patient.profileId}/medications`, patient.token, { name: 'Metformin', dose: '500 mg', frequency: 'twice daily', start: '2019-06-01', end: null })).data.id;
  });

  test('pages are stored sealed and read one by one, with the document prompt, as JSON', async () => {
    gemini.pages = [PRESCRIPTION_PAGE_1, PRESCRIPTION_PAGE_2];
    const response = await upload(patient.token, patient.profileId, [
      { bytes: JPEG, type: 'image/jpeg', name: 'page1.jpg' },
      { bytes: PDF, type: 'application/pdf', name: 'page2.pdf' },
    ]);
    assert.equal(response.status, 200);
    const created = (await response.json()) as { id: string; status: string };
    assert.equal(created.status, 'processing');
    docId = created.id;

    const stored = readdirSync(filesDir).map((name) => readFileSync(join(filesDir, name)));
    assert.equal(stored.length, 2);
    assert.ok(stored.every((file) => !file.includes(JPEG.subarray(4, 64)) && !file.includes(Buffer.from('%PDF'))), 'pages are sealed on disk');

    await idle();
    const [first, second] = gemini.calls.slice(-2);
    assert.match(first.path, /^\/v1beta\/models\/gemini-3\.8-flash:generateContent$/);
    assert.equal(first.key, 'test-gemini-key');
    assert.equal(first.body.systemInstruction.parts[0].text, DOCUMENT_SYSTEM_PROMPT);
    assert.equal(first.body.generationConfig.responseMimeType, 'application/json');
    assert.ok(first.body.generationConfig.responseJsonSchema);
    assert.equal(first.body.generationConfig.thinkingConfig.thinkingLevel, 'medium');
    const [image, prompt] = first.body.contents[0].parts as [{ inlineData: { mimeType: string; data: string } }, { text: string }];
    assert.equal(image.inlineData.mimeType, 'image/jpeg');
    assert.deepEqual(Buffer.from(image.inlineData.data, 'base64'), JPEG);
    assert.match(prompt.text, /page 1 of 2/);
    assert.equal((second.body.contents[0].parts[0] as { inlineData: { mimeType: string } }).inlineData.mimeType, 'application/pdf');
  });

  test('items wait for review: unnamed ones dropped, uncertain ones low, repeats pointed at the record', async () => {
    const doc = (await call<Record<string, any>>('GET', `/health/documents/${docId}`, patient.token)).data;
    assert.equal(doc.status, 'needs_review');
    assert.equal(doc.document_date, '2026-09-02', 'read from the page when the resident gave none');
    assert.equal(doc.page_count, 2);
    assert.match(doc.extracted_text, /Glucophage 1000 mg/);
    const items = doc.extracted_items as { item_id: string; section: string; data: Record<string, unknown>; confidence: string; possible_duplicate_of: string | null }[];
    assert.deepEqual(items.map((item) => item.section), ['medications', 'medications', 'allergies', 'labs']);
    const [glucophage, metformin, sulfa, hba1c] = items;
    assert.equal(glucophage.data.start, '2026-09-02', 'an undated prescription item takes the document date');
    assert.equal(glucophage.confidence, 'high');
    assert.equal(metformin.possible_duplicate_of, metforminId);
    assert.equal(sulfa.data.severity, null, 'a severity that is not written is left for the resident');
    assert.equal(sulfa.confidence, 'low');
    assert.equal(hba1c.data.date, '2026-09-01');
    assert.equal(hba1c.confidence, 'low', 'a month-only date is checked by hand');

    // The original is shown by a signed link, without a session, and nothing opens with a forged one.
    const page = await fetch(doc.file_url);
    assert.equal(page.status, 200);
    assert.equal(page.headers.get('content-type'), 'image/jpeg');
    assert.deepEqual(Buffer.from(await page.arrayBuffer()), JPEG);
    assert.equal((await fetch(doc.file_url.replace(/sig=[^&]+/, 'sig=forged'))).status, 404);
    assert.equal((await fetch(`${BASE}/health/media/document/${docId}/1`)).status, 404);
  });

  test('confirming saves exactly what the resident approved, with the document as source', async () => {
    const doc = (await call<Record<string, any>>('GET', `/health/documents/${docId}`, patient.token)).data;
    const [glucophage, metformin, sulfa, hba1c] = doc.extracted_items as { item_id: string; data: Record<string, unknown> }[];
    const missingSeverity = await call<{ detail: string }>('POST', `/health/documents/${docId}/confirm`, patient.token, { items: [{ item_id: sulfa.item_id, action: 'add', data: sulfa.data }] });
    assert.equal(missingSeverity.status, 422);
    assert.equal(missingSeverity.data.detail, 'severity');

    const confirmed = await call<Record<string, any>>('POST', `/health/documents/${docId}/confirm`, patient.token, {
      items: [
        { item_id: glucophage.item_id, action: 'add', data: glucophage.data },
        { item_id: metformin.item_id, action: 'replace', data: { ...metformin.data, start: '2019-06-01' }, replace_id: metforminId },
        { item_id: sulfa.item_id, action: 'add', data: { ...sulfa.data, severity: 'moderate' } },
        { item_id: hba1c.item_id, action: 'reject' },
      ],
      finished: true,
    });
    assert.equal(confirmed.status, 200);
    assert.equal(confirmed.data.status, 'confirmed');
    const record = (await call<Record<string, any>>('GET', `/health/profiles/${patient.profileId}/record`, patient.token)).data;
    assert.deepEqual(record.medications.map((med: { name: string; source: string }) => [med.name, med.source]).sort(), [
      ['Glucophage', docId],
      ['Metformin', docId],
    ]);
    assert.equal(record.allergies[0].severity, 'moderate');
    assert.equal(record.labs.length, 0, 'a rejected item is not saved');
  });

  test('an unreadable document fails with the app’s own wording, in the request’s language', async () => {
    gemini.pages = [{ document_date: null, text: '', items: [] }];
    const created = (await (await upload(patient.token, patient.profileId, [{ bytes: JPEG, type: 'image/jpeg', name: 'blurry.jpg' }])).json()) as { id: string };
    await idle();
    const doc = (await call<Record<string, any>>('GET', `/health/documents/${created.id}`, patient.token, undefined, 'ar')).data;
    assert.equal(doc.status, 'failed');
    assert.equal(doc.error, 'الصور غير واضحة بما يكفي للقراءة. حاول مرة أخرى في إضاءة جيدة مع ظهور الصفحة كاملة.');
    assert.equal(doc.extracted_items, null);
  });

  test('uploads are checked before anything is stored', async () => {
    const tooMany = await upload(patient.token, patient.profileId, Array.from({ length: 11 }, (_, i) => ({ bytes: JPEG, type: 'image/jpeg', name: `p${i}.jpg` })));
    assert.equal(tooMany.status, 422);
    const wrongType = await upload(patient.token, patient.profileId, [{ bytes: JPEG, type: 'text/plain', name: 'notes.txt' }]);
    assert.equal(wrongType.status, 422);
    const noType = await upload(patient.token, patient.profileId, [{ bytes: JPEG, type: 'image/jpeg', name: 'p.jpg' }], {});
    assert.equal(noType.status, 422);
    const stranger = await resident();
    assert.equal((await upload(stranger.token, patient.profileId, [{ bytes: JPEG, type: 'image/jpeg', name: 'p.jpg' }])).status, 404);
  });

  test('deleting a document with its items removes the items and the sealed pages', async () => {
    const before = readdirSync(filesDir).length;
    const deleted = await call('DELETE', `/health/documents/${docId}?delete_items=true`, patient.token);
    assert.equal(deleted.status, 204);
    assert.equal(readdirSync(filesDir).length, before - 2);
    const record = (await call<Record<string, any>>('GET', `/health/profiles/${patient.profileId}/record`, patient.token)).data;
    assert.equal(record.medications.length, 0);
    assert.equal(record.allergies.length, 0);
  });
});

const GOOD_SCRIPT =
  'Mona is 55 years old and female. Important, she has a severe allergy to Penicillin, which causes hives. ' +
  'She takes Bisoprolol 5 milligrams once daily and Atorvastatin 20 milligrams once daily at night. ' +
  'She has hypertension, diagnosed in March 2021, and it is active. Her blood type is A positive. ' +
  'Her LDL cholesterol was 4.1 in January 2026, above its reference range. There are no other recent results in the record.';

describe('spoken summaries for the doctor', () => {
  let patient: Awaited<ReturnType<typeof resident>>;

  before(async () => {
    patient = await resident();
    const add = (section: string, body: Record<string, unknown>) => call('POST', `/health/profiles/${patient.profileId}/${section}`, patient.token, body);
    await add('allergies', { substance: 'Penicillin', reaction: 'hives', severity: 'severe' });
    await add('medications', { name: 'Bisoprolol', dose: '5 mg', frequency: 'once daily', start: '2021-03-10', end: null });
    await add('medications', { name: 'Atorvastatin', dose: '20 mg', frequency: 'once daily at night', start: '2022-01-05', end: null });
    await add('conditions', { name: 'Hypertension', diagnosed: '2021-03-10', status: 'active' });
    await add('labs', { test: 'LDL cholesterol', value: 4.1, unit: 'mmol/L', date: '2026-01-15', ref_high: 3.0 });
  });

  test('the automatic check catches what the prompt forbids', () => {
    const facts = {
      patient: { name: 'Mona', sex: 'female', age: 55 },
      allergies: [{ substance: 'Penicillin', reaction: 'hives', severity: 'severe' }],
      current_medications: [{ name: 'Bisoprolol', dose: '5 mg', frequency: 'once daily' }],
    };
    const base = 'Mona is 55 years old. Important, she is allergic to Penicillin. She takes Bisoprolol 5 milligrams once daily. '.repeat(4);
    assert.deepEqual(checkScript(base, facts, 'en'), []);
    const problems = (script: string) => checkScript(script, facts, 'en').join(' ');
    assert.match(problems(`${base} She has taken it for 6 years.`), /numbers that are not in the facts: 6/);
    assert.match(problems(base.replace('5 milligrams', '5 mg')), /abbreviates units/);
    assert.match(problems(`${base} (100%)`), /symbols/);
    assert.match(problems(base.replace(/Important, /g, '')), /before the severe allergy Penicillin/);
    assert.match(problems(base.replace(/Bisoprolol/g, 'her heart pill')), /does not mention.*Bisoprolol/);
    assert.match(problems('Mona is 55.'), /words long/);
    // Arabic-Indic digits count as the same numbers.
    const arabic = 'منى عندها ٥٥ سنة. مهم، عندها حساسية من Penicillin. بتاخد Bisoprolol ٥ مليجرام مرة في اليوم. '.repeat(4);
    assert.deepEqual(checkScript(arabic, facts, 'ar'), []);
  });

  test('a summary is written from the facts, checked, recorded, and served by a signed link', async () => {
    gemini.scripts = [GOOD_SCRIPT];
    const voiced = voice.tts.length;
    const started = await call<Record<string, any>>('POST', `/health/profiles/${patient.profileId}/summary`, patient.token, { lang: 'en', specialty: 'cardiology', consent: true, async: true });
    assert.equal(started.status, 202);
    assert.equal(started.data.status, 'generating');
    await idle();

    const spoken = gemini.calls.at(-1) as GeminiCall;
    assert.equal(spoken.body.systemInstruction.parts[0].text, SPOKEN_SYSTEM_PROMPT);
    assert.equal(spoken.body.generationConfig.responseMimeType, undefined, 'the script is plain text');
    const input = JSON.parse((spoken.body.contents[0].parts[0] as { text: string }).text);
    assert.equal(input.language, 'en');
    assert.equal(input.doctor_specialty, 'cardiology');
    assert.deepEqual(input.facts.patient, { name: 'Mona', sex: 'female', age: 55, blood_type: 'A+' });
    assert.deepEqual(input.facts.current_medications.map((med: { name: string }) => med.name), ['Bisoprolol', 'Atorvastatin']);
    assert.deepEqual(input.facts.abnormal_latest_labs[0], { test: 'LDL cholesterol', value: 4.1, unit: 'mmol/L', date: '2026-01-15', ref_high: 3, flag: 'high' });
    assert.ok(!('past_medications' in input.facts), 'missing fields are left out, meaning "not recorded"');

    const ready = await call<Record<string, any>>('GET', `/health/profiles/${patient.profileId}/summary?lang=en&specialty=cardiology`, patient.token);
    assert.equal(ready.status, 200);
    assert.equal(ready.data.status, 'ready');
    assert.equal(ready.data.transcript, `${GOOD_SCRIPT}\n\n${CLOSING.en}`);
    assert.equal(voice.tts.at(-1)?.model, 'eleven_v4');
    assert.equal(voice.tts.at(-1)?.language, 'en');
    const audio = await fetch(ready.data.audio_url);
    assert.equal(audio.status, 200);
    const parts = speechParts(ready.data.transcript);
    assert.ok(parts.length >= 2);
    assert.equal(voice.tts.length - voiced, parts.length, 'recorded in parts, each once');
    assert.equal(Buffer.from(await audio.arrayBuffer()).toString(), parts.map((part) => `ID3[${part}]`).join(''), 'the parts joined in order');

    const again = await call<Record<string, any>>('POST', `/health/profiles/${patient.profileId}/summary`, patient.token, { lang: 'en', specialty: 'cardiology', consent: true, async: true });
    assert.equal(again.status, 200);
    assert.equal(again.data.cached, true, 'an unchanged record reuses its summary');
  });

  test('a script that fails the check is sent back once with what was wrong', async () => {
    gemini.scripts = [GOOD_SCRIPT.replace('Atorvastatin 20 milligrams once daily at night', 'a statin'), GOOD_SCRIPT];
    await call('POST', `/health/profiles/${patient.profileId}/summary`, patient.token, { lang: 'en', specialty: null, consent: true, async: true });
    await idle();
    const retry = gemini.calls.at(-1) as GeminiCall;
    assert.match((retry.body.contents[0].parts[0] as { text: string }).text, /previous script was rejected[\s\S]*Atorvastatin/);
    const ready = await call<Record<string, any>>('GET', `/health/profiles/${patient.profileId}/summary?lang=en&specialty=general`, patient.token);
    assert.equal(ready.data.status, 'ready');
  });

  test('a script that fails twice is rejected, and the resident is told it couldn’t be finished', async () => {
    gemini.scripts = ['Mona has a heart condition for 7 years and takes something.'];
    const started = await call<Record<string, any>>('POST', `/health/profiles/${patient.profileId}/summary`, patient.token, { lang: 'ar', specialty: 'general', consent: true, async: true }, 'ar');
    assert.equal(started.status, 202);
    await idle();
    const failed = await call<Record<string, any>>('GET', `/health/profiles/${patient.profileId}/summary?lang=ar&specialty=general`, patient.token, undefined, 'ar');
    assert.equal(failed.data.status, 'failed');
    assert.equal(failed.data.error, 'تعذّر إكمال الملخص. يرجى المحاولة مرة أخرى.');
  });

  test('a summary needs consent; withdrawing Health Passport consent deletes summaries and their recordings', async () => {
    assert.equal((await call('POST', `/health/profiles/${patient.profileId}/summary`, patient.token, { lang: 'en', specialty: null, async: true })).status, 422);
    const recordings = readdirSync(filesDir).length;
    assert.ok(recordings >= 1);
    await call('POST', '/health/consent', patient.token, { given: false });
    assert.ok(readdirSync(filesDir).length < recordings, 'the recordings left with the data');
    await call('POST', '/health/consent', patient.token, { given: true });
    const [self] = (await call<{ id: string }[]>('GET', '/health/profiles', patient.token)).data;
    assert.equal((await call('GET', `/health/profiles/${self.id}/summary?lang=en`, patient.token)).status, 404);
  });
});
