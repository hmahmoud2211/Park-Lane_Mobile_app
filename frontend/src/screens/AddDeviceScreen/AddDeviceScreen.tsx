import { useNavigation } from '@react-navigation/native';
import { useMemo, useState } from 'react';
import { View } from 'react-native';

import { AppButton } from '../../components/common/AppButton';
import { AppIcon } from '../../components/common/AppIcon';
import { AppInput } from '../../components/common/AppInput';
import { AppText } from '../../components/common/AppText';
import { BrandBadge } from '../../features/gateway/components/BrandBadge';
import { GatewayStatusRow } from '../../features/gateway/components/GatewayStatusRow';
import { SupportChip } from '../../features/gateway/components/RequirementChips';
import { PageHeader } from '../../components/layout/PageHeader';
import { ResponsiveGrid } from '../../components/layout/ResponsiveGrid';
import { Notice } from '../../components/feedback/Notice';
import { NeonPanel } from '../../components/ui/NeonPanel';
import { PanelHeading } from '../../components/ui/PanelHeading';
import { StatusChip } from '../../components/ui/StatusChip';
import { useAppTheme } from '../../hooks/useAppTheme';
import { useBrands } from '../../features/gateway/hooks/useBrands';
import { useEms } from '../../features/ems/hooks/useEms';
import { useGateway } from '../../features/gateway/hooks/useGateway';
import type { Brand } from '../../types/gateway.types';
import type { RootStackScreenProps } from '../../types/navigation.types';
import { addDeviceCopy as copy } from './AddDeviceScreen.data';
import { BUTTON_HEIGHT, CARD_GAP, FIELD_HEIGHT, MIN_BRAND_WIDTH, createStyles } from './AddDeviceScreen.styles';
import { InnerScreenFrame } from '../../components/layout/InnerScreenFrame';
import { SelectableCard } from '../../components/ui/SelectableCard';
import { ErrorNotice } from '../../components/feedback/ErrorNotice';
import { LoadingState } from '../../components/feedback/LoadingState';
import { readyHome } from '../../features/ems/services/readyHome';
import { NoGatewayNotice } from '../../features/gateway/components/NoGatewayNotice';

const SEARCH_ICON_SIZE = 16;

function matches(brand: Brand, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return true;
  }
  return [brand.name, ...brand.aliases].some((name) => name.toLowerCase().includes(needle));
}

/**
 * Add Device, Screen 1: the manufacturer. Every way of adding a device
 * starts here. The list comes from the gateway's adapters (GET /brands), so a
 * brand shows only what that gateway can really do; choosing one opens its
 * connection methods.
 */
export function AddDeviceScreen() {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const navigation = useNavigation<RootStackScreenProps<'AddDevice'>['navigation']>();
  const gateway = useGateway();
  const ems = useEms();
  const { brands, error, reload } = useBrands();
  const [query, setQuery] = useState('');

  const visible = useMemo(() => (brands ?? []).filter((brand) => matches(brand, query)), [brands, query]);
  const hasHub = readyHome(ems.status, ems.home) !== null;

  const renderBrand = (brand: Brand) => (
    <SelectableCard
      onPress={() => navigation.navigate('AddDeviceMethod', { brandId: brand.id })}
      accessibilityLabel={`${brand.name}. ${brand.summary}`}
      pressedStyle={styles.pressed}
      style={styles.brand}
    >
      <View style={styles.brandRow}>
        <BrandBadge logo={brand.logo} name={brand.name} />
        <View style={styles.brandText}>
          <AppText variant="statValue" numberOfLines={1}>
            {brand.name}
          </AppText>
          <AppText variant="tileCaption" color={theme.colors.textSupport} numberOfLines={2}>
            {brand.summary}
          </AppText>
        </View>
      </View>
      <View style={styles.actions}>
        <SupportChip status={brand.status} />
        {brand.account_free ? <StatusChip label="No account needed" tone="teal" icon="lock-open-outline" /> : null}
      </View>
    </SelectableCard>
  );

  const renderGatewayProblem = () => {
    if (gateway.status === 'loading' || gateway.status === 'connecting') {
      return <LoadingState accessibilityLabel="Connecting to your gateway" />;
    }
    if (gateway.status === 'none') {
      return (
        <NoGatewayNotice title={copy.noGatewayTitle} body={copy.noGatewayBody} actionLabel={copy.connectGateway} />
      );
    }
    return (
      <Notice
        tone={gateway.status === 'unauthorized' ? 'error' : 'warning'}
        title={gateway.status === 'unauthorized' ? copy.unauthorizedTitle : copy.offlineTitle}
        actions={
          <View style={styles.actions}>
            {gateway.status === 'offline' ? (
              <AppButton title={copy.reconnect} variant="secondary" height={BUTTON_HEIGHT} onPress={() => void gateway.reconnect()} style={styles.action} />
            ) : null}
            <AppButton title={copy.manageGateway} variant="secondary" height={BUTTON_HEIGHT} onPress={() => navigation.navigate('GatewaySetup')} style={styles.action} />
          </View>
        }
      >
        {gateway.problem}
      </Notice>
    );
  };

  const renderBrands = () => {
    if (error && !brands) {
      return (
        <ErrorNotice title={copy.loadFailed} retryLabel={copy.retry} onRetry={() => void reload()}>
          {error}
        </ErrorNotice>
      );
    }
    if (!brands) {
      return <LoadingState accessibilityLabel="Loading brands" />;
    }
    return (
      <>
        <AppInput
          variant="field"
          value={query}
          onChangeText={setQuery}
          placeholder={copy.search}
          accessibilityLabel={copy.search}
          autoCorrect={false}
          autoCapitalize="none"
          leftIcon={<AppIcon set="ionicons" name="search-outline" size={SEARCH_ICON_SIZE} color={theme.colors.textSupport} />}
          height={FIELD_HEIGHT}
        />
        {visible.length === 0 ? (
          <AppText variant="bodySmall" color={theme.colors.textSupport}>
            {copy.noMatch}
          </AppText>
        ) : (
          <ResponsiveGrid
            data={visible}
            keyExtractor={(brand) => brand.id}
            minItemWidth={MIN_BRAND_WIDTH}
            maxColumns={2}
            gap={CARD_GAP - 6}
            renderItem={renderBrand}
          />
        )}
      </>
    );
  };

  return (
    <InnerScreenFrame contentStyle={styles.content}>
      <PageHeader title={copy.title} subtitle={copy.subtitle} style={styles.header} />

      {gateway.status !== 'none' ? (
        <GatewayStatusRow
          status={gateway.status}
          name={gateway.active?.name ?? null}
          onManage={() => navigation.navigate('GatewaySetup')}
        />
      ) : null}

      <NeonPanel style={styles.panel}>
        <PanelHeading title={copy.brandsTitle} iconSet="ionicons" iconName="business-outline" divider />
        <AppText variant="bodySmall" color={theme.colors.textSupport}>
          {copy.brandsIntro}
        </AppText>
        {gateway.status === 'online' ? renderBrands() : renderGatewayProblem()}
      </NeonPanel>

      {hasHub ? (
        <NeonPanel style={styles.panel}>
          <PanelHeading title={copy.cloudTitle} iconSet="ionicons" iconName="cloud-outline" divider />
          <AppText variant="bodySmall" color={theme.colors.textSupport}>
            {copy.cloudBody}
          </AppText>
          <AppButton title={copy.cloudAction} variant="secondary" height={BUTTON_HEIGHT} onPress={() => navigation.navigate('ConnectAccount')} />
        </NeonPanel>
      ) : null}
    </InnerScreenFrame>
  );
}
