import { useNavigation, useRoute } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';

import { AppButton } from '../../components/common/AppButton';
import { AppInput } from '../../components/common/AppInput';
import { AppText } from '../../components/common/AppText';
import { EmsAccountPanel } from '../../features/ems/components/EmsAccountPanel';
import { DeviceCard } from '../../features/home/components/DeviceCard';
import { DeviceControl } from '../../features/home/components/DeviceControl';
import { BottomBar } from '../../components/layout/BottomBar';
import { PageHeader } from '../../components/layout/PageHeader';
import { ScreenWrapper } from '../../components/layout/ScreenWrapper';
import { Notice } from '../../components/feedback/Notice';
import { FilterChip } from '../../components/ui/FilterChip';
import { NeonPanel } from '../../components/ui/NeonPanel';
import { PanelHeading } from '../../components/ui/PanelHeading';
import { images } from '../../constants/images';
import { useAppTheme } from '../../hooks/useAppTheme';
import { useGatewayDevices } from '../../features/gateway/hooks/useGatewayDevices';
import { useHomeDevices } from '../../features/home/hooks/useHomeDevices';
import { useScreenLayout } from '../../hooks/useScreenLayout';
import { kindLabel, roomGlyph, toggleCommand } from '../../features/home/services/capabilities';
import * as gatewayApi from '../../features/gateway/services/gatewayApi';
import { hasControlSettings, isGatewayDeviceId, toGatewayDeviceId } from '../../features/gateway/services/deviceMapping';
import { errorMessage } from '../../features/gateway/services/gatewayHttp';
import type { RootStackScreenProps } from '../../types/navigation.types';
import { deviceDetailCopy as copy } from './DeviceDetailScreen.data';
import { FIELD_HEIGHT, SMALL_BUTTON_HEIGHT, createStyles } from './DeviceDetailScreen.styles';

/**
 * One device: every control it offers, then its name, room and where it
 * comes from. Commands show at once and settle on what the device reports;
 * changes made elsewhere arrive live. A device is either the building hub's
 * (through EmsContext) or the resident's CUBE Gateway's (GatewayContext, ids
 * prefixed `gw:`), and each action goes to the backend it belongs to.
 */
export function DeviceDetailScreen() {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const layout = useScreenLayout();
  const navigation = useNavigation<RootStackScreenProps<'DeviceDetail'>['navigation']>();
  const { params } = useRoute<RootStackScreenProps<'DeviceDetail'>['route']>();
  const hub = useHomeDevices();
  const local = useGatewayDevices();
  const isLocal = isGatewayDeviceId(params.deviceId);
  const ems = isLocal ? local : hub;
  const { devices, rooms, busy, errors } = ems;
  const device = devices.find((entry) => entry.id === params.deviceId);
  const raw = isLocal ? local.rawDevices.find((entry) => entry.id === toGatewayDeviceId(params.deviceId)) : undefined;
  const [draftName, setDraftName] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);

  const remove = async () => {
    if (!confirmRemove) {
      setConfirmRemove(true);
      return;
    }
    if (!local.target || !raw) return;
    try {
      await gatewayApi.removeDevice(local.target, raw.id);
      local.dropDevice(raw.id);
      navigation.goBack();
    } catch (error) {
      setRemoveError(errorMessage(error, 'The device could not be removed.'));
    }
  };

  const renderBody = () => {
    if (!isLocal && hub.status !== 'signedIn') {
      return <EmsAccountPanel intro={copy.accountIntro} />;
    }
    if (!device) {
      return (
        <Notice
          tone="error"
          title={copy.missingTitle}
          actions={<AppButton title={copy.cancel} variant="secondary" height={SMALL_BUTTON_HEIGHT} onPress={() => navigation.goBack()} />}
        >
          {copy.missingBody}
        </Notice>
      );
    }
    const deviceBusy = busy[device.id];
    const toggle = toggleCommand(device, true) ? (on: boolean) => {
      const next = toggleCommand(device, on);
      if (next) void ems.command(device, next);
    } : undefined;
    const facts = [
      [copy.manufacturer, device.manufacturer],
      [copy.model, device.model],
      [copy.integration, device.integration],
      [copy.address, raw?.ip ?? null],
    ].filter((fact): fact is [string, string] => Boolean(fact[1]));

    return (
      <>
        {!isLocal && hub.home?.hub.status === 'offline' ? <Notice tone="warning">{copy.hubOffline}</Notice> : null}
        {isLocal && local.status !== 'online' ? <Notice tone="warning">{copy.gatewayOffline}</Notice> : null}
        {device.experimental ? <Notice tone="warning">{copy.experimental}</Notice> : null}
        {device.assumed ? <Notice tone="info">{copy.assumed}</Notice> : null}
        <DeviceCard device={device} onToggle={toggle} busy={deviceBusy === 'command'} error={errors[device.id]} />

        <NeonPanel style={styles.panel}>
          <PanelHeading title={copy.controlsTitle} iconSet="ionicons" iconName="options-outline" divider />
          {!device.online ? (
            <AppText variant="bodySmall" color={theme.colors.textSupport}>
              {copy.offline}
            </AppText>
          ) : null}
          <DeviceControl device={device} busy={deviceBusy === 'command'} onCommand={(next) => void ems.command(device, next)} />
          {raw && raw.category === 'climate' && hasControlSettings(raw) ? (
            <AppButton
              title={copy.acSettings}
              variant="secondary"
              height={SMALL_BUTTON_HEIGHT}
              onPress={() => navigation.navigate('AcControl', { deviceId: params.deviceId })}
              accessibilityHint={copy.acSettingsHint}
            />
          ) : null}
        </NeonPanel>

        <NeonPanel style={styles.panel}>
          <PanelHeading title={copy.detailsTitle} iconSet="ionicons" iconName="information-circle-outline" divider />
          {draftName !== null ? (
            <View style={styles.form}>
              <AppInput variant="field" label={copy.name} value={draftName} onChangeText={setDraftName} height={FIELD_HEIGHT} />
              <View style={styles.actions}>
                <AppButton
                  title={copy.save}
                  variant="gradient"
                  height={SMALL_BUTTON_HEIGHT}
                  loading={deviceBusy === 'edit'}
                  disabled={!draftName.trim()}
                  onPress={async () => {
                    if (await ems.update(device, { name: draftName.trim() })) setDraftName(null);
                  }}
                  style={styles.action}
                />
                <AppButton title={copy.cancel} variant="secondary" height={SMALL_BUTTON_HEIGHT} onPress={() => setDraftName(null)} style={styles.action} />
              </View>
            </View>
          ) : (
            <View style={styles.factRow}>
              <AppText variant="statValue" style={styles.flex} numberOfLines={2}>
                {device.name}
              </AppText>
              <AppButton
                title={copy.rename}
                variant="secondary"
                height={SMALL_BUTTON_HEIGHT}
                onPress={() => setDraftName(device.name)}
                style={styles.inlineButton}
              />
            </View>
          )}

          <AppText variant="statLabel" color={theme.colors.textSupport}>
            {copy.room}
          </AppText>
          <View style={styles.chips} accessibilityRole="radiogroup">
            <FilterChip
              role="radio"
              label={copy.noRoom}
              iconSet="material"
              iconName="home-outline"
              selected={device.roomId === null}
              onPress={() => device.roomId !== null && void ems.update(device, { roomId: null })}
            />
            {rooms.map((room) => {
              const glyph = roomGlyph(room);
              return (
                <FilterChip
                  key={room.id}
                  role="radio"
                  label={room.name}
                  iconSet={glyph.iconSet}
                  iconName={glyph.iconName}
                  selected={device.roomId === room.id}
                  onPress={() => device.roomId !== room.id && void ems.update(device, { roomId: room.id })}
                />
              );
            })}
          </View>

          {facts.map(([label, value]) => (
            <View key={label} style={styles.factRow}>
              <AppText variant="tileCaption" color={theme.colors.textSupport}>
                {label}
              </AppText>
              <AppText variant="tileCaption">{value}</AppText>
            </View>
          ))}
          {isLocal && local.role === 'owner' ? (
            <>
              {removeError ? <Notice tone="error">{removeError}</Notice> : null}
              <AppButton
                title={confirmRemove ? copy.confirmRemove : copy.remove}
                variant="secondary"
                height={SMALL_BUTTON_HEIGHT}
                onPress={() => void remove()}
                accessibilityHint={copy.removeHint}
              />
            </>
          ) : null}
        </NeonPanel>
      </>
    );
  };

  return (
    <ScreenWrapper backgroundSource={images.homeBackground} withScrim={false} backgroundOverlay={0.34}>
      <StatusBar style="light" />
      <View style={styles.flex}>
        <ScrollView
          contentContainerStyle={[styles.content, layout.contentStyle]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <PageHeader
            title={device?.name ?? copy.fallbackTitle}
            subtitle={device ? [device.room, kindLabel(device.kind)].filter(Boolean).join(' · ') : undefined}
            style={styles.header}
          />
          {renderBody()}
        </ScrollView>
        <BottomBar />
      </View>
    </ScreenWrapper>
  );
}
