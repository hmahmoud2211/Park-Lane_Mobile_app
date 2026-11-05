import type { StyleProp, ViewStyle } from 'react-native';

import { useAppTheme } from '../../hooks/useAppTheme';
import { AppButton } from '../common/AppButton';
import { ArrowRightIcon } from '../ui/ArrowRightIcon';
import { CTA_ARROW_SIZE, CTA_HEIGHT } from './formMetrics';

export interface FormSubmitButtonProps {
  title: string;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
}

/**
 * The button that sends a form (a visitor pass, a booking, feedback, a maintenance
 * request): the four-stop CTA gradient with a trailing arrow, in Visitor Access's form
 * sizes so every form ends the same way.
 */
export function FormSubmitButton({ title, onPress, style }: FormSubmitButtonProps) {
  const theme = useAppTheme();

  return (
    <AppButton
      title={title}
      variant="gradient"
      gradientColors={[theme.colors.ctaSky, theme.colors.ctaRoyal, theme.colors.ctaViolet, theme.colors.ctaPink]}
      height={CTA_HEIGHT}
      labelVariant="statValue"
      trailingIcon={<ArrowRightIcon size={CTA_ARROW_SIZE} thickness={1.2} />}
      trailingPlacement="label"
      onPress={onPress}
      style={style}
    />
  );
}
