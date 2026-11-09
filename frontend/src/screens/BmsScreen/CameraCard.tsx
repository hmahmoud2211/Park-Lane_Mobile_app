import Ionicons from '@expo/vector-icons/Ionicons';
import { useMemo, useState } from 'react';
import { Image, Pressable, View, type StyleProp, type ViewStyle } from 'react-native';

import { AppIcon } from '../../components/common/AppIcon';
import { AppText } from '../../components/common/AppText';
import { images } from '../../constants/images';
import { useAppTheme } from '../../hooks/useAppTheme';
import { bmsCopy as copy, type CameraFeed } from './BmsScreen.data';
import { CAMERA_ARROW_SIZE, CAMERA_ICON_SIZE, createStyles } from './BmsScreen.styles';
import { BmsTile } from './BmsTile';

export interface CameraCardProps {
  cameras: readonly CameraFeed[];
  scale: number;
  style?: StyleProp<ViewStyle>;
}

/**
 * The CCTV card: the camera's name over its latest still, with arrows that step
 * through the building's cameras. With only one camera listed there is nothing
 * to step to, so the arrows are shown dimmed and do nothing.
 */
export function CameraCard({ cameras, scale, style }: CameraCardProps) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme, scale), [theme, scale]);
  const [index, setIndex] = useState(0);

  const camera = cameras[index % cameras.length];
  const canStep = cameras.length > 1;
  const step = (by: number) => setIndex((current) => (current + by + cameras.length) % cameras.length);

  const arrow = (direction: -1 | 1) => (
    <Pressable
      onPress={() => step(direction)}
      disabled={!canStep}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={direction < 0 ? copy.previousCamera : copy.nextCamera}
      accessibilityState={{ disabled: !canStep }}
      style={({ pressed }) => [styles.cameraArrow, pressed && styles.pressed, !canStep && styles.disabled]}
    >
      <Ionicons
        name={direction < 0 ? 'caret-back' : 'caret-forward'}
        size={CAMERA_ARROW_SIZE}
        color={theme.colors.textPrimary}
      />
    </Pressable>
  );

  if (!camera) {
    return null;
  }

  return (
    <BmsTile style={[styles.camera, style]}>
      <View style={styles.cameraHeader}>
        <AppIcon set="material" name="cctv" size={CAMERA_ICON_SIZE} style={styles.iconGap} />
        <AppText variant="statValue" numberOfLines={1} style={styles.grow}>
          {camera.name}
        </AppText>
        <View style={styles.cameraArrows}>
          {arrow(-1)}
          {arrow(1)}
        </View>
      </View>
      <View style={styles.snapshot}>
        <Image
          source={images[camera.snapshot]}
          style={styles.snapshotImage}
          resizeMode="cover"
          fadeDuration={0}
          accessibilityLabel={`${camera.name} camera, latest still`}
          accessibilityIgnoresInvertColors
        />
      </View>
    </BmsTile>
  );
}
