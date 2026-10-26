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
