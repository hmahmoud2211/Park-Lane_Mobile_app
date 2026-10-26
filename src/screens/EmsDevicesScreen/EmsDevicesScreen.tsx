import { StatusBar } from 'expo-status-bar';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, View } from 'react-native';

import { AppButton } from '../../components/common/AppButton';
import { AppInput } from '../../components/common/AppInput';
import { AppText } from '../../components/common/AppText';
import { EmsAccountPanel } from '../../components/ems/EmsAccountPanel';
import { SmartDeviceCard } from '../../components/ems/SmartDeviceCard';
import { BottomBar } from '../../components/layout/BottomBar';
import { PageHeader } from '../../components/layout/PageHeader';
import { ResponsiveGrid } from '../../components/layout/ResponsiveGrid';
import { ScreenWrapper } from '../../components/layout/ScreenWrapper';
import { Notice } from '../../components/parking/Notice';
import { NeonPanel } from '../../components/ui/NeonPanel';
import { PanelHeading } from '../../components/ui/PanelHeading';
import { StatusChip } from '../../components/ui/StatusChip';
import { images } from '../../constants/images';
import { useAppTheme } from '../../hooks/useAppTheme';
import { useEmsDevices } from '../../hooks/useEmsDevices';
import { useScreenLayout } from '../../hooks/useScreenLayout';
import type { SmartDevice } from '../../types/ems.types';
import { devicesCopy as copy } from './EmsDevicesScreen.data';
import { CARD_GAP, FIELD_HEIGHT, MIN_DEVICE_WIDTH, SMALL_BUTTON_HEIGHT, createStyles } from './EmsDevicesScreen.styles';

interface Draft {
  name: string;
  room: string;
}

/**
 * The resident's devices. Switching goes through the backend, so the card
 * shows the state the device confirmed, and changes made from another phone
 * or on the device arrive live.
 */
export function EmsDevicesScreen() {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const layout = useScreenLayout();
  const ems = useEmsDevices();
  const { status, devices, devicesLoaded, devicesError, realtime, refreshDevices, busy, errors } = ems;

  const [editing, setEditing] = useState<Record<string, Draft>>({});
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refreshDevices();
    setRefreshing(false);
  }, [refreshDevices]);


  const saveEdit = useCallback(
    async (device: SmartDevice) => {
      const draft = editing[device.id];
      if (!draft?.name.trim()) {
        return;
      }
      const updated = await ems.update(device, { name: draft.name.trim(), room: draft.room.trim() || null });
      if (updated) {
        setEditing(({ [device.id]: _done, ...rest }) => rest);
      }
    },
    [editing, ems],
  );

  const removeDevice = useCallback(
    async (device: SmartDevice) => {
      if (confirmRemove !== device.id) {
        setConfirmRemove(device.id);
        return;
      }
      setConfirmRemove(null);
      await ems.remove(device);
    },
    [confirmRemove, ems],
  );

  const liveLabel = realtime === 'live' ? copy.live : realtime === 'connecting' ? copy.connecting : copy.offline;

  const renderDevice = (device: SmartDevice) => {
    const draft = editing[device.id];
    const deviceBusy = busy[device.id];
    return (
      <SmartDeviceCard
        device={device}
        busy={deviceBusy === 'power'}
        error={errors[device.id]}
        onToggle={(on) => void ems.setPower(device, on)}
      >
        {draft ? (
          <View style={styles.form}>
            <AppInput
              variant="field"
              label={copy.name}
              value={draft.name}
              onChangeText={(name) => setEditing((current) => ({ ...current, [device.id]: { ...draft, name } }))}
              height={FIELD_HEIGHT}
            />
            <AppInput
              variant="field"
              label={copy.room}
              value={draft.room}
              onChangeText={(room) => setEditing((current) => ({ ...current, [device.id]: { ...draft, room } }))}
              height={FIELD_HEIGHT}
            />
            <View style={styles.actions}>
              <AppButton
                title={copy.save}
                variant="gradient"
                height={SMALL_BUTTON_HEIGHT}
                loading={deviceBusy === 'edit'}
                onPress={() => void saveEdit(device)}
                style={styles.action}
              />
              <AppButton
                title={copy.cancel}
                variant="secondary"
                height={SMALL_BUTTON_HEIGHT}
                onPress={() => setEditing(({ [device.id]: _done, ...rest }) => rest)}
                style={styles.action}
              />
            </View>
          </View>
        ) : (
          <View style={styles.actions}>
            <AppButton
              title={copy.rename}
              variant="secondary"
              height={SMALL_BUTTON_HEIGHT}
              onPress={() =>
                setEditing((current) => ({ ...current, [device.id]: { name: device.name, room: device.room ?? '' } }))
              }
              style={styles.action}
            />
            <AppButton
              title={confirmRemove === device.id ? copy.confirmRemove : copy.remove}
              variant="secondary"
              height={SMALL_BUTTON_HEIGHT}
              loading={deviceBusy === 'remove'}
              onPress={() => void removeDevice(device)}
              accessibilityHint="Removes the device from your home"
              style={styles.action}
            />
          </View>
        )}
      </SmartDeviceCard>
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
          refreshControl={
            status === 'signedIn' ? (
              <RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={theme.colors.textPrimary} />
            ) : undefined
          }
        >
          <PageHeader title={copy.title} subtitle={copy.subtitle} style={styles.header} />

          {status !== 'signedIn' ? (
            <EmsAccountPanel intro={copy.accountIntro} />
          ) : (
            <>
              <View style={styles.live} accessibilityLiveRegion="polite">
                <StatusChip
                  label={realtime === 'live' ? 'Live' : realtime === 'connecting' ? 'Connecting' : 'Offline'}
                  tone={realtime === 'live' ? 'teal' : realtime === 'connecting' ? 'slate' : 'amber'}
                  icon={realtime === 'live' ? 'radio-outline' : 'cloud-offline-outline'}
                />
                <AppText variant="tileCaption" color={theme.colors.textSupport} style={styles.flex}>
                  {liveLabel}
                </AppText>
              </View>


              <NeonPanel style={styles.panel}>
                <PanelHeading
                  title={copy.devicesTitle}
                  iconSet="material"
                  iconName="devices"
                  divider
                />
                {!devicesLoaded ? (
                  <ActivityIndicator color={theme.colors.textPrimary} accessibilityLabel="Loading devices" />
                ) : devicesError && devices.length === 0 ? (
                  <Notice
                    tone="error"
                    title={copy.loadFailed}
                    actions={<AppButton title={copy.retry} variant="secondary" height={SMALL_BUTTON_HEIGHT} onPress={() => void refreshDevices()} />}
                  >
                    {devicesError}
                  </Notice>
                ) : devices.length === 0 ? (
                  <AppText variant="bodySmall" color={theme.colors.textSupport}>
                    {copy.empty}
                  </AppText>
                ) : (
                  <ResponsiveGrid
                    data={devices}
                    keyExtractor={(device) => device.id}
                    minItemWidth={MIN_DEVICE_WIDTH}
                    maxColumns={2}
                    gap={CARD_GAP - 6}
                    renderItem={renderDevice}
                  />
                )}
              </NeonPanel>
            </>
          )}
        </ScrollView>
        <BottomBar />
      </View>
    </ScreenWrapper>
  );
}
