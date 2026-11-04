import { useNavigation } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, View } from 'react-native';

import { AppButton } from '../../components/common/AppButton';
import { AppText } from '../../components/common/AppText';
import { EmsAccountPanel } from '../../features/ems/components/EmsAccountPanel';
import { GatewayStatusRow } from '../../components/gateway/GatewayStatusRow';
import { DeviceCard } from '../../features/home/components/DeviceCard';
import { BottomBar } from '../../components/layout/BottomBar';
import { PageHeader } from '../../components/layout/PageHeader';
import { ResponsiveGrid } from '../../components/layout/ResponsiveGrid';
import { ScreenWrapper } from '../../components/layout/ScreenWrapper';
import { Notice } from '../../components/feedback/Notice';
import { NeonPanel } from '../../components/ui/NeonPanel';
import { PanelHeading } from '../../components/ui/PanelHeading';
import { StatusChip } from '../../components/ui/StatusChip';
import { images } from '../../constants/images';
import { useAppTheme } from '../../hooks/useAppTheme';
import { useGatewayDevices } from '../../hooks/useGatewayDevices';
import { useHomeDevices } from '../../features/home/hooks/useHomeDevices';
import { useLinkedAccounts } from '../../features/home/hooks/useLinkedAccounts';
import { useScreenLayout } from '../../hooks/useScreenLayout';
import { toggleCommand } from '../../features/home/services/capabilities';
import type { Device, LinkedAccount } from '../../types/home.types';
import type { RootStackScreenProps } from '../../types/navigation.types';
import { devicesCopy as copy } from './EmsDevicesScreen.data';
import { BUTTON_HEIGHT, CARD_GAP, MIN_DEVICE_WIDTH, SMALL_BUTTON_HEIGHT, createStyles } from './EmsDevicesScreen.styles';

/**
 * The resident's devices: first those their CUBE Gateway controls on the home
 * Wi-Fi, then those linked through the building's hub (brand cloud accounts,
 * through the EMS backend). Either way a card settles on the state the
 * device reports and changes made elsewhere arrive live; a card opens the
 * device's own screen. Adding a device always goes through Add Device.
 */
export function EmsDevicesScreen() {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const layout = useScreenLayout();
  const navigation = useNavigation<RootStackScreenProps<'EmsDevices'>['navigation']>();
  const ems = useHomeDevices();
  const { status, home, homeProblem, devices, devicesLoaded, realtime, refreshHome, busy, errors } = ems;
  const [refreshing, setRefreshing] = useState(false);
  const linked = useLinkedAccounts();
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const local = useGatewayDevices();
  const [showHidden, setShowHidden] = useState(false);

  const { hasHome, sync: syncAccounts } = linked;

  // Reloading the linked accounts is what brings in devices added in the brands' own apps.
  const { refresh: refreshLocal } = local;
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    const work: Promise<unknown>[] = [refreshLocal()];
    if (status === 'signedIn') {
      work.push((hasHome ? syncAccounts() : Promise.resolve()).then(() => refreshHome()));
    }
    await Promise.all(work);
    setRefreshing(false);
  }, [status, hasHome, syncAccounts, refreshHome, refreshLocal]);

  const reconnect = async (account: LinkedAccount) => {
    const step = await linked.reconnect(account);
    if (step) {
      navigation.navigate('ConnectAccount', { flowId: step.flowId });
    }
  };

  const unlink = (account: LinkedAccount) => {
    if (confirmRemove !== account.id) {
      setConfirmRemove(account.id);
      return;
    }
    setConfirmRemove(null);
    void linked.remove(account);
  };

  const renderAccount = (account: LinkedAccount) => (
    <View key={account.id} style={styles.account}>
      <View style={styles.accountRow}>
        <View style={styles.flex}>
          <AppText variant="statValue">{account.brand}</AppText>
          <AppText variant="tileCaption" color={theme.colors.textSupport}>
            {`${account.title} · ${copy.deviceCount(account.deviceCount)}`}
          </AppText>
        </View>
        {account.needsReconnect ? <StatusChip label={copy.needsReconnect} tone="amber" icon="alert-circle-outline" /> : null}
      </View>
      {account.problem ? (
        <AppText variant="tileCaption" color={theme.colors.error}>
          {account.problem}
        </AppText>
      ) : null}
      <View style={styles.accountActions}>
        {account.needsReconnect ? (
          <AppButton
            title={copy.reconnect}
            variant="gradient"
            height={SMALL_BUTTON_HEIGHT}
            loading={linked.busy[account.id]}
            onPress={() => void reconnect(account)}
            style={styles.accountAction}
          />
        ) : null}
        <AppButton
          title={confirmRemove === account.id ? copy.confirmRemove : copy.remove}
          variant="secondary"
          height={SMALL_BUTTON_HEIGHT}
          loading={linked.busy[account.id]}
          onPress={() => unlink(account)}
          accessibilityHint="Removes the account and its devices from your home"
          style={styles.accountAction}
        />
      </View>
    </View>
  );

  const liveLabel = realtime === 'live' ? copy.live : realtime === 'connecting' ? copy.connecting : copy.offline;
  const hubStatus = home?.hub.status;

  const renderDevice = (device: Device) => {
    const canToggle = toggleCommand(device, true) !== null;
    return (
      <DeviceCard
        device={device}
        busy={busy[device.id] === 'command'}
        error={errors[device.id]}
        onPress={() => navigation.navigate('DeviceDetail', { deviceId: device.id })}
        onToggle={
          canToggle
            ? (on) => {
                const next = toggleCommand(device, on);
                if (next) void ems.command(device, next);
              }
            : undefined
        }
      />
    );
  };

  const renderLocalDevice = (device: Device) => {
    const canToggle = toggleCommand(device, true) !== null;
    return (
      <DeviceCard
        device={device}
        busy={local.busy[device.id] === 'command'}
        error={local.errors[device.id]}
        onPress={() => navigation.navigate('DeviceDetail', { deviceId: device.id })}
        onToggle={
          canToggle
            ? (on) => {
                const next = toggleCommand(device, on);
                if (next) void local.command(device, next);
              }
            : undefined
        }
      />
    );
  };

  const renderLocal = () => {
    if (local.status === 'none') {
      return (
        <Notice
          tone="info"
          title={copy.noGatewayTitle}
          actions={
            <AppButton title={copy.connectGateway} variant="gradient" height={BUTTON_HEIGHT} onPress={() => navigation.navigate('GatewaySetup')} />
          }
        >
          {copy.noGatewayBody}
        </Notice>
      );
    }
    const hidden = new Set(local.rawDevices.filter((raw) => !raw.dashboard).map((raw) => `gw:${raw.id}`));
    const shown = showHidden ? local.devices : local.devices.filter((device) => !hidden.has(device.id));
    return (
      <>
        <GatewayStatusRow
          status={local.status}
          name={local.active?.name ?? null}
          detail={local.status === 'online' ? null : local.problem}
          manageLabel={copy.manageGateway}
          onManage={() => navigation.navigate('GatewaySetup')}
        />
        {local.status === 'online' && !local.devicesLoaded ? <ActivityIndicator color={theme.colors.textPrimary} /> : null}
        {hidden.size > 0 ? (
          <AppButton
            title={showHidden ? copy.hideHidden : copy.showHidden(hidden.size)}
            variant="secondary"
            height={SMALL_BUTTON_HEIGHT}
            onPress={() => setShowHidden((value) => !value)}
          />
        ) : null}
        {local.devicesLoaded && shown.length === 0 ? (
          <AppText variant="bodySmall" color={theme.colors.textSupport}>
            {copy.localEmpty}
          </AppText>
        ) : null}
        {shown.length > 0 ? (
          <ResponsiveGrid
            data={shown}
            keyExtractor={(device) => device.id}
            minItemWidth={MIN_DEVICE_WIDTH}
            maxColumns={2}
            gap={CARD_GAP - 6}
            renderItem={renderLocalDevice}
          />
        ) : null}
      </>
    );
  };

  const renderDevices = () => {
    if (!devicesLoaded) {
      return <ActivityIndicator color={theme.colors.textPrimary} accessibilityLabel="Loading devices" />;
    }
    if (homeProblem?.code === 'no_home' || homeProblem?.code === 'provisioning') {
      return (
        <Notice tone="info" title={homeProblem.code === 'no_home' ? copy.noHomeTitle : copy.provisioningTitle}>
          {homeProblem.message}
        </Notice>
      );
    }
    if (homeProblem && devices.length === 0) {
      return (
        <Notice
          tone="error"
          title={copy.loadFailed}
          actions={<AppButton title={copy.retry} variant="secondary" height={SMALL_BUTTON_HEIGHT} onPress={() => void refreshHome()} />}
        >
          {homeProblem.message}
        </Notice>
      );
    }
    if (devices.length === 0) {
      return (
        <>
          <AppText variant="bodySmall" color={theme.colors.textSupport}>
            {copy.empty}
          </AppText>
        </>
      );
    }
    return (
      <ResponsiveGrid
        data={devices}
        keyExtractor={(device) => device.id}
        minItemWidth={MIN_DEVICE_WIDTH}
        maxColumns={2}
        gap={CARD_GAP - 6}
        renderItem={renderDevice}
      />
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
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={theme.colors.textPrimary} />}
        >
          <PageHeader title={copy.title} subtitle={home?.unit.name ?? copy.subtitle} style={styles.header} />

          <NeonPanel style={styles.panel}>
            <PanelHeading
              title={copy.localTitle}
              iconSet="ionicons"
              iconName="wifi-outline"
              subtitle={copy.localIntro}
              actionLabel={copy.add}
              onActionPress={() => navigation.navigate('AddDevice')}
              divider
            />
            {renderLocal()}
          </NeonPanel>

          {status !== 'signedIn' ? (
            <EmsAccountPanel intro={copy.accountIntroHub} />
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
              {hubStatus && hubStatus !== 'provisioning' ? (
                <View style={styles.live}>
                  <StatusChip
                    label={hubStatus === 'online' ? copy.hubOnline : hubStatus === 'auth_failed' ? copy.hubAuth : copy.hubOffline}
                    tone={hubStatus === 'online' ? 'teal' : hubStatus === 'auth_failed' ? 'red' : 'amber'}
                    icon="home-outline"
                  />
                </View>
              ) : null}

              <NeonPanel style={styles.panel}>
                <PanelHeading
                  title={copy.hubTitle}
                  iconSet="material"
                  iconName="devices"
                  // Every way of adding a device starts at Add Device; cloud linking is one of its methods.
                  actionLabel={home && home.hub.status !== 'provisioning' ? copy.add : undefined}
                  onActionPress={() => navigation.navigate('AddDevice')}
                  divider
                />
                {renderDevices()}
                {linked.hasHome ? (
                  <AppButton
                    title={copy.refresh}
                    variant="secondary"
                    height={SMALL_BUTTON_HEIGHT}
                    loading={refreshing}
                    onPress={() => void onRefresh()}
                    accessibilityHint={copy.refreshHint}
                  />
                ) : null}
              </NeonPanel>

              {linked.hasHome ? (
                <NeonPanel style={styles.panel}>
                  <PanelHeading title={copy.accountsTitle} iconSet="ionicons" iconName="link-outline" divider />
                  {linked.error ? <Notice tone="error">{linked.error}</Notice> : null}
                  {linked.loaded && linked.accounts.length === 0 ? (
                    <AppText variant="bodySmall" color={theme.colors.textSupport}>
                      {copy.accountsEmpty}
                    </AppText>
                  ) : null}
                  {linked.accounts.map(renderAccount)}
                  <AppButton title={copy.connect} variant="gradient" height={BUTTON_HEIGHT} onPress={() => navigation.navigate('AddDevice')} />
                </NeonPanel>
              ) : null}
            </>
          )}
        </ScrollView>
        <BottomBar />
      </View>
    </ScreenWrapper>
  );
}
