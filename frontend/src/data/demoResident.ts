/**
 * The resident and their unit, as Home, Profile and My Unit show them until those screens
 * read the signed-in account. Mock content shaped the way a real API response would be; the
 * wording matches the Figma reference.
 *
 * Shown on Home, Profile and My Unit, and printed on the visitor pass and receipts. Other
 * demo identities are separate on purpose (config/demo.ts lists them all).
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
