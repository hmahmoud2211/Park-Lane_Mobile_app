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
 * The store build's tiles: the parts backed by a real service. The other Home tiles still
 * show sample data, so that build leaves them out (flags.sampleContent).
 */
const storeTiles: readonly ServiceTileItem[] = [
  ...serviceTiles.filter((tile) => tile.route === 'SmartHome'),
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
