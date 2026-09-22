 import { useNavigation } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useMemo } from 'react';
import { View } from 'react-native';

import { AppButton } from '../../components/common/AppButton';
import { AppText } from '../../components/common/AppText';
import { ScreenWrapper } from '../../components/layout/ScreenWrapper';
import { ArrowRightIcon } from '../../components/ui/ArrowRightIcon';
import { GlowArc } from '../../components/ui/GlowArc';
import { useAppContext } from '../../hooks/useAppContext';
import { useAppTheme } from '../../hooks/useAppTheme';
import { useResponsive } from '../../hooks/useResponsive';
import type { RootStackScreenProps } from '../../types/navigation.types';
import { eyebrowLines, headlineLines, primaryCta } from './FirstScreen.data';
import { createStyles } from './FirstScreen.styles';

/** Pill height measured from the reference. */
const CTA_HEIGHT = 45;

export function FirstScreen() {
  const theme = useAppTheme();
  const { isCompact, scale, width } = useResponsive();
  const { completeOnboarding } = useAppContext();
  const navigation = useNavigation<RootStackScreenProps<'FirstScreen'>['navigation']>();

  const headlineFontSize = Math.round(scale(theme.typography.displayLarge.fontSize));
  const headlineLineHeight = Math.round(headlineFontSize * 1.1);
  // A wide circle showing only a shallow corner sweep, as in the design.
  const arcSize = width * 1.4;

  const styles = useMemo(
    () => createStyles(theme, { isCompact, headlineFontSize, headlineLineHeight, arcSize }),
    [theme, isCompact, headlineFontSize, headlineLineHeight, arcSize],
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

          <AppButton
            title={primaryCta.label}
            onPress={handleGetStarted}
            height={CTA_HEIGHT}
            leadingIcon={<ArrowRightIcon size={15} />}
            style={styles.cta}
          />
        </View>
      </View>
    </ScreenWrapper>
  );
}
