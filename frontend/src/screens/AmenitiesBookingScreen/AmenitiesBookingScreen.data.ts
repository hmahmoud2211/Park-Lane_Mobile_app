import type { IconSet } from '../../types/icons.types';
import type { ImageKey } from '../../constants/images';
import { amenityPicture } from '../../constants/pictures';
import type { AmenityBookingView, AmenityCategory, AmenityOptions, AmenitySlot, AmenityView } from '../../../../shared/contracts/amenities';
import { formatDate } from '../../utils/format';
import { addDays } from '../../utils/zonedTime';

/**
 * The Amenities Booking screen's copy, and how it reads building management's catalogue and the apartment's
 * bookings (GET /api/amenities, /api/amenities/bookings). Wording matches the Figma reference
 * (assets/Screens/screen11.png).
 */

export const amenitiesCopy = {
  title: 'Amenities Booking',
  bannerTitle: 'Premium Amenities',
  bannerBody: 'For a Healthier , happier Lifestyle.',
  bookNow: 'Book Now',
  viewMore: 'View More Amenities',
  /** Not in the design: the same button once the full list is showing. */
  showLess: 'Show Less',
  /** Not in the design: shown if a filter matches nothing. */
  empty: 'No amenities in this category yet.',
  /*
   * Not in the design: the booking form, the resident's bookings, and the loading, empty and error states.
   */
  formTitle: (amenity: string) => `Book ${amenity}`,
  formSubtitle: 'Choose a day, a time and how many are coming',
  dateLabel: 'Date',
  datePlaceholder: 'Select date',
  slotLabel: 'Time',
  slotPlaceholder: 'Select time',
  peopleLabel: 'People',
  confirm: 'Confirm Booking',
  confirming: 'Booking…',
  closeForm: 'Close the booking form',
  bookingsTitle: 'My Bookings',
  /** Wide layouts keep My Bookings in view beside the list, empty or not. */
  bookingsEmpty: 'No bookings yet. Book an amenity and it will show here.',
  cancelBooking: (amenity: string, date: string) => `Cancel ${amenity} on ${date}`,
  booked: (amenity: string, date: string, slot: string) => `${amenity} booked for ${date}, ${slot}`,
  noSlots: 'No times left that day',
  chooseDayFirst: 'Choose a day first',
  loadingSlots: 'Loading times…',
  noCatalogue: 'Building management hasn’t added any amenities yet.',
  loadFailed: 'Couldn’t load the amenities',
  retry: 'Try again',
  noHomeTitle: 'Not linked to an apartment yet',
  noHomeBody: 'Ask building management to add your account to your apartment. You can then book amenities here.',
} as const;

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

/** An amenity as the screen draws it. */
export interface Amenity extends AmenityView {
  photo: ImageKey;
  iconSet: IconSet;
  iconName: string;
}

export function toAmenity(view: AmenityView): Amenity {
  const picture = amenityPicture(view.picture);
  return { ...view, photo: picture.photo, iconSet: picture.icon.set, iconName: picture.icon.name };
}

/** How many amenities show before "View More Amenities" is tapped: the design's three. */
export const initialVisibleCount = 3;

export function amenitiesFor(list: readonly Amenity[], filter: CategoryFilter): readonly Amenity[] {
  return filter === 'all' ? list : list.filter((amenity) => amenity.categories.includes(filter));
}

/** "06:00 - 22:00". */
export function hoursLabel({ opens, closes }: Pick<Amenity, 'opens' | 'closes'>): string {
  return `${opens} - ${closes}`;
}

/** "Max 20", or "1 apartment" for one that a single apartment takes at a time. */
export function capacityLabel({ capacity, exclusive }: Pick<Amenity, 'capacity' | 'exclusive'>): string {
  return exclusive ? '1 apartment' : `Max ${capacity}`;
}

/** "06 Oct 2026" from YYYY-MM-DD. */
export function dayLabel(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  return formatDate(new Date(year, month - 1, day));
}

/** "1 Person", "3 People". */
export const peopleLabel = (count: number) => (count === 1 ? '1 Person' : `${count} People`);

export interface Booking {
  id: string;
  reference: string;
  amenityId: string;
  amenityTitle: string;
  /** "18 Oct 2026". */
  date: string;
  /** "10:00 - 11:00", as the cards write hours. */
  slot: string;
  people: number;
  cancellable: boolean;
}

/** The apartment's bookings from today on, soonest first. */
export function upcomingBookings(views: readonly AmenityBookingView[], today: string): Booking[] {
  return views
    .filter((view) => view.status === 'booked' && view.date >= today)
    .map((view) => ({
      id: view.id,
      reference: view.reference,
      amenityId: view.amenityId,
      amenityTitle: view.amenityTitle,
      date: dayLabel(view.date),
      slot: `${view.start} - ${view.end}`,
      people: view.people,
      cancellable: view.cancellable,
    }));
}

/** The form holds the values the backend takes: YYYY-MM-DD, HH:MM, and a count. */
export interface BookingForm {
  date: string;
  slot: string;
  people: string;
}

export type BookingErrors = Partial<Record<keyof BookingForm, string>>;

export interface Choice {
  value: string;
  label: string;
}

export function dateChoices(options: Pick<AmenityOptions, 'firstDate' | 'lastDate'>): Choice[] {
  const days: Choice[] = [];
  for (let date = options.firstDate; date <= options.lastDate && days.length < 120; date = addDays(date, 1)) {
    days.push({ value: date, label: dayLabel(date) });
  }
  return days;
}

/** Times that can still take this many people: not started, not already the apartment's, with room left. */
export function slotChoices(slots: readonly AmenitySlot[], amenity: Pick<Amenity, 'exclusive'>, people: number): Choice[] {
  return slots
    .filter((slot) => !slot.past && !slot.mine && slot.left >= (amenity.exclusive ? 1 : people))
    .map((slot) => ({ value: slot.start, label: amenity.exclusive ? `${slot.start} - ${slot.end}` : `${slot.start} - ${slot.end} · ${slot.left} left` }));
}

export function peopleChoices(amenity: Pick<Amenity, 'maxPeople'>): Choice[] {
  return Array.from({ length: amenity.maxPeople }, (_, index) => ({ value: String(index + 1), label: peopleLabel(index + 1) }));
}

export const labelFor = (choices: readonly Choice[], value: string) => choices.find((choice) => choice.value === value)?.label ?? '';

/** The app's own checks; the backend checks the rules and the places again. */
export function validateBooking(form: BookingForm): BookingErrors {
  const errors: BookingErrors = {};
  if (!form.date) errors.date = 'Choose a date';
  if (!form.slot) errors.slot = 'Choose a time';
  return errors;
}

/** Which field a refusal from the backend belongs to. */
export function formFieldOf(apiField: string | undefined, code: string): keyof BookingForm | null {
  if (code === 'slot_taken') return 'slot';
  if (apiField === 'date' || apiField === 'people') return apiField;
  if (apiField === 'start') return 'slot';
  return null;
}
