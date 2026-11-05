import { useNavigation } from '@react-navigation/native';
import { useMemo } from 'react';

import { PageHeader } from '../../components/layout/PageHeader';
import { ResponsiveGrid } from '../../components/layout/ResponsiveGrid';
import { AppMenu } from '../../components/ui/AppMenu';
import { LinkCard } from '../../components/ui/LinkCard';
import { images } from '../../constants/images';
import { useAppTheme } from '../../hooks/useAppTheme';
import type { RootStackScreenProps } from '../../types/navigation.types';
import { servicesCopy as copy, services } from './ServicesScreen.data';
import { CARD_GAP, MIN_CARD_WIDTH, createStyles } from './ServicesScreen.styles';
import { useScreenMenu } from '../../hooks/useScreenMenu';
import { InnerScreenFrame } from '../../components/layout/InnerScreenFrame';

export function ServicesScreen() {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const navigation = useNavigation<RootStackScreenProps<'Services'>['navigation']>();
  const { menuOpen, setMenuOpen, menuItems } = useScreenMenu();

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
            icon={service.glyph ?? { image: images[service.icon] }}
            // Services without a screen yet open the same placeholder
            // Home's unbuilt tiles do.
            // TODO(nav): route to each service's screen once it is designed.
            onPress={() =>
              service.route
                ? navigation.navigate(service.route)
                : navigation.navigate('UnderDevelopment', {
                    title: service.title,
                    iconSet: service.iconSet,
                    iconName: service.iconName,
                  })
            }
          />
        )}
      />
    </InnerScreenFrame>
  );
}
