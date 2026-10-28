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
import { useLgPairing } from '../../hooks/useLgPairing';
import { useScreenLayout } from '../../hooks/useScreenLayout';
import { openWifiSettings } from '../../services/sonoff/wifiProvisioningService';
import type { RootStackScreenProps } from '../../types/navigation.types';
import { lgPairingCopy as copy, lgWizardSteps } from './LgPairingScreen.data';
import { createStyles } from './LgPairingScreen.styles';
import { LgFinishStep, LgHomeWifiStep, LgSendStep, LgSetupModeStep } from './LgPairingSteps';

/**
 * Adds an LG AC without LG's ThinQ app: setup mode, home Wi-Fi, the AC's
 * hotspot, then rethink on the backend. One route, so the Wi-Fi password
 * stays in memory here rather than in navigation params.
 */
export function LgPairingScreen() {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const layout = useScreenLayout();
  // A focused, one-step-at-a-time task: wide layouts keep it to one readable column.
  const wizardWidth = layout.isWide
    ? { maxWidth: theme.layout.contentMaxWidth.tablet + 2 * layout.gutter }
    : undefined;
  const navigation = useNavigation<RootStackScreenProps<'LgPairing'>['navigation']>();
  const pairing = useLgPairing();
  const scroll = useRef<ScrollViewInstance>(null);
  const [leaving, setLeaving] = useState(false);

  const stepIndex = lgWizardSteps.findIndex((entry) => entry.id === pairing.step);
  const steps = useMemo<readonly ProgressStep[]>(
    () =>
      lgWizardSteps.map((entry, index) => ({
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
  usePreventRemove((pairing.step === 'wifi' || pairing.step === 'join') && !leaving, () => {
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
      void leave();
    }
  }, [leave, pairing]);

  const startOver = useCallback(async () => {
    await pairing.cancel();
    // A new screen instance resets the hook and checks the bridge again.
    navigation.replace('LgPairing');
  }, [navigation, pairing]);

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

          {pairing.step === 'prepare' ? <LgSetupModeStep pairing={pairing} /> : null}
          {pairing.step === 'wifi' ? <LgHomeWifiStep pairing={pairing} /> : null}
          {pairing.step === 'join' ? (
            <LgSendStep pairing={pairing} onOpenWifiSettings={() => void openWifiSettings()} />
          ) : null}
          {pairing.step === 'finish' ? (
            <LgFinishStep pairing={pairing} onStartOver={() => void startOver()} onDone={() => void leave()} />
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </ScreenWrapper>
  );
}
