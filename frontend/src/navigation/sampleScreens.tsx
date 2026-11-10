import { BmsScreen } from '../screens/BmsScreen';
import { DemoControlsScreen } from '../screens/DemoControlsScreen';
import { SecurityConsoleScreen } from '../screens/SecurityConsoleScreen';
import { ParkingDemoProvider } from '../features/parking/context/ParkingDemoContext';
import type { ComponentType } from 'react';

/** The demo tools run the parking rules on this device, with their own sample data, apart from the backend's. */
function withOfflineDemo<P extends object>(Screen: ComponentType<P>): ComponentType<P> {
  function OfflineDemo(props: P) {
    return (
      <ParkingDemoProvider>
        <Screen {...props} />
      </ParkingDemoProvider>
    );
  }
  OfflineDemo.displayName = `OfflineDemo(${Screen.displayName ?? Screen.name ?? 'Screen'})`;
  return OfflineDemo;
}

/**
 * Screens that still show sample data or keep everything on the phone. AppNavigator `require`s
 * this module behind a build-time check, so the store build (EXPO_PUBLIC_STORE_MODE=1) leaves
 * them, and their made-up residents, receipts and passes, out of the app altogether.
 * When a screen gets a real backend, move it back to a normal import in AppNavigator.
 */
export const sampleScreens = {
  // Simulated readings only (a demo compound) until a live building feed exists.
  Bms: BmsScreen,
  SecurityConsole: withOfflineDemo(SecurityConsoleScreen),
  DemoControls: withOfflineDemo(DemoControlsScreen),
} as const;
