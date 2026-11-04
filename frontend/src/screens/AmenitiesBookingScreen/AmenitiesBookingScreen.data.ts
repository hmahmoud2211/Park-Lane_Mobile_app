import type { IconSet } from '../../components/ui/ServiceTile';
import type { ImageKey } from '../../constants/images';
import { formatDate, guestsLabel } from '../VisitorAccessScreen/VisitorAccessScreen.data';

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
  /*
   * Not in the design: the booking form (built on the app's other forms) and
   * the resident's bookings.
   */
  formTitle: (amenity: string) => `Book ${amenity}`,
  formSubtitle: 'Choose a day, a time and how many are coming',
  dateLabel: 'Date',
  datePlaceholder: 'Select date',
  slotLabel: 'Time',
  slotPlaceholder: 'Select time',
  guestsLabel: 'Guests',
  confirm: 'Confirm Booking',
  closeForm: 'Close the booking form',
  bookingsTitle: 'My Bookings',
  /** Not in the design: wide layouts keep My Bookings in view beside the list, empty or not. */
  bookingsEmpty: 'No bookings yet. Book an amenity and it will show here.',
  cancelBooking: (amenity: string, date: string) => `Cancel ${amenity} on ${date}`,
  booked: (amenity: string, date: string, slot: string) => `${amenity} booked for ${date}, ${slot}`,
  noSlots: 'No times left today',
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

export interface Booking {
  id: string;
  amenityId: Amenity['id'];
  /** "18 Oct 2026". */
  date: string;
  /** "10:00 - 11:00", as the cards write hours. */
  slot: string;
  guests: number;
}

/** The resident's upcoming bookings, soonest first. */
export const initialBookings: readonly Booking[] = [
  { id: 'BK-1001', amenityId: 'pool', date: '18 Oct 2026', slot: '10:00 - 11:00', guests: 2 },
];

export interface BookingForm {
  date: string;
  slot: string;
  guests: string;
}

export type BookingErrors = Partial<Record<keyof BookingForm, string>>;

/** At most this many people on one booking, or the amenity's capacity if lower. */
const MAX_GUESTS = 6;

/** Bookings open from today up to two weeks ahead. */
export function bookingDates(from: Date = new Date(), days = 14): string[] {
  return Array.from({ length: days }, (_, offset) =>
    formatDate(new Date(from.getFullYear(), from.getMonth(), from.getDate() + offset)),
  );
}

const pad = (value: number) => String(value).padStart(2, '0');

/**
 * One-hour slots across the amenity's opening hours, as "10:00 - 11:00".
 * Today's list starts at the next full hour, so a slot already under way
 * cannot be booked.
 */
export function slotOptions(amenity: Amenity, date: string, now: Date = new Date()): string[] {
  const opens = Number.parseInt(amenity.opens, 10);
  const closes = Number.parseInt(amenity.closes, 10);
  const first = date === formatDate(now) ? Math.max(opens, now.getHours() + 1) : opens;
  return Array.from({ length: Math.max(0, closes - first) }, (_, index) => {
    const hour = first + index;
    return `${pad(hour)}:00 - ${pad(hour + 1)}:00`;
  });
}

export function guestOptions(amenity: Amenity): string[] {
  return Array.from({ length: Math.min(MAX_GUESTS, amenity.capacity) }, (_, index) =>
    guestsLabel(index + 1),
  );
}

/** Frontend checks only; the backend will validate again (and check capacity). */
export function validateBooking(
  form: BookingForm,
  amenity: Amenity,
  bookings: readonly Booking[],
): BookingErrors {
  const errors: BookingErrors = {};
  if (!form.date) {
    errors.date = 'Choose a date';
  }
  if (!form.slot) {
    errors.slot = 'Choose a time';
  } else if (
    bookings.some(
      (booking) =>
        booking.amenityId === amenity.id && booking.date === form.date && booking.slot === form.slot,
    )
  ) {
    errors.slot = 'You already booked this time';
  }
  return errors;
}

/**
 * A confirmed booking. Frontend only: it lives in the screen's state until a
 * backend takes real ones, so its reference follows the highest so far.
 */
export function createBooking(
  form: BookingForm,
  amenity: Amenity,
  existing: readonly Booking[],
): Booking {
  const last = existing.reduce(
    (max, booking) => Math.max(max, Number.parseInt(booking.id.replace(/\D/g, ''), 10) || 0),
    1000,
  );
  return {
    id: `BK-${last + 1}`,
    amenityId: amenity.id,
    date: form.date,
    slot: form.slot,
    guests: Number.parseInt(form.guests, 10) || 1,
  };
}
