import { useMemo } from 'react';
import { Image, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { images } from '../../constants/images';
import { useAppTheme } from '../../hooks/useAppTheme';
import type { AppTheme } from '../../types/theme.types';
import { AppButton } from '../common/AppButton';
import { AppText } from '../common/AppText';
import { GlassSurface } from '../common/GlassSurface';
import { ArrowRightIcon } from './ArrowRightIcon';

export interface PromoCardProps {
  title: string;
  body: string;
  ctaLabel: string;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}

const CARD_HEIGHT = 145;
const CTA_HEIGHT = 32;

/** The lifestyle promo at the foot of the home screen. */
export function PromoCard({ title, body, ctaLabel, onPress, style }: PromoCardProps) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  return (
    <GlassSurface
      radius={theme.borderRadius.lg}
      stroke="gradient"
      strokeColors={[theme.colors.featureStrokeFrom, theme.colors.featureStrokeTo]}
      style={[styles.surface, style]}
    >
      <View style={styles.text}>
        <AppText variant="promoTitle">{title}</AppText>
        <AppText variant="tileSubtitle" color={theme.colors.textSecondary} style={styles.body}>
          {body}
        </AppText>
        <AppButton
          title={ctaLabel}
          variant="gradient"
          height={CTA_HEIGHT}
          labelVariant="tileTitle"
          trailingIcon={<ArrowRightIcon size={13} />}
          trailingInset={14}
          onPress={onPress}
          style={styles.cta}
        />
      </View>

      <Image source={images.promoPhoto} style={styles.photo} resizeMode="cover" />
    </GlassSurface>
  );
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    surface: {
      height: CARD_HEIGHT,
      flexDirection: 'row',
      alignItems: 'center',
    },
    text: {
      flex: 1,
      paddingLeft: theme.spacing.md,
      paddingRight: theme.spacing.sm,
    },
    body: {
      marginTop: 4,
    },
    cta: {
      marginTop: theme.spacing.md,
      alignSelf: 'flex-start',
      minWidth: 140,
    },
    photo: {
      width: '42%',
      height: '100%',
    },
    pressed: {
      opacity: 0.85,
    },
  });
}
