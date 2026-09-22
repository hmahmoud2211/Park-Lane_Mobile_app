import { useId, useMemo, useState } from 'react';
import {
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import Svg, { Defs, LinearGradient, Stop, Text as SvgText } from 'react-native-svg';

import { useAppTheme } from '../../hooks/useAppTheme';
import type { TypographyVariant } from '../../theme';
import { AppText } from './AppText';

export interface GradientTextProps {
  children: string;
  variant?: TypographyVariant;
  colors?: readonly [string, string];
  style?: StyleProp<ViewStyle>;
}

/**
 * Text filled with a horizontal gradient, as on the login heading's "Back".
 *
 * An invisible copy of the string sizes the box and the SVG is drawn over it at
 * exactly that size. The size has to be passed to <Svg> as width/height props:
 * sizing it through styles alone leaves the element at the SVG default of
 * 300x150, which pushes the glyphs well below their intended baseline.
 */
export function GradientText({ children, variant = 'heading', colors, style }: GradientTextProps) {
  const theme = useAppTheme();
  // Colons from useId() are not safe inside an SVG url(#...) reference.
  const rawId = useId();
  const id = useMemo(() => `grad-${rawId.replace(/:/g, '')}`, [rawId]);
  const [box, setBox] = useState({ width: 0, height: 0 });

  const [from, to] = colors ?? [theme.colors.electricCyan, theme.colors.frameGradientEnd];
  const textStyle = theme.typography[variant] as TextStyle;
  const fontSize = textStyle.fontSize ?? 16;

  const onLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setBox((current) =>
      Math.abs(current.width - width) < 0.5 && Math.abs(current.height - height) < 0.5
        ? current
        : { width, height },
    );
  };

  // Centre the cap height in the line box, matching how Text lays glyphs out.
  const baseline = box.height / 2 + fontSize * 0.36;

  return (
    <View style={[styles.root, style]}>
      <AppText variant={variant} onLayout={onLayout} style={styles.sizer}>
        {children}
      </AppText>

      {box.width > 0 ? (
        <Svg width={box.width} height={box.height} style={styles.overlay}>
          <Defs>
            <LinearGradient id={id} x1="0" y1="0" x2="1" y2="0">
              <Stop offset="0" stopColor={from} />
              <Stop offset="1" stopColor={to} />
            </LinearGradient>
          </Defs>
          <SvgText
            x={0}
            y={baseline}
            fill={`url(#${id})`}
            fontFamily={textStyle.fontFamily}
            fontSize={fontSize}
            fontWeight="700"
            letterSpacing={textStyle.letterSpacing ?? 0}
          >
            {children}
          </SvgText>
        </Svg>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    // Anchors the overlay; react-native-web does not position plain Views.
    position: 'relative',
  },
  sizer: {
    opacity: 0,
  },
  overlay: {
    position: 'absolute',
    left: 0,
    top: 0,
  },
});
