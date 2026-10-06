import { createContext, useContext, useMemo, type Ref } from 'react';
import { Text, type StyleProp, type TextProps, type TextStyle } from 'react-native';

import { useAppTheme } from '../../hooks/useAppTheme';
import type { TypographyVariant } from '../../theme';

/**
 * The figure and caption roles My Unit shrinks in step on narrower cards (see
 * StatItem `scale`). Headings and hero type keep their size.
 */
const SCALED_VARIANTS: ReadonlySet<TypographyVariant> = new Set([
  'statLabel',
  'statValue',
  'statValueLarge',
  'tileTitle',
  'tileCaption',
]);

/**
 * Scales the figure and caption roles for every AppText inside it, so a
 * screen can set its small type exactly as My Unit's is drawn. Defaults to 1,
 * which leaves every token at its own size.
 */
export const TypeScaleContext = createContext(1);

export interface AppTextProps extends TextProps {
  variant?: TypographyVariant;
  color?: string;
  align?: TextStyle['textAlign'];
  style?: StyleProp<TextStyle>;
  ref?: Ref<Text>;
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
  const typeScale = useContext(TypeScaleContext);

  const composed = useMemo<StyleProp<TextStyle>>(() => {
    const base: TextStyle = theme.typography[variant];
    const scaled =
      typeScale !== 1 && SCALED_VARIANTS.has(variant) && base.fontSize && base.lineHeight
        ? { fontSize: base.fontSize * typeScale, lineHeight: base.lineHeight * typeScale }
        : null;
    return [
      base,
      scaled,
      { color: color ?? theme.colors.textPrimary },
      align ? { textAlign: align } : null,
      style,
    ];
  }, [theme, variant, typeScale, color, align, style]);

  return (
    <Text {...rest} style={composed}>
      {children}
    </Text>
  );
}
