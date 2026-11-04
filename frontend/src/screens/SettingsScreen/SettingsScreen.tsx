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
import { settingsCopy as copy, settingsItems, type SettingsItem } from './SettingsScreen.data';
import { CARD_GAP, MIN_CARD_WIDTH, createStyles } from './SettingsScreen.styles';

export function SettingsScreen() {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const navigation = useNavigation<RootStackScreenProps<'Settings'>['navigation']>();
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

  const open = (item: SettingsItem) => {
    if (item.action === 'logout') {
      handleLogout();
    } else if (item.route) {
      navigation.navigate(item.route);
    } else {
      // TODO(nav): route to the setting's screen once it is designed.
      navigation.navigate('UnderDevelopment', {
        title: item.title,
        iconSet: item.iconSet,
        iconName: item.iconName,
      });
    }
  };

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

          {/* One column on phones, two side by side on wider screens. */}
          <ResponsiveGrid
            data={settingsItems}
            keyExtractor={(item) => item.id}
            minItemWidth={MIN_CARD_WIDTH}
            maxColumns={2}
            gap={CARD_GAP}
            renderItem={(item) => (
              <LinkCard
                fill
                size="compact"
                title={item.title}
                description={item.description}
                icon={{ set: item.iconSet, name: item.iconName }}
                onPress={() => open(item)}
              />
            )}
          />
        </ScrollView>

        {/* The same glass bar as the other inner screens, with Settings lit. */}
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
