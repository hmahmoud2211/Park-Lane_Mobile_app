import { useNavigation, useRoute } from '@react-navigation/native';
import { useMemo, useState } from 'react';
import { View } from 'react-native';

import { AppButton } from '../../components/common/AppButton';
import { AppInput } from '../../components/common/AppInput';
import { AppText } from '../../components/common/AppText';
import { EmsAccountPanel } from '../../features/ems/components/EmsAccountPanel';
import { ChoiceGroup } from '../../features/home/components/ControlParts';
import { DeviceControl } from '../../features/home/components/DeviceControl';
import { PageHeader } from '../../components/layout/PageHeader';
import { ResponsiveColumns } from '../../components/layout/ResponsiveColumns';
import { LoadingState } from '../../components/feedback/LoadingState';
import { Notice } from '../../components/feedback/Notice';
import { NeonPanel } from '../../components/ui/NeonPanel';
import { PanelHeading } from '../../components/ui/PanelHeading';
import { useAppTheme } from '../../hooks/useAppTheme';
import { useGatewayDevices } from '../../features/gateway/hooks/useGatewayDevices';
import { useHomeDevices } from '../../features/home/hooks/useHomeDevices';
import { kindLabel, roomGlyph } from '../../features/home/services/capabilities';
import * as gatewayApi from '../../features/gateway/services/gatewayApi';
import { hasControlSettings, isGatewayDeviceId, toGatewayDeviceId } from '../../features/gateway/services/deviceMapping';
import { errorMessage } from '../../features/gateway/services/gatewayHttp';
import type { RootStackScreenProps } from '../../types/navigation.types';
import { NO_ROOM, deviceDetailCopy as copy } from './DeviceDetailScreen.data';
import { BUTTON_HEIGHT, CARD_GAP, FIELD_HEIGHT, createStyles } from './DeviceDetailScreen.styles';
import { InnerScreenFrame } from '../../components/layout/InnerScreenFrame';

/**
 * One device: what it is doing and its one obvious control at the top, then its other
 * controls and settings (DeviceControl), then its name, room and where it comes from.
 * Commands show at once and settle on what the device reports; changes made elsewhere
 * arrive live. A device is either the building hub's (through EmsContext) or the
 * resident's CUBE Gateway's (GatewayContext, ids prefixed `gw:`), and each action goes to
 * the backend it belongs to.
 */
export function DeviceDetailScreen() {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
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
      // Still connecting or reading the list (e.g. opened from a link or just after launch): not "missing" yet.
      const stillLoading = isLocal
        ? local.status === 'loading' || local.status === 'connecting' || local.account.state === 'connecting'
        : !hub.devicesLoaded;
      if (stillLoading) {
        return <LoadingState label={isLocal ? copy.connectingHub : copy.loadingDevice} announce />;
      }
      return (
        <Notice
          tone="error"
          title={copy.missingTitle}
          actions={<AppButton title={copy.back} variant="secondary" height={BUTTON_HEIGHT} onPress={() => navigation.goBack()} />}
        >
          {copy.missingBody}
        </Notice>
      );
    }
    const deviceBusy = busy[device.id];
    const facts = [
      [copy.manufacturer, device.manufacturer],
      [copy.model, device.model],
      [copy.integration, device.integration],
      [copy.address, raw?.ip ?? null],
    ].filter((fact): fact is [string, string] => Boolean(fact[1]));
    const roomChoices = [
      { value: NO_ROOM, label: copy.noRoom, icon: 'home-outline' },
      ...rooms.map((room) => ({ value: room.id, label: room.name, icon: roomGlyph(room).iconName })),
    ];

    return (
      <ResponsiveColumns gap={CARD_GAP} weights={[3, 2]}>
        <>
          {!isLocal && hub.home?.hub.status === 'offline' ? <Notice tone="warning">{copy.hubOffline}</Notice> : null}
          {isLocal && local.status !== 'online' ? <Notice tone="warning">{copy.gatewayOffline}</Notice> : null}
          {device.experimental ? <Notice tone="warning">{copy.experimental}</Notice> : null}
          {device.assumed ? <Notice tone="info">{copy.assumed}</Notice> : null}
          <DeviceControl
            device={device}
            busy={deviceBusy === 'command'}
            error={errors[device.id]}
            onCommand={(next) => void ems.command(device, next)}
            footer={
              raw && raw.category === 'climate' && hasControlSettings(raw) ? (
                <AppButton
                  title={copy.acSettings}
                  variant="secondary"
                  height={BUTTON_HEIGHT}
                  labelVariant="controlLabel"
                  onPress={() => navigation.navigate('AcControl', { deviceId: params.deviceId })}
                  accessibilityHint={copy.acSettingsHint}
                />
              ) : null
            }
          />
        </>

        <NeonPanel style={styles.panel}>
          <PanelHeading title={copy.detailsTitle} iconSet="ionicons" iconName="information-circle-outline" divider />
          {draftName !== null ? (
            <View style={styles.form}>
              <AppInput variant="field" label={copy.name} value={draftName} onChangeText={setDraftName} height={FIELD_HEIGHT} />
              <View style={styles.actions}>
                <AppButton
                  title={copy.save}
                  variant="gradient"
                  height={BUTTON_HEIGHT}
                  labelVariant="controlLabel"
                  loading={deviceBusy === 'edit'}
                  disabled={!draftName.trim()}
                  onPress={async () => {
                    if (await ems.update(device, { name: draftName.trim() })) setDraftName(null);
                  }}
                  style={styles.action}
                />
                <AppButton
                  title={copy.cancel}
                  variant="secondary"
                  height={BUTTON_HEIGHT}
                  labelVariant="controlLabel"
                  onPress={() => setDraftName(null)}
                  style={styles.action}
                />
              </View>
            </View>
          ) : (
            <View style={styles.factRow}>
              <AppText variant="controlLabel" style={styles.flex} numberOfLines={2}>
                {device.name}
              </AppText>
              <AppButton
                title={copy.rename}
                variant="secondary"
                height={BUTTON_HEIGHT}
                labelVariant="controlLabel"
                onPress={() => setDraftName(device.name)}
                accessibilityLabel={`${copy.rename} ${device.name}`}
                style={styles.inlineButton}
              />
            </View>
          )}

          <ChoiceGroup
            label={copy.room}
            choices={roomChoices}
            selected={device.roomId ?? NO_ROOM}
            waiting={deviceBusy === 'edit'}
            onPick={(value) => {
              const roomId = value === NO_ROOM ? null : value;
              if (roomId !== device.roomId) void ems.update(device, { roomId });
            }}
          />

          {facts.map(([label, value]) => (
            <View key={label} style={styles.factRow}>
              <AppText variant="controlCaption" color={theme.colors.textSupport}>
                {label}
              </AppText>
              <AppText variant="controlCaption" style={styles.factValue}>
                {value}
              </AppText>
            </View>
          ))}
          {isLocal && local.role === 'owner' ? (
            <>
              {removeError ? <Notice tone="error">{removeError}</Notice> : null}
              <AppButton
                title={confirmRemove ? copy.confirmRemove : copy.remove}
                variant="secondary"
                height={BUTTON_HEIGHT}
                labelVariant="controlLabel"
                onPress={() => void remove()}
                accessibilityHint={copy.removeHint}
              />
            </>
          ) : null}
        </NeonPanel>
      </ResponsiveColumns>
    );
  };

  return (
    <InnerScreenFrame contentStyle={styles.content}>
      <PageHeader
        title={device?.name ?? copy.fallbackTitle}
        subtitle={device ? [device.room, kindLabel(device.kind)].filter(Boolean).join(' · ') : undefined}
        style={styles.header}
      />
      {renderBody()}
    </InnerScreenFrame>
  );
}
