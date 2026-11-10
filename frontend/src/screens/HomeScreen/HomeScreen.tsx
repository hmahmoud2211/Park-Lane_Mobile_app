import { useNavigation } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { useMemo } from 'react';
import { ScrollView, View } from 'react-native';

import { AppText } from '../../components/common/AppText';
import { BottomBar } from '../../components/layout/BottomBar';
import { ResponsiveColumns } from '../../components/layout/ResponsiveColumns';
import { ResponsiveGrid } from '../../components/layout/ResponsiveGrid';
import { ScreenHeader } from '../../components/layout/ScreenHeader';
import { ScreenWrapper } from '../../components/layout/ScreenWrapper';
import { AppMenu } from '../../components/ui/AppMenu';
import { PromoCard } from '../../components/ui/PromoCard';
import { ServiceTile } from '../../components/ui/ServiceTile';
import { UnitSummaryCard } from '../../components/ui/UnitSummaryCard';
import { WeatherPill } from '../../components/ui/WeatherPill';
import { flags } from '../../config/flags';
import { images } from '../../constants/images';
import { useResidentIdentity } from '../../features/home/hooks/useResidentIdentity';
import { useAppTheme } from '../../hooks/useAppTheme';
import { useScreenLayout } from '../../hooks/useScreenLayout';
import type { RootStackScreenProps } from '../../types/navigation.types';
import { unit } from '../../data/demoResident';
import { homeTiles, promo, weather } from './HomeScreen.data';
import { GREETING_TO_UNIT, MIN_TILE_WIDTH, TILE_GAP, TILE_ROW_GAP, createStyles } from './HomeScreen.styles';
import { useScreenMenu } from '../../hooks/useScreenMenu';

export function HomeScreen() {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const navigation = useNavigation<RootStackScreenProps<'Home'>['navigation']>();
  const { menuOpen, setMenuOpen, menuItems } = useScreenMenu();
  const layout = useScreenLayout();
  const identity = useResidentIdentity();
  // The unit card and weather are sample content: the store build leaves them out.
  const sample = flags.sampleContent;

  const greeting = (
    <View style={styles.greetingRow}>
      <View style={styles.greetingText}>
        <AppText variant="statLabel" color={theme.colors.textSecondary}>
          {identity.greeting}
        </AppText>
        <AppText variant="screenTitle">{identity.firstName}</AppText>
        <AppText variant="statLabel" color={theme.colors.textSecondary} style={styles.tagline}>
          {identity.tagline}
        </AppText>
      </View>

      {sample ? <WeatherPill temperature={weather.temperature} condition={weather.condition} /> : null}
    </View>
  );

  const unitCard = (
    <UnitSummaryCard title={unit.title} meta={unit.meta} onPress={() => navigation.navigate('MyUnit')} />
  );

  const tileGrid = (
    <ResponsiveGrid
      data={homeTiles}
      keyExtractor={(tile) => tile.id}
      minItemWidth={MIN_TILE_WIDTH}
      minColumns={2}
      // Eight tiles: two rows of four at most, never a ragged last row.
      maxColumns={4}
      gap={TILE_GAP}
      rowGap={TILE_ROW_GAP}
      style={styles.grid}
      renderItem={(tile) => (
        <ServiceTile
          title={tile.title}
          subtitle={tile.subtitle}
          // Wide layouts have the room for the taller, icon-over-title tile.
          layout={layout.isWide ? 'stacked' : 'row'}
          iconSet={tile.iconSet}
          iconName={tile.iconName}
          onPress={() => {
            if (tile.route) {
              navigation.navigate(tile.route);
            } else if (tile.underDevelopment) {
              navigation.navigate('UnderDevelopment', {
                title: tile.title,
                iconSet: tile.iconSet,
                iconName: tile.iconName,
              });
            }
          }}
        />
      )}
    />
  );

  const promoCard = (
    <PromoCard
      title={promo.title}
      body={promo.body}
      ctaLabel={promo.ctaLabel}
      // Until a lifestyle section exists, "Explore Now" opens the services residents can use.
      onPress={() => navigation.navigate('Services')}
    />
  );

  return (
    // The background's corner arcs are baked in, so no GlowArc overlay here.
    <ScreenWrapper
      backgroundSource={images.homeBackground}
      withScrim={false}
      backgroundOverlay={0.34}
      // Wide layouts take their gutter from the device class instead.
      withGutter={!layout.isWide}
    >
      <StatusBar style="light" />

      <View style={styles.flex}>
        <ScrollView
          contentContainerStyle={[styles.content, layout.contentStyle]}
          showsVerticalScrollIndicator={false}
        >
          <ScreenHeader
            style={styles.header}
            initials={identity.initials}
            onMenuPress={() => setMenuOpen(true)}
            onProfilePress={() => navigation.navigate('Profile')}
          />

          {!sample ? (
            <>
              <View style={styles.greetingSpacing}>{greeting}</View>
              {tileGrid}
              {promoCard}
            </>
          ) : layout.isWide ? (
            <>
              {/* Greeting and unit beside the promo, then every tile in one band. */}
              <ResponsiveColumns gap={GREETING_TO_UNIT} align="end" style={styles.wideTop}>
                <>
                  {greeting}
                  {unitCard}
                </>
                {promoCard}
              </ResponsiveColumns>
              {tileGrid}
            </>
          ) : (
            <>
              <View style={styles.greetingSpacing}>{greeting}</View>
              <View style={styles.unitCard}>{unitCard}</View>
              {tileGrid}
              {promoCard}
            </>
          )}
        </ScrollView>

        <BottomBar inset={theme.spacing.screenGutter} />

        <AppMenu visible={menuOpen} onClose={() => setMenuOpen(false)} items={menuItems} />
      </View>
    </ScreenWrapper>
  );
}
