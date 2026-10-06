import { useNavigation, useRoute } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { useMemo } from 'react';
import { View } from 'react-native';

import { AppButton } from '../../components/common/AppButton';
import { AppIcon } from '../../components/common/AppIcon';
import { AppText } from '../../components/common/AppText';
import { BackButton } from '../../components/common/BackButton';
import { GlassSurface } from '../../components/common/GlassSurface';
import { BottomBar } from '../../components/layout/BottomBar';
import { ScreenWrapper } from '../../components/layout/ScreenWrapper';
import { images } from '../../constants/images';
import { useAppTheme } from '../../hooks/useAppTheme';
import type { RootStackScreenProps } from '../../types/navigation.types';
import { underDevelopmentCopy } from './UnderDevelopmentScreen.data';
import { ICON_SIZE, createStyles } from './UnderDevelopmentScreen.styles';

type Props = RootStackScreenProps<'UnderDevelopment'>;

/**
 * Placeholder for features whose screens are not built yet (Smart Home, BMS,
 * Amenities Booking). The opening tile passes its own title and icon, so the
 * page names the feature the resident tapped.
 */
export function UnderDevelopmentScreen() {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const navigation = useNavigation<Props['navigation']>();
  const { title, iconSet, iconName } = useRoute<Props['route']>().params;

  return (
    <ScreenWrapper backgroundSource={images.homeBackground} withScrim={false} backgroundOverlay={0.34}>
      <StatusBar style="light" />

      <View style={styles.flex}>
        <View style={styles.content}>
          <View style={styles.headerRow}>
            <BackButton title={title} style={styles.headerTitle} />
          </View>

          <View style={styles.body}>
            <GlassSurface
              radius={theme.borderRadius.xl}
              stroke="gradient"
              strokeColors={[theme.colors.featureStrokeFrom, theme.colors.featureStrokeTo]}
              style={styles.card}
            >
              <View style={styles.iconGlow}>
                <LinearGradient
                  colors={[theme.colors.ctaSky, theme.colors.ctaRoyal, theme.colors.ctaViolet, theme.colors.ctaPink]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.iconDisc}
                >
                  <AppIcon set={iconSet} name={iconName} size={ICON_SIZE} />
                </LinearGradient>
              </View>

              <View style={styles.badge}>
                <AppText variant="voiceStatus" color={theme.colors.chipVioletText}>
                  {underDevelopmentCopy.badge}
                </AppText>
              </View>

              <AppText variant="heroTitle" align="center" style={styles.heading}>
                {underDevelopmentCopy.heading}
              </AppText>
              <AppText variant="caption" align="center" color={theme.colors.textSupport} style={styles.message}>
                {underDevelopmentCopy.body(title)}
              </AppText>

              <AppButton
                title={underDevelopmentCopy.cta}
                variant="gradient"
                onPress={() => navigation.popTo('Home')}
                style={styles.cta}
              />
            </GlassSurface>
          </View>
        </View>

        <BottomBar />
      </View>
    </ScreenWrapper>
  );
}
