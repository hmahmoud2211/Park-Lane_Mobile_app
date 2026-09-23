import { useNavigation } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';

import { AppText } from '../../components/common/AppText';
import { BottomBar } from '../../components/layout/BottomBar';
import { ScreenHeader } from '../../components/layout/ScreenHeader';
import { ScreenWrapper } from '../../components/layout/ScreenWrapper';
import { AppMenu, type AppMenuItem } from '../../components/ui/AppMenu';
import { PromoCard } from '../../components/ui/PromoCard';
import { ServiceTile } from '../../components/ui/ServiceTile';
import { UnitSummaryCard } from '../../components/ui/UnitSummaryCard';
import { WeatherPill } from '../../components/ui/WeatherPill';
import { images } from '../../constants/images';
import { useAppTheme } from '../../hooks/useAppTheme';
import type { RootStackScreenProps } from '../../types/navigation.types';
import { promo, resident, serviceTiles, unit, weather } from './HomeScreen.data';
import { createStyles } from './HomeScreen.styles';

export function HomeScreen() {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const navigation = useNavigation<RootStackScreenProps<'Home'>['navigation']>();
  const [menuOpen, setMenuOpen] = useState(false);

  const handleLogout = useCallback(() => {
    setMenuOpen(false);
    // Frontend only: there is no session to clear yet. Resetting rather than
    // navigating drops Home from the stack, so back cannot return to it.
    // TODO(auth): clear the stored session here once one exists.
    navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
  }, [navigation]);

  const menuItems = useMemo<readonly AppMenuItem[]>(
    () => [{ id: 'logout', label: 'Log out', icon: 'log-out-outline', onPress: handleLogout }],
    [handleLogout],
  );

  return (
    // The background's corner arcs are baked in, so no GlowArc overlay here.
    <ScreenWrapper
      backgroundSource={images.homeBackground}
      withScrim={false}
      backgroundOverlay={0.34}
      withGutter
    >
      <StatusBar style="light" />

      <View style={styles.flex}>
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator
          indicatorStyle="white"
        >
          <ScreenHeader
            style={styles.header}
            onMenuPress={() => setMenuOpen(true)}
            onNotificationsPress={() => {
              // TODO(nav): route to Notifications once that screen exists.
            }}
          />

          <View style={styles.greetingRow}>
            <View style={styles.greetingText}>
              <AppText variant="tileTitle" color={theme.colors.textSecondary}>
                {resident.greeting}
              </AppText>
              <AppText variant="displayName">{resident.name}</AppText>
              <AppText variant="tileTitle" color={theme.colors.textSecondary} style={styles.tagline}>
                {resident.tagline}
              </AppText>
            </View>

            <WeatherPill temperature={weather.temperature} condition={weather.condition} />
          </View>

          <UnitSummaryCard
            title={unit.title}
            meta={unit.meta}
            style={styles.unitCard}
            onPress={() => {
              // TODO(nav): route to the unit detail screen once it exists.
            }}
          />

          <View style={styles.grid}>
            {serviceTiles.map((tile) => (
              <View key={tile.id} style={styles.gridItem}>
                <ServiceTile
                  title={tile.title}
                  subtitle={tile.subtitle}
                  iconSet={tile.iconSet}
                  iconName={tile.iconName}
                  onPress={() => {
                    // TODO(nav): route to the `tile.id` screen once it exists.
                  }}
                />
              </View>
            ))}
          </View>

          <PromoCard
            title={promo.title}
            body={promo.body}
            ctaLabel={promo.ctaLabel}
            onPress={() => {
              // TODO(nav): route to the lifestyle section once it exists.
            }}
          />
        </ScrollView>

        <BottomBar height={62} style={styles.bottomBar} />

        <AppMenu visible={menuOpen} onClose={() => setMenuOpen(false)} items={menuItems} />
      </View>
    </ScreenWrapper>
  );
}
