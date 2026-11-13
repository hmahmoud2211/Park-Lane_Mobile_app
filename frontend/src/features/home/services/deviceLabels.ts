/**
 * Everyday words for the values Home Assistant and the CUBE gateway report, so a resident
 * reads "On its dock" rather than `docked` and "Auto" rather than `heat_cool`. Anything not
 * listed is shown in title case with spaces. Pure, no React: checked by `npm run check:home`.
 */

/** Short words written in capitals wherever they appear in a value. */
const ACRONYMS = new Set(['tv', 'hdmi', 'usb', 'av', 'dvd', 'led', 'ac', 'dc', 'uv', 'co2', 'ir', 'hd', 'uhd', 'arc', 'dab', 'bt', 'pm25']);

function word(raw: string): string {
  const lower = raw.toLowerCase();
  if (ACRONYMS.has(lower)) return raw.toUpperCase();
  // "hdmi1" → "HDMI 1"
  const numbered = /^([a-z]+)(\d+)$/i.exec(raw);
  if (numbered && ACRONYMS.has(numbered[1].toLowerCase())) return `${numbered[1].toUpperCase()} ${numbered[2]}`;
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

/** An unknown value, readable: `low_power` → "Low Power", `hdmi1` → "HDMI 1". Names already capitalised stay. */
export function titleCase(value: string): string {
  return value
    .replace(/[_-]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(word)
    .join(' ');
}

const lookup = (table: Readonly<Record<string, string>>, value: string | null | undefined): string =>
  value === null || value === undefined || value === '' ? 'Not known' : (table[value] ?? STATES[value] ?? titleCase(value));

/** Words for states every entity can report. */
const STATES: Readonly<Record<string, string>> = {
  unknown: 'Not known',
  unavailable: 'Not responding',
  on: 'On',
  off: 'Off',
};

/** On, off or not known. */
export const powerLabel = (value: string) => lookup({}, value);

const CLIMATE_MODES: Readonly<Record<string, string>> = {
  off: 'Off',
  heat: 'Heat',
  cool: 'Cool',
  heat_cool: 'Auto',
  auto: 'Auto',
  dry: 'Dry',
  fan_only: 'Fan only',
};

/**
 * An air conditioner or heater's mode. `heat_cool` (keeps a range) is "Auto"; when a
 * device also has Home Assistant's `auto` (follows a schedule or learns), that one is
 * "Smart", so two buttons never read the same.
 */
export function climateModeLabel(mode: string, modes: readonly string[] = []): string {
  if (mode === 'auto' && modes.includes('heat_cool')) return 'Smart';
  return lookup(CLIMATE_MODES, mode);
}

const PRESETS: Readonly<Record<string, string>> = {
  none: 'Normal',
  normal: 'Normal',
  eco: 'Eco',
  away: 'Away',
  boost: 'Boost',
  comfort: 'Comfort',
  home: 'Home',
  sleep: 'Sleep',
  activity: 'Activity',
  auto: 'Auto',
  baby: 'Baby',
};

/** Climate, fan and humidifier presets and humidifier modes. */
export const presetLabel = (preset: string) => lookup(PRESETS, preset);

const FAN_MODES: Readonly<Record<string, string>> = {
  auto: 'Auto',
  low: 'Low',
  medium: 'Medium',
  mid: 'Medium',
  high: 'High',
  quiet: 'Quiet',
  silent: 'Quiet',
  turbo: 'Turbo',
  focus: 'Focus',
  diffuse: 'Spread out',
};

/** An AC's fan speed or a vacuum's suction. */
export const fanModeLabel = (mode: string) => lookup(FAN_MODES, mode);

const SWING_MODES: Readonly<Record<string, string>> = {
  on: 'On',
  off: 'Off',
  both: 'Both ways',
  vertical: 'Up and down',
  horizontal: 'Side to side',
};

export const swingLabel = (mode: string) => lookup(SWING_MODES, mode);

const VACUUM_STATES: Readonly<Record<string, string>> = {
  cleaning: 'Cleaning',
  docked: 'On its dock',
  returning: 'Going back to its dock',
  error: 'Needs attention',
  idle: 'Waiting',
  paused: 'Paused',
};

export const vacuumStateLabel = (state: string) => lookup(VACUUM_STATES, state);

const MOWER_STATES: Readonly<Record<string, string>> = {
  mowing: 'Mowing',
  docked: 'On its dock',
  returning: 'Going back to its dock',
  error: 'Needs attention',
  paused: 'Paused',
};

export const mowerStateLabel = (state: string) => lookup(MOWER_STATES, state);

const ALARM_STATES: Readonly<Record<string, string>> = {
  disarmed: 'Off',
  armed_home: 'Armed (at home)',
  armed_away: 'Armed (away)',
  armed_night: 'Armed (night)',
  armed_vacation: 'Armed (holiday)',
  armed_custom_bypass: 'Armed (custom)',
  arming: 'Arming…',
  disarming: 'Turning off…',
  pending: 'About to sound',
  triggered: 'Alarm!',
};

export const alarmStateLabel = (state: string) => lookup(ALARM_STATES, state);

const ALARM_MODES: Readonly<Record<string, string>> = {
  home: 'Arm home',
  away: 'Arm away',
  night: 'Arm night',
  vacation: 'Arm holiday',
  custom_bypass: 'Arm custom',
};

/** The button that arms the alarm in one of its modes. */
export const alarmModeLabel = (mode: string) => ALARM_MODES[mode] ?? `Arm ${titleCase(mode).toLowerCase()}`;

/** The state an arm button leads to, so the button for the current state can show as chosen. */
export const alarmModeState = (mode: string) => `armed_${mode}`;

const REPEAT_MODES: Readonly<Record<string, string>> = {
  off: 'Off',
  one: 'Repeat one',
  all: 'Repeat all',
};

export const repeatLabel = (mode: string) => lookup(REPEAT_MODES, mode);

const COVER_STATES: Readonly<Record<string, string>> = {
  open: 'Open',
  closed: 'Closed',
  opening: 'Opening…',
  closing: 'Closing…',
  stopped: 'Stopped',
};

/** Curtains, blinds, garage doors and valves. */
export const openStateLabel = (state: string) => lookup(COVER_STATES, state);

const LOCK_STATES: Readonly<Record<string, string>> = {
  locked: 'Locked',
  unlocked: 'Unlocked',
  locking: 'Locking…',
  unlocking: 'Unlocking…',
  jammed: 'Stuck: check the lock',
  open: 'Open',
  opening: 'Opening…',
};

export const lockStateLabel = (state: string) => lookup(LOCK_STATES, state);

/** Whether the lock is locked or on its way there. */
export const isLocked = (state: string) => state === 'locked' || state === 'locking';

const MEDIA_STATES: Readonly<Record<string, string>> = {
  playing: 'Playing',
  paused: 'Paused',
  idle: 'Ready',
  standby: 'Standby',
  buffering: 'Loading…',
};

export const mediaStateLabel = (state: string) => lookup(MEDIA_STATES, state);

const WATER_HEATER_MODES: Readonly<Record<string, string>> = {
  eco: 'Eco',
  electric: 'Electric',
  gas: 'Gas',
  heat_pump: 'Heat pump',
  high_demand: 'High demand',
  performance: 'Full power',
};

export const waterHeaterModeLabel = (mode: string) => lookup(WATER_HEATER_MODES, mode);

const DIRECTIONS: Readonly<Record<string, string>> = {
  forward: 'Forward',
  reverse: 'Reverse',
};

export const directionLabel = (direction: string) => lookup(DIRECTIONS, direction);

/** A choice from a select entity, a light effect or a remote activity. */
export const optionLabel = (option: string) => lookup({}, option);

/** A TV input or app: these are names already ("HDMI 1", "Netflix"), so only identifiers are reworded. */
export const sourceLabel = (source: string) => (/[A-Z ]/.test(source) ? source : titleCase(source));

/** "22", "22.5": at most one decimal, none when it is whole. */
export function formatNumber(value: number): string {
  if (Number.isInteger(value)) return String(value);
  const fixed = value.toFixed(1);
  return fixed.endsWith('.0') ? fixed.slice(0, -2) : fixed;
}

/** "22°" for a temperature in degrees, "22 K" for anything else. */
export function temperatureText(value: number, unit: string): string {
  return unit.startsWith('°') || unit === '' ? `${formatNumber(value)}°` : `${formatNumber(value)} ${unit}`;
}

export const percentText = (value: number) => `${Math.round(value)}%`;

/** A white light's colour temperature in words, then kelvin: "Warm white · 2700 K". */
export function colorTempLabel(kelvin: number): string {
  const name = kelvin < 3300 ? 'Warm white' : kelvin < 5000 ? 'Neutral white' : 'Cool white';
  return `${name} · ${Math.round(kelvin)} K`;
}

/** How open a cover or valve is: "Closed", "Fully open", "40% open". */
export function openAmountLabel(position: number): string {
  if (position <= 0) return 'Closed';
  if (position >= 100) return 'Fully open';
  return `${Math.round(position)}% open`;
}

/** A sensor's value with its unit, its words reworded: "21.5 °C", "Detected". */
export function readingText(value: string, unit: string | null): string {
  const shown = /^[a-z_]+$/.test(value) ? lookup({}, value) : value;
  return unit ? `${shown} ${unit}` : shown;
}

/** Words that already tell the resident what to do next. */
const ADVICE = /\b(try|check|ask|sign in|wait|turn it|plug|make sure|contact)\b/i;

/**
 * A failed command's message with something to do about it: messages that already say
 * what to do keep their own words, the rest get "Try again…".
 */
export function problemAdvice(message: string): string {
  const text = message.trim();
  if (!text) return 'That didn’t work. Try again in a moment.';
  if (ADVICE.test(text)) return text;
  return `${text} Try again in a moment. If it keeps happening, check that the device has power.`;
}
