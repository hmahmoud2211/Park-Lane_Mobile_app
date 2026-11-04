import { useNavigation, useRoute } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';

import { AppButton } from '../../components/common/AppButton';
import { AppIcon } from '../../components/common/AppIcon';
import { AppInput } from '../../components/common/AppInput';
import { AppText } from '../../components/common/AppText';
import { ToggleSwitch } from '../../components/common/ToggleSwitch';
import { DeviceCard } from '../../features/home/components/DeviceCard';
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
import { useScreenLayout } from '../../hooks/useScreenLayout';
import { kindLabel } from '../../features/home/services/capabilities';
import * as api from '../../features/gateway/services/gatewayApi';
import { toAppDeviceId } from '../../features/gateway/services/deviceMapping';
import { errorMessage } from '../../features/gateway/services/gatewayHttp';
import type { RootStackScreenProps } from '../../types/navigation.types';
import { capabilityLabels, deviceSetupCopy as copy } from './DeviceSetupScreen.data';
import { BUTTON_HEIGHT, FIELD_HEIGHT, SMALL_BUTTON_HEIGHT, createStyles } from './DeviceSetupScreen.styles';

type TestOutcome = { tone: 'success' | 'warning' | 'error' | 'info'; text: string };

/**
 * Add Device, Screen 4: a device the gateway has just paired. Name it, put it
 * in a room, choose whether it shows on the dashboard, and check live control
 * works. The check says "Working" only when the gateway reports the device
 * confirmed the change; for devices that give no feedback it says so.
 */
export function DeviceSetupScreen() {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const layout = useScreenLayout();
  const navigation = useNavigation<RootStackScreenProps<'DeviceSetup'>['navigation']>();
  const { params } = useRoute<RootStackScreenProps<'DeviceSetup'>['route']>();
  const gateway = useGatewayDevices();
  const { target, devices, rooms, rawDevices, upsertDevice, busy, errors } = gateway;
  const raw = rawDevices.find((entry) => entry.id === params.deviceId);
  const device = devices.find((entry) => entry.id === toAppDeviceId(params.deviceId));
  const [draftName, setDraftName] = useState<string | null>(null);
  const [newRoom, setNewRoom] = useState('');
  const [roomError, setRoomError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [outcome, setOutcome] = useState<TestOutcome | null>(null);

  const name = draftName ?? device?.name ?? '';

  const addRoom = async () => {
    if (!target || !device || !newRoom.trim()) return;
    setRoomError(null);
    try {
      const room = await api.createRoom(target, newRoom.trim());
      setNewRoom('');
      await gateway.update(device, { roomId: room.id });
      void gateway.refresh();
    } catch (error) {
      setRoomError(errorMessage(error, 'The room could not be added.'));
    }
  };

  const test = async () => {
    if (!target || !raw || !device) return;
    setTesting(true);
    setOutcome(null);
    try {
      if (raw.commands.includes('toggle')) {
        const response = await api.sendCommand(target, raw.id, { command: 'toggle', params: {} });
        upsertDevice(response.device);
        const status = response.result.status;
        setOutcome(
          status === 'confirmed'
            ? { tone: 'success', text: copy.testWorking }
            : status === 'assumed'
              ? { tone: 'warning', text: copy.testAssumed }
              : { tone: 'info', text: copy.testPending },
        );
      } else {
        const fresh = await api.refreshDevice(target, raw.id);
        upsertDevice(fresh);
        setOutcome(
          fresh.connection.status === 'connected' || fresh.connection.status === 'experimental'
            ? { tone: 'success', text: copy.testRead }
            : { tone: 'error', text: fresh.connection.last_error ?? copy.testOffline },
        );
      }
    } catch (error) {
      setOutcome({ tone: 'error', text: errorMessage(error, copy.testOffline) });
    } finally {
      setTesting(false);
    }
  };

  const renderBody = () => {
    if (!target) {
      return <Notice tone="warning">{copy.offline}</Notice>;
    }
    if (!device || !raw) {
      return (
        <Notice
          tone="error"
          title={copy.missingTitle}
          actions={<AppButton title={copy.done} variant="secondary" height={SMALL_BUTTON_HEIGHT} onPress={() => navigation.navigate('EmsDevices')} />}
        >
          {copy.missingBody}
        </Notice>
      );
    }
    const editing = busy[device.id] === 'edit';
    const types = [...new Set(raw.capabilities.map((capability) => capability.type))];

    return (
      <>
        {raw.experimental ? <Notice tone="warning">{copy.experimental}</Notice> : null}
        <DeviceCard device={device} busy={busy[device.id] === 'command'} error={errors[device.id]} />

        <NeonPanel style={styles.panel}>
          <PanelHeading title={copy.nameTitle} iconSet="ionicons" iconName="create-outline" divider />
          <AppInput variant="field" label={copy.nameLabel} value={name} onChangeText={setDraftName} height={FIELD_HEIGHT} maxLength={64} />
          <AppButton
            title={copy.save}
            variant="secondary"
            height={SMALL_BUTTON_HEIGHT}
            loading={editing}
            disabled={!name.trim() || name.trim() === device.name}
            onPress={async () => {
              if (await gateway.update(device, { name: name.trim() })) setDraftName(null);
            }}
          />
        </NeonPanel>

        <NeonPanel style={styles.panel}>
          <PanelHeading title={copy.roomTitle} iconSet="material" iconName="door" divider />
          <View style={styles.chips} accessibilityRole="radiogroup">
            <FilterChip
              role="radio"
              label={copy.noRoom}
              iconSet="material"
              iconName="home-outline"
              selected={device.roomId === null}
              onPress={() => device.roomId !== null && void gateway.update(device, { roomId: null })}
            />
            {rooms.map((room) => (
              <FilterChip
                key={room.id}
                role="radio"
                label={room.name}
                iconSet="material"
                iconName="door"
                selected={device.roomId === room.id}
                onPress={() => device.roomId !== room.id && void gateway.update(device, { roomId: room.id })}
              />
            ))}
          </View>
          <View style={styles.row}>
            <View style={styles.flex}>
              <AppInput variant="field" label={copy.newRoomLabel} value={newRoom} onChangeText={setNewRoom} height={FIELD_HEIGHT} maxLength={40} error={roomError ?? undefined} />
            </View>
            <AppButton
              title={copy.addRoom}
              variant="secondary"
              height={SMALL_BUTTON_HEIGHT}
              disabled={!newRoom.trim()}
              onPress={() => void addRoom()}
              style={styles.inlineButton}
            />
          </View>
        </NeonPanel>

        <NeonPanel style={styles.panel}>
          <PanelHeading title={copy.capabilitiesTitle} iconSet="ionicons" iconName="options-outline" divider />
          {types.length === 0 ? (
            <AppText variant="bodySmall" color={theme.colors.textSupport}>
              {copy.noCapabilities}
            </AppText>
          ) : (
            types.map((type) => (
              <View key={type} style={styles.bullet}>
                <AppIcon set="ionicons" name="checkmark-outline" size={16} color={theme.colors.success} />
                <AppText variant="tileCaption">{capabilityLabels[type] ?? type}</AppText>
              </View>
            ))
          )}
          {raw.readings.map((reading) => (
            <View key={reading.key} style={styles.bullet}>
              <AppIcon set="ionicons" name="analytics-outline" size={16} color={theme.colors.textSupport} />
              <AppText variant="tileCaption" color={theme.colors.textSupport}>
                {reading.label}
              </AppText>
            </View>
          ))}
          <View style={styles.row}>
            <View style={styles.flex}>
              <AppText variant="statValue">{copy.dashboardTitle}</AppText>
              <AppText variant="tileCaption" color={theme.colors.textSupport}>
                {copy.dashboardHint}
              </AppText>
            </View>
            <ToggleSwitch
              value={raw.dashboard}
              onValueChange={(next) => void gateway.update(device, { dashboard: next })}
              disabled={editing}
              accessibilityLabel={copy.dashboardTitle}
            />
          </View>
        </NeonPanel>

        <NeonPanel style={styles.panel}>
          <PanelHeading title={copy.testTitle} iconSet="ionicons" iconName="pulse-outline" divider />
          <AppText variant="bodySmall" color={theme.colors.textSupport}>
            {copy.testIntro}
          </AppText>
          {outcome ? <Notice tone={outcome.tone}>{outcome.text}</Notice> : null}
          <AppButton title={copy.test} variant="secondary" height={BUTTON_HEIGHT} loading={testing} onPress={() => void test()} />
        </NeonPanel>

        <AppButton title={copy.done} variant="gradient" height={BUTTON_HEIGHT} onPress={() => navigation.navigate('EmsDevices')} />
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
            title={device ? copy.title : copy.fallbackTitle}
            subtitle={device ? [device.name, kindLabel(device.kind)].join(' · ') : undefined}
            style={styles.header}
          />
          {renderBody()}
        </ScrollView>
        <BottomBar />
      </View>
    </ScreenWrapper>
  );
}
