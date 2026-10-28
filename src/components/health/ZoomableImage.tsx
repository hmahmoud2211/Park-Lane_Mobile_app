import Ionicons from '@expo/vector-icons/Ionicons';
import { useMemo, useState } from 'react';
import {
  Animated,
  Image,
  PanResponder,
  Pressable,
  StyleSheet,
  View,
  type GestureResponderEvent,
  type ImageSourcePropType,
} from 'react-native';

import { useAppTheme } from '../../hooks/useAppTheme';
import type { AppTheme } from '../../types/theme.types';

export interface ZoomableImageProps {
  source: ImageSourcePropType;
  /** Width over height of the frame; a portrait A4 page by default. */
  aspectRatio?: number;
  accessibilityLabel: string;
  zoomInLabel: string;
  zoomOutLabel: string;
  onError?: () => void;
}

const MAX_SCALE = 4;
const STEP = 1.6;

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

function spread(event: GestureResponderEvent) {
  const [a, b] = event.nativeEvent.touches;
  return Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY);
}

/**
 * A document page the resident can pinch to zoom and drag around, to read
 * a handwritten dose against what was extracted. Buttons zoom as well, for
 * a mouse on web and for anyone who can't pinch.
 *
 * Plain PanResponder rather than a gesture library: one image needs no
 * more. Until it is zoomed, single-finger drags pass through to the page's
 * scroll view.
 */
export function ZoomableImage({
  source,
  aspectRatio = 1000 / 1380,
  accessibilityLabel,
  zoomInLabel,
  zoomOutLabel,
  onError,
}: ZoomableImageProps) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [zoomed, setZoomed] = useState(false);
  const [zoom] = useState(() => new PinchZoom(setZoomed));

  return (
    <View
      style={[styles.frame, { aspectRatio }]}
      onLayout={(event) => zoom.setSize(event.nativeEvent.layout.width, event.nativeEvent.layout.height)}
      {...zoom.handlers}
    >
      <Animated.View
        style={[
          StyleSheet.absoluteFill,
          { transform: [{ translateX: zoom.pan.x }, { translateY: zoom.pan.y }, { scale: zoom.scale }] },
        ]}
      >
        <Image
          source={source}
          resizeMode="contain"
          style={styles.image}
          accessible
          accessibilityLabel={accessibilityLabel}
          onError={onError}
        />
      </Animated.View>
      <View style={styles.controls}>
        <Pressable
          onPress={() => zoom.zoomBy(1 / STEP)}
          disabled={!zoomed}
          accessibilityRole="button"
          accessibilityLabel={zoomOutLabel}
          hitSlop={6}
          style={({ pressed }) => [styles.control, pressed && styles.pressed, !zoomed && styles.disabled]}
        >
          <Ionicons name="remove" size={20} color={theme.colors.textPrimary} />
        </Pressable>
        <Pressable
          onPress={() => zoom.zoomBy(STEP)}
          accessibilityRole="button"
          accessibilityLabel={zoomInLabel}
          hitSlop={6}
          style={({ pressed }) => [styles.control, pressed && styles.pressed]}
        >
          <Ionicons name="add" size={20} color={theme.colors.textPrimary} />
        </Pressable>
      </View>
    </View>
  );
}

/**
 * The gesture's running state, outside React: pinch to scale, drag to pan
 * once zoomed, kept within the frame. Reports only "zoomed or not" back.
 */
class PinchZoom {
  readonly scale = new Animated.Value(1);
  readonly pan = new Animated.ValueXY({ x: 0, y: 0 });
  readonly handlers;
  private current = { scale: 1, x: 0, y: 0 };
  private base = { scale: 1, x: 0, y: 0, spread: 0 };
  private size = { width: 0, height: 0 };

  constructor(private readonly onZoomed: (zoomed: boolean) => void) {
    this.handlers = PanResponder.create({
      onStartShouldSetPanResponder: (event) => event.nativeEvent.touches.length >= 2,
      onMoveShouldSetPanResponder: (event) => event.nativeEvent.touches.length >= 2 || this.current.scale > 1.01,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        this.base = { ...this.current, spread: 0 };
      },
      onPanResponderMove: (event, state) => {
        if (event.nativeEvent.touches.length >= 2) {
          const now = spread(event);
          if (!this.base.spread) {
            this.base = { ...this.current, spread: now };
            return;
          }
          this.apply((this.base.scale * now) / this.base.spread, this.current.x, this.current.y);
        } else if (this.current.scale > 1.01) {
          this.apply(this.current.scale, this.base.x + state.dx, this.base.y + state.dy);
        }
      },
      onPanResponderRelease: () => {
        if (this.current.scale <= 1.01) this.apply(1, 0, 0);
      },
    }).panHandlers;
  }

  setSize(width: number, height: number) {
    this.size = { width, height };
  }

  zoomBy(factor: number) {
    const next = clamp(this.current.scale * factor, 1, MAX_SCALE);
    this.apply(next, next === 1 ? 0 : this.current.x, next === 1 ? 0 : this.current.y);
  }

  private apply(nextScale: number, x: number, y: number) {
    const scale = clamp(nextScale, 1, MAX_SCALE);
    const maxX = (this.size.width * (scale - 1)) / 2;
    const maxY = (this.size.height * (scale - 1)) / 2;
    this.current = { scale, x: clamp(x, -maxX, maxX), y: clamp(y, -maxY, maxY) };
    this.scale.setValue(scale);
    this.pan.setValue({ x: this.current.x, y: this.current.y });
    this.onZoomed(scale > 1.01);
  }
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    frame: {
      width: '100%',
      overflow: 'hidden',
      borderRadius: theme.borderRadius.md,
      borderWidth: 1,
      borderColor: theme.colors.dividerSubtle,
      backgroundColor: theme.colors.cameraFill,
    },
    image: {
      width: '100%',
      height: '100%',
    },
    controls: {
      position: 'absolute',
      right: 8,
      bottom: 8,
      flexDirection: 'row',
      gap: 8,
    },
    control: {
      width: 40,
      height: 40,
      borderRadius: 20,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.colors.scrimBottom,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    pressed: {
      opacity: 0.7,
    },
    disabled: {
      opacity: 0.4,
    },
  });
}
