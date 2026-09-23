import type { IconSet } from '../../components/ui/ServiceTile';

/**
 * Mock content for the home screen. Shaped the way a real API response would
 * be, so wiring this to a backend later replaces this module rather than the
 * screen. Wording matches the Figma reference exactly.
 */

export interface ResidentSummary {
  greeting: string;
  name: string;
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
}

export const resident: ResidentSummary = {
  greeting: 'Good evening,',
  name: 'Ahmed',
  tagline: 'Home Feels Better Together.',
};

export const unit: UnitSummary = {
  title: 'Unit A-302',
  meta: '3 Bedrooms • Tower A',
};

export const weather: WeatherSummary = {
  temperature: '24 C',
  condition: 'Clear Night',
};

export const serviceTiles: readonly ServiceTileItem[] = [
  { id: 'my-unit', title: 'My Unit', subtitle: 'View details', iconSet: 'ionicons', iconName: 'home-outline' },
  { id: 'smart-home', title: 'Smart Home', subtitle: 'Control your unit', iconSet: 'material', iconName: 'home-automation' },
  { id: 'bms', title: 'BMS', subtitle: 'Manage & grow', iconSet: 'material', iconName: 'file-cog-outline' },
  { id: 'visitor-access', title: 'Visitor Access', subtitle: 'Invite & manage', iconSet: 'material', iconName: 'account-check-outline' },
  { id: 'parking', title: 'Parking', subtitle: 'Check availability', iconSet: 'ionicons', iconName: 'car-outline' },
  { id: 'maintenance', title: 'Maintenance', subtitle: 'Request & track', iconSet: 'material', iconName: 'tools' },
  { id: 'community', title: 'Community', subtitle: 'New', iconSet: 'ionicons', iconName: 'bag-outline' },
  { id: 'amenities', title: 'Amenities Booking', subtitle: 'Request & track', iconSet: 'material', iconName: 'calendar-check-outline' },
];

export const promo = {
  title: 'A Better\nTomorrow Together',
  body: 'Discover a smarter, safer\nand more connected lifestyle.',
  ctaLabel: 'Explore Now',
} as const;
