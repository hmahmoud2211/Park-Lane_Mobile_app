import { useContext } from 'react';

import { ParkingDemoContext } from '../context/parkingValue';

/** The parking store, clock and service: the backend's, or the offline demo's for the demo tools. */
export function useParking() {
  const context = useContext(ParkingDemoContext);
  if (!context) {
    throw new Error('useParking must be used inside a ParkingDemoProvider');
  }
  return context;
}
