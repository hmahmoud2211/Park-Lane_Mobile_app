import {
  NavigationContainer,
  StackActions,
  createNavigationContainerRef,
  type LinkingOptions,
  type Theme,
} from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useCallback, useMemo, useState } from 'react';
import { Platform } from 'react-native';

import { AppShell } from '../components/layout/AppShell';
import { useAppTheme } from '../hooks/useAppTheme';
import { AmenitiesBookingScreen } from '../screens/AmenitiesBookingScreen';
import { AssistantScreen } from '../screens/AssistantScreen';
import { ChargingSessionScreen } from '../screens/ChargingSessionScreen';
import { CommunityScreen } from '../screens/CommunityScreen';
import { ConnectAccountScreen } from '../screens/ConnectAccountScreen';
import { DemoControlsScreen } from '../screens/DemoControlsScreen';
import { DeviceDetailScreen } from '../screens/DeviceDetailScreen';
import { EmsDevicesScreen } from '../screens/EmsDevicesScreen';
import { FirstScreen } from '../screens/FirstScreen';
import { GuestPassScreen } from '../screens/GuestPassScreen';
import { HomeScreen } from '../screens/HomeScreen';
import { LoginScreen } from '../screens/LoginScreen';
import { MaintenanceScreen } from '../screens/MaintenanceScreen';
import { MyUnitScreen } from '../screens/MyUnitScreen';
import { ParkingMapScreen } from '../screens/ParkingMapScreen';
import { ParkingScreen } from '../screens/ParkingScreen';
import { ProfileScreen } from '../screens/ProfileScreen';
import { ReservationDetailsScreen } from '../screens/ReservationDetailsScreen';
import { ReservationHistoryScreen } from '../screens/ReservationHistoryScreen';
import { ReserveParkingScreen } from '../screens/ReserveParkingScreen';
import { SecurityConsoleScreen } from '../screens/SecurityConsoleScreen';
import { ServicesScreen } from '../screens/ServicesScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { SmartHomeScreen } from '../screens/SmartHomeScreen';
import { UnderDevelopmentScreen } from '../screens/UnderDevelopmentScreen';
import { VisitorAccessScreen } from '../screens/VisitorAccessScreen';
import type { RootStackParamList } from '../types/navigation.types';
import type { CurrentRoute, NavTab } from './navTabs';

const Stack = createNativeStackNavigator<RootStackParamList>();

/** Lets the side rail, which sits outside the stack, navigate it and see where it is. */
const navigationRef = createNavigationContainerRef<RootStackParamList>();

/**
 * Web only: gives the visitor's invitation its own address, /pass/<token>,
 * so the link opens the pass directly without signing in, and gives the
 * parking screens addresses that survive a refresh (the demo's data does
 * too, see services/parking). Screens without a path here open at the first
 * screen on refresh, as before. Native deep links would need an app scheme.
 */
const linking: LinkingOptions<RootStackParamList> = {
  enabled: Platform.OS === 'web',
  prefixes: [],
  config: {
    screens: {
      FirstScreen: '',
      Parking: 'parking',
      ReserveParking: 'parking/reserve',
      ReservationDetails: {
        path: 'parking/reservation/:reservationId',
        parse: {
          justBooked: (value: string) => value === 'true',
          justEdited: (value: string) => value === 'true',
        },
      },
      ReservationHistory: 'parking/history',
      ParkingMap: 'parking/map',
      ChargingSession: 'parking/charging/:reservationId',
      SecurityConsole: 'parking/security',
      DemoControls: 'parking/demo',
      GuestPass: 'pass/:invite',
    },
  },
};

export function AppNavigator() {
  const theme = useAppTheme();
  const [current, setCurrent] = useState<CurrentRoute>();

  const trackRoute = useCallback(() => {
    const route = navigationRef.getCurrentRoute();
    if (route) {
      setCurrent({ name: route.name, params: route.params });
    }
  }, []);

  // The same moves the bottom bar makes, for the rail.
  const navigateTab = useCallback((tab: NavTab) => {
    if (!navigationRef.isReady()) {
      return;
    }
    if (tab.route === 'Home') {
      navigationRef.dispatch(StackActions.popTo('Home'));
    } else if (tab.route) {
      navigationRef.navigate(tab.route);
    } else if (tab.underDevelopment) {
      navigationRef.navigate('UnderDevelopment', {
        title: tab.label,
        iconSet: tab.iconSet,
        iconName: tab.iconName,
      });
    }
  }, []);

  // Keeps the navigator's own surfaces from flashing white between screens.
  const navigationTheme = useMemo<Theme>(
    () => ({
      dark: true,
      colors: {
        primary: theme.colors.primary,
        background: theme.colors.background,
        card: theme.colors.surface,
        text: theme.colors.textPrimary,
        border: theme.colors.border,
        notification: theme.colors.accent,
      },
      fonts: {
        regular: { fontFamily: theme.fontFamily.regular, fontWeight: '400' },
        medium: { fontFamily: theme.fontFamily.medium, fontWeight: '500' },
        bold: { fontFamily: theme.fontFamily.bold, fontWeight: '700' },
        heavy: { fontFamily: theme.fontFamily.bold, fontWeight: '700' },
      },
    }),
    [theme],
  );

  return (
    <NavigationContainer
      ref={navigationRef}
      theme={navigationTheme}
      linking={linking}
      onReady={trackRoute}
      onStateChange={trackRoute}
    >
      <AppShell current={current} onNavigate={navigateTab}>
        <Stack.Navigator
          initialRouteName="FirstScreen"
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: theme.colors.background },
          }}
        >
          <Stack.Screen name="FirstScreen" component={FirstScreen} />
          <Stack.Screen name="Login" component={LoginScreen} />
          <Stack.Screen name="Home" component={HomeScreen} />
          <Stack.Screen name="Profile" component={ProfileScreen} />
          <Stack.Screen name="MyUnit" component={MyUnitScreen} />
          <Stack.Screen name="VisitorAccess" component={VisitorAccessScreen} />
          <Stack.Screen name="Maintenance" component={MaintenanceScreen} />
          <Stack.Screen name="Parking" component={ParkingScreen} />
          <Stack.Screen name="Community" component={CommunityScreen} />
          <Stack.Screen name="SmartHome" component={SmartHomeScreen} />
          <Stack.Screen name="EmsDevices" component={EmsDevicesScreen} />
          <Stack.Screen name="DeviceDetail" component={DeviceDetailScreen} />
          <Stack.Screen name="ConnectAccount" component={ConnectAccountScreen} />
          <Stack.Screen name="AmenitiesBooking" component={AmenitiesBookingScreen} />
          <Stack.Screen name="Services" component={ServicesScreen} />
          <Stack.Screen name="Settings" component={SettingsScreen} />
          <Stack.Screen name="Assistant" component={AssistantScreen} />
          <Stack.Screen name="UnderDevelopment" component={UnderDevelopmentScreen} />
          <Stack.Screen name="ReserveParking" component={ReserveParkingScreen} />
          <Stack.Screen name="ReservationDetails" component={ReservationDetailsScreen} />
          <Stack.Screen name="ReservationHistory" component={ReservationHistoryScreen} />
          <Stack.Screen name="GuestPass" component={GuestPassScreen} />
          <Stack.Screen name="ParkingMap" component={ParkingMapScreen} />
          <Stack.Screen name="ChargingSession" component={ChargingSessionScreen} />
          <Stack.Screen name="SecurityConsole" component={SecurityConsoleScreen} />
          <Stack.Screen name="DemoControls" component={DemoControlsScreen} />
          {/* Register later screens here as their designs land. */}
        </Stack.Navigator>
      </AppShell>
    </NavigationContainer>
  );
}
