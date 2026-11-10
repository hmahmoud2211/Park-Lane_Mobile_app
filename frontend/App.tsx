// Imported by subpath, not from the package root: the root re-exports all 18
// weights and italics, which drags ~6MB of unused .ttf into the bundle.
import { Inter_400Regular } from '@expo-google-fonts/inter/400Regular';
import { Inter_500Medium } from '@expo-google-fonts/inter/500Medium';
import { Inter_600SemiBold } from '@expo-google-fonts/inter/600SemiBold';
import { Inter_700Bold } from '@expo-google-fonts/inter/700Bold';
import { useFonts } from 'expo-font';
import { StatusBar } from 'expo-status-bar';
import { Fragment } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AppProvider } from './src/context/AppContext';
import { EmsProvider } from './src/features/ems/context/EmsContext';
import { GatewayProvider } from './src/features/gateway/context/GatewayContext';
import { HealthProvider } from './src/features/health/context/HealthContext';
import { ThemeProvider } from './src/context/ThemeContext';
import { AppNavigator } from './src/navigation/AppNavigator';
import { colors } from './src/theme';
import { installWebFormStyles } from './src/utils/webFormStyles';
import { installWebZoomLock } from './src/utils/webZoomLock';

installWebFormStyles();
installWebZoomLock();

/**
 * The parking demo's on-device store. A require behind a check written out in full, so the
 * store build (EXPO_PUBLIC_STORE_MODE=1), which has no parking screens, leaves it out altogether.
 */
const ParkingDemoProvider =
  process.env.EXPO_PUBLIC_STORE_MODE === '1'
    ? Fragment
    : // eslint-disable-next-line @typescript-eslint/no-require-imports
      (require('./src/features/parking/context/ParkingDemoContext') as typeof import('./src/features/parking/context/ParkingDemoContext')).ParkingDemoProvider;

export default function App() {
  const [fontsLoaded] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  return (
    // The root view paints the brand colour behind everything, including the
    // status bar area, so the window's default white never shows through.
    <View style={styles.root}>
      <SafeAreaProvider>
        <ThemeProvider>
          <AppProvider>
            <EmsProvider>
              <GatewayProvider>
                <ParkingDemoProvider>
                  <HealthProvider>
                    {/* Every screen is dark, so light status bar content is the default. */}
                    <StatusBar style="light" />
                    {fontsLoaded ? <AppNavigator /> : <View style={styles.splash} />}
                  </HealthProvider>
                </ParkingDemoProvider>
              </GatewayProvider>
            </EmsProvider>
          </AppProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  splash: {
    flex: 1,
    backgroundColor: colors.background,
  },
});
