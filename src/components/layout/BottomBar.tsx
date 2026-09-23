import { useMemo, type PropsWithChildren } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { useAppTheme } from '../../hooks/useAppTheme';
import { GlassSurface } from '../common/GlassSurface';

export interface BottomBarProps extends PropsWithChildren {
  height?: number;
  style?: StyleProp<ViewStyle>;
}

/**
 * The glass bar pinned at the bottom of the home screen.
 *
 * The reference design shows it empty, so it ships empty and accepts children
 * for when the tab design lands.
 */
export function BottomBar({ height = 56, style, children }: BottomBarProps) {
  const theme = useAppTheme();

  const styles = useMemo(
    () =>
      StyleSheet.create({
        surface: {
          height,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-around',
          paddingHorizontal: theme.spacing.lg,
        },
      }),
    [height, theme],
  );

  return (
    <View style={style}>
      <GlassSurface radius={height / 2} style={styles.surface}>
        {children}
      </GlassSurface>
    </View>
  );
}
