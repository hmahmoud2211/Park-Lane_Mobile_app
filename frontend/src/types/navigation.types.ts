import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import type { DocumentType, HealthLang, RecordSection } from './health.types';
import type { IconSet } from './icons.types';
import type { Lang } from './i18n.types';

/**
 * Only the implemented screen is registered. Later screens are added here
 * alongside their params, which keeps navigation calls type-checked.
 */
export type RootStackParamList = {
  FirstScreen: undefined;
  Login: undefined;
  /**
   * Choosing one's own password: after signing in with a temporary one (nothing else opens until
   * it is set), or `voluntary` from Account & security, which returns there when done.
   */
  ChangePassword: { voluntary?: boolean } | undefined;
  Home: undefined;
  Profile: undefined;
  MyUnit: undefined;
  VisitorAccess: undefined;
  Maintenance: undefined;
  Parking: undefined;
  Community: undefined;
  SmartHome: undefined;
  /** Building Management System: the building's shared systems at a glance, from Home's "BMS" tile. */
  Bms: undefined;
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
  /**
   * Who shares the home, and family invites: inviting (owners) and joining. `code` comes from an
   * invite link (parklane://join/<code>) and is checked straight away.
   */
  Household: { code?: string } | undefined;
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
  /** Adding an LG AC from the phone through ReThink (gateway plugin lg_thinq_softap). */
  LgPairing: undefined;
  /** Every setting an AC announces through the gateway. `deviceId` is the app's id (gw:…). */
  AcControl: { deviceId: string };
  AmenitiesBooking: undefined;
  Services: undefined;
  Settings: undefined;
  /** Password, signing out other phones and deleting the account, from Settings. */
  AccountSecurity: undefined;
  /** Deleting the signed-in account and its data, after the password. */
  DeleteAccount: undefined;
  /** How to get help, the privacy policy and the app version; the Contact Us tab and Settings. */
  HelpSupport: undefined;
  /** The resident's inbox and which kinds of update they want, from Settings. */
  Notifications: undefined;
  /** The apartment's bills and payments (owners), from Services. */
  Bills: undefined;
  /** Parcels the gate is holding, from Services. */
  Deliveries: undefined;
  /** Cleaning visits, from Services; the Maintenance screen in its housekeeping form. */
  Housekeeping: undefined;
  /** Moving in or out, from Services; the Maintenance screen in its moving form. */
  MovingRequest: undefined;
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
  ParkingMap: { reservationId?: string; invite?: string; spaceId?: string; lang?: Lang } | undefined;
  ChargingSession: { reservationId: string };
  /** Demo only: the security desk's gate console. */
  SecurityConsole: undefined;
  /** Demo only: clock, simulated events and data reset. */
  DemoControls: undefined;

  /** Health Passport home; sends a resident who hasn't consented to onboarding first. */
  HealthPassport: undefined;
  HealthOnboarding: undefined;
  /** A profile's basic details; without `profileId` it adds a family member. */
  HealthProfile: { profileId?: string } | undefined;
  HealthRecords: { profileId: string; tab?: RecordTab };
  HealthDocument: { docId: string };
  /** `retryOf` names a failed document this upload replaces. */
  HealthUpload: { profileId: string; type?: DocumentType; retryOf?: string };
  /** Checking what the server read from a document, item by item. */
  HealthReview: { docId: string };
  /**
   * Adds an item by hand, or edits `itemId`. Without `section` the resident
   * picks one first; `labTest` starts a new lab result for that test.
   */
  HealthItemForm: { profileId: string; section?: RecordSection; itemId?: string; labTest?: string };
  /** With `lang` (and `specialty`), opens straight on that summary: its player, progress or failure. */
  HealthSummary: { profileId: string; lang?: HealthLang; specialty?: string | null };
  HealthSettings: undefined;
  /** Who can see a record the resident keeps: the apartment's other residents. */
  HealthShare: { profileId: string };
  /** A clinic visit its doctor finalized, as it appears in Health Passport. */
  HealthConsultation: { consultationId: string };

  /** Clinical Appointment: the clinic's doctors, by specialty, and the resident's appointments. */
  Clinic: undefined;
  /** A doctor's profile and free slots. `rescheduleOf` moves that appointment rather than booking a new one. */
  ClinicDoctor: { doctorId: string; rescheduleOf?: string };
  /** Confirming a slot. `date` and `time` are clinic time, as the slot listed them. */
  ClinicBooking: { doctorId: string; startsAt: string; date: string; time: string; rescheduleOf?: string };
  ClinicAppointment: { appointmentId: string; justBooked?: boolean };
};

/** The Records screen's tabs: each record section, then the documents. */
export type RecordTab = RecordSection | 'documents';

/**
 * Paramless routes that only their own flow opens, by name; no tile or tab points at them.
 * The way in (FirstScreen, Login) counts: sign-in and sign-out reach it by name.
 */
type FlowOnlyRoute =
  | 'FirstScreen'
  | 'Login'
  | 'HealthOnboarding'
  | 'HealthProfile'
  | 'HealthSettings'
  | 'ChangePassword'
  | 'Household'
  | 'AccountSecurity'
  | 'DeleteAccount'
  | 'Notifications'
  | 'Bills'
  | 'Deliveries'
  | 'Housekeeping'
  | 'MovingRequest';

/**
 * Routes that can be opened without params, e.g. from data-driven tiles and tabs.
 *
 * TypeScript compares a union argument with navigate()'s overloads only up to 25 members;
 * past that every `navigate(tile.route)` fails to compile. New routes that no tile or tab
 * opens belong in FlowOnlyRoute.
 */
export type ParamlessRoute = Exclude<
  { [K in keyof RootStackParamList]: undefined extends RootStackParamList[K] ? K : never }[keyof RootStackParamList],
  FlowOnlyRoute
>;

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
