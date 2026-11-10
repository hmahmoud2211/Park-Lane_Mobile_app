import { flags } from '../../config/flags';
import type { IconSet } from '../../types/icons.types';
import type { ParamlessRoute } from '../../types/navigation.types';

/**
 * Mock content for the home screen. Shaped the way a real API response would
 * be, so wiring this to a backend later replaces this module rather than the
 * screen. Wording matches the Figma reference exactly.
 */

export interface WeatherSummary {
  temperature: string;
  condition: string;
}

export interface ServiceTileItem {
  id: string;
  title: string;
  subtitle: string;
  iconSet: IconSet;
  iconName: string;
  /** Screen the tile opens; tiles without one are not wired up yet. */
  route?: ParamlessRoute;
  /** Opens the "Under Development" placeholder until the feature is built. */
  underDevelopment?: boolean;
}

export const weather: WeatherSummary = {
  temperature: '24 C',
  condition: 'Clear Night',
};

/** MET Norway's symbol codes (e.g. "partlycloudy_night") in the pill's words. */
const CONDITIONS: readonly [RegExp, string][] = [
  [/^clearsky_night/, 'Clear Night'],
  [/^clearsky/, 'Clear'],
  [/^fair/, 'Fair'],
  [/^partlycloudy/, 'Partly Cloudy'],
  [/^cloudy/, 'Cloudy'],
  [/^fog/, 'Fog'],
  [/thunder/, 'Thunder'],
  [/^(heavyrain|heavyrainshowers)/, 'Heavy Rain'],
  [/^(lightrain|lightrainshowers)/, 'Light Rain'],
  [/rain/, 'Rain'],
  [/sleet/, 'Sleet'],
  [/snow/, 'Snow'],
];

/** The compound's weather from the backend (MET Norway), in the pill's shape, with an icon that fits it. */
export function weatherFrom(now: { temperatureC: number; symbol: string | null }): WeatherSummary & { icon: 'moon' | 'sunny' | 'partly-sunny' | 'cloudy' | 'rainy' | 'thunderstorm' | 'snow' } {
  const symbol = now.symbol ?? '';
  const condition = symbol ? (CONDITIONS.find(([pattern]) => pattern.test(symbol))?.[1] ?? 'Now') : 'Now';
  const icon = /thunder/.test(symbol)
    ? 'thunderstorm'
    : /snow|sleet/.test(symbol)
      ? 'snow'
      : /rain/.test(symbol)
        ? 'rainy'
        : /^cloudy|fog/.test(symbol)
          ? 'cloudy'
          : /_night$/.test(symbol)
            ? 'moon'
            : /^(fair|partlycloudy)/.test(symbol)
              ? 'partly-sunny'
              : 'sunny';
  return { temperature: `${Math.round(now.temperatureC)} C`, condition, icon };
}

export const serviceTiles: readonly ServiceTileItem[] = [
  {
    id: 'my-unit',
    title: 'My Unit',
    subtitle: 'View details',
    iconSet: 'ionicons',
    iconName: 'home-outline',
    route: 'MyUnit',
  },
  {
    id: 'smart-home',
    title: 'Smart Home',
    subtitle: 'Control your unit',
    iconSet: 'material',
    iconName: 'home-automation',
    route: 'SmartHome',
  },
  {
    id: 'bms',
    title: 'BMS',
    subtitle: 'Manage & grow',
    iconSet: 'material',
    iconName: 'file-cog-outline',
    route: 'Bms',
  },
  {
    id: 'visitor-access',
    title: 'Visitor Access',
    subtitle: 'Invite & manage',
    iconSet: 'material',
    iconName: 'account-check-outline',
    route: 'VisitorAccess',
  },
  {
    id: 'parking',
    title: 'Parking',
    subtitle: 'Check availability',
    iconSet: 'ionicons',
    iconName: 'car-outline',
    route: 'Parking',
  },
  {
    id: 'maintenance',
    title: 'Maintenance',
    subtitle: 'Request & track',
    iconSet: 'material',
    iconName: 'tools',
    route: 'Maintenance',
  },
  {
    id: 'community',
    title: 'Community',
    subtitle: 'New',
    iconSet: 'ionicons',
    iconName: 'bag-outline',
    route: 'Community',
  },
  {
    id: 'amenities',
    title: 'Amenities Booking',
    subtitle: 'Request & track',
    iconSet: 'material',
    iconName: 'calendar-check-outline',
    route: 'AmenitiesBooking',
  },
];

/**
 * The store build's tiles: the parts backed by a real service. BMS stays out while its readings are simulated, and
 * Parking until its real layout is confirmed (flags.parking).
 */
const STORE_ROUTES: readonly ParamlessRoute[] = ['MyUnit', 'SmartHome', 'VisitorAccess', 'Maintenance', 'Community', 'AmenitiesBooking', ...(flags.parking ? (['Parking'] as const) : [])];
const storeTiles: readonly ServiceTileItem[] = [
  ...serviceTiles.filter((tile) => tile.route !== undefined && STORE_ROUTES.includes(tile.route)),
  { id: 'health-passport', title: 'Health Passport', subtitle: 'Family records', iconSet: 'ionicons', iconName: 'medkit-outline', route: 'HealthPassport' },
  { id: 'clinic', title: 'Clinic', subtitle: 'Book a doctor', iconSet: 'ionicons', iconName: 'calendar-number-outline', route: 'Clinic' },
  { id: 'assistant', title: 'EMS AI', subtitle: 'Ask the assistant', iconSet: 'material', iconName: 'robot-outline', route: 'Assistant' },
];

export const homeTiles: readonly ServiceTileItem[] = flags.sampleContent ? serviceTiles : storeTiles;

export const promo = {
  title: 'A Better\nTomorrow Together',
  body: 'Discover a smarter, safer\nand more connected lifestyle.',
  ctaLabel: 'Explore Now',
} as const;
