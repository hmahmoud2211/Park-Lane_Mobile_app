/**
 * Copy for the onboarding screen, kept out of the component so the layout is
 * driven by data rather than repeated markup. Text matches the Figma screen
 * exactly and must not be reworded here.
 */

export interface EyebrowLine {
  id: string;
  text: string;
}

export interface HeadlineLine {
  id: string;
  text: string;
  /** Rendered in the accent colour. */
  accent?: boolean;
}

export const eyebrowLines: readonly EyebrowLine[] = [
  { id: 'eyebrow-1', text: 'More' },
  { id: 'eyebrow-2', text: 'Than a home' },
];

export const headlineLines: readonly HeadlineLine[] = [
  { id: 'headline-1', text: 'Smart' },
  { id: 'headline-2', text: 'Community' },
  { id: 'headline-3', text: 'Living', accent: true },
];

export const primaryCta = {
  label: 'Get Started',
} as const;
