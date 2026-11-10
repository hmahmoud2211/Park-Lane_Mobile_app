import { createAmenity } from '../../src/amenities/amenities.ts';
import { listAmenities } from '../../src/repositories/amenities.ts';

/** Adds an amenity to the site's catalogue unless one with that title is there; returns its id. */
export function addAmenity(siteId: string, body: Record<string, unknown>): string {
  const existing = listAmenities(siteId, true).find((amenity) => amenity.title === body.title);
  return existing?.id ?? createAmenity(siteId, body).id;
}
