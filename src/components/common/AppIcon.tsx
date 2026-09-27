import Ionicons from '@expo/vector-icons/Ionicons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { StyleProp, TextStyle } from 'react-native';

import { useAppTheme } from '../../hooks/useAppTheme';
import type { IconSet } from '../ui/ServiceTile';

export interface AppIconProps {
  set: IconSet;
  name: string;
  size: number;
  /** Defaults to the primary text colour. */
  color?: string;
  style?: StyleProp<TextStyle>;
}

/**
 * One glyph from either icon family, chosen by the `IconSet` that screen data
 * already carries, so data-driven rows need no per-set branching of their own.
 */
export function AppIcon({ set, name, size, color, style }: AppIconProps) {
  const theme = useAppTheme();
  const tint = color ?? theme.colors.textPrimary;

  // The icon sets do not share a name union, so the name is typed per set.
  return set === 'ionicons' ? (
    <Ionicons name={name as keyof typeof Ionicons.glyphMap} size={size} color={tint} style={style} />
  ) : (
    <MaterialCommunityIcons
      name={name as keyof typeof MaterialCommunityIcons.glyphMap}
      size={size}
      color={tint}
      style={style}
    />
  );
}
