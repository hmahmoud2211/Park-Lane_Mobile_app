import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { useId, useMemo, useState, type PropsWithChildren } from 'react';
import {
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Svg, {
  Defs,
  LinearGradient as SvgLinearGradient,
  Rect,
  Stop,
} from 'react-native-svg';

import { useAppTheme } from '../../hooks/useAppTheme';

/**
 * `hairline` is the white 1px stroke from the Figma frame spec, used on the
 * onboarding CTA and the login fields. `gradient` is the glowing coloured
 * outline the home screen's cards use instead.
 */
export type GlassStroke = 'hairline' | 'gradient';

export interface GlassSurfaceProps extends PropsWithChildren {
  /** Corner radius; the surface clips its blur and gradient to it. */
  radius: number;
  /** Drop the gradient tint, leaving the stroke and frosted backdrop only. */
  tinted?: boolean;
  stroke?: GlassStroke;
  /** Stops for `stroke="gradient"`; defaults to the card stroke tokens. */
  strokeColors?: readonly [string, string];
  style?: StyleProp<ViewStyle>;
}

/**
 * The Parklane "Glass" frame: a frosted panel, a 20% blue-to-pink gradient
 * fill and an outline, per the Figma spec in `theme/glass.ts`.
 *
 * Both variants share one body, so a gradient-stroked card is exactly as
 * transparent as a hairline one. The coloured outline is drawn as an SVG ring
 * laid over the panel rather than a gradient behind it: a gradient behind
 * would show through the translucent body and flood the card with colour.
 */
export function GlassSurface({
  radius,
  tinted = true,
  stroke = 'hairline',
  strokeColors,
  style,
  children,
}: GlassSurfaceProps) {
  const theme = useAppTheme();
  const isGradient = stroke === 'gradient';

  const rawId = useId();
  const gradientId = useMemo(() => `stroke-${rawId.replace(/:/g, '')}`, [rawId]);
  const [box, setBox] = useState({ width: 0, height: 0 });

  const styles = useMemo(
    () =>
      StyleSheet.create({
        root: {
          borderRadius: radius,
          // Required so Android clips the blur layer to the rounded corners.
          overflow: 'hidden',
          borderWidth: isGradient ? 0 : theme.glass.strokeWidth,
          borderColor: theme.glass.strokeColor,
        },
        fill: { opacity: theme.glass.fillOpacity },
      }),
    [radius, isGradient, theme],
  );

  const onLayout = (event: LayoutChangeEvent) => {
    if (!isGradient) {
      return;
    }
    const { width, height } = event.nativeEvent.layout;
    setBox((current) =>
      Math.abs(current.width - width) < 0.5 && Math.abs(current.height - height) < 0.5
        ? current
        : { width, height },
    );
  };

  const edge = strokeColors ?? ([theme.colors.cardStrokeFrom, theme.colors.cardStrokeTo] as const);
  const strokeWidth = theme.glass.strokeWidth;
  const inset = strokeWidth / 2;

  return (
    <View style={[styles.root, style]} onLayout={onLayout}>
      <BlurView
        intensity={theme.glass.blurIntensity}
        tint={theme.glass.blurTint}
        style={StyleSheet.absoluteFill}
      />

      {tinted ? (
        <LinearGradient
          colors={[...theme.glass.gradientColors]}
          start={theme.glass.gradientStart}
          end={theme.glass.gradientEnd}
          style={[StyleSheet.absoluteFill, styles.fill]}
        />
      ) : null}

      {children}

      {isGradient && box.width > 0 ? (
        <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
          <Defs>
            <SvgLinearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0" stopColor={edge[0]} />
              <Stop offset="1" stopColor={edge[1]} />
            </SvgLinearGradient>
          </Defs>
          <Rect
            x={inset}
            y={inset}
            width={Math.max(0, box.width - strokeWidth)}
            height={Math.max(0, box.height - strokeWidth)}
            rx={Math.max(0, radius - inset)}
            ry={Math.max(0, radius - inset)}
            fill="none"
            stroke={`url(#${gradientId})`}
            strokeWidth={strokeWidth}
          />
        </Svg>
      ) : null}
    </View>
  );
}
