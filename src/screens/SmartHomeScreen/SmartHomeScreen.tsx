import Ionicons from '@expo/vector-icons/Ionicons';
import { useNavigation } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useMemo, useState } from 'react';
import { Image, Pressable, ScrollView, View, useWindowDimensions } from 'react-native';

import { AppIcon } from '../../components/common/AppIcon';
import { AppText } from '../../components/common/AppText';
import { GlassSurface } from '../../components/common/GlassSurface';
import { BottomBar } from '../../components/layout/BottomBar';
import { PageHeader } from '../../components/layout/PageHeader';
import { ScreenWrapper } from '../../components/layout/ScreenWrapper';
import { AppMenu, type AppMenuItem } from '../../components/ui/AppMenu';
import { FeatureBanner } from '../../components/ui/FeatureBanner';
import { NeonPanel } from '../../components/ui/NeonPanel';
import { PanelHeading } from '../../components/ui/PanelHeading';
import { imageAspects, images } from '../../constants/images';
import { useAppTheme } from '../../hooks/useAppTheme';
import type { RootStackScreenProps } from '../../types/navigation.types';
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
  mediaCard,
  mediaSources,
  rooms,
  scenes,
  smartHomeCopy as copy,
  type AcMode,
  type CurtainAction,
} from './SmartHomeScreen.data';
import {
  BANNER_BUTTON_SIZE,
  BANNER_CHEVRON_SIZE,
  BANNER_HEIGHT,
  CURTAIN_BUTTON_SIZE,
  CURTAIN_ICON_SIZE,
  GAUGE_SIZE,
  HEADING_ICON_SIZE,
  MEDIA_ICON_SIZE,
  MEDIA_LOGO_HEIGHT,
  ROOM_ICON_SIZE,
  createStyles,
  layoutFor,
} from './SmartHomeScreen.styles';

/** Placeholder for links whose destination screens are not designed yet. */
function notYetRouted() {
  // TODO(nav): route to the destination screen once it is designed.
}

/** Seeds a per-item on/off map from mock data. */
function enabledMap(items: readonly { id: string; enabled: boolean }[]) {
  return Object.fromEntries(items.map((item) => [item.id, item.enabled]));
}

export function SmartHomeScreen() {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { width } = useWindowDimensions();
  const layout = layoutFor(width);
  const gridStyle = [styles.grid, layout.controlColumns === 1 && styles.gridStacked];
  const cellStyle = layout.controlColumns === 2 ? styles.gridCell : undefined;
  const navigation = useNavigation<RootStackScreenProps<'SmartHome'>['navigation']>();
  const [menuOpen, setMenuOpen] = useState(false);

  // Screen-local until there is a home-automation backend to send commands to.
  // TODO(api): send each change to the unit's controller once that service exists.
  const [roomId, setRoomId] = useState(rooms[0].id);
  const [lightsOn, setLightsOn] = useState(true);
  const [brightness, setBrightness] = useState<number>(lighting.brightness);
  const [presetId, setPresetId] = useState<string>(lighting.presets[0].id);
  const [acOn, setAcOn] = useState(true);
  const [temperature, setTemperature] = useState<number>(climate.temperature);
  const [fanSpeed, setFanSpeed] = useState<number>(climate.fanSpeed);
  const [acMode, setAcMode] = useState<AcMode>(climate.modes[0]);
  const [curtainsOn, setCurtainsOn] = useState(true);
  const [curtainAction, setCurtainAction] = useState<CurtainAction | null>(null);
  const [mediaOn, setMediaOn] = useState(true);
  const [mediaId, setMediaId] = useState<string | null>(null);
  const [sceneId, setSceneId] = useState(activeSceneId);
  const [devicesOn, setDevicesOn] = useState(() => enabledMap(devices));
  const [automationsOn, setAutomationsOn] = useState(() => enabledMap(automations));

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

  const headingIcon = (name: keyof typeof Ionicons.glyphMap, color: string) => (
    <Ionicons name={name} size={HEADING_ICON_SIZE} color={color} />
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
            title={copy.unitTitle}
            body={copy.unitMeta}
            photo={images.smartHomeHero}
            photoAspect={imageAspects.smartHomeHero}
            height={BANNER_HEIGHT}
            titleVariant="heroTitle"
            bodyVariant="heroSubtitle"
            footer={
              <Pressable
                onPress={() => navigation.navigate('MyUnit')}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel={`Open ${copy.unitTitle}`}
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
            {rooms.map((room) => {
              const selected = room.id === roomId;
              return (
                <Pressable
                  key={room.id}
                  onPress={() => setRoomId(room.id)}
                  accessibilityRole="tab"
                  accessibilityLabel={room.label}
                  accessibilityState={{ selected }}
                  style={({ pressed }) => pressed && styles.pressed}
                >
                  <GlassSurface
                    radius={theme.borderRadius.sm}
                    glow={selected}
                    stroke="gradient"
                    strokeColors={
                      selected
                        ? [theme.colors.cardStrokeFrom, theme.colors.featureStrokeTo]
                        : [theme.colors.dividerSubtle, theme.colors.dividerSubtle]
                    }
                    blurred={false}
                    fillOpacity={selected ? undefined : theme.glass.subtleFillOpacity}
                    style={[styles.roomSurface, !selected && styles.roomIdle]}
                  >
                    <AppIcon set={room.iconSet} name={room.iconName} size={ROOM_ICON_SIZE} />
                    <AppText variant={selected ? 'statValue' : 'statLabel'}>{room.label}</AppText>
                  </GlassSurface>
                </Pressable>
              );
            })}
          </ScrollView>

          <View style={gridStyle}>
            <View style={cellStyle}>
              <ControlCard info={lightingCard} on={lightsOn} onToggle={setLightsOn}>
                <LightingControls
                  brightness={brightness}
                  onBrightnessChange={setBrightness}
                  presetId={presetId}
                  onPresetChange={setPresetId}
                  // TODO(nav): open the colour picker once it is designed.
                  onCustomColorPress={notYetRouted}
                />
              </ControlCard>
            </View>
            <View style={cellStyle}>
              <ControlCard info={acCard} on={acOn} onToggle={setAcOn}>
                <ClimateControls
                  temperature={temperature}
                  onTemperatureChange={setTemperature}
                  fanSpeed={fanSpeed}
                  onFanSpeedChange={setFanSpeed}
                  mode={acMode}
                  onModeChange={setAcMode}
                />
              </ControlCard>
            </View>
          </View>

          <View style={[gridStyle, styles.gridLast]}>
            <View style={cellStyle}>
              <ControlCard info={curtainsCard} on={curtainsOn} onToggle={setCurtainsOn}>
                <View style={styles.curtainRow}>
                  {curtainActions.map((action) => {
                    const active = action.id === curtainAction;
                    return (
                      <Pressable
                        key={action.id}
                        onPress={() => setCurtainAction(action.id)}
                        accessibilityRole="button"
                        accessibilityLabel={`${action.label} curtains`}
                        accessibilityState={{ selected: active }}
                        style={({ pressed }) => [styles.curtainButton, pressed && styles.pressed]}
                      >
                        <GlassSurface
                          radius={CURTAIN_BUTTON_SIZE / 2}
                          glow={active}
                          stroke="gradient"
                          strokeColors={[theme.colors.cardStrokeFrom, theme.colors.featureStrokeTo]}
                          blurred={false}
                          fillOpacity={theme.glass.subtleFillOpacity}
                          style={styles.curtainSurface}
                        >
                          <AppIcon
                            set={action.iconSet}
                            name={action.iconName}
                            size={CURTAIN_ICON_SIZE}
                          />
                          <AppText variant="statLabel">{action.label}</AppText>
                        </GlassSurface>
                      </Pressable>
                    );
                  })}
                </View>
              </ControlCard>
            </View>
            <View style={cellStyle}>
              <ControlCard info={mediaCard} on={mediaOn} onToggle={setMediaOn}>
                <View style={styles.mediaRow} accessibilityRole="radiogroup">
                  {mediaSources.map((source) => {
                    const active = source.id === mediaId;
                    return (
                      <Pressable
                        key={source.id}
                        onPress={() => setMediaId(source.id)}
                        accessibilityRole="radio"
                        accessibilityLabel={source.label}
                        accessibilityState={{ selected: active }}
                        style={({ pressed }) => [styles.mediaItem, pressed && styles.pressed]}
                      >
                        <GlassSurface
                          radius={theme.borderRadius.sm}
                          glow={active}
                          stroke="gradient"
                          strokeColors={[theme.colors.dividerSubtle, theme.colors.dividerSubtle]}
                          blurred={false}
                          fillOpacity={theme.glass.subtleFillOpacity}
                          style={styles.mediaTile}
                        >
                          {'logo' in source ? (
                            <Image
                              source={images[source.logo]}
                              style={[
                                styles.mediaLogo,
                                { width: MEDIA_LOGO_HEIGHT * imageAspects[source.logo] },
                              ]}
                              resizeMode="contain"
                              fadeDuration={0}
                            />
                          ) : (
                            <AppIcon
                              set={source.iconSet}
                              name={source.iconName}
                              size={MEDIA_ICON_SIZE}
                            />
                          )}
                        </GlassSurface>
                        <AppText variant="tileCaption" numberOfLines={1}>
                          {source.label}
                        </AppText>
                      </Pressable>
                    );
                  })}
                </View>
              </ControlCard>
            </View>
          </View>

          <NeonPanel style={styles.card}>
            <PanelHeading
              title={copy.scenesTitle}
              subtitle={copy.scenesSubtitle}
              icon={headingIcon('star-outline', theme.colors.iconWarm)}
              iconSize={HEADING_ICON_SIZE}
              actionLabel={copy.viewAll}
              onActionPress={notYetRouted}
              divider={false}
            />
            <View style={styles.sceneRow} accessibilityRole="radiogroup">
              {scenes.map((scene) => (
                <SceneTile
                  key={scene.id}
                  label={scene.label}
                  photo={images[scene.photo]}
                  iconSet={scene.iconSet}
                  iconName={scene.iconName}
                  active={scene.id === sceneId}
                  onPress={() => setSceneId(scene.id)}
                />
              ))}
            </View>
          </NeonPanel>

          <NeonPanel style={styles.card}>
            <PanelHeading
              title={copy.energyTitle}
              subtitle={copy.energySubtitle}
              icon={headingIcon('leaf-outline', theme.colors.textPrimary)}
              iconSize={HEADING_ICON_SIZE}
              actionLabel={copy.viewAll}
              onActionPress={notYetRouted}
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
                {energy.breakdown.map((row) => (
                  <GlassSurface
                    key={row.id}
                    radius={theme.borderRadius.sm}
                    stroke="gradient"
                    strokeColors={[theme.colors.avatarStroke, theme.colors.dividerSubtle]}
                    blurred={false}
                    fillOpacity={theme.glass.subtleFillOpacity}
                    style={styles.energyRow}
                  >
                    <AppIcon
                      set={row.iconSet}
                      name={row.iconName}
                      size={ROOM_ICON_SIZE}
                      color={theme.colors[row.iconColor]}
                    />
                    <AppText variant="statValue" style={styles.energyLabel}>
                      {row.label}
                    </AppText>
                    <AppText variant="statValue">{formatKwh(row.kwh)}</AppText>
                  </GlassSurface>
                ))}
              </View>
            </View>
          </NeonPanel>

          <NeonPanel style={styles.card}>
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
              actionLabel={copy.viewAll}
              onActionPress={notYetRouted}
              divider={false}
            />
            <View style={styles.deviceGrid}>
              {devices.map((device) => (
                <View
                  key={device.id}
                  style={[styles.deviceCell, layout.deviceColumns === 1 && styles.deviceCellFull]}
                >
                  <DeviceCard
                    name={device.name}
                    location={device.location}
                    iconSet={device.iconSet}
                    iconName={device.iconName}
                    online={device.online}
                    statusLabel={device.online ? deviceStatusLabel.online : deviceStatusLabel.offline}
                    enabled={devicesOn[device.id] ?? device.enabled}
                    onToggle={(next) => setDevicesOn((current) => ({ ...current, [device.id]: next }))}
                    // TODO(nav): open the device once its detail screen is designed.
                    onPress={notYetRouted}
                  />
                </View>
              ))}
            </View>
          </NeonPanel>

          <NeonPanel style={styles.card}>
            <PanelHeading
              title={copy.automationTitle}
              subtitle={copy.automationSubtitle}
              icon={headingIcon('settings-outline', theme.colors.textPrimary)}
              iconSize={HEADING_ICON_SIZE}
              actionLabel={copy.viewAll}
              onActionPress={notYetRouted}
              divider={false}
            />
            <View style={styles.automationList}>
              {automations.map((automation) => (
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
