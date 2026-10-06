import Ionicons from '@expo/vector-icons/Ionicons';
import { StatusBar } from 'expo-status-bar';
import { useMemo } from 'react';
import { Image, Pressable, ScrollView, View, useWindowDimensions } from 'react-native';

import { AppText } from '../../components/common/AppText';
import { BackButton } from '../../components/common/BackButton';
import { BottomBar } from '../../components/layout/BottomBar';
import { ScreenWrapper } from '../../components/layout/ScreenWrapper';
import { DividedRow } from '../../components/ui/DividedRow';
import { ProgressBar } from '../../components/ui/ProgressBar';
import { SectionCard } from '../../components/ui/SectionCard';
import { ServiceTile } from '../../components/ui/ServiceTile';
import { StatItem, type StatItemData, type StatItemProps } from '../../components/ui/StatItem';
import { UnitHeroCard } from '../../components/ui/UnitHeroCard';
import { images } from '../../constants/images';
import { useAppTheme } from '../../hooks/useAppTheme';
import {
  documents,
  financial,
  maintenanceFees,
  myUnitCopy,
  overviewColumns,
  sections,
  unitHero,
  utilities,
} from './MyUnitScreen.data';
import {
  UTILITY_ICON_GAP,
  UTILITY_ICON_SIZE,
  columns,
  createStyles,
  statScaleFor,
} from './MyUnitScreen.styles';

/** Placeholder for links whose destination screens are not designed yet. */
function notYetRouted() {
  // TODO(nav): route to the section's detail screen once it is designed.
}

type StatRowOptions = Pick<StatItemProps, 'size' | 'iconSize' | 'iconGap' | 'trendOverhang' | 'scale'>;

/** Maps a row of figures onto StatItems, keyed by their ids. */
function renderStats(items: readonly StatItemData[], options?: StatRowOptions) {
  return items.map(({ id, ...item }) => <StatItem key={id} {...item} {...options} />);
}

export function MyUnitScreen() {
  const theme = useAppTheme();
  const { width } = useWindowDimensions();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const scale = statScaleFor(width, theme);

  return (
    // Same photo and overlay as the home screen.
    <ScreenWrapper
      backgroundSource={images.homeBackground}
      withScrim={false}
      backgroundOverlay={0.34}
    >
      <StatusBar style="light" />

      <View style={styles.flex}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            {/* Drawn first, beneath the row, so the controls stay tappable. */}
            <View style={styles.lockupFrame} pointerEvents="none">
              <Image
                fadeDuration={0}
                source={images.brandLockup}
                style={styles.lockup}
                resizeMode="contain"
                accessibilityLabel="Parklane, Smart Community Living"
              />
            </View>

            <View style={styles.headerRow}>
              <BackButton title={myUnitCopy.title} style={styles.headerTitle} />
              <Pressable
                onPress={() => {
                  // TODO(menu): the design gives this button no menu items yet.
                }}
                hitSlop={11}
                accessibilityRole="button"
                accessibilityLabel="More options"
                style={({ pressed }) => [styles.more, pressed && styles.pressed]}
              >
                <Ionicons name="ellipsis-horizontal" size={13} color={theme.colors.textPrimary} />
              </Pressable>
            </View>
          </View>

          <UnitHeroCard
            title={unitHero.title}
            meta={unitHero.meta}
            stats={unitHero.stats}
            statWeights={columns.hero.weights}
            statScale={scale}
            style={styles.card}
          />

          <SectionCard {...sections.overview} onPress={notYetRouted} style={styles.card}>
            <DividedRow weights={columns.overview.weights} gap={columns.overview.gap * scale}>
              {overviewColumns.map((column) => (
                <View key={column[0].id} style={styles.overviewColumn}>
                  {renderStats(column, { scale })}
                </View>
              ))}
            </DividedRow>
          </SectionCard>

          <SectionCard {...sections.financial} onPress={notYetRouted} style={styles.card}>
            <DividedRow weights={columns.financial.weights} gap={columns.financial.gap * scale}>
              {renderStats(financial.summary, { size: 'large', scale })}
            </DividedRow>

            <View style={styles.progressRow}>
              <ProgressBar
                progress={financial.paidRatio}
                accessibilityLabel={financial.paidLabel}
                style={styles.progressBar}
              />
              <AppText variant="statValue" color={theme.colors.textPrimary}>
                {financial.paidLabel}
              </AppText>
            </View>

            <View style={styles.financialDivider} />

            <DividedRow weights={columns.financial.weights} gap={columns.financial.gap * scale}>
              {renderStats(financial.schedule, { scale })}
            </DividedRow>
          </SectionCard>

          <SectionCard
            {...sections.maintenance}
            onPress={notYetRouted}
            style={styles.card}
          >
            <DividedRow weights={columns.maintenance.weights} gap={columns.maintenance.gap * scale}>
              {renderStats(maintenanceFees, { scale })}
            </DividedRow>
          </SectionCard>

          <SectionCard
            {...sections.utilities}
            onPress={notYetRouted}
            style={styles.card}
          >
            <DividedRow weights={columns.utilities.weights} gap={columns.utilities.gap * scale}>
              {renderStats(utilities, {
                iconSize: UTILITY_ICON_SIZE,
                iconGap: UTILITY_ICON_GAP,
                trendOverhang: columns.utilities.gap,
                scale,
              })}
            </DividedRow>
          </SectionCard>

          <SectionCard
            {...sections.documents}
            onPress={notYetRouted}
            divider={false}
            style={styles.card}
            contentStyle={styles.documentsBody}
          >
            {documents.map((doc) => (
              <ServiceTile
                key={doc.id}
                title={doc.title}
                subtitle={doc.subtitle}
                iconSet={doc.iconSet}
                iconName={doc.iconName}
                compact
                nested
                glow
                scale={scale}
                style={styles.documentTile}
                onPress={() => {
                  // TODO(nav): open the `doc.id` document viewer once it is designed.
                }}
              />
            ))}
          </SectionCard>
        </ScrollView>

        {/* The same empty glass bar as the home screen. */}
        <BottomBar />
      </View>
    </ScreenWrapper>
  );
}
