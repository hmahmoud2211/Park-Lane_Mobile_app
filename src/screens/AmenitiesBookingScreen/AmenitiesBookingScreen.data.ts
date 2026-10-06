import type { IconSet } from '../../components/ui/ServiceTile';
import type { ImageKey } from '../../constants/images';

/**
 * Mock content for the Amenities Booking screen. Shaped the way a real API
 * response would be, so wiring this to a backend later replaces this module
 * rather than the screen. Wording matches the Figma reference
 * (assets/Screens/screen11.png) exactly.
 */

export const amenitiesCopy = {
  title: 'Amenities Booking',
  bannerTitle: 'Premium Amenities',
  bannerBody: 'For a Healthier , happier Lifestyle.',
  bookNow: 'Book Now',
  viewMore: 'View More Amenities',
  /** Not in the design: the same button once the full list is showing. */
  showLess: 'Show Less',
  /** Not in the design: shown only if a filter ever matches nothing. */
  empty: 'No amenities in this category yet.',
} as const;

export type AmenityCategory = 'sports' | 'leisure' | 'family';

/** `all` is the unfiltered list; the rest match an amenity's categories. */
export type CategoryFilter = 'all' | AmenityCategory;

export interface CategoryChip {
  id: CategoryFilter;
  label: string;
  iconSet: IconSet;
  iconName: string;
}

export const categoryChips: readonly CategoryChip[] = [
  { id: 'all', label: 'All', iconSet: 'ionicons', iconName: 'grid-outline' },
  { id: 'sports', label: 'Sports', iconSet: 'material', iconName: 'run' },
  { id: 'leisure', label: 'Leisure', iconSet: 'material', iconName: 'seat-recline-normal' },
  { id: 'family', label: 'Family', iconSet: 'material', iconName: 'account-group-outline' },
];

export interface Amenity {
  id: string;
  title: string;
  location: string;
  /** Opening hours, 24-hour "HH:MM". */
  opens: string;
  closes: string;
  capacity: number;
  photo: ImageKey;
  iconSet: IconSet;
  iconName: string;
  categories: readonly AmenityCategory[];
}

export const amenities: readonly Amenity[] = [
  {
    id: 'pool',
    title: 'Swimming Pool',
    location: 'Residential Club',
    opens: '06:00',
    closes: '22:00',
    capacity: 20,
    photo: 'amenityPool',
    iconSet: 'material',
    iconName: 'pool',
    categories: ['sports', 'leisure', 'family'],
  },
  {
    id: 'gym',
    title: 'Gym',
    location: 'Tower A - Level 1',
    opens: '05:00',
    closes: '23:00',
    capacity: 15,
    photo: 'amenityGym',
    iconSet: 'ionicons',
    iconName: 'barbell-outline',
    categories: ['sports'],
  },
  {
    id: 'hall',
    title: 'Multipurpose Hall',
    location: 'Tower B - Ground Floor',
    opens: '09:00',
    closes: '22:00',
    capacity: 50,
    photo: 'amenityHall',
    iconSet: 'material',
    iconName: 'account-group-outline',
    categories: ['leisure', 'family'],
  },

  /*
   * Revealed by "View More Amenities". Not in the design, so the wording is
   * mock content, with venues and the café's hours taken from the Community
   * screen's data, and the photos reused from it as placeholders.
   */
  {
    id: 'yoga',
    title: 'Yoga Studio',
    location: 'Clubhouse - Level 2',
    opens: '06:00',
    closes: '21:00',
    capacity: 12,
    photo: 'communityYoga',
    iconSet: 'material',
    iconName: 'meditation',
    categories: ['sports', 'leisure'],
  },
  {
    id: 'cinema',
    title: 'Outdoor Cinema',
    location: 'Central Garden',
    opens: '18:00',
    closes: '23:00',
    capacity: 40,
    photo: 'communityMovie',
    iconSet: 'material',
    iconName: 'movie-open-outline',
    categories: ['leisure', 'family'],
  },
  {
    id: 'kids',
    title: 'Kids Play Area',
    location: 'Central Garden',
    opens: '08:00',
    closes: '20:00',
    capacity: 25,
    photo: 'communityPollKids',
    iconSet: 'material',
    iconName: 'seesaw',
    categories: ['family'],
  },
  {
    id: 'cafe',
    title: 'Clubhouse Café',
    location: 'Clubhouse - Ground Floor',
    opens: '07:00',
    closes: '22:00',
    capacity: 30,
    photo: 'communityCafe',
    iconSet: 'material',
    iconName: 'coffee-outline',
    categories: ['leisure'],
  },
];

/** How many amenities show before "View More Amenities" is tapped: the design's three. */
export const initialVisibleCount = 3;

export function amenitiesFor(filter: CategoryFilter): readonly Amenity[] {
  return filter === 'all' ? amenities : amenities.filter((a) => a.categories.includes(filter));
}

/** "06:00 - 22:00". */
export function hoursLabel({ opens, closes }: Amenity): string {
  return `${opens} - ${closes}`;
}

/** "Max 20". */
export function capacityLabel({ capacity }: Amenity): string {
  return `Max ${capacity}`;
}
