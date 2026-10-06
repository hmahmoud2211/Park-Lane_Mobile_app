import type { IconSet } from '../../components/ui/ServiceTile';
import type { ImageKey } from '../../constants/images';
import type { colors } from '../../theme/colors';

/**
 * Mock content for the Smart Home screen. Shaped the way a real API response
 * would be, so wiring this to a backend later replaces this module rather
 * than the screen. Wording matches the Figma reference
 * (assets/Screens/screen9.png, and its continuation screen10.png) exactly.
 */

/** A theme colour, named rather than written out, so data stays hex-free. */
type ColorToken = keyof typeof colors;

export const smartHomeCopy = {
  title: 'Smart Home',
  unitTitle: 'Unit A-302',
  unitMeta: '3 Bedrooms • Tower A • Floor 3',
  viewAll: 'View All',
  scenesTitle: 'Scenes',
  scenesSubtitle: 'One tap for the perfect atmosphere.',
  energyTitle: 'Energy Usage',
  energySubtitle: 'Live monitoring for a smarter home.',
  devicesTitle: 'Smart Devices',
  devicesSubtitle: 'Manage all your connected devices.',
  automationTitle: 'Device Automation',
  automationSubtitle: 'Make your home work for you.',
} as const;

interface Glyph {
  iconSet: IconSet;
  iconName: string;
}

export interface Room extends Glyph {
  id: string;
  label: string;
}

export const rooms: readonly Room[] = [
  { id: 'living', label: 'Living Room', iconSet: 'material', iconName: 'sofa-outline' },
  { id: 'master', label: 'Master Bedroom', iconSet: 'material', iconName: 'bed-king-outline' },
  { id: 'bedroom-2', label: 'Bedroom 2', iconSet: 'material', iconName: 'bed-outline' },
  { id: 'bedroom-3', label: 'Bedroom 3', iconSet: 'material', iconName: 'bed-outline' },
  { id: 'kitchen', label: 'Kitchen', iconSet: 'material', iconName: 'pot-steam-outline' },
];

/** The four control cards share a heading: icon, title, supporting line and toggle. */
export interface ControlCardInfo extends Glyph {
  title: string;
  subtitle: string;
  iconColor: ColorToken;
}

export const lightingCard: ControlCardInfo = {
  title: 'Lighting',
  subtitle: 'Adjust brightness and color',
  iconSet: 'material',
  iconName: 'lightbulb-on-outline',
  iconColor: 'iconWarm',
};

export const acCard: ControlCardInfo = {
  title: 'AC',
  subtitle: 'Set your comfort temperature',
  iconSet: 'material',
  iconName: 'snowflake',
  iconColor: 'iconCool',
};

export const curtainsCard: ControlCardInfo = {
  title: 'Curtains',
  subtitle: 'Open or close curtains',
  iconSet: 'material',
  iconName: 'curtains',
  iconColor: 'iconWarm',
};

export const mediaCard: ControlCardInfo = {
  title: 'TV & Media',
  subtitle: 'Control your entertainment',
  iconSet: 'material',
  iconName: 'monitor',
  iconColor: 'textPrimary',
};

export interface LightPreset {
  id: string;
  label: string;
  color: ColorToken;
}

export const lighting = {
  /** 0-1. */
  brightness: 0.7,
  /** Arrow keys and screen-reader swipes move it by this much. */
  brightnessStep: 0.1,
  presets: [
    { id: 'warm', label: 'Warm white', color: 'lightWarm' },
    { id: 'amber', label: 'Amber', color: 'lightAmber' },
    { id: 'daylight', label: 'Daylight', color: 'lightDaylight' },
    { id: 'blue', label: 'Blue', color: 'lightBlue' },
    { id: 'violet', label: 'Violet', color: 'lightViolet' },
  ] satisfies readonly LightPreset[],
  /** Six hues around the custom-colour ring, clockwise from the top. */
  ringHues: ['hueRed', 'hueOrange', 'hueYellow', 'hueGreen', 'hueBlue', 'hueMagenta'] satisfies readonly ColorToken[],
} as const;

export type AcMode = 'Auto' | 'Cool' | 'Dry' | 'Fan';

export const climate = {
  temperature: 24,
  minTemperature: 16,
  maxTemperature: 30,
  /** Fan speed, 1 to `fanLevels`. */
  fanSpeed: 4,
  fanLevels: 7,
  modes: ['Auto', 'Cool', 'Dry', 'Fan'] satisfies readonly AcMode[],
} as const;

export type CurtainAction = 'open' | 'pause' | 'close';

export const curtainActions: readonly (Glyph & { id: CurtainAction; label: string })[] = [
  { id: 'open', label: 'Open', iconSet: 'material', iconName: 'curtains' },
  { id: 'pause', label: 'Pause', iconSet: 'ionicons', iconName: 'pause' },
  { id: 'close', label: 'Close', iconSet: 'material', iconName: 'curtains-closed' },
];

/** A streaming app is shown by its logo; the app drawer by a glyph. */
export type MediaSource =
  | { id: string; label: string; logo: 'netflixLogo' | 'youtubeLogo' | 'disneyLogo' }
  | ({ id: string; label: string } & Glyph);

export const mediaSources: readonly MediaSource[] = [
  { id: 'netflix', label: 'Netflix', logo: 'netflixLogo' },
  { id: 'youtube', label: 'YouTube', logo: 'youtubeLogo' },
  { id: 'disney', label: 'Disney+', logo: 'disneyLogo' },
  { id: 'apps', label: 'Apps', iconSet: 'ionicons', iconName: 'grid-outline' },
];

export interface Scene extends Glyph {
  id: string;
  label: string;
  photo: ImageKey;
}

export const scenes: readonly Scene[] = [
  { id: 'welcome', label: 'Welcome Home', photo: 'sceneWelcome', iconSet: 'ionicons', iconName: 'home-outline' },
  { id: 'relax', label: 'Relax', photo: 'sceneRelax', iconSet: 'ionicons', iconName: 'leaf-outline' },
  { id: 'movie', label: 'Movie Night', photo: 'sceneMovie', iconSet: 'material', iconName: 'movie-open-play-outline' },
  { id: 'night', label: 'Good Night', photo: 'sceneNight', iconSet: 'ionicons', iconName: 'moon-outline' },
];

/** The scene running when the screen opens. */
export const activeSceneId = 'welcome';

export interface EnergyRow extends Glyph {
  id: string;
  label: string;
  kwh: number;
  iconColor: ColorToken;
}

export const energy = {
  todayKwh: 12.4,
  /** The gauge fills against this daily figure. */
  dailyBudgetKwh: 28,
  /** Change on yesterday, in percent; negative is a saving. */
  changePercent: -12,
  breakdown: [
    { id: 'lighting', label: 'Lighting', kwh: 4.1, iconSet: 'material', iconName: 'lightbulb-on-outline', iconColor: 'iconWarm' },
    { id: 'ac', label: 'AC', kwh: 5.6, iconSet: 'material', iconName: 'snowflake', iconColor: 'iconWarm' },
    { id: 'media', label: 'TV & Media', kwh: 1.8, iconSet: 'material', iconName: 'monitor', iconColor: 'textPrimary' },
    { id: 'other', label: 'Other', kwh: 0.9, iconSet: 'material', iconName: 'power-socket-eu', iconColor: 'textPrimary' },
  ] satisfies readonly EnergyRow[],
} as const;

/** "12.4 kWh". */
export function formatKwh(kwh: number): string {
  return `${kwh.toFixed(1)} kWh`;
}

export interface SmartDevice extends Glyph {
  id: string;
  name: string;
  location: string;
  online: boolean;
  enabled: boolean;
}

export const devices: readonly SmartDevice[] = [
  { id: 'lock', name: 'Smart Lock', location: 'Front Door', online: true, enabled: true, iconSet: 'ionicons', iconName: 'lock-closed-outline' },
  { id: 'camera', name: 'Security Camera', location: 'Living Room', online: true, enabled: true, iconSet: 'material', iconName: 'cctv' },
  { id: 'speaker', name: 'Smart Speaker', location: 'Living Room', online: true, enabled: true, iconSet: 'material', iconName: 'speaker' },
  { id: 'motion', name: 'Motion Sensor', location: 'Corridor', online: true, enabled: true, iconSet: 'material', iconName: 'access-point' },
];

export const deviceStatusLabel = { online: 'Online', offline: 'Offline' } as const;

export interface Automation extends Glyph {
  id: string;
  title: string;
  summary: string;
  enabled: boolean;
}

export const automations: readonly Automation[] = [
  {
    id: 'arrive',
    title: 'Arrive Home',
    summary: 'Turn on lights, open curtains, set AC to 24°C',
    enabled: true,
    iconSet: 'ionicons',
    iconName: 'home-outline',
  },
  {
    id: 'leave',
    title: 'Leave Home',
    summary: 'Turn off lights, close curtains, activate security',
    enabled: true,
    iconSet: 'material',
    iconName: 'briefcase-outline',
  },
  {
    id: 'night',
    title: 'Good Night',
    summary: 'Turn off TV, dim lights, set AC to 26°C',
    enabled: true,
    iconSet: 'ionicons',
    iconName: 'moon-outline',
  },
];
