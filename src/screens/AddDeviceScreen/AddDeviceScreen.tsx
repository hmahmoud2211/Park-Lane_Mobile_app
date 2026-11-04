import { useNavigation } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';

import { AppButton } from '../../components/common/AppButton';
import { AppIcon } from '../../components/common/AppIcon';
import { AppInput } from '../../components/common/AppInput';
import { AppText } from '../../components/common/AppText';
import { GlassSurface } from '../../components/common/GlassSurface';
import { BrandBadge } from '../../components/gateway/BrandBadge';
import { GatewayStatusRow } from '../../components/gateway/GatewayStatusRow';
import { SupportChip } from '../../components/gateway/RequirementChips';
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
import { useBrands } from '../../hooks/useBrands';
import { useEms } from '../../hooks/useEms';
import { useGateway } from '../../hooks/useGateway';
import { useScreenLayout } from '../../hooks/useScreenLayout';
import type { Brand } from '../../types/gateway.types';
import type { RootStackScreenProps } from '../../types/navigation.types';
import { addDeviceCopy as copy } from './AddDeviceScreen.data';
import { BUTTON_HEIGHT, CARD_GAP, FIELD_HEIGHT, MIN_BRAND_WIDTH, createStyles } from './AddDeviceScreen.styles';

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
  const layout = useScreenLayout();
  const navigation = useNavigation<RootStackScreenProps<'AddDevice'>['navigation']>();
  const gateway = useGateway();
  const ems = useEms();
  const { brands, error, reload } = useBrands();
  const [query, setQuery] = useState('');

  const visible = useMemo(() => (brands ?? []).filter((brand) => matches(brand, query)), [brands, query]);
  const hasHub = ems.status === 'signedIn' && ems.home !== null && ems.home.hub.status !== 'provisioning';

  const renderBrand = (brand: Brand) => (
    <Pressable
      onPress={() => navigation.navigate('AddDeviceMethod', { brandId: brand.id })}
      accessibilityRole="button"
      accessibilityLabel={`${brand.name}. ${brand.summary}`}
      style={({ pressed }) => pressed && styles.pressed}
    >
      <GlassSurface
        radius={theme.borderRadius.sm}
        blurred={false}
        strokeColors={[theme.colors.cardStrokeFrom, theme.colors.featureStrokeTo]}
        fillOpacity={theme.glass.subtleFillOpacity}
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
      </GlassSurface>
    </Pressable>
  );

  const renderGatewayProblem = () => {
    if (gateway.status === 'loading' || gateway.status === 'connecting') {
      return <ActivityIndicator color={theme.colors.textPrimary} accessibilityLabel="Connecting to your gateway" />;
    }
    if (gateway.status === 'none') {
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
      return <ActivityIndicator color={theme.colors.textPrimary} accessibilityLabel="Loading brands" />;
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
    <ScreenWrapper backgroundSource={images.homeBackground} withScrim={false} backgroundOverlay={0.34}>
      <StatusBar style="light" />
      <View style={styles.flex}>
        <ScrollView
          contentContainerStyle={[styles.content, layout.contentStyle]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
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
        </ScrollView>
        <BottomBar />
      </View>
    </ScreenWrapper>
  );
}
