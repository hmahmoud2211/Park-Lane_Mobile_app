import type { IconSet } from '../../components/ui/ServiceTile';
import type { ParamlessRoute } from '../../types/navigation.types';

/**
 * Mock content for the home screen. Shaped the way a real API response would
 * be, so wiring this to a backend later replaces this module rather than the
 * screen. Wording matches the Figma reference exactly.
 */

export interface ResidentSummary {
  greeting: string;
  firstName: string;
  /** Mock surname; the design only ever shows the first name. */
  lastName: string;
  tagline: string;
}

export interface UnitSummary {
  title: string;
  meta: string;
}

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

export const resident: ResidentSummary = {
  greeting: 'Good evening,',
  firstName: 'Ahmed',
  lastName: 'Hassan',
  tagline: 'Home Feels Better Together.',
};

/** First letter of each name, for the header avatar. */
export function initialsOf({ firstName, lastName }: ResidentSummary): string {
  return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase();
}

export const unit: UnitSummary = {
  title: 'Unit A-302',
  meta: '3 Bedrooms • Tower A',
};

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
    underDevelopment: true,
  },
  {
    id: 'bms',
    title: 'BMS',
    subtitle: 'Manage & grow',
    iconSet: 'material',
    iconName: 'file-cog-outline',
    underDevelopment: true,
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
    underDevelopment: true,
  },
];

export const promo = {
  title: 'A Better\nTomorrow Together',
  body: 'Discover a smarter, safer\nand more connected lifestyle.',
  ctaLabel: 'Explore Now',
} as const;
