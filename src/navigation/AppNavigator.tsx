import { NavigationContainer, type Theme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useMemo } from 'react';

import { useAppTheme } from '../hooks/useAppTheme';
import { FirstScreen } from '../screens/FirstScreen';
import { HomeScreen } from '../screens/HomeScreen';
import { LoginScreen } from '../screens/LoginScreen';
import type { RootStackParamList } from '../types/navigation.types';

const Stack = createNativeStackNavigator<RootStackParamList>();

export function AppNavigator() {
  const theme = useAppTheme();

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
    <NavigationContainer theme={navigationTheme}>
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
        {/* Register later screens here as their designs land. */}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
