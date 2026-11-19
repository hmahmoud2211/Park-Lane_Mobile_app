import type { StyleProp, ViewStyle } from 'react-native';

import type { CircleMember } from '../types';

export interface CircleMapProps {
  members: readonly CircleMember[];
  style?: StyleProp<ViewStyle>;
}

/** expo-maps has no web version: the web app shows the Circle as a list only (docs/plans/FAMILY_CIRCLE_PLAN.md, D10). */
export function CircleMap(_props: CircleMapProps) {
  return null;
}
