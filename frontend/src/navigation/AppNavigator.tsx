import {
  NavigationContainer,
  StackActions,
  createNavigationContainerRef,
  type LinkingOptions,
  type Theme,
} from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Platform } from 'react-native';

import { AppShell } from '../components/layout/AppShell';
import { flags } from '../config/flags';
import { useEms } from '../features/ems/hooks/useEms';
import { HealthNotifier } from '../features/health/components/HealthNotifier';
import type { HealthNotice } from '../features/health/services/healthStore';
import { useAppTheme } from '../hooks/useAppTheme';
import { AddDeviceMethodScreen } from '../screens/AddDeviceMethodScreen';
import { AddDeviceScreen } from '../screens/AddDeviceScreen';
import { AcControlScreen } from '../screens/AcControlScreen';
import { AmenitiesBookingScreen } from '../screens/AmenitiesBookingScreen';
import { BmsScreen } from '../screens/BmsScreen';
import { ChangePasswordScreen } from '../screens/ChangePasswordScreen';
import { AssistantScreen } from '../screens/AssistantScreen';
import { ChargingSessionScreen } from '../screens/ChargingSessionScreen';
import { ClinicAppointmentScreen } from '../screens/ClinicAppointmentScreen';
import { ClinicBookingScreen } from '../screens/ClinicBookingScreen';
import { ClinicDoctorScreen } from '../screens/ClinicDoctorScreen';
import { ClinicScreen } from '../screens/ClinicScreen';
import { CommunityScreen } from '../screens/CommunityScreen';
import { ConnectAccountScreen } from '../screens/ConnectAccountScreen';
import { DemoControlsScreen } from '../screens/DemoControlsScreen';
import { DeviceDetailScreen } from '../screens/DeviceDetailScreen';
import { DeviceDiscoveryScreen } from '../screens/DeviceDiscoveryScreen';
import { DeviceProvisioningScreen } from '../screens/DeviceProvisioningScreen';
import { DeviceSetupScreen } from '../screens/DeviceSetupScreen';
import { EmsDevicesScreen } from '../screens/EmsDevicesScreen';
import { FirstScreen } from '../screens/FirstScreen';
import { GatewaySetupScreen } from '../screens/GatewaySetupScreen';
import { GuestPassScreen } from '../screens/GuestPassScreen';
import { HealthConsultationScreen } from '../screens/HealthConsultationScreen';
import { HealthDocumentScreen } from '../screens/HealthDocumentScreen';
import { HealthItemFormScreen } from '../screens/HealthItemFormScreen';
import { HealthOnboardingScreen } from '../screens/HealthOnboardingScreen';
import { HealthPassportScreen } from '../screens/HealthPassportScreen';
import { HealthProfileScreen } from '../screens/HealthProfileScreen';
import { HealthRecordsScreen } from '../screens/HealthRecordsScreen';
import { HealthReviewScreen } from '../screens/HealthReviewScreen';
import { HealthSettingsScreen } from '../screens/HealthSettingsScreen';
import { HealthShareScreen } from '../screens/HealthShareScreen';
import { HealthSummaryScreen } from '../screens/HealthSummaryScreen';
import { HealthUploadScreen } from '../screens/HealthUploadScreen';
import { HomeScreen } from '../screens/HomeScreen';
import { LgPairingScreen } from '../screens/LgPairingScreen';
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

/** Every registered route; the visual-regression addresses below are made from it. */
const ROUTE_NAMES = [
  'FirstScreen', 'Login', 'ChangePassword', 'Home', 'Profile', 'MyUnit', 'VisitorAccess', 'Maintenance', 'Parking',
  'Community', 'SmartHome', 'Bms', 'EmsDevices', 'DeviceDetail', 'ConnectAccount', 'GatewaySetup',
  'AddDevice', 'AddDeviceMethod', 'DeviceDiscovery', 'DeviceProvisioning', 'DeviceSetup',
  'LgPairing', 'AcControl', 'AmenitiesBooking', 'Services', 'Settings', 'Assistant',
  'UnderDevelopment', 'ReserveParking', 'ReservationDetails', 'ReservationHistory', 'GuestPass',
  'ParkingMap', 'ChargingSession', 'SecurityConsole', 'DemoControls', 'HealthPassport',
  'HealthOnboarding', 'HealthProfile', 'HealthRecords', 'HealthDocument', 'HealthUpload',
  'HealthReview', 'HealthItemForm', 'HealthSummary', 'HealthSettings', 'HealthShare', 'HealthConsultation',
  'Clinic', 'ClinicDoctor', 'ClinicBooking', 'ClinicAppointment',
] as const satisfies readonly (keyof RootStackParamList)[];

/**
 * Testing aid, off unless the web build sets EXPO_PUBLIC_VISUAL_ROUTES=1: gives
 * every screen an address, visual/<Route>?<params>, so the visual-regression
 * script (scripts/visual-regression.mjs) can open each one directly. The
 * product's own addresses below are listed after these and win.
 */
function visualRoutePaths(): Partial<Record<keyof RootStackParamList, string>> {
  if (!flags.visualRoutes) {
    return {};
  }
  return Object.fromEntries(ROUTE_NAMES.map((name) => [name, `visual/${name}`]));
}

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
      ...visualRoutePaths(),
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
      // The demo's own tools get addresses only while the build includes them (config/flags.ts).
      ...(flags.demoTools ? { SecurityConsole: 'parking/security', DemoControls: 'parking/demo' } : {}),
      GuestPass: 'pass/:invite',
      HealthPassport: 'health',
      Clinic: 'clinic',
    },
  },
};

/**
 * Where a session that must still choose its own password may stay: the way in (the first
 * screen and Login, which sends it on), the visitor's pass (no account at all), and the step.
 */
const OPEN_WHILE_PASSWORD_PENDING = new Set<keyof RootStackParamList>(['FirstScreen', 'Login', 'GuestPass', 'ChangePassword']);

export function AppNavigator() {
  const theme = useAppTheme();
  const [current, setCurrent] = useState<CurrentRoute>();
  const { passwordChangeRequired } = useEms();

  // A temporary password comes before anything else, also when a call says so mid-session
  // (an admin reset it): from anywhere else, straight to the step, with nothing to go back to.
  useEffect(() => {
    if (!passwordChangeRequired || !current || OPEN_WHILE_PASSWORD_PENDING.has(current.name) || !navigationRef.isReady()) {
      return;
    }
    navigationRef.reset({ index: 0, routes: [{ name: 'ChangePassword' }] });
  }, [passwordChangeRequired, current]);

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

  // A document finished reading: straight to its review, or to why it failed.
  // A summary is ready: straight to its player, or to why it failed.
  const openHealthNotice = useCallback((notice: HealthNotice) => {
    if (!navigationRef.isReady()) {
      return;
    }
    if ('docId' in notice) {
      navigationRef.navigate(notice.kind === 'ready' ? 'HealthReview' : 'HealthDocument', { docId: notice.docId });
    } else {
      navigationRef.navigate('HealthSummary', {
        profileId: notice.profileId,
        lang: notice.lang,
        specialty: notice.specialty,
      });
    }
  }, []);

  // The health backend refused the session: back to sign-in, as "Log out" does.
  const endHealthSession = useCallback(() => {
    if (navigationRef.isReady()) {
      navigationRef.reset({ index: 0, routes: [{ name: 'Login' }] });
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
          <Stack.Screen name="ChangePassword" component={ChangePasswordScreen} options={{ gestureEnabled: false }} />
          <Stack.Screen name="Home" component={HomeScreen} />
          <Stack.Screen name="Profile" component={ProfileScreen} />
          <Stack.Screen name="MyUnit" component={MyUnitScreen} />
          <Stack.Screen name="VisitorAccess" component={VisitorAccessScreen} />
          <Stack.Screen name="Maintenance" component={MaintenanceScreen} />
          <Stack.Screen name="Parking" component={ParkingScreen} />
          <Stack.Screen name="Community" component={CommunityScreen} />
          <Stack.Screen name="SmartHome" component={SmartHomeScreen} />
          <Stack.Screen name="Bms" component={BmsScreen} />
          <Stack.Screen name="EmsDevices" component={EmsDevicesScreen} />
          <Stack.Screen name="DeviceDetail" component={DeviceDetailScreen} />
          <Stack.Screen name="ConnectAccount" component={ConnectAccountScreen} />
          <Stack.Screen name="GatewaySetup" component={GatewaySetupScreen} />
          <Stack.Screen name="AddDevice" component={AddDeviceScreen} />
          <Stack.Screen name="AddDeviceMethod" component={AddDeviceMethodScreen} />
          <Stack.Screen name="DeviceDiscovery" component={DeviceDiscoveryScreen} />
          <Stack.Screen name="DeviceProvisioning" component={DeviceProvisioningScreen} />
          <Stack.Screen name="DeviceSetup" component={DeviceSetupScreen} />
          <Stack.Screen name="LgPairing" component={LgPairingScreen} />
          <Stack.Screen name="AcControl" component={AcControlScreen} />
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
          <Stack.Screen name="HealthPassport" component={HealthPassportScreen} />
          <Stack.Screen name="HealthOnboarding" component={HealthOnboardingScreen} />
          <Stack.Screen name="HealthProfile" component={HealthProfileScreen} />
          <Stack.Screen name="HealthRecords" component={HealthRecordsScreen} />
          <Stack.Screen name="HealthDocument" component={HealthDocumentScreen} />
          <Stack.Screen name="HealthUpload" component={HealthUploadScreen} />
          <Stack.Screen name="HealthReview" component={HealthReviewScreen} />
          <Stack.Screen name="HealthItemForm" component={HealthItemFormScreen} />
          <Stack.Screen name="HealthSummary" component={HealthSummaryScreen} />
          <Stack.Screen name="HealthSettings" component={HealthSettingsScreen} />
          <Stack.Screen name="HealthShare" component={HealthShareScreen} />
          <Stack.Screen name="HealthConsultation" component={HealthConsultationScreen} />
          <Stack.Screen name="Clinic" component={ClinicScreen} />
          <Stack.Screen name="ClinicDoctor" component={ClinicDoctorScreen} />
          <Stack.Screen name="ClinicBooking" component={ClinicBookingScreen} />
          <Stack.Screen name="ClinicAppointment" component={ClinicAppointmentScreen} />
          {/* Register later screens here as their designs land. */}
        </Stack.Navigator>
      </AppShell>
      <HealthNotifier
        routeName={current?.name}
        routeParams={current?.params}
        onOpen={openHealthNotice}
        onSessionEnded={endHealthSession}
      />
    </NavigationContainer>
  );
}
