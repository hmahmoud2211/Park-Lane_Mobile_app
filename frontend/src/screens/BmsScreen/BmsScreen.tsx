import Ionicons from '@expo/vector-icons/Ionicons';
import { Fragment, useMemo } from 'react';
import { Image, View } from 'react-native';

import { AppIcon } from '../../components/common/AppIcon';
import { AppText, TypeScaleContext } from '../../components/common/AppText';
import { InnerScreenFrame } from '../../components/layout/InnerScreenFrame';
import { PageHeader } from '../../components/layout/PageHeader';
import { ResponsiveColumns } from '../../components/layout/ResponsiveColumns';
import { AppMenu } from '../../components/ui/AppMenu';
import { DividedRow } from '../../components/ui/DividedRow';
import { FeatureBanner } from '../../components/ui/FeatureBanner';
import { NeonPanel } from '../../components/ui/NeonPanel';
import { PanelHeading } from '../../components/ui/PanelHeading';
import { ProgressBar } from '../../components/ui/ProgressBar';
import { StatusChip } from '../../components/ui/StatusChip';
import { imageAspects, images } from '../../constants/images';
import { useAppTheme } from '../../hooks/useAppTheme';
import { useScreenLayout } from '../../hooks/useScreenLayout';
import { useScreenMenu } from '../../hooks/useScreenMenu';
import { getBmsLatest } from '../../features/series/services/seriesApi';
import { useQuarterHourly } from '../../lib/realtime/useQuarterHourly';
import { bmsCopy as copy, bmsViewFrom, percent, sampleBms, type StatusReading } from './BmsScreen.data';
import {
  BANNER_HEIGHT,
  CARD_GAP,
  DOWNLOAD_ICON_SIZE,
  FEED_ICON_SIZE,
  GATE_ICON_SIZE,
  GAUGE_WIDTH,
  HEADING_ICON_SIZE,
  LEVEL_HEIGHT,
  NETWORK_ICON_SIZE,
  RING_SIZE,
  RING_STROKE,
  SAFETY_ICON_SIZE,
  STRIP_ICON_SIZE,
  SUMMARY_ICON_SIZE,
  TREND_ICON_SIZE,
  contentScaleFor,
  createStyles,
  toneColor,
} from './BmsScreen.styles';
import { BmsTile } from './BmsTile';
import { CameraCard } from './CameraCard';
import { HealthRing } from './HealthRing';
import { PumpTile } from './PumpTile';
import { SpeedGauge } from './SpeedGauge';

/**
 * Building Management System: the state of the building's shared systems
 * (ventilation, power, internet, security, lifts, water and fire safety) at a
 * glance, as the Figma reference lays them out, top to bottom. Read-only: the
 * readings are sample data until a building systems feed exists (see
 * BmsScreen.data.ts).
 */
export function BmsScreen() {
  const theme = useAppTheme();
  const screen = useScreenLayout();
  // Fitted to the column the panels sit in, not the window.
  const scale = contentScaleFor(screen.columnFrameWidth);
  const styles = useMemo(() => createStyles(theme, scale), [theme, scale]);
  const { menuOpen, setMenuOpen, menuItems } = useScreenMenu();
  // The compound's latest quarter-hour reading; a new one arrives by itself every 15 minutes. Without one (no
  // building feed for this compound yet), the design's sample figures, labelled as such.
  const bms = useQuarterHourly(getBmsLatest, 'bms.reading');
  const view = bms.data ? bmsViewFrom(bms.data) : sampleBms;
  const { systemHealth, summaryFigures, ventilationFans, mainBoard, generator, energyFeeds, internet, networkReadings, gates, cameras, elevator, waterTank, pumps, safetySystems } = view;

  /** A tile with a reading's name over its state, as the fans are drawn. */
  const fanTile = (fan: StatusReading) => (
    <BmsTile key={fan.id} style={styles.fanTile}>
      <View accessible accessibilityLabel={`${fan.name}, ${fan.status}`} style={styles.centred}>
        <AppText variant="statValue" numberOfLines={1}>
          {fan.name}
        </AppText>
        <AppText variant="statValue" color={toneColor(theme, fan.tone)}>
          {fan.status}
        </AppText>
      </View>
    </BmsTile>
  );

  /** "• Normal": a state with the dot the electrical strip puts before it. */
  const dotStatus = (status: string) => (
    <View style={styles.dotStatus} accessibilityLabel={`Status: ${status}`}>
      <AppText variant="statValue" color={theme.colors.bmsStatus}>
        {'•'}
      </AppText>
      <AppText variant="statValue" color={theme.colors.bmsStatus} numberOfLines={1}>
        {status}
      </AppText>
    </View>
  );

  const overview = (
    <NeonPanel>
      <DividedRow style={styles.summary} gap={theme.spacing.xs}>
        <View style={styles.summaryColumn} accessible accessibilityLabel={`${copy.healthLabel} ${percent(systemHealth)}`}>
          <HealthRing fraction={systemHealth} label={percent(systemHealth)} size={RING_SIZE} stroke={RING_STROKE} />
          <AppText variant="statValue" style={styles.summaryLabel}>
            {copy.healthLabel}
          </AppText>
        </View>
        {summaryFigures.map((figure) => (
          <View
            key={figure.id}
            style={styles.summaryColumn}
            accessible
            accessibilityLabel={`${figure.label} ${figure.value}`}
          >
            <AppIcon set={figure.iconSet} name={figure.iconName} size={SUMMARY_ICON_SIZE} />
            <AppText variant="statValue" numberOfLines={1} style={styles.summaryLabel}>
              {figure.label}
            </AppText>
            <AppText variant="statValue" numberOfLines={1} style={styles.summaryValue}>
              {figure.value}
            </AppText>
          </View>
        ))}
      </DividedRow>
    </NeonPanel>
  );

  const ventilation = (
    <NeonPanel style={styles.panel}>
      <View style={styles.fanLayer} pointerEvents="none">
        <Image source={images.bmsFan} style={styles.fan} resizeMode="contain" fadeDuration={0} accessibilityIgnoresInvertColors />
      </View>
      <PanelHeading
        title={copy.ventilationTitle}
        iconSet="material"
        iconName="fan"
        iconSize={HEADING_ICON_SIZE}
        divider={false}
      />
      <View style={styles.fanBody}>
        <View style={styles.fanColumn}>{ventilationFans.slice(0, 2).map(fanTile)}</View>
        <View style={styles.fanColumn}>{ventilationFans.slice(2).map(fanTile)}</View>
      </View>
    </NeonPanel>
  );

  const electrical = (
    <NeonPanel style={styles.panel}>
      <PanelHeading
        title={copy.electricalTitle}
        iconSet="material"
        iconName="speedometer"
        iconSize={HEADING_ICON_SIZE}
        divider={false}
      />
      <View style={styles.body}>
        <BmsTile style={styles.strip}>
          <View style={styles.stripHalf}>
            <View style={styles.stripLine}>
              <View style={styles.row}>
                <AppIcon
                  set="ionicons"
                  name="speedometer-outline"
                  size={STRIP_ICON_SIZE}
                  color={theme.colors.electricCyan}
                  style={styles.iconGap}
                />
                <AppText variant="statValue">{mainBoard.name}</AppText>
              </View>
              {dotStatus(mainBoard.status)}
            </View>
            <View style={styles.stripFigures}>
              {mainBoard.figures.map((figure) => (
                <View key={figure} style={styles.figure}>
                  <AppIcon set="material" name="chart-line-variant" size={TREND_ICON_SIZE} color={theme.colors.bmsStatus} />
                  <AppText variant="statValue" color={theme.colors.bmsStatus}>
                    {figure}
                  </AppText>
                </View>
              ))}
            </View>
          </View>
          <View style={styles.stripDivider} />
          <View style={styles.stripHalf}>
            <View style={styles.stripLine}>
              <AppText variant="statValue">{generator.name}</AppText>
              {dotStatus(generator.status)}
            </View>
            <View style={styles.row}>
              <AppText variant="statValue">{generator.tankLabel}</AppText>
              <ProgressBar
                progress={generator.tankLevel}
                height={LEVEL_HEIGHT}
                colors={[theme.colors.bmsSolarFill, theme.colors.bmsSolarFill]}
                trackColor={theme.colors.bmsTrack}
                glowColor={theme.colors.bmsSolarFill}
                accessibilityLabel={`${generator.tankLabel} ${percent(generator.tankLevel)}`}
                style={styles.level}
              />
              <AppText variant="statLabel" color={theme.colors.bmsStatus}>
                {percent(generator.tankLevel)}
              </AppText>
            </View>
          </View>
        </BmsTile>

        <View style={styles.feeds}>
          {energyFeeds.map((feed) => (
            <BmsTile key={feed.id} style={styles.feed}>
              <View accessible accessibilityLabel={`${feed.title}: ${feed.power}, ${feed.cost}`}>
                <AppText variant="statValue" align="center" numberOfLines={1}>
                  {feed.title}
                </AppText>
                <View style={[styles.feedFigures, styles.summaryLabel]}>
                  <View style={styles.feedFigure}>
                    <Ionicons name="flash" size={FEED_ICON_SIZE} color={theme.colors.textPrimary} />
                    <AppText variant="statValue" color={theme.colors.bmsStatus} numberOfLines={1}>
                      {feed.power}
                    </AppText>
                  </View>
                  <View style={styles.feedDivider} />
                  <View style={styles.feedFigure}>
                    <AppIcon set="material" name="database" size={FEED_ICON_SIZE} />
                    <AppText variant="statValue" color={theme.colors.bmsStatus} numberOfLines={1}>
                      {feed.cost}
                    </AppText>
                  </View>
                </View>
              </View>
            </BmsTile>
          ))}
        </View>
      </View>
    </NeonPanel>
  );

  const internetPanel = (
    <NeonPanel style={styles.panel}>
      <PanelHeading
        title={copy.internetTitle}
        iconSet="material"
        iconName="bullseye-arrow"
        iconSize={HEADING_ICON_SIZE}
        divider={false}
      />
      <View style={styles.internetBody}>
        <View
          style={styles.speed}
          accessible
          accessibilityLabel={`${copy.downloadCaption} ${internet.download} ${internet.unit}`}
        >
          <SpeedGauge fraction={internet.download / internet.gaugeMax} width={GAUGE_WIDTH * scale} />
          <BmsTile radius={10} style={styles.speedPill}>
            <AppText variant="statValue">{`${internet.download} `}</AppText>
            <AppText variant="statValue" color={theme.colors.textSecondary}>
              {internet.unit}
            </AppText>
          </BmsTile>
          <View style={styles.download}>
            <Ionicons name="arrow-down" size={DOWNLOAD_ICON_SIZE} color={theme.colors.bmsDownload} />
            <AppText variant="statValue">{copy.downloadCaption}</AppText>
          </View>
        </View>
        <View style={styles.networkRows}>
          {networkReadings.map((reading) => (
            <BmsTile key={reading.id} radius={10} style={styles.networkRow}>
              <View
                style={[styles.row, styles.grow]}
                accessible
                accessibilityLabel={`${reading.label} ${reading.value}${reading.unit ? ` ${reading.unit}` : ''}`}
              >
                <AppIcon set={reading.iconSet} name={reading.iconName} size={NETWORK_ICON_SIZE} style={styles.iconGap} />
                <AppText variant="statValue" numberOfLines={1} style={styles.grow}>
                  {reading.label}
                </AppText>
                <AppText variant="statValue" color={toneColor(theme, reading.tone)}>
                  {reading.value}
                </AppText>
                {reading.unit ? (
                  <AppText variant="statValue" color={theme.colors.textSecondary}>
                    {` ${reading.unit}`}
                  </AppText>
                ) : null}
              </View>
            </BmsTile>
          ))}
        </View>
      </View>
    </NeonPanel>
  );

  const security = (
    <NeonPanel style={styles.panel}>
      <PanelHeading
        title={copy.securityTitle}
        iconSet="material"
        iconName="cctv"
        iconSize={HEADING_ICON_SIZE + 3}
        divider={false}
      />
      <View style={styles.securityBody}>
        <BmsTile style={styles.gateList}>
          {gates.map((gate, index) => (
            <Fragment key={gate.id}>
              {index > 0 ? <View style={[styles.hairline, styles.gateDivider]} /> : null}
              <View style={styles.gateRow} accessible accessibilityLabel={`${gate.name}, ${gate.status}`}>
                <AppIcon set={gate.iconSet} name={gate.iconName} size={GATE_ICON_SIZE} style={styles.iconGap} />
                <AppText variant="statValue" numberOfLines={1} style={styles.grow}>
                  {gate.name}
                </AppText>
                <AppText variant="statValue" color={toneColor(theme, gate.tone)}>
                  {gate.status}
                </AppText>
              </View>
            </Fragment>
          ))}
        </BmsTile>
        <CameraCard cameras={cameras} scale={scale} />
      </View>
    </NeonPanel>
  );

  const elevatorPanel = (
    <NeonPanel style={styles.panel}>
      <PanelHeading
        title={copy.elevatorTitle}
        iconSet="material"
        iconName="elevator"
        iconSize={HEADING_ICON_SIZE}
        divider={false}
      />
      <View style={styles.elevatorBody}>
        <Image
          source={images.bmsElevator}
          style={styles.elevatorImage}
          resizeMode="contain"
          fadeDuration={0}
          accessibilityIgnoresInvertColors
        />
        <BmsTile style={styles.detailTable}>
          <View style={styles.detailRow}>
            <AppText variant="statValue">{elevator.name}</AppText>
            <StatusChip label={elevator.status} tone="teal" style={styles.chip} />
          </View>
          {elevator.rows.map((row) => (
            <Fragment key={row.id}>
              <View style={styles.hairline} />
              <View style={styles.detailRow} accessible accessibilityLabel={`${row.label}: ${row.value}`}>
                <AppText variant="statValue">{row.label}</AppText>
                <AppText variant="statValue" color={toneColor(theme, row.tone)}>
                  {row.value}
                </AppText>
              </View>
            </Fragment>
          ))}
        </BmsTile>
      </View>
    </NeonPanel>
  );

  const water = (
    <NeonPanel style={styles.panel}>
      <PanelHeading
        title={copy.waterTitle}
        iconSet="material"
        iconName="water-pump"
        iconSize={HEADING_ICON_SIZE}
        divider={false}
      />
      <View style={styles.body}>
        <BmsTile style={styles.tankRow}>
          <AppText variant="statValue">{waterTank.label}</AppText>
          <ProgressBar
            progress={waterTank.level}
            height={LEVEL_HEIGHT}
            colors={[theme.colors.bmsTankFill, theme.colors.bmsTankFill]}
            trackColor={theme.colors.bmsTrack}
            glowColor={theme.colors.bmsTankFill}
            accessibilityLabel={`${waterTank.label} ${percent(waterTank.level)}`}
            style={styles.tankBar}
          />
          <AppText variant="statValue" color={theme.colors.bmsStatus}>
            {percent(waterTank.level)}
          </AppText>
        </BmsTile>
        <View style={styles.pumps}>
          {pumps.map((pump) => (
            <PumpTile key={pump.id} pump={pump} scale={scale} />
          ))}
        </View>
      </View>
    </NeonPanel>
  );

  const fireSafety = (
    <NeonPanel style={styles.panel}>
      <PanelHeading
        title={copy.fireTitle}
        iconSet="material"
        iconName="fire"
        iconSize={HEADING_ICON_SIZE}
        divider={false}
      />
      <View style={[styles.body, styles.safetyRows]}>
        {safetySystems.map((system) => (
          <BmsTile key={system.id} style={styles.safetyRow}>
            <View
              style={[styles.row, styles.grow]}
              accessible
              accessibilityLabel={`${system.name}, ${system.status}. ${copy.lastMaintenance} ${system.lastMaintenance}`}
            >
              <View style={styles.safetyName}>
                <AppIcon set={system.iconSet} name={system.iconName} size={SAFETY_ICON_SIZE} style={styles.iconGap} />
                <AppText variant="statValue" numberOfLines={1}>
                  {system.name}
                </AppText>
              </View>
              <AppText variant="statValue" color={toneColor(theme, system.tone)} style={styles.safetyStatus}>
                {system.status}
              </AppText>
              <AppText variant="statLabel" numberOfLines={1}>
                {`${copy.lastMaintenance}${system.lastMaintenance}`}
              </AppText>
            </View>
          </BmsTile>
        ))}
      </View>
    </NeonPanel>
  );

  return (
    <InnerScreenFrame
      contentStyle={styles.content}
      keyboardShouldPersistTaps="never"
      overlay={<AppMenu visible={menuOpen} onClose={() => setMenuOpen(false)} items={menuItems} align="right" />}
    >
      <TypeScaleContext value={scale}>
        <PageHeader title={copy.title} onMenuPress={() => setMenuOpen(true)} style={styles.header} />
        {view.dataLabel ? <StatusChip label={view.dataLabel} tone="amber" style={styles.dataChip} /> : null}

        <FeatureBanner
          title={view.banner.title}
          body={copy.bannerBody}
          photo={images.bmsHero}
          photoAspect={imageAspects.bmsHero}
          height={BANNER_HEIGHT}
          titleVariant="cardTitle"
          bodyVariant="statValue"
          footer={
            <View style={styles.bannerStatus}>
              <View style={styles.bannerDot} />
              <AppText variant="statValueLarge" color={theme.colors.bmsStatusBright}>
                {view.banner.status}
              </AppText>
            </View>
          }
          style={styles.banner}
        />

        {/*
          The reference's order, top to bottom: the building's state and its
          services on the left, its safety systems on the right.
        */}
        <ResponsiveColumns gap={CARD_GAP}>
          <Fragment key="services">
            {overview}
            {ventilation}
            {electrical}
            {internetPanel}
          </Fragment>
          <Fragment key="safety">
            {security}
            {elevatorPanel}
            {water}
            {fireSafety}
          </Fragment>
        </ResponsiveColumns>
      </TypeScaleContext>
    </InnerScreenFrame>
  );
}
