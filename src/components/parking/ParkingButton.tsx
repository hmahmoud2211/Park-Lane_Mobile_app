import Ionicons from '@expo/vector-icons/Ionicons';
import type { StyleProp, ViewStyle } from 'react-native';

import { useAppTheme } from '../../hooks/useAppTheme';
import { AppButton } from '../common/AppButton';

export type ParkingButtonTone = 'primary' | 'secondary' | 'danger';

export interface ParkingButtonProps {
  label: string;
  onPress: () => void;
  tone?: ParkingButtonTone;
  icon?: keyof typeof Ionicons.glyphMap;
  loading?: boolean;
  disabled?: boolean;
  /** 36dp instead of 46dp, for buttons inside rows and notices. */
  compact?: boolean;
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * The parking flows' buttons, built on AppButton: `primary` is the "Generate
 * QR Pass" gradient, `secondary` the glass pill, `danger` the hang-up red.
 */
export function ParkingButton({
  label,
  onPress,
  tone = 'secondary',
  icon,
  loading,
  disabled,
  compact = false,
  accessibilityHint,
  style,
}: ParkingButtonProps) {
  const theme = useAppTheme();
  const { colors } = theme;
  const height = compact ? 36 : 46;
  const gradient =
    tone === 'primary'
      ? ([colors.ctaSky, colors.ctaRoyal, colors.ctaViolet, colors.ctaPink] as const)
      : tone === 'danger'
        ? ([colors.hangUpFrom, colors.hangUpTo] as const)
        : undefined;

  return (
    <AppButton
      title={label}
      onPress={onPress}
      variant={gradient ? 'gradient' : 'secondary'}
      gradientColors={gradient}
      height={height}
      radius={theme.borderRadius.md}
      labelVariant={compact ? 'label' : 'bodyStrong'}
      leadingIcon={icon ? <Ionicons name={icon} size={compact ? 15 : 18} color={colors.textPrimary} /> : undefined}
      leadingPlacement="inline"
      loading={loading}
      disabled={disabled}
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      style={style}
    />
  );
}
