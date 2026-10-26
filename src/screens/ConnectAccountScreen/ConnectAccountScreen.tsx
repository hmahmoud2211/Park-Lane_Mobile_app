import { useNavigation, useRoute } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';

import { AppButton } from '../../components/common/AppButton';
import { AppText } from '../../components/common/AppText';
import { GlassSurface } from '../../components/common/GlassSurface';
import { EmsAccountPanel } from '../../components/ems/EmsAccountPanel';
import { BottomBar } from '../../components/layout/BottomBar';
import { PageHeader } from '../../components/layout/PageHeader';
import { ScreenWrapper } from '../../components/layout/ScreenWrapper';
import { Notice } from '../../components/parking/Notice';
import { NeonPanel } from '../../components/ui/NeonPanel';
import { PanelHeading } from '../../components/ui/PanelHeading';
import { StatusChip } from '../../components/ui/StatusChip';
import { images } from '../../constants/images';
import { useAccountLink } from '../../hooks/useAccountLink';
import { useAppTheme } from '../../hooks/useAppTheme';
import { useEms } from '../../hooks/useEms';
import { useScreenLayout } from '../../hooks/useScreenLayout';
import { EmsError } from '../../services/ems/emsApi';
import * as homeApi from '../../services/home/homeApi';
import type { Integration } from '../../types/home.types';
import type { RootStackScreenProps } from '../../types/navigation.types';
import { connectCopy as copy, methodLabels } from './ConnectAccountScreen.data';
import { BUTTON_HEIGHT, createStyles } from './ConnectAccountScreen.styles';
import { FlowStepForm } from './FlowStepForm';

/**
 * Connecting devices: the resident picks the brand their devices already use
 * and links that account. The backend runs the brand's own steps on the
 * unit's Home Assistant (forms, a QR code, or the brand's sign-in page);
 * once linked, the account's devices appear in the home.
 */
export function ConnectAccountScreen() {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const layout = useScreenLayout();
  const navigation = useNavigation<RootStackScreenProps<'ConnectAccount'>['navigation']>();
  const { params } = useRoute<RootStackScreenProps<'ConnectAccount'>['route']>();
  const { status, home, homeProblem, refreshHome } = useEms();
  const link = useAccountLink();
  const { start, open } = link;
  const [integrations, setIntegrations] = useState<Integration[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const hasHome = status === 'signedIn' && home !== null && home.hub.status !== 'provisioning';

  const loadIntegrations = useCallback(async () => {
    try {
      setIntegrations(await homeApi.listIntegrations());
      setLoadError(null);
    } catch (error) {
      setLoadError(error instanceof EmsError ? error.message : copy.loadFailed);
    }
  }, []);

  useEffect(() => {
    if (status !== 'signedIn') {
      return;
    }
    let cancelled = false;
    homeApi.listIntegrations().then(
      (list) => {
        if (cancelled) return;
        setIntegrations(list);
        setLoadError(null);
      },
      (error: unknown) => {
        if (!cancelled) setLoadError(error instanceof EmsError ? error.message : copy.loadFailed);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [status]);

  // Arriving with a brand (or a flow to continue) starts it straight away, once.
  const opened = useRef(false);
  useEffect(() => {
    if (!hasHome || opened.current) {
      return;
    }
    opened.current = true;
    if (params?.flowId) {
      void open(params.flowId);
    } else if (params?.integration) {
      void start(params.integration);
    }
  }, [hasHome, params, open, start]);

  const brandName = (id: string) => integrations?.find((entry) => entry.id === id)?.name ?? id;

  const renderBrands = () => {
    if (loadError) {
      return (
        <Notice
          tone="error"
          title={copy.loadFailed}
          actions={<AppButton title={copy.retry} variant="secondary" height={BUTTON_HEIGHT} onPress={() => void loadIntegrations()} />}
        >
          {loadError}
        </Notice>
      );
    }
    if (!integrations) {
      return <ActivityIndicator color={theme.colors.textPrimary} accessibilityLabel="Loading brands" />;
    }
    return (
      <View style={styles.brands}>
        {integrations.map((integration) => {
          const method = methodLabels[integration.method];
          return (
            <Pressable
              key={integration.id}
              onPress={() => void start(integration.id)}
              disabled={!integration.available || link.busy}
              accessibilityRole="button"
              accessibilityLabel={`${integration.name}. ${integration.available ? integration.hint : copy.notAvailable}`}
              accessibilityState={{ disabled: !integration.available }}
              style={({ pressed }) => [pressed && styles.pressed, !integration.available && styles.dim]}
            >
              <GlassSurface
                radius={theme.borderRadius.sm}
                blurred={false}
                strokeColors={[theme.colors.cardStrokeFrom, theme.colors.featureStrokeTo]}
                fillOpacity={theme.glass.subtleFillOpacity}
                style={styles.brand}
              >
                <View style={styles.brandRow}>
                  <AppText variant="statValue" style={styles.flex}>
                    {integration.name}
                  </AppText>
                  <StatusChip
                    label={integration.available ? method.label : copy.notAvailable}
                    tone={integration.available ? 'indigo' : 'slate'}
                    icon={method.icon}
                  />
                </View>
                <AppText variant="tileCaption" color={theme.colors.textSupport}>
                  {integration.hint}
                </AppText>
              </GlassSurface>
            </Pressable>
          );
        })}
      </View>
    );
  };

  const renderBody = () => {
    if (status !== 'signedIn') {
      return <EmsAccountPanel intro={copy.accountIntro} />;
    }
    if (!hasHome) {
      if (homeProblem?.code === 'no_home' || homeProblem?.code === 'provisioning') {
        return (
          <Notice tone="info" title={homeProblem.code === 'no_home' ? copy.noHomeTitle : copy.provisioningTitle}>
            {homeProblem.message}
          </Notice>
        );
      }
      return homeProblem ? (
        <Notice
          tone="error"
          title={copy.homeFailedTitle}
          actions={<AppButton title={copy.retry} variant="secondary" height={BUTTON_HEIGHT} onPress={() => void refreshHome()} />}
        >
          {homeProblem.message}
        </Notice>
      ) : (
        <ActivityIndicator color={theme.colors.textPrimary} />
      );
    }
    if (link.step) {
      const brand = brandName(link.step.integration);
      return (
        <NeonPanel style={styles.panel}>
          <PanelHeading title={brand} iconSet="ionicons" iconName="link-outline" divider />
          <FlowStepForm
            key={`${link.step.flowId}:${link.step.stepId}:${link.step.type}`}
            step={link.step}
            brand={brand}
            busy={link.busy}
            error={link.error}
            onSubmit={(data) => void link.submit(data)}
            onSignIn={() => void link.signInWithBrand()}
            onCancel={() => void link.cancel()}
            onDone={() => (navigation.canGoBack() ? navigation.goBack() : navigation.navigate('EmsDevices'))}
            onRetry={async () => {
              const integration = link.step?.integration;
              await link.cancel();
              if (integration) await start(integration);
            }}
          />
        </NeonPanel>
      );
    }
    return (
      <NeonPanel style={styles.panel}>
        <PanelHeading title={copy.brandsTitle} iconSet="ionicons" iconName="apps-outline" divider />
        <AppText variant="bodySmall" color={theme.colors.textSupport}>
          {copy.brandsIntro}
        </AppText>
        {link.error ? <Notice tone="error">{link.error}</Notice> : null}
        {link.busy ? <ActivityIndicator color={theme.colors.textPrimary} /> : null}
        {renderBrands()}
      </NeonPanel>
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
          {renderBody()}
        </ScrollView>
        <BottomBar />
      </View>
    </ScreenWrapper>
  );
}
