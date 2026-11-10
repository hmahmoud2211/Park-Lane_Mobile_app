import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

/**
 * Phase 6: the weather proxy keeps MET Norway's terms: it names itself with the operator's contact, sends at most
 * four decimals, keeps the answer until MET's Expires, asks again with If-Modified-Since, falls back to the last
 * answer when MET can't be reached, credits MET, and stays off without a contact.
 */
Object.assign(process.env, { DATA_DIR: mkdtempSync(join(tmpdir(), 'ems-weather-')), WEATHER_CONTACT: 'ops@example.com', WEATHER_LAT: '30.019876', WEATHER_LON: '31.7612345' });

const { config } = await import('../src/config.ts');
const { currentWeather, resetWeather } = await import('../src/weather/met.ts');

const FORECAST = {
  properties: {
    meta: { updated_at: '2026-11-10T10:00:00Z' },
    timeseries: [{ time: new Date(Date.now() - 10 * 60_000).toISOString(), data: { instant: { details: { air_temperature: 24.36 } }, next_1_hours: { summary: { symbol_code: 'clearsky_day' } } } }],
  },
};

function fakeMet(answers: ((request: { url: string; headers: Record<string, string> }) => Response)[]) {
  const seen: { url: string; headers: Record<string, string> }[] = [];
  const fetcher = (async (url: string, init?: RequestInit) => {
    const request = { url, headers: init?.headers as Record<string, string> };
    seen.push(request);
    const answer = answers.shift();
    if (!answer) throw new Error('offline');
    return answer(request);
  }) as unknown as typeof fetch;
  return { fetcher, seen };
}

test('names itself, sends four decimals, caches until Expires, revalidates, falls back, credits MET', async () => {
  resetWeather();
  const soon = new Date(Date.now() + 60_000).toUTCString();
  const past = new Date(Date.now() - 1000).toUTCString();
  const met = fakeMet([
    () => new Response(JSON.stringify(FORECAST), { status: 200, headers: { Expires: past, 'Last-Modified': 'Tue, 10 Nov 2026 10:00:00 GMT' } }),
    () => new Response(null, { status: 304, headers: { Expires: soon } }),
  ]);
  const first = await currentWeather(met.fetcher);
  assert.deepEqual([first.temperatureC, first.symbol], [24.4, 'clearsky_day']);
  assert.match(first.credit, /MET Norway/);
  assert.equal(met.seen[0].headers['User-Agent'], 'ParklaneBackend/1.0 (ops@example.com)');
  assert.match(met.seen[0].url, /lat=30\.0199&lon=31\.7612$/);

  const second = await currentWeather(met.fetcher);
  assert.equal(met.seen[1].headers['If-Modified-Since'], 'Tue, 10 Nov 2026 10:00:00 GMT');
  assert.equal(second.temperatureC, 24.4);
  await currentWeather(met.fetcher);
  assert.equal(met.seen.length, 2, 'fresh until Expires: no third request');
});

test('when MET is unreachable, the last answer stands; with no answer yet, it says so', async () => {
  resetWeather();
  const met = fakeMet([() => new Response(JSON.stringify(FORECAST), { status: 200, headers: { Expires: new Date(Date.now() - 1000).toUTCString() } })]);
  await currentWeather(met.fetcher);
  assert.equal((await currentWeather(met.fetcher)).temperatureC, 24.4, 'offline: the cached answer');
  resetWeather();
  await assert.rejects(currentWeather(fakeMet([]).fetcher), /not available/);
});

test('off without a contact', async () => {
  resetWeather();
  const settings = config.weather as { contact: string };
  const contact = settings.contact;
  settings.contact = '';
  await assert.rejects(currentWeather(fakeMet([]).fetcher), /WEATHER_CONTACT/);
  settings.contact = contact;
});
