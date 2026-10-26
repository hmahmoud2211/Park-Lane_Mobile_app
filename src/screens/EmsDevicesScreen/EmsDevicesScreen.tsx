import { useNavigation } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, View } from 'react-native';

import { AppButton } from '../../components/common/AppButton';
import { AppText } from '../../components/common/AppText';
import { EmsAccountPanel } from '../../components/ems/EmsAccountPanel';
import { DeviceCard } from '../../components/home/DeviceCard';
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
import { useHomeDevices } from '../../hooks/useHomeDevices';
import { useScreenLayout } from '../../hooks/useScreenLayout';
import { toggleCommand } from '../../services/home/capabilities';
import type { Device } from '../../types/home.types';
import type { RootStackScreenProps } from '../../types/navigation.types';
import { devicesCopy as copy } from './EmsDevicesScreen.data';
import { CARD_GAP, MIN_DEVICE_WIDTH, SMALL_BUTTON_HEIGHT, createStyles } from './EmsDevicesScreen.styles';

/**
 * The resident's devices, from their unit's hub. Switching goes through the
 * backend, so a card settles on the state the hub reports, and changes made
 * from another phone or on the device arrive live. A card opens the
 * device's own screen with all its controls.
 */
export function EmsDevicesScreen() {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const layout = useScreenLayout();
  const navigation = useNavigation<RootStackScreenProps<'EmsDevices'>['navigation']>();
  const ems = useHomeDevices();
  const { status, home, homeProblem, devices, devicesLoaded, realtime, refreshHome, busy, errors } = ems;
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refreshHome();
    setRefreshing(false);
  }, [refreshHome]);

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
        <AppText variant="bodySmall" color={theme.colors.textSupport}>
          {copy.empty}
        </AppText>
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
          refreshControl={
            status === 'signedIn' ? (
              <RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={theme.colors.textPrimary} />
            ) : undefined
          }
        >
          <PageHeader title={copy.title} subtitle={home?.unit.name ?? copy.subtitle} style={styles.header} />

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
                <PanelHeading title={copy.devicesTitle} iconSet="material" iconName="devices" divider />
                {renderDevices()}
              </NeonPanel>
            </>
          )}
        </ScrollView>
        <BottomBar />
      </View>
    </ScreenWrapper>
  );
}
