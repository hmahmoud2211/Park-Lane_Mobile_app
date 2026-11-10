import { AmenitiesBookingScreen } from '../screens/AmenitiesBookingScreen';
import { BmsScreen } from '../screens/BmsScreen';
import { ChargingSessionScreen } from '../screens/ChargingSessionScreen';
import { CommunityScreen } from '../screens/CommunityScreen';
import { DemoControlsScreen } from '../screens/DemoControlsScreen';
import { GuestPassScreen } from '../screens/GuestPassScreen';
import { MaintenanceScreen } from '../screens/MaintenanceScreen';
import { MyUnitScreen } from '../screens/MyUnitScreen';
import { ParkingMapScreen } from '../screens/ParkingMapScreen';
import { ParkingScreen } from '../screens/ParkingScreen';
import { ReservationDetailsScreen } from '../screens/ReservationDetailsScreen';
import { ReservationHistoryScreen } from '../screens/ReservationHistoryScreen';
import { ReserveParkingScreen } from '../screens/ReserveParkingScreen';
import { SecurityConsoleScreen } from '../screens/SecurityConsoleScreen';
import { VisitorAccessScreen } from '../screens/VisitorAccessScreen';

/**
 * Screens that still show sample data or keep everything on the phone. AppNavigator `require`s
 * this module behind a build-time check, so the store build (EXPO_PUBLIC_STORE_MODE=1) leaves
 * them, and their made-up residents, receipts and passes, out of the app altogether.
 * When a screen gets a real backend, move it back to a normal import in AppNavigator.
 */
export const sampleScreens = {
  MyUnit: MyUnitScreen,
  VisitorAccess: VisitorAccessScreen,
  Maintenance: MaintenanceScreen,
  Parking: ParkingScreen,
  Community: CommunityScreen,
  Bms: BmsScreen,
  AmenitiesBooking: AmenitiesBookingScreen,
  ReserveParking: ReserveParkingScreen,
  ReservationDetails: ReservationDetailsScreen,
  ReservationHistory: ReservationHistoryScreen,
  GuestPass: GuestPassScreen,
  ParkingMap: ParkingMapScreen,
  ChargingSession: ChargingSessionScreen,
  SecurityConsole: SecurityConsoleScreen,
  DemoControls: DemoControlsScreen,
} as const;
