import { LinearGradient } from 'expo-linear-gradient';
import { useMemo } from 'react';
import { Image, Pressable, StyleSheet, View, type ImageSourcePropType } from 'react-native';

import { AppIcon } from '../../components/common/AppIcon';
import { AppText } from '../../components/common/AppText';
import type { IconSet } from '../../components/ui/ServiceTile';
import { useAppTheme } from '../../hooks/useAppTheme';
import type { AppTheme } from '../../types/theme.types';

export interface SceneTileProps {
  label: string;
  photo: ImageSourcePropType;
  iconSet: IconSet;
  iconName: string;
  active: boolean;
  onPress: () => void;
}

/*
 * Measured on the Smart Home reference: a room photo, drawn 72 x 66dp, darkened
 * towards the bottom under a glyph and the scene's name. The running scene is
 * rimmed in glowing amber; the rest take a faint blue hairline.
 */
const ASPECT = 1.08;
const ICON_SIZE = 17;
const ACTIVE_STROKE = 1.5;
const BOTTOM = 7;

/** One scene in the Smart Home "Scenes" panel. */
export function SceneTile({ label, photo, iconSet, iconName, active, onPress }: SceneTileProps) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      style={({ pressed }) => [styles.tile, active && styles.activeGlow, pressed && styles.pressed]}
    >
      <View style={[styles.frame, active ? styles.activeFrame : styles.idleFrame]}>
        <Image
          source={photo}
          style={styles.photo}
          resizeMode="cover"
          fadeDuration={0}
          accessibilityIgnoresInvertColors
        />
        <LinearGradient
          colors={[theme.colors.transparent, theme.colors.scrimTop, theme.colors.scrimBottom]}
          locations={[0.25, 0.6, 1]}
          style={StyleSheet.absoluteFill}
        />
        <View style={styles.caption}>
          <AppIcon set={iconSet} name={iconName} size={ICON_SIZE} />
          <AppText variant="statLabel" align="center" numberOfLines={2} style={styles.label}>
            {label}
          </AppText>
        </View>
      </View>
    </Pressable>
  );
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    tile: {
      flex: 1,
      aspectRatio: ASPECT,
      borderRadius: theme.borderRadius.sm,
    },
    // On the unclipped wrapper; iOS drops shadows on views that clip.
    activeGlow: {
      backgroundColor: theme.colors.backgroundDeep,
      shadowColor: theme.colors.sceneActive,
      shadowOpacity: 0.85,
      shadowRadius: 7,
      shadowOffset: { width: 0, height: 0 },
      elevation: 6,
    },
    frame: {
      flex: 1,
      borderRadius: theme.borderRadius.sm,
      overflow: 'hidden',
      justifyContent: 'flex-end',
    },
    idleFrame: {
      borderWidth: theme.glass.strokeWidth,
      borderColor: theme.colors.avatarStroke,
    },
    activeFrame: {
      borderWidth: ACTIVE_STROKE,
      borderColor: theme.colors.sceneActive,
    },
    // Explicit 100% rather than absoluteFill: react-native-web stamps the
    // image's intrinsic size onto the element, which beats inset-0 alone.
    photo: {
      position: 'absolute',
      top: 0,
      left: 0,
      width: '100%',
      height: '100%',
    },
    caption: {
      alignItems: 'center',
      paddingBottom: BOTTOM,
      paddingHorizontal: 2,
    },
    label: {
      marginTop: 3,
    },
    pressed: {
      opacity: 0.8,
    },
  });
}
