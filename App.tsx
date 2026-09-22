// Imported by subpath, not from the package root: the root re-exports all 18
// weights and italics, which drags ~6MB of unused .ttf into the bundle.
import { Inter_400Regular } from '@expo-google-fonts/inter/400Regular';
import { Inter_500Medium } from '@expo-google-fonts/inter/500Medium';
import { Inter_600SemiBold } from '@expo-google-fonts/inter/600SemiBold';
import { Inter_700Bold } from '@expo-google-fonts/inter/700Bold';
import { useFonts } from 'expo-font';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AppProvider } from './src/context/AppContext';
import { ThemeProvider } from './src/context/ThemeContext';
import { WebViewport } from './src/components/layout/WebViewport';
import { AppNavigator } from './src/navigation/AppNavigator';
import { colors } from './src/theme';
import { installWebFormStyles } from './src/utils/webFormStyles';

installWebFormStyles();

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
            {/* Every screen is dark, so light status bar content is the default. */}
            <StatusBar style="light" />
            <WebViewport>
              {fontsLoaded ? <AppNavigator /> : <View style={styles.splash} />}
            </WebViewport>
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
