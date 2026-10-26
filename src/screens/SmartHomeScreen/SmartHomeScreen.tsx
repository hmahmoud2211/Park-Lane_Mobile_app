import Ionicons from '@expo/vector-icons/Ionicons';
import { useNavigation } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useMemo, useState } from 'react';
import { Image, Pressable, ScrollView, View } from 'react-native';

import { AppIcon } from '../../components/common/AppIcon';
import { AppText, TypeScaleContext } from '../../components/common/AppText';
import { GlassSurface } from '../../components/common/GlassSurface';
import { BottomBar } from '../../components/layout/BottomBar';
import { PageHeader } from '../../components/layout/PageHeader';
import { ResponsiveColumns } from '../../components/layout/ResponsiveColumns';
import { ScreenWrapper } from '../../components/layout/ScreenWrapper';
import { AppMenu, type AppMenuItem } from '../../components/ui/AppMenu';
import { FeatureBanner } from '../../components/ui/FeatureBanner';
import { FilterChip } from '../../components/ui/FilterChip';
import { NeonPanel } from '../../components/ui/NeonPanel';
import { PanelHeading } from '../../components/ui/PanelHeading';
import { imageAspects, images } from '../../constants/images';
import { useAppTheme } from '../../hooks/useAppTheme';
import { useHomeDevices } from '../../hooks/useHomeDevices';
import { useScreenLayout } from '../../hooks/useScreenLayout';
import { capabilityOf, isOn, kindGlyph, kindLabel, roomGlyph, toggleCommand } from '../../services/home/capabilities';
import type { Command, Device, DeviceKind } from '../../types/home.types';
import type { RootStackScreenProps } from '../../types/navigation.types';
// My Unit's own scale, so the two screens' small type is drawn at one size.
import { statScaleFor } from '../MyUnitScreen/MyUnitScreen.styles';
import { AutomationRow } from './AutomationRow';
import { ClimateControls } from './ClimateControls';
import { ControlCard } from './ControlCard';
import { DeviceCard } from './DeviceCard';
import { EnergyGauge } from './EnergyGauge';
import { LightingControls } from './LightingControls';
import { SceneTile } from './SceneTile';
import {
  acCard,
  activeSceneId,
  addDeviceCopy,
  automations,
  climate,
  curtainActions,
  curtainsCard,
  deviceStatusLabel,
  devices,
  energy,
  formatKwh,
  lighting,
  lightingCard,
  liveCopy,
  mediaCard,
  mediaSources,
  previewCounts,
  rooms,
  scenes,
  smartHomeCopy as copy,
  type CurtainAction,
  type Scene,
} from './SmartHomeScreen.data';
import {
  ADD_BUTTON_SIZE,
  ADD_ICON_SIZE,
  BANNER_BUTTON_SIZE,
  BANNER_CHEVRON_SIZE,
  BANNER_HEIGHT,
  CARD_GAP,
  CURTAIN_BUTTON_SIZE,
  CURTAIN_ICON_SIZE,
  GAUGE_SIZE,
  HEADING_ICON_SIZE,
  MEDIA_ICON_SIZE,
  MEDIA_LOGO_HEIGHT,
  ROOM_ICON_SIZE,
  createStyles,
  layoutFor,
  wideDeviceColumns,
} from './SmartHomeScreen.styles';

/** Placeholder for links whose destination screens are not designed yet. */
function notYetRouted() {
  // TODO(nav): route to the destination screen once it is designed.
}

/** The panels whose "View All" opens the full list in place. */
type ExpandablePanel = 'scenes' | 'energy' | 'devices' | 'automations';

const SCENES_PER_ROW = 4;

/** Splits scenes into rows of four. */
function sceneRows(items: readonly Scene[]): Scene[][] {
  return Array.from({ length: Math.ceil(items.length / SCENES_PER_ROW) }, (_, row) =>
    items.slice(row * SCENES_PER_ROW, (row + 1) * SCENES_PER_ROW),
  );
}

/** Seeds a per-item on/off map from mock data. */
function enabledMap(items: readonly { id: string; enabled: boolean }[]) {
  return Object.fromEntries(items.map((item) => [item.id, item.enabled]));
}

/** One card in the Smart Devices panel. */
interface DeviceItem {
  id: string;
  name: string;
  location: string;
  iconSet: Scene['iconSet'];
  iconName: string;
  online: boolean;
  enabled: boolean;
  onToggle?: (next: boolean) => void;
  onPress?: () => void;
}

/** The live media card shows this many of the player's sources. */
const MEDIA_SOURCES_SHOWN = 3;

type MediaSourceTile = (typeof mediaSources)[number];

/** Which way a cover is heading, as the Curtains card's buttons show it. */
function coverAction(state: string): CurtainAction | null {
  if (state === 'open' || state === 'opening') return 'open';
  if (state === 'closed' || state === 'closing') return 'close';
  return null;
}

export function SmartHomeScreen() {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const screen = useScreenLayout();
  // Sized for the page column the sections sit in, not the window.
  const layout = layoutFor(screen.columnFrameWidth);
  const typeScale = statScaleFor(screen.columnFrameWidth, theme);
  const deviceColumns = screen.isWide ? wideDeviceColumns(screen.columnWidth) : layout.deviceColumns;
  const gridStyle = [styles.grid, layout.controlColumns === 1 && styles.gridStacked];
  const cellStyle = layout.controlColumns === 2 ? styles.gridCell : undefined;
  const navigation = useNavigation<RootStackScreenProps<'SmartHome'>['navigation']>();
  const [menuOpen, setMenuOpen] = useState(false);

  // A signed-in resident with a home sees their own rooms and devices; anyone
  // else sees the design's sample home, driven by screen-local state below.
  const ems = useHomeDevices();
  const home = ems.status === 'signedIn' && ems.home && ems.home.hub.status !== 'provisioning' ? ems.home : null;
  const live = home !== null;
  const [liveRoomId, setLiveRoomId] = useState('all');
  const [dragBrightness, setDragBrightness] = useState<number | null>(null);
  const [livePresetId, setLivePresetId] = useState<string | null>(null);
  const roomDevices = live ? ems.devices.filter((device) => liveRoomId === 'all' || device.roomId === liveRoomId) : [];
  // Each control card drives the room's first device of its kind, preferring one that is online.
  const firstOf = (kind: DeviceKind) =>
    roomDevices.find((device) => device.kind === kind && device.online) ?? roomDevices.find((device) => device.kind === kind);
  const liveLight = firstOf('light');
  const liveAc = firstOf('climate');
  const liveCover = firstOf('cover');
  const liveMedia = firstOf('media');
  const send = (device: Device, command: Command) => void ems.command(device, command);
  const toggle = (device: Device) => (on: boolean) => {
    const command = toggleCommand(device, on);
    if (command) send(device, command);
  };
  const openDevice = (device: Device) => navigation.navigate('DeviceDetail', { deviceId: device.id });

  // The sample home's state: screen-local, nothing is sent anywhere.
  const [roomId, setRoomId] = useState(rooms[0].id);
  const [lightsOn, setLightsOn] = useState(true);
  const [brightness, setBrightness] = useState<number>(lighting.brightness);
  const [presetId, setPresetId] = useState<string>(lighting.presets[0].id);
  const [acOn, setAcOn] = useState(true);
  const [temperature, setTemperature] = useState<number>(climate.temperature);
  const [fanSpeed, setFanSpeed] = useState<number>(climate.fanSpeed);
  const [acMode, setAcMode] = useState<string>(climate.modes[0]);
  const [curtainsOn, setCurtainsOn] = useState(true);
  const [curtainAction, setCurtainAction] = useState<CurtainAction | null>(null);
  const [mediaOn, setMediaOn] = useState(true);
  const [mediaId, setMediaId] = useState<string | null>(null);
  const [sceneId, setSceneId] = useState(activeSceneId);
  const [devicesOn, setDevicesOn] = useState(() => enabledMap(devices));
  const [automationsOn, setAutomationsOn] = useState(() => enabledMap(automations));
  const [expanded, setExpanded] = useState<Record<ExpandablePanel, boolean>>({
    scenes: false,
    energy: false,
    devices: false,
    automations: false,
  });

  // "View All" opens the panel's full list in place; "Show Less" folds it back.
  const viewAll = (panel: ExpandablePanel) => ({
    actionLabel: expanded[panel] ? copy.showLess : copy.viewAll,
    actionExpanded: expanded[panel],
    onActionPress: () => setExpanded((current) => ({ ...current, [panel]: !current[panel] })),
  });

  const visibleScenes = expanded.scenes ? scenes : scenes.slice(0, previewCounts.scenes);
  const deviceItems: DeviceItem[] = live
    ? roomDevices.map((device) => ({
        id: device.id,
        name: device.name,
        location: device.room ?? kindLabel(device.kind),
        ...kindGlyph(device.kind),
        online: device.online,
        enabled: isOn(device) ?? device.online,
        onToggle: toggleCommand(device, true) ? toggle(device) : undefined,
        onPress: () => openDevice(device),
      }))
    : devices.map((device) => ({
        ...device,
        enabled: devicesOn[device.id] ?? device.enabled,
        onToggle: (next: boolean) => setDevicesOn((current) => ({ ...current, [device.id]: next })),
      }));
  const roomChips = live
    ? [
        { id: 'all', label: liveCopy.allRooms, iconSet: 'material' as const, iconName: 'home-outline' },
        ...ems.rooms.map((room) => ({ id: room.id, label: room.name, ...roomGlyph(room) })),
      ]
    : rooms;
  const selectedRoom = live ? liveRoomId : roomId;
  const selectRoom = (id: string) => (live ? setLiveRoomId(id) : setRoomId(id));
  const visibleDevices = expanded.devices
    ? deviceItems
    : deviceItems.slice(0, previewCounts.devices);
  const visibleAutomations = expanded.automations
    ? automations
    : automations.slice(0, previewCounts.automations);

  const handleLogout = useCallback(() => {
    setMenuOpen(false);
    // Frontend only, as on Home: there is no session to clear yet.
    // TODO(auth): clear the stored session here once one exists.
    navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
  }, [navigation, setMenuOpen]);

  const menuItems = useMemo<readonly AppMenuItem[]>(
    () => [
      {
        id: 'devices',
        label: 'My Devices',
        icon: 'hardware-chip-outline',
        onPress: () => {
          setMenuOpen(false);
          navigation.navigate('EmsDevices');
        },
      },
      {
        id: 'connect',
        label: 'Connect devices',
        icon: 'add-circle-outline',
        onPress: () => {
          setMenuOpen(false);
          navigation.navigate('ConnectAccount');
        },
      },
      { id: 'logout', label: 'Log out', icon: 'log-out-outline', onPress: handleLogout },
    ],
    [handleLogout, navigation, setMenuOpen],
  );

  const lightCaps = liveLight
    ? {
        power: capabilityOf(liveLight, 'power'),
        brightness: capabilityOf(liveLight, 'brightness'),
        color: capabilityOf(liveLight, 'color'),
        colorTemp: capabilityOf(liveLight, 'color_temp'),
      }
    : null;
  const lightingEl = live ? (
    liveLight && lightCaps ? (
      <ControlCard key="lighting" info={{ ...lightingCard, subtitle: liveLight.name }} on={isOn(liveLight) === true} onToggle={toggle(liveLight)}>
        <LightingControls
          brightness={dragBrightness ?? (lightCaps.brightness?.value ?? (isOn(liveLight) ? 100 : 0)) / 100}
          onBrightnessChange={setDragBrightness}
          onBrightnessCommit={(next) => {
            setDragBrightness(null);
            if (lightCaps.brightness) {
              send(liveLight, { capability: 'brightness', action: 'set', value: Math.round(next * 100), entityId: lightCaps.brightness.entityId });
            }
          }}
          showPresets={Boolean(lightCaps.color || lightCaps.colorTemp)}
          presetId={livePresetId ?? ''}
          onPresetChange={(id) => {
            const preset = lighting.presets.find((entry) => entry.id === id);
            setLivePresetId(id);
            if (preset && 'hue' in preset && lightCaps.color) {
              send(liveLight, { capability: 'color', action: 'set', value: { h: preset.hue, s: 100 }, entityId: lightCaps.color.entityId });
            } else if (preset && 'kelvin' in preset && lightCaps.colorTemp) {
              send(liveLight, { capability: 'color_temp', action: 'set', value: preset.kelvin, entityId: lightCaps.colorTemp.entityId });
            }
          }}
          onCustomColorPress={() => openDevice(liveLight)}
        />
      </ControlCard>
    ) : null
  ) : (
    <ControlCard key="lighting" info={lightingCard} on={lightsOn} onToggle={setLightsOn}>
      <LightingControls
        brightness={brightness}
        onBrightnessChange={setBrightness}
        presetId={presetId}
        onPresetChange={setPresetId}
        // TODO(nav): open the colour picker once it is designed.
        onCustomColorPress={notYetRouted}
      />
    </ControlCard>
  );

  const acCap = liveAc ? capabilityOf(liveAc, 'climate') : undefined;
  const acEl = live ? (
    liveAc && acCap ? (
      <ControlCard key="ac" info={{ ...acCard, subtitle: liveAc.name }} on={acCap.mode !== 'off'} onToggle={toggle(liveAc)}>
        <ClimateControls
          temperature={acCap.target ?? acCap.current ?? acCap.min}
          onTemperatureChange={(next) =>
            send(liveAc, { capability: 'climate', action: 'set_temperature', value: next, entityId: acCap.entityId })
          }
          fanSpeed={acCap.fanMode ? acCap.fanModes.indexOf(acCap.fanMode) + 1 : 0}
          onFanSpeedChange={(level) =>
            send(liveAc, { capability: 'climate', action: 'set_fan_mode', value: acCap.fanModes[level - 1], entityId: acCap.entityId })
          }
          mode={acCap.mode}
          onModeChange={(next) => send(liveAc, { capability: 'climate', action: 'set_mode', value: next, entityId: acCap.entityId })}
          minTemperature={acCap.min}
          maxTemperature={acCap.max}
          step={acCap.step}
          unit={acCap.unit}
          // Off is the card's own switch.
          modes={acCap.modes.filter((mode) => mode !== 'off')}
          fanLevels={acCap.fanModes.length}
        />
      </ControlCard>
    ) : null
  ) : (
    <ControlCard key="ac" info={acCard} on={acOn} onToggle={setAcOn}>
      <ClimateControls
        temperature={temperature}
        onTemperatureChange={setTemperature}
        fanSpeed={fanSpeed}
        onFanSpeedChange={setFanSpeed}
        mode={acMode}
        onModeChange={setAcMode}
      />
    </ControlCard>
  );

  const coverCap = liveCover ? capabilityOf(liveCover, 'cover') : undefined;
  const curtainButtons = (active: CurtainAction | null, onPick: (action: CurtainAction) => void) => (
    <View style={styles.curtainRow}>
      {curtainActions.map((action) => (
        <Pressable
          key={action.id}
          onPress={() => onPick(action.id)}
          accessibilityRole="button"
          accessibilityLabel={`${action.label} curtains`}
          accessibilityState={{ selected: action.id === active }}
          style={({ pressed }) => [styles.curtainButton, pressed && styles.pressed]}
        >
          <GlassSurface
            radius={CURTAIN_BUTTON_SIZE / 2}
            glow={action.id === active}
            stroke="gradient"
            strokeColors={[theme.colors.cardStrokeFrom, theme.colors.featureStrokeTo]}
            blurred={false}
            fillOpacity={theme.glass.subtleFillOpacity}
            style={styles.curtainSurface}
          >
            <AppIcon set={action.iconSet} name={action.iconName} size={CURTAIN_ICON_SIZE} />
            <AppText variant="statLabel">{action.label}</AppText>
          </GlassSurface>
        </Pressable>
      ))}
    </View>
  );
  const curtainsEl = live ? (
    liveCover && coverCap ? (
      <ControlCard
        key="curtains"
        info={{ ...curtainsCard, subtitle: liveCover.name }}
        on={coverCap.state !== 'closed'}
        onToggle={(on) => send(liveCover, { capability: 'cover', action: on ? 'open' : 'close', entityId: coverCap.entityId })}
      >
        {curtainButtons(coverAction(coverCap.state), (action) =>
          send(liveCover, {
            capability: 'cover',
            action: action === 'pause' ? 'stop' : action,
            entityId: coverCap.entityId,
          }),
        )}
      </ControlCard>
    ) : null
  ) : (
    <ControlCard key="curtains" info={curtainsCard} on={curtainsOn} onToggle={setCurtainsOn}>
      {curtainButtons(curtainAction, setCurtainAction)}
    </ControlCard>
  );

  const mediaCap = liveMedia ? capabilityOf(liveMedia, 'media') : undefined;
  const mediaTiles = (
    sources: readonly MediaSourceTile[],
    active: string | null,
    onPick: (id: string) => void,
  ) => (
    <View style={styles.mediaRow} accessibilityRole="radiogroup">
      {sources.map((source) => (
        <Pressable
          key={source.id}
          onPress={() => onPick(source.id)}
          accessibilityRole="radio"
          accessibilityLabel={source.label}
          accessibilityState={{ selected: source.id === active }}
          style={({ pressed }) => [styles.mediaItem, pressed && styles.pressed]}
        >
          <GlassSurface
            radius={theme.borderRadius.sm}
            glow={source.id === active}
            stroke="gradient"
            strokeColors={[theme.colors.dividerSubtle, theme.colors.dividerSubtle]}
            blurred={false}
            fillOpacity={theme.glass.subtleFillOpacity}
            style={styles.mediaTile}
          >
            {'logo' in source ? (
              <Image
                source={images[source.logo]}
                style={[styles.mediaLogo, { width: MEDIA_LOGO_HEIGHT * imageAspects[source.logo] }]}
                resizeMode="contain"
                fadeDuration={0}
              />
            ) : (
              <AppIcon set={source.iconSet} name={source.iconName} size={MEDIA_ICON_SIZE} />
            )}
          </GlassSurface>
          <AppText variant="tileCaption" numberOfLines={1}>
            {source.label}
          </AppText>
        </Pressable>
      ))}
    </View>
  );
  const mediaEl = live ? (
    liveMedia && mediaCap ? (
      <ControlCard
        key="media"
        info={{ ...mediaCard, subtitle: mediaCap.title ?? liveMedia.name }}
        on={isOn(liveMedia) ?? mediaCap.state !== 'off'}
        onToggle={toggle(liveMedia)}
      >
        {mediaCap.sources.length > 0 ? (
          mediaTiles(
            mediaCap.sources
              .slice(0, MEDIA_SOURCES_SHOWN)
              .map((source) => ({ id: source, label: source, iconSet: 'material' as const, iconName: 'television-play' })),
            mediaCap.source,
            (source) => send(liveMedia, { capability: 'media', action: 'select_source', value: source, entityId: mediaCap.entityId }),
          )
        ) : (
          <Pressable onPress={() => openDevice(liveMedia)} accessibilityRole="button" accessibilityLabel={`Open ${liveMedia.name}`}>
            <AppText variant="tileCaption" color={theme.colors.textSupport}>
              {kindLabel(liveMedia.kind)}
            </AppText>
          </Pressable>
        )}
      </ControlCard>
    ) : null
  ) : (
    <ControlCard key="media" info={mediaCard} on={mediaOn} onToggle={setMediaOn}>
      {mediaTiles(mediaSources, mediaId, setMediaId)}
    </ControlCard>
  );

  // Two cards to a row, as drawn; the live screen closes up around the ones it has no device for.
  const controlCards = [lightingEl, acEl, curtainsEl, mediaEl].filter((card) => card !== null);
  const controlRows = Array.from({ length: Math.ceil(controlCards.length / 2) }, (_, row) => controlCards.slice(row * 2, row * 2 + 2));

  const headingIcon = (name: keyof typeof Ionicons.glyphMap, color: string) => (
    <Ionicons name={name} size={HEADING_ICON_SIZE} color={color} />
  );

  // One breakdown line: the category rows, and the per-room rows behind "View All".
  const energyRow = (row: {
    id: string;
    label: string;
    kwh: number;
    iconSet: Scene['iconSet'];
    iconName: string;
    iconColor?: string;
  }) => (
    <GlassSurface
      key={row.id}
      radius={theme.borderRadius.sm}
      stroke="gradient"
      strokeColors={[theme.colors.avatarStroke, theme.colors.dividerSubtle]}
      blurred={false}
      fillOpacity={theme.glass.subtleFillOpacity}
      style={styles.energyRow}
    >
      <AppIcon set={row.iconSet} name={row.iconName} size={ROOM_ICON_SIZE} color={row.iconColor} />
      <AppText variant="statValue" style={styles.energyLabel}>
        {row.label}
      </AppText>
      <AppText variant="statValue">{formatKwh(row.kwh)}</AppText>
    </GlassSurface>
  );

  return (
    <ScreenWrapper
      backgroundSource={images.homeBackground}
      withScrim={false}
      backgroundOverlay={0.34}
    >
      <StatusBar style="light" />

      <View style={styles.flex}>
        <TypeScaleContext value={typeScale}>
          <ScrollView
            contentContainerStyle={[styles.content, screen.contentStyle]}
            showsVerticalScrollIndicator={false}
          >
            <PageHeader
              title={copy.title}
              onMenuPress={() => setMenuOpen(true)}
              style={styles.header}
            />

            <FeatureBanner
              title={home ? home.unit.name : copy.unitTitle}
              body={
                home
                  ? [home.unit.building, liveCopy.deviceCount(ems.devices.length), home.hub.status === 'offline' ? liveCopy.hubOffline : null]
                      .filter(Boolean)
                      .join(' • ')
                  : copy.unitMeta
              }
              photo={images.smartHomeHero}
              photoAspect={imageAspects.smartHomeHero}
              height={BANNER_HEIGHT}
              footer={
                <Pressable
                  onPress={() => navigation.navigate('MyUnit')}
                  hitSlop={10}
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${home ? home.unit.name : copy.unitTitle}`}
                  style={({ pressed }) => [styles.bannerButton, pressed && styles.pressed]}
                >
                  <GlassSurface
                    radius={BANNER_BUTTON_SIZE / 2}
                    stroke="gradient"
                    strokeColors={[theme.colors.cardStrokeFrom, theme.colors.featureStrokeTo]}
                    blurred={false}
                    fillOpacity={theme.glass.subtleFillOpacity}
                    style={styles.bannerButtonSurface}
                  >
                    <Ionicons
                      name="chevron-forward"
                      size={BANNER_CHEVRON_SIZE}
                      color={theme.colors.textPrimary}
                    />
                  </GlassSurface>
                </Pressable>
              }
            />

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.rooms}
              contentContainerStyle={styles.roomsContent}
              accessibilityRole="tablist"
            >
              {roomChips.map((room) => (
                <FilterChip
                  key={room.id}
                  label={room.label}
                  iconSet={room.iconSet}
                  iconName={room.iconName}
                  selected={room.id === selectedRoom}
                  onPress={() => selectRoom(room.id)}
                />
              ))}
            </ScrollView>

            {/* Controls and scenes, then energy, devices and automations: side by side when wide. */}
            <ResponsiveColumns gap={CARD_GAP} style={styles.sections}>
              <>
                <View>
                  {controlRows.map((row, index) => (
                    <View key={row[0]?.key} style={[gridStyle, index === controlRows.length - 1 && styles.gridLast]}>
                      {row.map((card) => (
                        <View key={card?.key} style={cellStyle}>
                          {card}
                        </View>
                      ))}
                    </View>
                  ))}
                </View>

                <NeonPanel>
                  <PanelHeading
                    title={copy.scenesTitle}
                    subtitle={copy.scenesSubtitle}
                    icon={headingIcon('star-outline', theme.colors.iconWarm)}
                    iconSize={HEADING_ICON_SIZE}
                    {...viewAll('scenes')}
                    divider={false}
                  />
                  <View style={styles.sceneGrid} accessibilityRole="radiogroup">
                    {sceneRows(visibleScenes).map((row) => (
                      <View key={row[0].id} style={styles.sceneRow}>
                        {row.map((scene) => (
                          <SceneTile
                            key={scene.id}
                            label={scene.label}
                            photo={scene.photo ? images[scene.photo] : undefined}
                            iconSet={scene.iconSet}
                            iconName={scene.iconName}
                            active={scene.id === sceneId}
                            onPress={() => setSceneId(scene.id)}
                          />
                        ))}
                        {Array.from({ length: SCENES_PER_ROW - row.length }, (_, index) => (
                          <View key={`spacer-${index}`} style={styles.sceneSpacer} />
                        ))}
                      </View>
                    ))}
                  </View>
                </NeonPanel>
              </>
              <>
                <NeonPanel>
                  <PanelHeading
                    title={copy.energyTitle}
                    subtitle={copy.energySubtitle}
                    icon={headingIcon('leaf-outline', theme.colors.textPrimary)}
                    iconSize={HEADING_ICON_SIZE}
                    {...viewAll('energy')}
                    divider={false}
                  />
                  <View style={[styles.energyBody, layout.energyStacked && styles.energyStacked]}>
                    <View style={layout.energyStacked && styles.energyGaugeStacked}>
                      <EnergyGauge
                        value={formatKwh(energy.todayKwh)}
                        caption="Today"
                        fraction={energy.todayKwh / energy.dailyBudgetKwh}
                        trend={`${Math.abs(energy.changePercent)}%`}
                        trendDown={energy.changePercent < 0}
                        trendCaption="vs. yesterday"
                        size={GAUGE_SIZE}
                      />
                    </View>
                    <View style={[styles.energyRows, layout.energyStacked && styles.energyRowsStacked]}>
                      {energy.breakdown.map((row) =>
                        energyRow({ ...row, iconColor: theme.colors[row.iconColor] }),
                      )}
                    </View>
                  </View>
                  {expanded.energy ? (
                    <View style={styles.energyRooms}>
                      <AppText
                        variant="statLabel"
                        color={theme.colors.textSupport}
                        style={styles.energyRoomsTitle}
                      >
                        {copy.energyByRoom}
                      </AppText>
                      {energy.byRoom.map(({ roomId, kwh }) => {
                        const room = rooms.find((entry) => entry.id === roomId);
                        return room
                          ? energyRow({
                              id: room.id,
                              label: room.label,
                              kwh,
                              iconSet: room.iconSet,
                              iconName: room.iconName,
                            })
                          : null;
                      })}
                    </View>
                  ) : null}
                </NeonPanel>

                <NeonPanel>
                  <PanelHeading
                    title={copy.devicesTitle}
                    subtitle={copy.devicesSubtitle}
                    icon={
                      <AppIcon
                        set="ionicons"
                        name="git-network-outline"
                        size={HEADING_ICON_SIZE}
                        color={theme.colors.iconWarm}
                        // Flipped, so one node sits above two, as drawn.
                        style={styles.flipped}
                      />
                    }
                    iconSize={HEADING_ICON_SIZE}
                    {...viewAll('devices')}
                    trailing={
                      <Pressable
                        onPress={() => navigation.navigate('ConnectAccount')}
                        hitSlop={10}
                        accessibilityRole="button"
                        accessibilityLabel={addDeviceCopy.buttonLabel}
                        style={({ pressed }) => [styles.addButton, pressed && styles.pressed]}
                      >
                        <GlassSurface
                          radius={ADD_BUTTON_SIZE / 2}
                          stroke="gradient"
                          strokeColors={[theme.colors.cardStrokeFrom, theme.colors.featureStrokeTo]}
                          blurred={false}
                          fillOpacity={theme.glass.subtleFillOpacity}
                          style={styles.bannerButtonSurface}
                        >
                          <Ionicons name="add" size={ADD_ICON_SIZE} color={theme.colors.textPrimary} />
                        </GlassSurface>
                      </Pressable>
                    }
                    divider={false}
                  />
                  <View style={styles.deviceGrid}>
                    {live && deviceItems.length === 0 ? (
                      <AppText variant="tileCaption" color={theme.colors.textSupport} style={styles.deviceNote}>
                        {liveCopy.noDevices}
                      </AppText>
                    ) : null}
                    {visibleDevices.map((device) => (
                      <View
                        key={device.id}
                        style={[
                          styles.deviceCell,
                          deviceColumns === 1 && styles.deviceCellFull,
                          deviceColumns === 3 && styles.deviceCellThird,
                        ]}
                      >
                        <DeviceCard
                          name={device.name}
                          location={device.location}
                          iconSet={device.iconSet}
                          iconName={device.iconName}
                          online={device.online}
                          statusLabel={device.online ? deviceStatusLabel.online : deviceStatusLabel.offline}
                          enabled={device.enabled}
                          onToggle={device.onToggle}
                          // TODO(nav): the sample devices open nothing; live ones open their own screen.
                          onPress={device.onPress ?? notYetRouted}
                        />
                      </View>
                    ))}
                  </View>
                </NeonPanel>

                <NeonPanel>
                  <PanelHeading
                    title={copy.automationTitle}
                    subtitle={copy.automationSubtitle}
                    icon={headingIcon('settings-outline', theme.colors.textPrimary)}
                    iconSize={HEADING_ICON_SIZE}
                    {...viewAll('automations')}
                    divider={false}
                  />
                  <View style={styles.automationList}>
                    {visibleAutomations.map((automation) => (
                      <AutomationRow
                        key={automation.id}
                        title={automation.title}
                        summary={automation.summary}
                        iconSet={automation.iconSet}
                        iconName={automation.iconName}
                        enabled={automationsOn[automation.id] ?? automation.enabled}
                        onToggle={(next) =>
                          setAutomationsOn((current) => ({ ...current, [automation.id]: next }))
                        }
                        // TODO(nav): open the automation once its editor is designed.
                        onPress={notYetRouted}
                      />
                    ))}
                  </View>
                </NeonPanel>
              </>
            </ResponsiveColumns>
          </ScrollView>
        </TypeScaleContext>

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
