import { createContext, useContext, useMemo, type Ref } from 'react';
import { Platform, Text, type StyleProp, type TextInstance, type TextProps, type TextStyle } from 'react-native';

import { useAppTheme } from '../../hooks/useAppTheme';
import type { TypographyVariant } from '../../theme';
import { LayoutDirectionContext } from './DirectionView';

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
  ref?: Ref<TextInstance>;
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
  // Inside a right-to-left page every line starts at the right, even one that opens with a plate or bay code.
  const direction = useContext(LayoutDirectionContext);

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
      direction && Platform.OS !== 'web' ? { writingDirection: direction } : null,
      style,
    ];
  }, [theme, variant, typeScale, color, align, direction, style]);

  // react-native-web sets each text's direction from its first letter unless told; RN's types don't list `dir`.
  const web = direction && Platform.OS === 'web' ? ({ dir: direction } as TextProps) : null;

  return (
    <Text {...rest} {...web} style={composed}>
      {children}
    </Text>
  );
}
