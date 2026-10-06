import Ionicons from '@expo/vector-icons/Ionicons';
import { useNavigation } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { AppText } from '../../components/common/AppText';
import { GlassSurface } from '../../components/common/GlassSurface';
import { BottomBar } from '../../components/layout/BottomBar';
import { PageHeader } from '../../components/layout/PageHeader';
import { ScreenWrapper } from '../../components/layout/ScreenWrapper';
import { AppMenu, type AppMenuItem } from '../../components/ui/AppMenu';
import { FeatureBanner } from '../../components/ui/FeatureBanner';
import { FilterChip } from '../../components/ui/FilterChip';
import { imageAspects, images } from '../../constants/images';
import { useAppTheme } from '../../hooks/useAppTheme';
import type { RootStackScreenProps } from '../../types/navigation.types';
import { AmenityCard } from './AmenityCard';
import {
  amenitiesCopy as copy,
  amenitiesFor,
  capacityLabel,
  categoryChips,
  hoursLabel,
  initialVisibleCount,
  type CategoryFilter,
} from './AmenitiesBookingScreen.data';
import { BANNER_HEIGHT, MORE_CHEVRON_SIZE, createStyles } from './AmenitiesBookingScreen.styles';

/** Placeholder for links whose destination screens are not designed yet. */
function notYetRouted() {
  // TODO(nav): route to the destination screen once it is designed.
}

export function AmenitiesBookingScreen() {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const navigation = useNavigation<RootStackScreenProps<'AmenitiesBooking'>['navigation']>();
  const [menuOpen, setMenuOpen] = useState(false);
  const [filter, setFilter] = useState<CategoryFilter>('all');
  const [expanded, setExpanded] = useState(false);
  const matching = amenitiesFor(filter);
  const visible = expanded ? matching : matching.slice(0, initialVisibleCount);
  // Hidden when the filter already fits in the first screenful.
  const canExpand = matching.length > initialVisibleCount;

  const handleLogout = useCallback(() => {
    setMenuOpen(false);
    // Frontend only, as on Home: there is no session to clear yet.
    // TODO(auth): clear the stored session here once one exists.
    navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
  }, [navigation]);

  const menuItems = useMemo<readonly AppMenuItem[]>(
    () => [{ id: 'logout', label: 'Log out', icon: 'log-out-outline', onPress: handleLogout }],
    [handleLogout],
  );

  return (
    <ScreenWrapper
      backgroundSource={images.homeBackground}
      withScrim={false}
      backgroundOverlay={0.34}
    >
      <StatusBar style="light" />

      <View style={styles.flex}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <PageHeader
            title={copy.title}
            onMenuPress={() => setMenuOpen(true)}
            style={styles.header}
          />

          <FeatureBanner
            title={copy.bannerTitle}
            body={copy.bannerBody}
            photo={images.amenitiesHero}
            photoAspect={imageAspects.amenitiesHero}
            height={BANNER_HEIGHT}
            footer={null}
            style={styles.banner}
          />

          <View style={styles.chips} accessibilityRole="radiogroup">
            {categoryChips.map((chip) => (
              <FilterChip
                key={chip.id}
                label={chip.label}
                iconSet={chip.iconSet}
                iconName={chip.iconName}
                selected={chip.id === filter}
                onPress={() => setFilter(chip.id)}
                role="radio"
                style={styles.chip}
              />
            ))}
          </View>

          <View style={styles.list}>
            {visible.map((amenity) => (
              <AmenityCard
                key={amenity.id}
                title={amenity.title}
                location={amenity.location}
                hours={hoursLabel(amenity)}
                capacity={capacityLabel(amenity)}
                photo={images[amenity.photo]}
                iconSet={amenity.iconSet}
                iconName={amenity.iconName}
                bookLabel={copy.bookNow}
                // TODO(nav): open the amenity once its detail screen is designed.
                onPress={notYetRouted}
                // The booking flow is not designed yet, so this opens the same
                // placeholder Home's unbuilt tiles do.
                onBook={() =>
                  navigation.navigate('UnderDevelopment', {
                    title: `${amenity.title} Booking`,
                    iconSet: amenity.iconSet,
                    iconName: amenity.iconName,
                  })
                }
              />
            ))}
            {visible.length === 0 ? (
              <AppText variant="statValue" color={theme.colors.textSupport} align="center" style={styles.empty}>
                {copy.empty}
              </AppText>
            ) : null}
          </View>

          {canExpand ? (
            <Pressable
              onPress={() => setExpanded((current) => !current)}
              accessibilityRole="button"
              accessibilityLabel={expanded ? copy.showLess : copy.viewMore}
              accessibilityState={{ expanded }}
              style={({ pressed }) => [styles.more, pressed && styles.pressed]}
            >
              <GlassSurface
                radius={theme.borderRadius.pill}
                blurred={false}
                fillOpacity={theme.glass.subtleFillOpacity}
                style={styles.moreSurface}
              >
                <AppText variant="statValue" align="center" style={styles.moreLabel}>
                  {expanded ? copy.showLess : copy.viewMore}
                </AppText>
                <Ionicons
                  name={expanded ? 'chevron-up' : 'chevron-forward'}
                  size={MORE_CHEVRON_SIZE}
                  color={theme.colors.textPrimary}
                />
              </GlassSurface>
            </Pressable>
          ) : null}
        </ScrollView>

        {/* The same empty glass bar as the other inner screens. */}
        <BottomBar />
      </View>

      <AppMenu
        visible={menuOpen}
        onClose={() => setMenuOpen(false)}
        items={menuItems}
        align="right"
      />
    </ScreenWrapper>
  );
}
