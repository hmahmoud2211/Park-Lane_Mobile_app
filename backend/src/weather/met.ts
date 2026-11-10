import { config } from '../config.ts';
import { ApiError } from '../errors.ts';
import { log } from '../log.ts';

/**
 * The compound's weather, from MET Norway's Locationforecast 2.0 (compact), fetched by the backend only, never by
 * phones: one cached answer for everyone, refreshed after the time MET's `Expires` header gives, asked again with
 * `If-Modified-Since`. Their terms: name the client with a contact (WEATHER_CONTACT), at most four decimals in the
 * coordinates, respect Expires, and credit "MET Norway" where the data is shown (CC BY 4.0). Off until a contact is set.
 */

export interface WeatherNow {
  temperatureC: number;
  /** MET's symbol code, e.g. "clearsky_day", "partlycloudy_night", "rain". */
  symbol: string | null;
  /** When MET's forecast for this hour was made. */
  updatedAt: string;
  credit: string;
}

const ENDPOINT = 'https://api.met.no/weatherapi/locationforecast/2.0/compact';
const CREDIT = 'Weather data from MET Norway (CC BY 4.0)';

interface Cached {
  value: WeatherNow;
  expiresAt: number;
  lastModified: string | null;
}

let cached: Cached | null = null;
let inFlight: Promise<WeatherNow> | null = null;

export const weatherEnabled = () => Boolean(config.weather.contact);

/** The User-Agent MET asks for: the app and how to reach its operator. */
const userAgent = () => `ParklaneBackend/1.0 (${config.weather.contact})`;

function pick(body: unknown, fallbackUpdated: string): WeatherNow {
  const properties = (body as { properties?: { meta?: { updated_at?: string }; timeseries?: { time: string; data: Record<string, any> }[] } }).properties;
  const now = Date.now();
  const series = properties?.timeseries ?? [];
  const current = series.find((entry) => Date.parse(entry.time) + 3600_000 > now) ?? series[0];
  const temperature = current?.data?.instant?.details?.air_temperature;
  if (typeof temperature !== 'number') throw new Error('MET answered without a temperature.');
  const symbol = current.data.next_1_hours?.summary?.symbol_code ?? current.data.next_6_hours?.summary?.symbol_code ?? null;
  return { temperatureC: Math.round(temperature * 10) / 10, symbol, updatedAt: properties?.meta?.updated_at ?? fallbackUpdated, credit: CREDIT };
}

async function refresh(fetcher: typeof fetch): Promise<WeatherNow> {
  const url = `${ENDPOINT}?lat=${config.weather.lat.toFixed(4)}&lon=${config.weather.lon.toFixed(4)}`;
  const headers: Record<string, string> = { 'User-Agent': userAgent(), Accept: 'application/json' };
  if (cached?.lastModified) headers['If-Modified-Since'] = cached.lastModified;
  const response = await fetcher(url, { headers, signal: AbortSignal.timeout(8000) });
  const expires = Date.parse(response.headers.get('expires') ?? '');
  const expiresAt = Number.isNaN(expires) ? Date.now() + 30 * 60_000 : expires;
  if (response.status === 304 && cached) {
    cached = { ...cached, expiresAt };
    return cached.value;
  }
  if (!response.ok) throw new Error(`MET answered ${response.status}.`);
  const value = pick(await response.json(), new Date().toISOString());
  cached = { value, expiresAt, lastModified: response.headers.get('last-modified') };
  return value;
}

/** The current weather; the cached answer while MET says it is fresh, or while MET can't be reached. */
export async function currentWeather(fetcher: typeof fetch = fetch): Promise<WeatherNow> {
  if (!weatherEnabled()) throw new ApiError('not_configured', 'Weather is off: set WEATHER_CONTACT on the server.');
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  inFlight ??= refresh(fetcher).finally(() => {
    inFlight = null;
  });
  try {
    return await inFlight;
  } catch (error) {
    log.warn('Weather: MET could not be reached', { reason: (error as Error).message });
    if (cached) return cached.value;
    throw new ApiError('not_available', 'The weather is not available right now.');
  }
}

/** Tests: forget the cached answer. */
export function resetWeather() {
  cached = null;
  inFlight = null;
}
