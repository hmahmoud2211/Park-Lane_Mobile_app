import { useMemo, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { useAppTheme } from '../../../hooks/useAppTheme';
import type { CapabilityType, Command, Device } from '../../../types/home.types';
import type { AppTheme } from '../../../types/theme.types';
import { AppIcon } from '../../../components/common/AppIcon';
import { AppText } from '../../../components/common/AppText';
import { Notice } from '../../../components/feedback/Notice';
import { NeonPanel } from '../../../components/ui/NeonPanel';
import { PanelHeading } from '../../../components/ui/PanelHeading';
import { kindGlyph, stateLine } from '../services/capabilities';
import { hasExtras, planControls } from '../services/controlPlan';
import { problemAdvice, readingText } from '../services/deviceLabels';
import type { ControlKit } from '../types';
import { CapabilityBlock, CapabilityExtras } from './CapabilityControls';
import { keyOf } from './ControlParts';
import { MainControl } from './MainControl';

export interface DeviceControlProps {
  device: Device;
  /** Sends one command; the caller shows it at once and confirms it with the hub. */
  onCommand: (command: Command) => void;
  /** A command from this screen is waiting for the hub. */
  busy?: boolean;
  /** Why the last command from this screen failed. */
  error?: string | null;
  /** Under the main control, e.g. the link to an AC's full settings. */
  footer?: ReactNode;
}

const copy = {
  notResponding: 'Not responding',
  notRespondingBody: 'Check that it is switched on and has power. Its controls come back when it does.',
  failed: 'That didn’t work',
  updating: 'Updating…',
  moreControls: 'More controls',
  moreSettings: 'More settings',
  moreSettingsHint: 'Shows this device’s settings, such as child lock or what it does after a power cut',
  readings: 'Readings',
  readingsOnly: 'This device only shows readings.',
  nothingToControl: 'The app has no controls for this device yet.',
} as const;

const BADGE_SIZE = 48;
const BADGE_ICON_SIZE = 26;
const ROW_ICON_SIZE = 22;

/**
 * Everything a resident can do with one device, in the order they need it: what it is doing
 * in words and the one obvious control (big On/Off, the temperature, a remote, Lock /
 * Unlock…), then "More controls", then its settings folded under "More settings", then its
 * readings. The pressed control shows it is working; the result shows at once (the hooks'
 * optimistic update); a failure says what to do.
 */
export function DeviceControl({ device, onCommand, busy = false, error, footer }: DeviceControlProps) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const plan = useMemo(() => planControls(device), [device]);
  const [active, setActive] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  // Ours while this screen waits; otherwise a command another phone sent.
  const pendingKey = device.pending ? `${device.pending.entityId}:${device.pending.capability}:${device.pending.action}` : null;
  const busyKey = busy ? active : pendingKey;
  const kit: ControlKit = {
    deviceName: device.name,
    kind: device.kind,
    disabled: !device.online,
    waiting: busy,
    isBusy: (key) => busyKey !== null && (key === busyKey || busyKey.startsWith(`${key}:`)),
    send: (capability, action, value, key) => {
      setActive(key ?? keyOf(capability, action, value));
      onCommand({ capability: capability.type, action, value, entityId: capability.entityId });
    },
  };

  const counts = new Map<CapabilityType, number>();
  device.capabilities.forEach((capability) => counts.set(capability.type, (counts.get(capability.type) ?? 0) + 1));
  const named = (type: CapabilityType) => (counts.get(type) ?? 0) > 1;
  const extras = plan.main !== null && hasExtras(plan.main);
  const glyph = kindGlyph(device.kind);
  const nothing = !plan.main && plan.more.length === 0 && plan.settings.length === 0;

  return (
    <View style={styles.root}>
      <NeonPanel style={styles.panel}>
        {device.online ? (
          <View style={styles.status}>
            <View style={styles.badge}>
              <AppIcon set={glyph.iconSet} name={glyph.iconName} size={BADGE_ICON_SIZE} />
            </View>
            <View style={styles.flex}>
              <AppText variant="controlState" accessibilityLiveRegion="polite">
                {stateLine(device)}
              </AppText>
              {device.pending && !busy ? (
                <View style={styles.inline}>
                  <ActivityIndicator size="small" color={theme.colors.textAccentSoft} />
                  <AppText variant="controlCaption" color={theme.colors.textAccentSoft}>
                    {copy.updating}
                  </AppText>
                </View>
              ) : null}
            </View>
          </View>
        ) : (
          <Notice tone="warning" title={copy.notResponding}>
            {copy.notRespondingBody}
          </Notice>
        )}

        <MainControl device={device} plan={plan} kit={kit} />

        {nothing ? (
          <AppText variant="controlCaption" color={theme.colors.textSupport}>
            {device.sensors.length > 0 ? copy.readingsOnly : copy.nothingToControl}
          </AppText>
        ) : null}
        {error ? (
          <Notice tone="error" title={copy.failed}>
            {problemAdvice(error)}
          </Notice>
        ) : null}
        {footer}
      </NeonPanel>

      {extras || plan.more.length > 0 ? (
        <NeonPanel style={styles.panel}>
          <PanelHeading title={copy.moreControls} iconSet="material" iconName="tune-variant" divider />
          {extras && plan.main ? <CapabilityExtras capability={plan.main} kit={kit} /> : null}
          {plan.more.map((capability) => (
            <CapabilityBlock key={`${capability.entityId}:${capability.type}`} capability={capability} kit={kit} named={named(capability.type)} />
          ))}
        </NeonPanel>
      ) : null}

      {plan.settings.length > 0 ? (
        <NeonPanel style={styles.panel}>
          <Pressable
            onPress={() => setShowSettings((open) => !open)}
            accessibilityRole="button"
            accessibilityLabel={`${copy.moreSettings}, ${plan.settings.length}`}
            accessibilityHint={copy.moreSettingsHint}
            accessibilityState={{ expanded: showSettings }}
            style={({ pressed }) => [styles.disclosure, pressed && styles.pressed]}
          >
            <AppIcon set="material" name="cog-outline" size={ROW_ICON_SIZE} />
            <AppText variant="controlLabel" style={styles.flex}>
              {`${copy.moreSettings} (${plan.settings.length})`}
            </AppText>
            <AppIcon set="material" name={showSettings ? 'chevron-up' : 'chevron-down'} size={ROW_ICON_SIZE} color={theme.colors.textSupport} />
          </Pressable>
          {showSettings
            ? plan.settings.map((capability) => (
                <CapabilityBlock key={`${capability.entityId}:${capability.type}`} capability={capability} kit={kit} named={named(capability.type)} />
              ))
            : null}
        </NeonPanel>
      ) : null}

      {device.sensors.length > 0 ? (
        <NeonPanel style={styles.panel}>
          <PanelHeading title={copy.readings} iconSet="material" iconName="gauge" divider />
          {device.sensors.map((sensor) => (
            <View key={sensor.entityId} style={styles.reading} accessible accessibilityLabel={`${sensor.label}: ${readingText(sensor.value, sensor.unit)}`}>
              <AppText variant="controlCaption" color={theme.colors.textSupport} style={styles.flex}>
                {sensor.label}
              </AppText>
              <AppText variant="controlLabel">{readingText(sensor.value, sensor.unit)}</AppText>
            </View>
          ))}
        </NeonPanel>
      ) : null}
    </View>
  );
}

function createStyles(theme: AppTheme) {
  const inner = theme.layout.innerScreen;
  return StyleSheet.create({
    root: {
      gap: inner.cardGap,
    },
    panel: {
      padding: inner.panelInset,
      gap: inner.panelInset,
    },
    flex: {
      flex: 1,
    },
    inline: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.xs,
    },
    status: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.sm + theme.spacing.xs,
    },
    badge: {
      width: BADGE_SIZE,
      height: BADGE_SIZE,
      borderRadius: theme.borderRadius.md,
      borderWidth: theme.glass.strokeWidth,
      borderColor: theme.colors.avatarStroke,
      backgroundColor: theme.colors.avatarFill,
      alignItems: 'center',
      justifyContent: 'center',
    },
    disclosure: {
      minHeight: theme.layout.deviceControl.minTarget,
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.sm + theme.spacing.xs,
    },
    pressed: {
      opacity: 0.7,
    },
    reading: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      columnGap: theme.spacing.sm,
      minHeight: theme.layout.deviceControl.minTarget - theme.spacing.md,
    },
  });
}
