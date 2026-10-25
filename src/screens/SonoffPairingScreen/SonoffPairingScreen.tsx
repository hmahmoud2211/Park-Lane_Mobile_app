import { useNavigation, usePreventRemove } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, type ScrollViewInstance } from 'react-native';

import { AppText } from '../../components/common/AppText';
import { PageHeader } from '../../components/layout/PageHeader';
import { ScreenWrapper } from '../../components/layout/ScreenWrapper';
import { ProgressStepper, type ProgressStep } from '../../components/ui/ProgressStepper';
import { images } from '../../constants/images';
import { useAppTheme } from '../../hooks/useAppTheme';
import { useScreenLayout } from '../../hooks/useScreenLayout';
import { useSonoffPairing } from '../../hooks/useSonoffPairing';
import { openAppSettings, openWifiSettings } from '../../services/sonoff/wifiProvisioningService';
import type { RootStackScreenProps } from '../../types/navigation.types';
import { DeviceWifiConnectionStep } from './DeviceWifiConnectionStep';
import { PairingInstructionsStep } from './PairingInstructionsStep';
import { PairingProgressStep } from './PairingProgressStep';
import { pairingCopy as copy, wizardSteps, type AdviceAction } from './SonoffPairingScreen.data';
import { createStyles } from './SonoffPairingScreen.styles';
import { WifiConfigurationStep } from './WifiConfigurationStep';

/**
 * Adds a SONOFF Wi-Fi plug without the eWeLink app: pairing mode, the plug's
 * setup hotspot, home Wi-Fi, then the hub. One route, so the plug's key and
 * the Wi-Fi password stay in memory here rather than in navigation params.
 */
export function SonoffPairingScreen() {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const layout = useScreenLayout();
  // A focused, one-step-at-a-time task: wide layouts keep it to one readable column.
  const wizardWidth = layout.isWide
    ? { maxWidth: theme.layout.contentMaxWidth.tablet + 2 * layout.gutter }
    : undefined;
  const navigation = useNavigation<RootStackScreenProps<'SonoffPairing'>['navigation']>();
  const pairing = useSonoffPairing();
  const scroll = useRef<ScrollViewInstance>(null);
  const [leaving, setLeaving] = useState(false);

  const stepIndex = wizardSteps.findIndex((entry) => entry.id === pairing.step);
  const steps = useMemo<readonly ProgressStep[]>(
    () =>
      wizardSteps.map((entry, index) => ({
        id: entry.id,
        label: entry.label,
        details: [index < stepIndex ? 'Done' : index === stepIndex ? 'Now' : 'Next'],
      })),
    [stepIndex],
  );

  // Each page starts at its top.
  useEffect(() => {
    scroll.current?.scrollTo({ y: 0, animated: false });
  }, [pairing.step]);

  // Back (header, Android button, iOS swipe) steps back through the wizard first.
  usePreventRemove(pairing.step !== 'instructions' && !leaving, () => {
    pairing.back();
  });

  const leave = useCallback(async () => {
    await pairing.cancel();
    setLeaving(true);
  }, [pairing]);

  useEffect(() => {
    if (leaving) {
      navigation.goBack();
    }
  }, [leaving, navigation]);

  const handleBack = useCallback(() => {
    if (!pairing.back()) {
      navigation.goBack();
    }
  }, [navigation, pairing]);

  const handleOpenWifiSettings = useCallback(() => {
    pairing.markManualJoin();
    void openWifiSettings();
  }, [pairing]);

  const handleAdvice = useCallback(
    (action: AdviceAction) => {
      switch (action) {
        case 'appSettings':
          void openAppSettings();
          break;
        case 'wifiSettings':
          handleOpenWifiSettings();
          break;
        case 'editWifi':
          pairing.backToForm();
          break;
        case 'startOver':
          void pairing.cancel();
          break;
      }
    },
    [handleOpenWifiSettings, pairing],
  );

  return (
    <ScreenWrapper backgroundSource={images.homeBackground} withScrim={false} backgroundOverlay={0.34}>
      <StatusBar style="light" />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          ref={scroll}
          contentContainerStyle={[styles.content, layout.contentStyle, wizardWidth]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <PageHeader
            title={copy.title}
            subtitle={copy.subtitle}
            onBackPress={handleBack}
            trailing={
              <Pressable
                onPress={() => void leave()}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel="Cancel pairing"
                style={({ pressed }) => [styles.cancel, pressed && styles.pressed]}
              >
                <AppText variant="statLabel" color={theme.colors.textAccentSoft}>
                  {copy.cancel}
                </AppText>
              </Pressable>
            }
            style={styles.header}
          />

          <ProgressStepper steps={steps} currentIndex={stepIndex} style={styles.stepper} />

          {pairing.step === 'instructions' ? (
            <PairingInstructionsStep onContinue={pairing.startConnecting} />
          ) : null}
          {pairing.step === 'connect' ? (
            <DeviceWifiConnectionStep
              pairing={pairing}
              onAdviceAction={handleAdvice}
              onOpenWifiSettings={handleOpenWifiSettings}
            />
          ) : null}
          {pairing.step === 'wifi' ? <WifiConfigurationStep pairing={pairing} /> : null}
          {pairing.step === 'progress' ? (
            <PairingProgressStep pairing={pairing} onAdviceAction={handleAdvice} onDone={() => void leave()} />
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </ScreenWrapper>
  );
}
