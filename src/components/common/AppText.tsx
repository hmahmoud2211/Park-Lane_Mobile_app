import { useMemo } from 'react';
import { Text, type StyleProp, type TextProps, type TextStyle } from 'react-native';

import { useAppTheme } from '../../hooks/useAppTheme';
import type { TypographyVariant } from '../../theme';

export interface AppTextProps extends TextProps {
  variant?: TypographyVariant;
  color?: string;
  align?: TextStyle['textAlign'];
  style?: StyleProp<TextStyle>;
}

export function AppText({
  variant = 'body',
  color,
  align,
  style,
  children,
  ...rest
}: AppTextProps) {
  const theme = useAppTheme();

  const composed = useMemo<StyleProp<TextStyle>>(
    () => [
      theme.typography[variant],
      { color: color ?? theme.colors.textPrimary },
      align ? { textAlign: align } : null,
      style,
    ],
    [theme, variant, color, align, style],
  );

  return (
    <Text {...rest} style={composed}>
      {children}
    </Text>
  );
}
