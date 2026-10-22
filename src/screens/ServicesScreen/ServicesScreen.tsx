import { useNavigation } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';

import { BottomBar } from '../../components/layout/BottomBar';
import { PageHeader } from '../../components/layout/PageHeader';
import { ResponsiveGrid } from '../../components/layout/ResponsiveGrid';
import { ScreenWrapper } from '../../components/layout/ScreenWrapper';
import { AppMenu, type AppMenuItem } from '../../components/ui/AppMenu';
import { LinkCard } from '../../components/ui/LinkCard';
import { images } from '../../constants/images';
import { useAppTheme } from '../../hooks/useAppTheme';
import { useScreenLayout } from '../../hooks/useScreenLayout';
import type { RootStackScreenProps } from '../../types/navigation.types';
import { servicesCopy as copy, services } from './ServicesScreen.data';
import { CARD_GAP, MIN_CARD_WIDTH, createStyles } from './ServicesScreen.styles';

export function ServicesScreen() {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const navigation = useNavigation<RootStackScreenProps<'Services'>['navigation']>();
  const [menuOpen, setMenuOpen] = useState(false);
  const layout = useScreenLayout();

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
        <ScrollView
          contentContainerStyle={[styles.content, layout.contentStyle]}
          showsVerticalScrollIndicator={false}
        >
          <PageHeader
            title={copy.title}
            subtitle={copy.subtitle}
            onMenuPress={() => setMenuOpen(true)}
            style={styles.header}
          />

          {/* One column on phones; two or three side by side on wider screens. */}
          <ResponsiveGrid
            data={services}
            keyExtractor={(service) => service.id}
            minItemWidth={MIN_CARD_WIDTH}
            maxColumns={3}
            gap={CARD_GAP}
            renderItem={(service) => (
              <LinkCard
                fill
                title={service.title}
                description={service.description}
                icon={{ image: images[service.icon] }}
                // None of the services has a designed screen yet, so each opens
                // the same placeholder Home's unbuilt tiles do.
                // TODO(nav): route to each service's screen once it is designed.
                onPress={() =>
                  navigation.navigate('UnderDevelopment', {
                    title: service.title,
                    iconSet: service.iconSet,
                    iconName: service.iconName,
                  })
                }
              />
            )}
          />
        </ScrollView>

        {/* The same glass bar as the other inner screens, with Services lit. */}
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
