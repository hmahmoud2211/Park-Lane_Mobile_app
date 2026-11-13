import Ionicons from '@expo/vector-icons/Ionicons';
import { useNavigation } from '@react-navigation/native';
import * as WebBrowser from 'expo-web-browser';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useMemo, useRef, useState, type RefObject } from 'react';
import { Alert, Pressable, ScrollView, useWindowDimensions, View, type ViewInstance } from 'react-native';

import type { UnitOverview } from '../../../../shared/contracts/unitFinance';
import { AppButton } from '../../components/common/AppButton';
import { AppText } from '../../components/common/AppText';
import { ErrorNotice } from '../../components/feedback/ErrorNotice';
import { LoadingState } from '../../components/feedback/LoadingState';
import { Notice } from '../../components/feedback/Notice';
import { BottomBar } from '../../components/layout/BottomBar';
import { PageHeader } from '../../components/layout/PageHeader';
import { ResponsiveColumns } from '../../components/layout/ResponsiveColumns';
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
import { useScreenLayout } from '../../hooks/useScreenLayout';
import { downloadPdf, viewPdf } from '../../features/documents/services/exportPdf';
import { useResidentIdentity } from '../../features/home/hooks/useResidentIdentity';
import { getUnitOverview, getUnitPayments } from '../../features/unitFinance/services/unitApi';
import { useFocusQuery } from '../../hooks/useFocusQuery';
import {
  documentTilesFrom,
  financialFrom,
  heroFrom,
  maintenanceFeesFrom,
  myUnitCopy,
  overviewColumnsFrom,
  sections,
  utilitiesFrom,
  type DocumentItem,
} from './MyUnitScreen.data';
import { contractSummary, paymentReceipts } from './MyUnitScreen.documents';
import {
  UTILITY_ICON_GAP,
  UTILITY_ICON_SIZE,
  CARD_GAP,
  columns,
  createStyles,
} from './MyUnitScreen.styles';
import { statScaleFor } from '../../utils/responsive';
import { layout as themeLayout } from '../../theme';
import type { RootStackScreenProps } from '../../types/navigation.types';

/** Placeholder for links whose destination screens are not designed yet. */
function notYetRouted() {
  // TODO(nav): route to the section's detail screen once it is designed.
}

interface UnitViewProps {
  overview: UnitOverview;
  scale: number;
  documents: readonly DocumentItem[];
  preparing: string | null;
  documentTiles: RefObject<Record<string, ViewInstance | null>>;
  onOpenDocument: (doc: DocumentItem) => void;
}

/** The unit's cards, as the design draws them, filled from its records. Owners also see the money. */
function UnitView({ overview, scale, documents, preparing, documentTiles, onOpenDocument }: UnitViewProps) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const hero = heroFrom(overview.details);
  const overviewColumns = overviewColumnsFrom(overview.details);
  const financial = overview.finance ? financialFrom(overview.finance) : null;
  const maintenanceFees = overview.finance ? maintenanceFeesFrom(overview.finance) : null;
  const utilities = utilitiesFrom(overview.meters);
  return (
    <>
          <UnitHeroCard
            title={hero.title}
            meta={hero.meta}
            stats={hero.stats}
            statWeights={columns.hero.weights}
            statScale={scale}
            style={styles.hero}
          />

          {/* Unit and money on the left, running costs and papers on the right. */}
          <ResponsiveColumns gap={CARD_GAP}>
            <>
              <SectionCard {...sections.overview} onPress={notYetRouted}>
                <DividedRow weights={columns.overview.weights} gap={columns.overview.gap * scale}>
                  {overviewColumns.map((column) => (
                    <View key={column[0].id} style={styles.overviewColumn}>
                      {renderStats(column, { scale })}
                    </View>
                  ))}
                </DividedRow>
              </SectionCard>

              {financial ? (
              <SectionCard {...sections.financial} onPress={notYetRouted}>
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
              ) : (
                <AppText variant="bodySmall" color={theme.colors.textSecondary}>
                  {myUnitCopy.memberNote}
                </AppText>
              )}
            </>

            <>
              {maintenanceFees ? (
                <SectionCard {...sections.maintenance} onPress={notYetRouted}>
                  <DividedRow weights={columns.maintenance.weights} gap={columns.maintenance.gap * scale}>
                    {renderStats(maintenanceFees, { scale })}
                  </DividedRow>
                </SectionCard>
              ) : null}

              <SectionCard {...sections.utilities} onPress={notYetRouted}>
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
                contentStyle={styles.documentsBody}
              >
                {documents.length === 0 ? (
                  <AppText variant="bodySmall" color={theme.colors.textSecondary}>
                    {myUnitCopy.noDocuments}
                  </AppText>
                ) : null}
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
                      onPress={() => onOpenDocument(doc)}
                    />
                  </View>
                ))}
              </SectionCard>
            </>
          </ResponsiveColumns>
    </>
  );
}

type StatRowOptions = Pick<StatItemProps, 'size' | 'iconSize' | 'iconGap' | 'trendOverhang' | 'scale'>;

/** Maps a row of figures onto StatItems, keyed by their ids. */
function renderStats(items: readonly StatItemData[], options?: StatRowOptions) {
  return items.map(({ id, ...item }) => <StatItem key={id} {...item} {...options} />);
}

/** The document whose menu is open, and where its tile sits on screen. */
interface DocumentMenu {
  id: string;
  anchor: { y: number; height: number };
  align: 'left' | 'right';
}

export function MyUnitScreen() {
  const theme = useAppTheme();
  const { width: windowWidth } = useWindowDimensions();
  const layout = useScreenLayout();
  const styles = useMemo(() => createStyles(theme), [theme]);
  // Fitted to the column the cards sit in, which beside a side rail or in a
  // two-column page is narrower than the window.
  const scale = statScaleFor(layout.columnFrameWidth, theme);
  // The page's middle on screen: the side rail, if any, takes the window's left edge.
  const pageCenter = windowWidth - layout.frameWidth / 2;
  const [documentMenu, setDocumentMenu] = useState<DocumentMenu | null>(null);
  const [preparing, setPreparing] = useState<string | null>(null);
  const documentTiles = useRef<Record<string, ViewInstance | null>>({});
  const identity = useResidentIdentity();
  const navigation = useNavigation<RootStackScreenProps<'MyUnit'>['navigation']>();
  const [moreOpen, setMoreOpen] = useState(false);

  // The unit's records, and for an owner the payments too, so the receipts PDF opens straight from the tap.
  const fetchUnit = useCallback(async () => {
    const overview = await getUnitOverview();
    const payments = overview.finance ? await getUnitPayments() : [];
    return { overview, payments };
  }, []);
  const unit = useFocusQuery(fetchUnit);
  const overview = unit.data?.overview;
  const documents = useMemo(() => (overview ? documentTilesFrom(overview) : []), [overview]);

  // Hangs the View / Download menu off the tapped tile, on its side of the screen.
  const openDocumentMenu = useCallback(
    (id: string) => {
      documentTiles.current[id]?.measureInWindow((x, y, tileWidth, tileHeight) => {
        setDocumentMenu({
          id,
          anchor: { y, height: tileHeight },
          align: x + tileWidth / 2 < pageCenter ? 'left' : 'right',
        });
      });
    },
    [pageCenter],
  );

  // The PDF is made on the device from the records already loaded.
  const exportDocument = useCallback(
    (id: string, action: 'view' | 'download') => {
      setDocumentMenu(null);
      if (preparing || !unit.data) {
        return;
      }
      const { overview: records, payments } = unit.data;
      setPreparing(id);
      // Called straight from the tap, with no await first: the web build opens
      // a new tab, which browsers only allow inside a user gesture.
      const run = action === 'view' ? viewPdf : downloadPdf;
      Promise.resolve()
        .then(() => run(id === 'receipts' ? paymentReceipts(records, payments, identity.fullName) : contractSummary(records, identity.fullName)))
        .catch(() => Alert.alert(myUnitCopy.documentFailedTitle, myUnitCopy.documentFailedBody))
        .finally(() => setPreparing(null));
    },
    [preparing, unit.data, identity.fullName],
  );

  // A file management uploaded opens as it is; the two the app makes get a View / Download menu.
  const openDocument = useCallback(
    (doc: DocumentItem) => {
      if (doc.kind === 'uploaded' && doc.url) {
        void WebBrowser.openBrowserAsync(doc.url);
      } else {
        openDocumentMenu(doc.id);
      }
    },
    [openDocumentMenu],
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
        <ScrollView
          contentContainerStyle={[styles.content, layout.contentStyle]}
          showsVerticalScrollIndicator={false}
        >
          <PageHeader
            title={myUnitCopy.title}
            style={styles.header}
            trailing={
              <Pressable
                // The design gives this button no items; it opens the household (who lives here, invites).
                onPress={() => setMoreOpen(true)}
                hitSlop={11}
                accessibilityRole="button"
                accessibilityLabel="More options"
                style={({ pressed }) => [styles.more, pressed && styles.pressed]}
              >
                <Ionicons name="ellipsis-horizontal" size={13} color={theme.colors.textPrimary} />
              </Pressable>
            }
          />

          {!overview ? (
            unit.error ? (
              unit.error.code === 'no_home' ? (
                <Notice
                  tone="info"
                  title={myUnitCopy.noHomeTitle}
                  actions={<AppButton title={myUnitCopy.joinWithCode} variant="gradient" height={themeLayout.innerScreen.buttonHeight} onPress={() => navigation.navigate('Household')} />}
                >
                  {myUnitCopy.noHomeBody}
                </Notice>
              ) : (
                <ErrorNotice title={myUnitCopy.loadFailed} retryLabel={myUnitCopy.retry} onRetry={unit.reload}>
                  {unit.error.message}
                </ErrorNotice>
              )
            ) : (
              <LoadingState />
            )
          ) : (
            <UnitView
              overview={overview}
              scale={scale}
              documents={documents}
              preparing={preparing}
              documentTiles={documentTiles}
              onOpenDocument={openDocument}
            />
          )}
        </ScrollView>

        {/* The same empty glass bar as the home screen. */}
        <BottomBar />
      </View>

      <AppMenu
        visible={moreOpen}
        onClose={() => setMoreOpen(false)}
        align="right"
        items={[
          {
            id: 'household',
            label: myUnitCopy.household,
            icon: 'people-outline',
            onPress: () => {
              setMoreOpen(false);
              navigation.navigate('Household');
            },
          },
        ]}
      />
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
