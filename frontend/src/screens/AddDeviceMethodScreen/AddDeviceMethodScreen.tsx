import { useNavigation, useRoute } from '@react-navigation/native';
import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';

import { AppButton } from '../../components/common/AppButton';
import { AppIcon } from '../../components/common/AppIcon';
import { AppText } from '../../components/common/AppText';
import { MethodChips } from '../../features/gateway/components/RequirementChips';
import { PageHeader } from '../../components/layout/PageHeader';
import { Notice } from '../../components/feedback/Notice';
import { NeonPanel } from '../../components/ui/NeonPanel';
import { PanelHeading } from '../../components/ui/PanelHeading';
import { useAppTheme } from '../../hooks/useAppTheme';
import { LG_PLUGIN_ID } from '../../features/lg/hooks/useLgPairing';
import { useBrands } from '../../features/gateway/hooks/useBrands';
import { useEms } from '../../features/ems/hooks/useEms';
import { useGateway } from '../../features/gateway/hooks/useGateway';
import * as homeApi from '../../features/home/services/homeApi';
import type { ConnectionMethod, MethodGroup } from '../../types/gateway.types';
import type { Integration } from '../../types/home.types';
import type { RootStackScreenProps } from '../../types/navigation.types';
import { addDeviceMethodCopy as copy, cloudIntegrations, groupCopy } from './AddDeviceMethodScreen.data';
import { BUTTON_HEIGHT, createStyles } from './AddDeviceMethodScreen.styles';
import { InnerScreenFrame } from '../../components/layout/InnerScreenFrame';
import { SelectableCard } from '../../components/ui/SelectableCard';
import { ErrorNotice } from '../../components/feedback/ErrorNotice';
import { LoadingState } from '../../components/feedback/LoadingState';
import { readyHome } from '../../features/ems/services/readyHome';

const GROUPS: readonly MethodGroup[] = ['existing', 'new', 'advanced'];
const CHEVRON_SIZE = 18;

/**
 * Add Device, Screen 2: how to connect a device of the chosen brand. The
 * gateway decides which methods exist and whether each works here (an LG
 * appliance needs ReThink, a Kasa setup needs the gateway's Wi-Fi radio);
 * unavailable ones stay visible with the reason. When the building's hub can
 * link the brand's cloud account, that is offered last, clearly labelled.
 */
export function AddDeviceMethodScreen() {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const navigation = useNavigation<RootStackScreenProps<'AddDeviceMethod'>['navigation']>();
  const { params } = useRoute<RootStackScreenProps<'AddDeviceMethod'>['route']>();
  const gateway = useGateway();
  const ems = useEms();
  const { brands, error, reload } = useBrands();
  const brand = brands?.find((entry) => entry.id === params.brandId) ?? null;
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const hasHub = readyHome(ems.status, ems.home) !== null;

  useEffect(() => {
    if (!hasHub || !cloudIntegrations[params.brandId]) {
      return;
    }
    let cancelled = false;
    homeApi.listIntegrations().then(
      (list) => {
        if (!cancelled) setIntegrations(list);
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [hasHub, params.brandId]);

  const cloud = integrations.filter((entry) => entry.available && cloudIntegrations[params.brandId]?.includes(entry.id));

  const open = (method: ConnectionMethod) => {
    if (!brand || !method.available) {
      return;
    }
    if (method.id.startsWith('find:')) {
      navigation.navigate('DeviceDiscovery', { brandId: brand.id, adapterId: method.adapter_id, mode: 'scan' });
    } else if (method.id.startsWith('manual:')) {
      navigation.navigate('DeviceDiscovery', { brandId: brand.id, adapterId: method.adapter_id, mode: 'manual' });
    } else if (method.plugin_id) {
      if (method.plugin_id === LG_PLUGIN_ID) {
        // LG setup runs ReThink's protocol from the phone, with Master's dedicated wizard.
        navigation.navigate('LgPairing');
      } else {
        navigation.navigate('DeviceProvisioning', { brandId: brand.id, pluginId: method.plugin_id });
      }
    }
  };

  const renderMethod = (method: ConnectionMethod) => (
    <SelectableCard
      key={method.id}
      onPress={() => open(method)}
      disabled={!method.available}
      accessibilityLabel={`${method.title}. ${method.available ? method.description : (method.unavailable_reason ?? copy.unavailable)}`}
      accessibilityState={{ disabled: !method.available }}
      pressedStyle={styles.pressed}
      disabledStyle={styles.dim}
      style={styles.method}
    >
      <View style={styles.methodRow}>
        <AppText variant="statValue" style={styles.flex}>
          {method.title}
        </AppText>
        {method.available ? <AppIcon set="ionicons" name="chevron-forward" size={CHEVRON_SIZE} color={theme.colors.textSupport} /> : null}
      </View>
      <AppText variant="tileCaption" color={theme.colors.textSupport}>
        {method.available ? method.description : (method.unavailable_reason ?? method.description)}
      </AppText>
      <MethodChips method={method} />
    </SelectableCard>
  );

  const renderBody = () => {
    if (gateway.status !== 'online') {
      return <Notice tone="warning">{gateway.problem ?? copy.offline}</Notice>;
    }
    if (error && !brands) {
      return (
        <ErrorNotice title={copy.loadFailed} retryLabel={copy.retry} onRetry={() => void reload()}>
          {error}
        </ErrorNotice>
      );
    }
    if (!brands) {
      return <LoadingState accessibilityLabel="Loading" />;
    }
    if (!brand) {
      return (
        <Notice
          tone="error"
          actions={<AppButton title={copy.back} variant="secondary" height={BUTTON_HEIGHT} onPress={() => navigation.goBack()} />}
        >
          {copy.missingBrand}
        </Notice>
      );
    }
    return (
      <>
        {GROUPS.map((group) => {
          const methods = brand.methods.filter((method) => method.group === group);
          if (methods.length === 0) {
            return null;
          }
          const text = groupCopy[group];
          return (
            <NeonPanel key={group} style={styles.panel}>
              <PanelHeading title={text.title} iconSet="ionicons" iconName={text.icon} subtitle={text.intro} divider />
              {methods.map(renderMethod)}
            </NeonPanel>
          );
        })}

        {cloud.length > 0 ? (
          <NeonPanel style={styles.panel}>
            <PanelHeading title={copy.cloudTitle} iconSet="ionicons" iconName="cloud-outline" divider />
            <AppText variant="tileCaption" color={theme.colors.textSupport}>
              {copy.cloudBody}
            </AppText>
            {cloud.map((integration) => (
              <AppButton
                key={integration.id}
                title={copy.cloudAction(integration.name)}
                variant="secondary"
                height={BUTTON_HEIGHT}
                onPress={() => navigation.navigate('ConnectAccount', { integration: integration.id })}
              />
            ))}
          </NeonPanel>
        ) : null}

        {brand.notes.length > 0 ? (
          <NeonPanel style={styles.panel}>
            <PanelHeading title={copy.notes} iconSet="ionicons" iconName="information-circle-outline" divider />
            {brand.notes.map((note) => (
              <View key={note} style={styles.note}>
                <AppIcon set="ionicons" name="ellipse" size={6} color={theme.colors.textSupport} />
                <AppText variant="tileCaption" color={theme.colors.textSupport} style={styles.flex}>
                  {note}
                </AppText>
              </View>
            ))}
          </NeonPanel>
        ) : null}
      </>
    );
  };

  return (
    <InnerScreenFrame contentStyle={styles.content}>
      <PageHeader title={brand?.name ?? copy.fallbackTitle} subtitle={brand?.summary} style={styles.header} />
      {renderBody()}
    </InnerScreenFrame>
  );
}
