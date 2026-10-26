 import { useNavigation } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useMemo } from 'react';
import { View } from 'react-native';

import { AppText } from '../../components/common/AppText';
import { SlideButton } from '../../components/common/SlideButton';
import { ScreenWrapper } from '../../components/layout/ScreenWrapper';
import { GlowArc } from '../../components/ui/GlowArc';
import { NudgingArrow } from '../../components/ui/NudgingArrow';
import { useAppContext } from '../../hooks/useAppContext';
import { useAppTheme } from '../../hooks/useAppTheme';
import { useResponsive } from '../../hooks/useResponsive';
import { pickResponsive, useScreenLayout } from '../../hooks/useScreenLayout';
import type { RootStackScreenProps } from '../../types/navigation.types';
import { eyebrowLines, headlineLines, primaryCta } from './FirstScreen.data';
import { HEADLINE_SCALE, WIDE_MIN_HEIGHT, createStyles } from './FirstScreen.styles';

/** Pill height measured from the reference. */
const CTA_HEIGHT = 45;

export function FirstScreen() {
  const theme = useAppTheme();
  const { isCompact, scale, width, height } = useResponsive();
  const { isWide, breakpoint } = useScreenLayout();
  const { completeOnboarding } = useAppContext();
  const navigation = useNavigation<RootStackScreenProps<'FirstScreen'>['navigation']>();

  // Tablets and desktops set the headline larger, unless the window is too
  // short for it (a phone in landscape).
  const roomy = isWide && height >= WIDE_MIN_HEIGHT;
  const headlineFontSize = roomy
    ? Math.round(theme.typography.displayLarge.fontSize * pickResponsive(HEADLINE_SCALE, breakpoint))
    : Math.round(scale(theme.typography.displayLarge.fontSize));
  const headlineLineHeight = Math.round(headlineFontSize * 1.1);
  // A wide circle showing only a shallow corner sweep, as in the design. On
  // wide windows it follows the height, so it stays a corner accent.
  const arcSize = isWide ? Math.min(width, height) * 1.4 : width * 1.4;

  const styles = useMemo(
    () => createStyles(theme, { isCompact, isWide, headlineFontSize, headlineLineHeight, arcSize }),
    [theme, isCompact, isWide, headlineFontSize, headlineLineHeight, arcSize],
  );

  const handleGetStarted = useCallback(() => {
    completeOnboarding();
    navigation.navigate('Login');
  }, [completeOnboarding, navigation]);

  return (
    <ScreenWrapper
      withGutter
      backdrop={<GlowArc size={arcSize} style={styles.glowArc} />}
    >
      <StatusBar style="light" />

      <View style={styles.content}>
        <View style={styles.eyebrow}>
          {eyebrowLines.map((line) => (
            <AppText key={line.id} variant="overline">
              {line.text}
            </AppText>
          ))}
          <View style={styles.eyebrowRule} />
        </View>

        <View style={styles.bottomBlock}>
          <View style={styles.headline}>
            {headlineLines.map((line) => (
              <AppText
                key={line.id}
                variant="displayLarge"
                color={line.accent ? theme.colors.headlineAccent : theme.colors.textPrimary}
                style={styles.headlineLine}
              >
                {line.text}
              </AppText>
            ))}
          </View>

          {/* Slid rather than tapped: the arrow is dragged to the far end. */}
          <SlideButton
            title={primaryCta.label}
            onComplete={handleGetStarted}
            height={CTA_HEIGHT}
            icon={<NudgingArrow size={15} />}
            accessibilityHint={primaryCta.hint}
            style={styles.cta}
          />
        </View>
      </View>
    </ScreenWrapper>
  );
}
