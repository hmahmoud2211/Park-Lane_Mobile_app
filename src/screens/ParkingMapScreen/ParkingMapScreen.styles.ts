import { StyleSheet } from 'react-native';

import type { AppTheme } from '../../types/theme.types';

/** The map's column and the directions' beside it, on screens with room for both. */
export const MAP_COLUMN_WEIGHTS = [3, 2] as const;

/** The map panel runs edge to edge; the route on it does the guiding. */
export function createStyles(_theme: AppTheme) {
  return StyleSheet.create({
    mapPad: {
      paddingHorizontal: 10,
      paddingBottom: 12,
    },
    note: {
      marginHorizontal: 2,
    },
  });
}
