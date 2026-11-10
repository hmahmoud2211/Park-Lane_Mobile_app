import type { IconSet } from '../types/icons.types';
import type { ImageKey } from './images';

/**
 * The pictures building management can choose for a notice, event, poll option or amenity (the backend's list,
 * backend/src/lib/pictures.ts). Each is one of the app's own photos or a glyph, so nothing is downloaded. A name
 * the app doesn't know (say, one added to the backend later) gets the caller's fallback glyph.
 */

type Glyph = { set: IconSet; name: string };

const PHOTOS: Record<string, ImageKey> = {
  pool: 'communityPool',
  pool_night: 'communityPoolNight',
  cafe: 'communityCafe',
  movie: 'communityMovie',
  yoga: 'communityYoga',
  gathering: 'communityGathering',
  gate: 'communityGate',
  gym: 'amenityGym',
  hall: 'amenityHall',
  kids: 'communityPollKids',
  fitness: 'communityPollFitness',
  events: 'communityPollEvents',
  feedback: 'communityFeedback',
};

const GLYPHS: Record<string, Glyph> = {
  leaf: { set: 'ionicons', name: 'leaf-outline' },
  barbell: { set: 'ionicons', name: 'barbell-outline' },
  water: { set: 'ionicons', name: 'water-outline' },
  car: { set: 'ionicons', name: 'car-outline' },
  palette: { set: 'ionicons', name: 'color-palette-outline' },
  walk: { set: 'ionicons', name: 'walk-outline' },
  megaphone: { set: 'ionicons', name: 'megaphone-outline' },
  calendar: { set: 'ionicons', name: 'calendar-outline' },
  info: { set: 'ionicons', name: 'information-circle-outline' },
  warning: { set: 'ionicons', name: 'warning-outline' },
  music: { set: 'ionicons', name: 'musical-notes-outline' },
  tools: { set: 'ionicons', name: 'construct-outline' },
  tennis: { set: 'ionicons', name: 'tennisball-outline' },
  football: { set: 'ionicons', name: 'football-outline' },
};

/** The ring icon an amenity card draws beside its photo. */
const AMENITY_ICONS: Record<string, Glyph> = {
  pool: { set: 'material', name: 'pool' },
  pool_night: { set: 'material', name: 'pool' },
  gym: { set: 'ionicons', name: 'barbell-outline' },
  barbell: { set: 'ionicons', name: 'barbell-outline' },
  hall: { set: 'material', name: 'account-group-outline' },
  gathering: { set: 'material', name: 'account-group-outline' },
  yoga: { set: 'material', name: 'meditation' },
  movie: { set: 'material', name: 'movie-open-outline' },
  kids: { set: 'material', name: 'seesaw' },
  cafe: { set: 'material', name: 'coffee-outline' },
  tennis: { set: 'ionicons', name: 'tennisball-outline' },
  football: { set: 'ionicons', name: 'football-outline' },
};

/** A row's picture: one of the app's photos, or a glyph on a tinted tile. */
export function pictureFor(name: string | null, fallback: Glyph): { photo: ImageKey; icon?: never } | { photo?: never; icon: Glyph } {
  const photo = name ? PHOTOS[name] : undefined;
  if (photo) return { photo };
  return { icon: (name ? GLYPHS[name] : undefined) ?? fallback };
}

/** An amenity card always shows a photo (the banner's, without one of its own) and a ring icon. */
export function amenityPicture(name: string | null): { photo: ImageKey; icon: Glyph } {
  return {
    photo: (name ? PHOTOS[name] : undefined) ?? 'amenitiesHero',
    icon: (name ? (AMENITY_ICONS[name] ?? GLYPHS[name]) : undefined) ?? { set: 'ionicons', name: 'sparkles-outline' },
  };
}
