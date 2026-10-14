import Ionicons from '@expo/vector-icons/Ionicons';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, View, useWindowDimensions } from 'react-native';

import { AppText } from '../../components/common/AppText';
import { BottomBar } from '../../components/layout/BottomBar';
import { PageHeader } from '../../components/layout/PageHeader';
import { ScreenWrapper } from '../../components/layout/ScreenWrapper';
import { AppMenu, type AppMenuItem } from '../../components/ui/AppMenu';
import { DividedRow } from '../../components/ui/DividedRow';
import { ProgressBar } from '../../components/ui/ProgressBar';
import { SectionCard } from '../../components/ui/SectionCard';
import { ServiceTile } from '../../components/ui/ServiceTile';
import { StatItem, type StatItemData, type StatItemProps } from '../../components/ui/StatItem';
import { UnitHeroCard } from '../../components/ui/UnitHeroCard';
import { images } from '../../constants/images';
import { useAppTheme } from '../../hooks/useAppTheme';
import { downloadPdf, viewPdf } from '../../services/documents/exportPdf';
import {
  documents,
  financial,
  maintenanceFees,
  myUnitCopy,
  overviewColumns,
  sections,
  unitHero,
  utilities,
  type DocumentId,
} from './MyUnitScreen.data';
import { buildUnitDocument } from './MyUnitScreen.documents';
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

/** The document whose menu is open, and where its tile sits on screen. */
interface DocumentMenu {
  id: DocumentId;
  anchor: { y: number; height: number };
  align: 'left' | 'right';
}

export function MyUnitScreen() {
  const theme = useAppTheme();
  const { width } = useWindowDimensions();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const scale = statScaleFor(width, theme);
  const [documentMenu, setDocumentMenu] = useState<DocumentMenu | null>(null);
  const [preparing, setPreparing] = useState<DocumentId | null>(null);
  const documentTiles = useRef<Partial<Record<DocumentId, View | null>>>({});

  // Hangs the View / Download menu off the tapped tile, on its side of the screen.
  const openDocumentMenu = useCallback(
    (id: DocumentId) => {
      documentTiles.current[id]?.measureInWindow((x, y, tileWidth, tileHeight) => {
        setDocumentMenu({
          id,
          anchor: { y, height: tileHeight },
          align: x + tileWidth / 2 < width / 2 ? 'left' : 'right',
        });
      });
    },
    [width],
  );

  // The PDF is built from the screen's own data, on the device (frontend only).
  const exportDocument = useCallback(
    (id: DocumentId, action: 'view' | 'download') => {
      setDocumentMenu(null);
      if (preparing) {
        return;
      }
      setPreparing(id);
      // Called straight from the tap, with no await first: the web build opens
      // a new tab, which browsers only allow inside a user gesture.
      const run = action === 'view' ? viewPdf : downloadPdf;
      run(buildUnitDocument(id))
        .catch(() => Alert.alert(myUnitCopy.documentFailedTitle, myUnitCopy.documentFailedBody))
        .finally(() => setPreparing(null));
    },
    [preparing],
  );

  const documentMenuItems = useMemo<readonly AppMenuItem[]>(() => {
    if (!documentMenu) {
      return [];
    }
    const { id } = documentMenu;
    return [
      {
        id: 'view',
        label: myUnitCopy.viewDocument,
        icon: 'eye-outline',
        onPress: () => exportDocument(id, 'view'),
      },
      {
        id: 'download',
        label: myUnitCopy.downloadDocument,
        icon: 'download-outline',
        onPress: () => exportDocument(id, 'download'),
      },
    ];
  }, [documentMenu, exportDocument]);

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
          <PageHeader
            title={myUnitCopy.title}
            style={styles.header}
            trailing={
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
            }
          />

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
              // Wrapped so the menu can measure where the tile sits.
              <View
                key={doc.id}
                ref={(node) => {
                  documentTiles.current[doc.id] = node;
                }}
                collapsable={false}
                style={styles.documentTile}
              >
                <ServiceTile
                  title={doc.title}
                  subtitle={preparing === doc.id ? myUnitCopy.preparingDocument : doc.subtitle}
                  iconSet={doc.iconSet}
                  iconName={doc.iconName}
                  compact
                  nested
                  glow
                  scale={scale}
                  onPress={() => openDocumentMenu(doc.id)}
                />
              </View>
            ))}
          </SectionCard>
        </ScrollView>

        {/* The same empty glass bar as the home screen. */}
        <BottomBar />
      </View>

      <AppMenu
        visible={documentMenu !== null}
        onClose={() => setDocumentMenu(null)}
        items={documentMenuItems}
        anchor={documentMenu?.anchor}
        align={documentMenu?.align}
      />
    </ScreenWrapper>
  );
}
