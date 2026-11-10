import { ApiError } from '../errors.ts';

/**
 * Pictures management can pick for a notice, event, poll option or amenity. The app ships these itself (photos
 * from the design and plain glyphs), so nothing is uploaded and a resident's phone never fetches an image from
 * elsewhere. The app draws a glyph for any name it doesn't know.
 */
export const PICTURES = [
  // photos
  'pool', 'pool_night', 'cafe', 'movie', 'yoga', 'gathering', 'gate', 'gym', 'hall', 'kids', 'fitness', 'events', 'feedback',
  // glyphs
  'leaf', 'barbell', 'water', 'car', 'palette', 'walk', 'megaphone', 'calendar', 'info', 'warning', 'music', 'tools', 'tennis', 'football',
] as const;

export function pictureOf(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'string' && (PICTURES as readonly string[]).includes(value)) return value;
  throw new ApiError('invalid', `Choose a picture from the list: ${PICTURES.join(', ')}.`, field);
}
