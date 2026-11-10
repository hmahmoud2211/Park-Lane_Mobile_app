import { withParkingReady } from '../features/parking/components/ParkingReady';
import { ChargingSessionScreen } from '../screens/ChargingSessionScreen';
import { GuestPassScreen } from '../screens/GuestPassScreen';
import { ParkingMapScreen } from '../screens/ParkingMapScreen';
import { ParkingScreen } from '../screens/ParkingScreen';
import { ReservationDetailsScreen } from '../screens/ReservationDetailsScreen';
import { ReservationHistoryScreen } from '../screens/ReservationHistoryScreen';
import { ReserveParkingScreen } from '../screens/ReserveParkingScreen';

/**
 * The parking screens, on the backend's parking; each waits for its first snapshot (ParkingReady). AppNavigator
 * `require`s this module behind a build-time check, so a store build without EXPO_PUBLIC_PARKING=1 (parking's real
 * layout not yet confirmed) leaves them out altogether.
 */
export const parkingScreens = {
  Parking: withParkingReady(ParkingScreen),
  ReserveParking: withParkingReady(ReserveParkingScreen),
  ReservationDetails: withParkingReady(ReservationDetailsScreen),
  ReservationHistory: withParkingReady(ReservationHistoryScreen),
  GuestPass: withParkingReady(GuestPassScreen),
  ParkingMap: withParkingReady(ParkingMapScreen),
  ChargingSession: withParkingReady(ChargingSessionScreen),
} as const;
