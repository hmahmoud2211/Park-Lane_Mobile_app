import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { useMemo, type PropsWithChildren } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { useAppTheme } from '../../hooks/useAppTheme';

export interface GlassSurfaceProps extends PropsWithChildren {
  /** Corner radius; the surface clips its blur and gradient to it. */
  radius: number;
  /** Drop the gradient tint, leaving blur and stroke only. */
  tinted?: boolean;
  style?: StyleProp<ViewStyle>;
}

/**
 * The Parklane "Glass" frame: blur, a 20% blue-to-pink gradient fill and a
 * white hairline stroke, per the Figma spec captured in `theme/glass.ts`.
 *
 * Shared by the CTA, the login fields and the sign-in option cards so the
 * treatment is defined once. Callers own their own sizing and drop shadow.
 */
export function GlassSurface({ radius, tinted = true, style, children }: GlassSurfaceProps) {
  const theme = useAppTheme();

  const styles = useMemo(
    () =>
      StyleSheet.create({
        root: {
          borderRadius: radius,
          // Required so Android clips the blur layer to the rounded corners.
          overflow: 'hidden',
          borderWidth: theme.glass.strokeWidth,
          borderColor: theme.glass.strokeColor,
        },
        fill: { opacity: theme.glass.fillOpacity },
      }),
    [radius, theme],
  );

  return (
    <View style={[styles.root, style]}>
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
    </View>
  );
}
