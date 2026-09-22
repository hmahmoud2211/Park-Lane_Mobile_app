import { Image, type ImageStyle, type StyleProp } from 'react-native';

import { images } from '../../constants/images';

export interface GoogleMarkProps {
  size?: number;
  style?: StyleProp<ImageStyle>;
}

/**
 * Google's four-colour "G", required by their branding guidelines on a
 * "Continue with Google" control.
 *
 * Shipped as a raster asset rather than an SVG: inside a blurred glass surface
 * Chrome composites SVG into the backdrop-filter layer, which smears the mark.
 * An Image is unaffected and renders identically on both platforms.
 */
export function GoogleMark({ size = 24, style }: GoogleMarkProps) {
  return (
    <Image
      source={images.googleMark}
      style={[{ width: size, height: size }, style]}
      resizeMode="contain"
      accessibilityLabel="Google"
    />
  );
}
