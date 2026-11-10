import { useNavigation } from '@react-navigation/native';
import * as WebBrowser from 'expo-web-browser';
import { useMemo } from 'react';

import { PageHeader } from '../../components/layout/PageHeader';
import { ResponsiveGrid } from '../../components/layout/ResponsiveGrid';
import { AppMenu } from '../../components/ui/AppMenu';
import { LinkCard } from '../../components/ui/LinkCard';
import { legal } from '../../config/legal';
import { useAppTheme } from '../../hooks/useAppTheme';
import type { RootStackScreenProps } from '../../types/navigation.types';
import { settingsCopy as copy, settingsItems, type SettingsItem } from './SettingsScreen.data';
import { CARD_GAP, MIN_CARD_WIDTH, createStyles } from './SettingsScreen.styles';
import { useScreenMenu } from '../../hooks/useScreenMenu';
import { InnerScreenFrame } from '../../components/layout/InnerScreenFrame';

export function SettingsScreen() {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const navigation = useNavigation<RootStackScreenProps<'Settings'>['navigation']>();
  const { menuOpen, setMenuOpen, logout: handleLogout, menuItems } = useScreenMenu();

  const open = (item: SettingsItem) => {
    if (item.action === 'logout') {
      handleLogout();
    } else if (item.action === 'privacy') {
      if (legal.privacyPolicyUrl) {
        void WebBrowser.openBrowserAsync(legal.privacyPolicyUrl);
      }
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
    <InnerScreenFrame
      contentStyle={styles.content}
      keyboardShouldPersistTaps="never"
      overlay={
        <AppMenu
          visible={menuOpen}
          onClose={() => setMenuOpen(false)}
          items={menuItems}
          align="right"
        />
      }
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
    </InnerScreenFrame>
  );
}
