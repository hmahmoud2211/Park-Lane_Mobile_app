import { useContext } from 'react';

import { ParkingDemoContext } from '../context/ParkingDemoContext';

/** The parking demo's store, clock and service. */
export function useParking() {
  const context = useContext(ParkingDemoContext);
  if (!context) {
    throw new Error('useParking must be used inside a ParkingDemoProvider');
  }
  return context;
}
