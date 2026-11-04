import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import type { IconSet } from '../components/ui/ServiceTile';
import type { Lang } from '../services/parking/i18n';

/**
 * Only the implemented screen is registered. Later screens are added here
 * alongside their params, which keeps navigation calls type-checked.
 */
export type RootStackParamList = {
  FirstScreen: undefined;
  Login: undefined;
  Home: undefined;
  Profile: undefined;
  MyUnit: undefined;
  VisitorAccess: undefined;
  Maintenance: undefined;
  Parking: undefined;
  Community: undefined;
  SmartHome: undefined;
  /** The resident's devices, controlled through the EMS backend. */
  EmsDevices: undefined;
  /** One device's controls, name and room. */
  DeviceDetail: { deviceId: string };
  /**
   * Linking a brand's cloud account through the building's hub. Reached only
   * from Add Device's "manufacturer account" fallback, or to sign in again.
   */
  ConnectAccount: { integration?: string; flowId?: string } | undefined;
  /** Pairing this phone with a CUBE Gateway; `host` pre-fills a found or scanned address. */
  GatewaySetup: { host?: string; code?: string } | undefined;
  /** The one way to add a device: choose the manufacturer (Screen 1). */
  AddDevice: undefined;
  /** How to connect a device of that brand (Screen 2). */
  AddDeviceMethod: { brandId: string };
  /** Finding devices on the Wi-Fi, or checking one address, then pairing (Screen 3). */
  DeviceDiscovery: { brandId: string; adapterId?: string; mode?: 'scan' | 'manual'; candidateId?: string };
  /** Setting up a factory-new device on the home Wi-Fi through its setup hotspot. */
  DeviceProvisioning: { brandId: string; pluginId: string };
  /** Naming, placing and testing a newly paired gateway device (Screen 4). `deviceId` is the gateway's id. */
  DeviceSetup: { deviceId: string };
  AmenitiesBooking: undefined;
  Services: undefined;
  Settings: undefined;
  /** Opens in chat unless `mode` asks for voice, e.g. from Home's mic button. */
  Assistant: { mode?: 'chat' | 'voice' } | undefined;
  /** Placeholder for a feature still being built, named and drawn by its tile. */
  UnderDevelopment: { title: string; iconSet: IconSet; iconName: string };

  /** Visitor parking and EV charging. `reservationId` edits an upcoming booking. */
  ReserveParking: { mode: 'guest' | 'ev'; reservationId?: string };
  ReservationDetails: { reservationId: string; justBooked?: boolean; justEdited?: boolean };
  ReservationHistory: undefined;
  /** The page a visitor opens from their invitation link; no account needed. `lang` picks English or Arabic. */
  GuestPass: { invite: string; lang?: Lang; /** Demo only: the booking carried in the link (services/parking/passLink). */ d?: string };
  /** Gate-to-bay directions for a booking, a visitor's pass, or the resident's own bay. Arabic only from a pass. */
  ParkingMap: { reservationId?: string; invite?: string; spaceId?: string; lang?: Lang };
  ChargingSession: { reservationId: string };
  /** Demo only: the security desk's gate console. */
  SecurityConsole: undefined;
  /** Demo only: clock, simulated events and data reset. */
  DemoControls: undefined;
};

/** Routes that can be opened without params, e.g. from data-driven tiles and tabs. */
export type ParamlessRoute = {
  [K in keyof RootStackParamList]: undefined extends RootStackParamList[K] ? K : never;
}[keyof RootStackParamList];

export type RootStackScreenProps<T extends keyof RootStackParamList> =
  NativeStackScreenProps<RootStackParamList, T>;

declare global {
  namespace ReactNavigation {
    // Module augmentation: React Navigation reads the app's routes from here,
    // so the interface deliberately adds no members of its own.
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface RootParamList extends RootStackParamList {}
  }
}
