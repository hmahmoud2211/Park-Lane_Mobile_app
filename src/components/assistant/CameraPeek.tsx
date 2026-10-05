import Ionicons from '@expo/vector-icons/Ionicons';
import { CameraView, type CameraType } from 'expo-camera';
import { File } from 'expo-file-system';
import { LinearGradient } from 'expo-linear-gradient';
import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from 'react';
import { Animated, Easing, Platform, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { useAppTheme } from '../../hooks/useAppTheme';
import type { AppTheme } from '../../types/theme.types';
import { AppText } from '../common/AppText';

export interface CameraPeekHandle {
  /** Base64 JPEG (no `data:` prefix) of the current frame, or '' if there is none yet. */
  capture: () => Promise<string>;
}

export interface CameraPeekProps {
  /** The assistant is studying a frame: sweep the scan line. */
  scanning: boolean;
  ref?: Ref<CameraPeekHandle>;
  style?: StyleProp<ViewStyle>;
}

const NATIVE = Platform.OS !== 'web';
const WIDTH = 108;
const HEIGHT = 144;
const RADIUS = 16;
/** Frames are sent over the socket, so cap the longer side near full HD. */
const MAX_PICTURE_EDGE = 1920;
/** The backend suggests 0.8; mobile sensors are far larger than webcams, so less. */
const JPEG_QUALITY = 0.55;

/**
 * A small live preview, pinned to a corner while the camera is on. The
 * assistant asks for a frame when the resident says "what is this?"; the
 * preview then flashes and a scan line sweeps it while the picture is studied.
 * Defaults to the rear camera; tap the corner button to flip.
 */
export function CameraPeek({ scanning, ref, style }: CameraPeekProps) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const camera = useRef<CameraView>(null);
  const [ready, setReady] = useState(false);
  const [facing, setFacing] = useState<CameraType>('back');
  const [pictureSize, setPictureSize] = useState<string | undefined>(undefined);

  const [appear] = useState(() => new Animated.Value(0));
  const [flash] = useState(() => new Animated.Value(0));
  const [sweep] = useState(() => new Animated.Value(0));

  useEffect(() => {
    const spring = Animated.spring(appear, { toValue: 1, damping: 14, stiffness: 170, useNativeDriver: NATIVE });
    spring.start();
    return () => spring.stop();
  }, [appear]);

  useEffect(() => {
    if (!scanning) {
      sweep.setValue(0);
      return undefined;
    }
    const loop = Animated.loop(
      Animated.timing(sweep, { toValue: 1, duration: 1300, easing: Easing.inOut(Easing.quad), useNativeDriver: NATIVE }),
    );
    loop.start();
    return () => loop.stop();
  }, [scanning, sweep]);

  const onReady = useCallback(async () => {
    setReady(true);
    if (!NATIVE) {
      return;
    }
    try {
      const sizes = (await camera.current?.getAvailablePictureSizesAsync()) ?? [];
      const best = sizes
        .map((size) => ({ size, match: /^(\d+)x(\d+)$/.exec(size) }))
        .filter((entry): entry is { size: string; match: RegExpExecArray } => entry.match !== null)
        .map(({ size, match }) => ({ size, edge: Math.max(Number(match[1]), Number(match[2])) }))
        .filter((entry) => entry.edge <= MAX_PICTURE_EDGE)
        .sort((a, b) => b.edge - a.edge)[0];
      if (best) {
        setPictureSize(best.size);
      }
    } catch {
      // keep the default size
    }
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      capture: async () => {
        if (!camera.current || !ready) {
          return '';
        }
        flash.setValue(1);
        Animated.timing(flash, { toValue: 0, duration: 420, useNativeDriver: NATIVE }).start();
        const photo = await camera.current.takePictureAsync({
          base64: true,
          quality: JPEG_QUALITY,
          shutterSound: false,
        });
        if (NATIVE && photo?.uri) {
          try {
            new File(photo.uri).delete();
          } catch {
            // cache files are purged by the system anyway
          }
        }
        return (photo?.base64 ?? '').replace(/^data:image\/[a-z]+;base64,/i, '');
      },
    }),
    [flash, ready],
  );

  return (
    <Animated.View
      style={[
        styles.frame,
        style,
        {
          opacity: appear,
          transform: [{ scale: appear.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) }],
        },
      ]}
    >
      <View style={styles.clip}>
        <CameraView
          ref={camera}
          style={StyleSheet.absoluteFill}
          facing={facing}
          mode="picture"
          mute
          animateShutter={false}
          pictureSize={pictureSize}
          onCameraReady={onReady}
        />
        {!ready ? (
          <View style={styles.waiting}>
            <Ionicons name="camera-outline" size={22} color={theme.colors.textSecondary} />
            <AppText variant="chatMeta" color={theme.colors.textSecondary} style={styles.waitingLabel}>
              Starting…
            </AppText>
          </View>
        ) : null}

        <Animated.View
          pointerEvents="none"
          style={[
            styles.scan,
            {
              opacity: scanning ? 1 : 0,
              transform: [{ translateY: sweep.interpolate({ inputRange: [0, 1], outputRange: [-24, HEIGHT] }) }],
            },
          ]}
        >
          <LinearGradient
            colors={[theme.colors.scanGlow, theme.colors.scanLine]}
            start={{ x: 0.5, y: 0 }}
            end={{ x: 0.5, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
        <Animated.View pointerEvents="none" style={[styles.flash, { opacity: flash }]} />
      </View>

      <Pressable
        onPress={() => setFacing((side) => (side === 'back' ? 'front' : 'back'))}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Switch camera"
        style={({ pressed }) => [styles.flip, pressed && styles.pressed]}
      >
        <Ionicons name="camera-reverse-outline" size={15} color={theme.colors.textPrimary} />
      </Pressable>
    </Animated.View>
  );
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    frame: {
      width: WIDTH,
      height: HEIGHT,
      borderRadius: RADIUS,
      borderWidth: 1.5,
      borderColor: theme.colors.accent,
      backgroundColor: theme.colors.cameraFill,
      ...theme.shadows.glow,
    },
    clip: {
      flex: 1,
      borderRadius: RADIUS - 1.5,
      overflow: 'hidden',
    },
    waiting: {
      ...StyleSheet.absoluteFill,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.colors.cameraFill,
    },
    waitingLabel: {
      marginTop: 6,
    },
    scan: {
      position: 'absolute',
      left: 0,
      right: 0,
      top: 0,
      height: 24,
    },
    flash: {
      ...StyleSheet.absoluteFill,
      backgroundColor: theme.colors.white,
    },
    flip: {
      position: 'absolute',
      right: 6,
      bottom: 6,
      width: 28,
      height: 28,
      borderRadius: 14,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.colors.scrimBottom,
    },
    pressed: {
      opacity: 0.7,
    },
  });
}
