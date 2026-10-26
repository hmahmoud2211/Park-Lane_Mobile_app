import { useNavigation } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, View } from 'react-native';

import { AppButton } from '../../components/common/AppButton';
import { AppInput } from '../../components/common/AppInput';
import { AppText } from '../../components/common/AppText';
import { ToggleSwitch } from '../../components/common/ToggleSwitch';
import { EmsAccountPanel } from '../../components/ems/EmsAccountPanel';
import { SmartDeviceCard } from '../../components/ems/SmartDeviceCard';
import { BottomBar } from '../../components/layout/BottomBar';
import { PageHeader } from '../../components/layout/PageHeader';
import { ResponsiveGrid } from '../../components/layout/ResponsiveGrid';
import { ScreenWrapper } from '../../components/layout/ScreenWrapper';
import { Notice } from '../../components/parking/Notice';
import { FilterChip } from '../../components/ui/FilterChip';
import { NeonPanel } from '../../components/ui/NeonPanel';
import { PanelHeading } from '../../components/ui/PanelHeading';
import { StatusChip } from '../../components/ui/StatusChip';
import { images } from '../../constants/images';
import { useAppTheme } from '../../hooks/useAppTheme';
import { useEmsDevices } from '../../hooks/useEmsDevices';
import { useScreenLayout } from '../../hooks/useScreenLayout';
import { EmsError } from '../../services/ems/emsApi';
import type { SmartDevice, SmartDeviceType } from '../../types/ems.types';
import type { RootStackScreenProps } from '../../types/navigation.types';
import { addOptions, devicesCopy as copy, virtualTypes, type AddOption } from './EmsDevicesScreen.data';
import {
  BUTTON_HEIGHT,
  CARD_GAP,
  FIELD_HEIGHT,
  MIN_DEVICE_WIDTH,
  SMALL_BUTTON_HEIGHT,
  createStyles,
} from './EmsDevicesScreen.styles';

interface Draft {
  name: string;
  room: string;
}

/**
 * Every device registered in EMS, the same list Alexa uses. Switching goes
 * through the backend's controller, so the card shows the state the device
 * confirmed, and changes made by Alexa or another phone arrive live.
 */
export function EmsDevicesScreen() {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const layout = useScreenLayout();
  const navigation = useNavigation<RootStackScreenProps<'EmsDevices'>['navigation']>();
  const ems = useEmsDevices();
  const { status, devices, devicesLoaded, devicesError, realtime, refreshDevices, busy, errors } = ems;

  const [adding, setAdding] = useState<AddOption['id'] | null>(null);
  const [newName, setNewName] = useState('');
  const [newRoom, setNewRoom] = useState('');
  const [newType, setNewType] = useState<SmartDeviceType>('switch');
  const [addBusy, setAddBusy] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Record<string, Draft>>({});
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refreshDevices();
    setRefreshing(false);
  }, [refreshDevices]);

  const addVirtual = useCallback(async () => {
    if (!newName.trim()) {
      setAddError('Give the switch a name, e.g. “Bedroom light”.');
      return;
    }
    setAddBusy(true);
    setAddError(null);
    try {
      await ems.addVirtual({ name: newName.trim(), room: newRoom.trim() || undefined, type: newType });
      setNewName('');
      setNewRoom('');
      setAdding(null);
    } catch (error) {
      setAddError(error instanceof EmsError ? error.message : 'The switch could not be added.');
    } finally {
      setAddBusy(false);
    }
  }, [ems, newName, newRoom, newType]);

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
            {device.simulated ? (
              <View style={[styles.toggleRow, styles.flex]}>
                <AppText variant="tileCaption" color={theme.colors.textSupport}>
                  {copy.simulateOffline}
                </AppText>
                <ToggleSwitch
                  value={!device.online}
                  onValueChange={(offline) => void ems.update(device, { online: !offline })}
                  accessibilityLabel={`${copy.simulateOffline}: ${device.name}`}
                />
              </View>
            ) : null}
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
              accessibilityHint="Removes the device from EMS and from Alexa"
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

              {adding ? (
                <NeonPanel style={styles.panel}>
                  <PanelHeading
                    title={copy.addTitle}
                    iconSet="ionicons"
                    iconName="add-circle-outline"
                    actionLabel={copy.close}
                    onActionPress={() => setAdding(null)}
                    divider
                  />
                  <View style={styles.chips} accessibilityRole="radiogroup">
                    {addOptions.map((option) => (
                      <FilterChip
                        key={option.id}
                        role="radio"
                        label={option.label}
                        iconSet="ionicons"
                        iconName={option.iconName}
                        selected={adding === option.id}
                        onPress={() => setAdding(option.id)}
                      />
                    ))}
                  </View>
                  {adding === 'virtual' ? (
                    <View style={styles.form}>
                      <AppText variant="bodySmall" color={theme.colors.textSupport}>
                        {copy.virtualNote}
                      </AppText>
                      <View style={styles.chips} accessibilityRole="radiogroup">
                        {virtualTypes.map((type) => (
                          <FilterChip
                            key={type.id}
                            role="radio"
                            label={type.label}
                            iconSet="ionicons"
                            iconName={type.iconName}
                            selected={newType === type.id}
                            onPress={() => setNewType(type.id)}
                          />
                        ))}
                      </View>
                      <AppInput variant="field" label={copy.name} value={newName} onChangeText={setNewName} height={FIELD_HEIGHT} />
                      <AppInput variant="field" label={copy.room} value={newRoom} onChangeText={setNewRoom} height={FIELD_HEIGHT} />
                      {addError ? (
                        <AppText variant="tileCaption" color={theme.colors.error} accessibilityRole="alert">
                          {addError}
                        </AppText>
                      ) : null}
                      <AppButton
                        title={copy.addVirtual}
                        variant="gradient"
                        height={BUTTON_HEIGHT}
                        loading={addBusy}
                        disabled={addBusy}
                        onPress={() => void addVirtual()}
                      />
                    </View>
                  ) : (
                    <View style={styles.form}>
                      <AppText variant="bodySmall" color={theme.colors.textSupport}>
                        {copy.sonoffNote}
                      </AppText>
                      <AppButton
                        title={copy.startPairing}
                        variant="gradient"
                        height={BUTTON_HEIGHT}
                        onPress={() => navigation.navigate('SonoffPairing')}
                      />
                    </View>
                  )}
                </NeonPanel>
              ) : null}

              <NeonPanel style={styles.panel}>
                <PanelHeading
                  title={copy.devicesTitle}
                  iconSet="material"
                  iconName="devices"
                  actionLabel={adding ? undefined : copy.add}
                  onActionPress={adding ? undefined : () => setAdding('virtual')}
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
