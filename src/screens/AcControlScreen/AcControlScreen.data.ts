import type { IconSet } from '../../components/ui/ServiceTile';

/** Copy for AC Controls: every setting an EMS air conditioner announces, and its readings. */

export const acCopy = {
  fallbackTitle: 'Air conditioner',
  subtitle: 'Every setting your AC supports, live.',
  accountIntro: 'Sign in to your EMS account to control your AC.',
  notFound: 'This AC is no longer one of your devices.',
  loading: 'Reading the AC’s settings…',
  loadFailed: 'The AC’s settings could not be read.',
  retry: 'Try again',
  offline: 'The AC is offline. Settings show what it last reported.',
  turnOnHint: 'Turn the AC on to change its mode, temperature, fan and airflow.',
  power: 'Power',
  lower: 'Lower temperature',
  raise: 'Raise temperature',
  room: 'Room',
  humidity: 'Humidity',
  drawing: 'Drawing',
  modeTitle: 'Mode',
  fanTitle: 'Fan speed',
  airflowTitle: 'Fan and airflow',
  verticalAirflow: 'Up and down',
  horizontalAirflow: 'Left and right',
  featuresTitle: 'Features',
  timersTitle: 'Timers',
  timerOff: 'Off',
  timerShorter: 'Shorter',
  timerLonger: 'Longer',
  timerClear: 'Clear',
  filterTitle: 'Filter',
  filterUsage: (used: number, life: number | null) => (life ? `${used} h of ${life} h` : `${used} h`),
  filterHours: 'Hours the AC has run since its filter was last cleaned.',
  filterDue: 'Time to clean the filter, then record it here.',
  filterLastCleaned: 'Last cleaned',
  filterNever: 'Not recorded yet',
  filterReset: 'I cleaned the filter',
  filterConfirm: 'Tap again to reset the hours',
  detailsTitle: 'Technical details',
  show: 'Show',
  hide: 'Hide',
  needs: (requirement: string) => `Needs: ${requirement}`,
  fault: (code: string | number) => `Fault ${code}`,
} as const;

interface Choice {
  label: string;
  iconSet: IconSet;
  iconName: string;
}

/** Home Assistant's climate modes and actions as rethink names them. */
export const modeChoices: Record<string, Choice> = {
  cool: { label: 'Cool', iconSet: 'material', iconName: 'snowflake' },
  heat: { label: 'Heat', iconSet: 'material', iconName: 'white-balance-sunny' },
  dry: { label: 'Dry', iconSet: 'material', iconName: 'water-percent' },
  fan_only: { label: 'Fan', iconSet: 'material', iconName: 'fan' },
  auto: { label: 'Auto', iconSet: 'material', iconName: 'autorenew' },
};

export const actionLabels: Record<string, string> = {
  cooling: 'Cooling',
  heating: 'Heating',
  drying: 'Drying',
  fan: 'Fan only',
  idle: 'Idle',
  off: 'Off',
};

/** Fan speeds as rethink names them, slowest first; anything else keeps its own name. */
export const fanOrder = ['auto', 'very low', 'low', 'medium', 'high', 'very high'];

/**
 * Vane positions: `on` swings across the whole range, `off` stops it, the
 * numbers hold one position, and `1-3` / `3-5` swing across part of it.
 */
export function airflowLabel(option: string): string {
  if (option === 'on') return 'Swing';
  if (option === 'off') return 'Off';
  if (/^\d-\d$/.test(option)) return `Swing ${option.replace('-', '–')}`;
  return option;
}

/** Off and Swing first, then the fixed positions in the AC's own order. */
export function airflowOrder(options: readonly string[]): string[] {
  const first = ['off', 'on'].filter((option) => options.includes(option));
  return [...first, ...options.filter((option) => !first.includes(option))];
}

/** "very high" → "Very high", "fan_only" → "Fan only". */
export function humanize(value: string): string {
  const words = value.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Icons for the extras rethink announces; others get a generic one. */
export const featureIcons: Record<string, string> = {
  jet: 'wind-power',
  airclean: 'air-purifier',
  energysave: 'leaf',
  energylimit: 'flash',
  softair: 'weather-windy',
  beep: 'volume-high',
  displaylight: 'lightbulb-outline',
  aiair: 'robot-outline',
  lowheating: 'snowflake-thermometer',
  windowdetection: 'window-open-variant',
  autodrysetting: 'hair-dryer',
  autodryfan: 'fan',
  goodsleep: 'sleep',
  goodsleepop: 'sleep',
  goodsleeptemp: 'sleep',
};

export const timerIcons: Record<string, string> = {
  sleeptimer: 'bed-clock',
  starttimer: 'timer-play-outline',
  stoptimer: 'timer-stop-outline',
};

/** Settings with their own panel, by key. */
export const climateKeys = ['mode', 'temperature', 'fan_mode', 'swing_mode', 'swing_horizontal_mode'];
export const filterKeys = ['filterused', 'filterlife', 'changeddate', 'filterreset'];
/** Shown in the summary rather than among the technical details. */
export const summaryKeys = ['energy_current', 'error'];

/** Timers step in half hours whatever finer step the AC takes. */
export const TIMER_STEP_HOURS = 0.5;
/** Quick taps on a stepper send only the last value. */
export const STEPPER_DEBOUNCE_MS = 700;

/** 1.5 → "1 h 30 min", 0.25 → "15 min". */
export function formatHours(hours: number): string {
  const minutes = Math.round(hours * 60);
  const whole = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (whole === 0) return `${rest} min`;
  return rest === 0 ? `${whole} h` : `${whole} h ${rest} min`;
}

/** A reading with its unit, e.g. "676 W", "27.2 °C". */
export function formatReading(value: string | number | boolean | null, unit: string | null): string {
  if (value === null) return '—';
  if (typeof value === 'boolean') return value ? 'On' : 'Off';
  const shown = typeof value === 'number' ? String(Math.round(value * 10) / 10) : value;
  return unit ? `${shown} ${unit}` : shown;
}
