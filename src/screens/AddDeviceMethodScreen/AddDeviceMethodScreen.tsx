import { useNavigation, useRoute } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';

import { AppButton } from '../../components/common/AppButton';
import { AppIcon } from '../../components/common/AppIcon';
import { AppText } from '../../components/common/AppText';
import { GlassSurface } from '../../components/common/GlassSurface';
import { MethodChips } from '../../components/gateway/RequirementChips';
import { BottomBar } from '../../components/layout/BottomBar';
import { PageHeader } from '../../components/layout/PageHeader';
import { ScreenWrapper } from '../../components/layout/ScreenWrapper';
import { Notice } from '../../components/parking/Notice';
import { NeonPanel } from '../../components/ui/NeonPanel';
import { PanelHeading } from '../../components/ui/PanelHeading';
import { images } from '../../constants/images';
import { useAppTheme } from '../../hooks/useAppTheme';
import { useBrands } from '../../hooks/useBrands';
import { useEms } from '../../hooks/useEms';
import { useGateway } from '../../hooks/useGateway';
import { useScreenLayout } from '../../hooks/useScreenLayout';
import * as homeApi from '../../services/home/homeApi';
import type { ConnectionMethod, MethodGroup } from '../../types/gateway.types';
import type { Integration } from '../../types/home.types';
import type { RootStackScreenProps } from '../../types/navigation.types';
import { addDeviceMethodCopy as copy, cloudIntegrations, groupCopy } from './AddDeviceMethodScreen.data';
import { BUTTON_HEIGHT, createStyles } from './AddDeviceMethodScreen.styles';

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
  const layout = useScreenLayout();
  const navigation = useNavigation<RootStackScreenProps<'AddDeviceMethod'>['navigation']>();
  const { params } = useRoute<RootStackScreenProps<'AddDeviceMethod'>['route']>();
  const gateway = useGateway();
  const ems = useEms();
  const { brands, error, reload } = useBrands();
  const brand = brands?.find((entry) => entry.id === params.brandId) ?? null;
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const hasHub = ems.status === 'signedIn' && ems.home !== null && ems.home.hub.status !== 'provisioning';

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
      navigation.navigate('DeviceProvisioning', { brandId: brand.id, pluginId: method.plugin_id });
    }
  };

  const renderMethod = (method: ConnectionMethod) => (
    <Pressable
      key={method.id}
      onPress={() => open(method)}
      disabled={!method.available}
      accessibilityRole="button"
      accessibilityLabel={`${method.title}. ${method.available ? method.description : (method.unavailable_reason ?? copy.unavailable)}`}
      accessibilityState={{ disabled: !method.available }}
      style={({ pressed }) => [pressed && styles.pressed, !method.available && styles.dim]}
    >
      <GlassSurface
        radius={theme.borderRadius.sm}
        blurred={false}
        strokeColors={[theme.colors.cardStrokeFrom, theme.colors.featureStrokeTo]}
        fillOpacity={theme.glass.subtleFillOpacity}
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
      </GlassSurface>
    </Pressable>
  );

  const renderBody = () => {
    if (gateway.status !== 'online') {
      return <Notice tone="warning">{gateway.problem ?? copy.offline}</Notice>;
    }
    if (error && !brands) {
      return (
        <Notice
          tone="error"
          title={copy.loadFailed}
          actions={<AppButton title={copy.retry} variant="secondary" height={BUTTON_HEIGHT} onPress={() => void reload()} />}
        >
          {error}
        </Notice>
      );
    }
    if (!brands) {
      return <ActivityIndicator color={theme.colors.textPrimary} accessibilityLabel="Loading" />;
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
    <ScreenWrapper backgroundSource={images.homeBackground} withScrim={false} backgroundOverlay={0.34}>
      <StatusBar style="light" />
      <View style={styles.flex}>
        <ScrollView
          contentContainerStyle={[styles.content, layout.contentStyle]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <PageHeader title={brand?.name ?? copy.fallbackTitle} subtitle={brand?.summary} style={styles.header} />
          {renderBody()}
        </ScrollView>
        <BottomBar />
      </View>
    </ScreenWrapper>
  );
}
