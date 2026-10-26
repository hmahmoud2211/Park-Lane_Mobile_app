import { Children, type ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import { useAppTheme } from '../../hooks/useAppTheme';
import { useScreenLayout } from '../../hooks/useScreenLayout';
import { FadeIn } from '../common/FadeIn';

export interface ResponsiveColumnsProps {
  /**
   * One child per column, in reading order; use a fragment to put several
   * cards in one. Null children are skipped.
   */
  children: ReactNode;
  /** Space between the cards in a column, and between stacked columns. */
  gap: number;
  /** Relative widths side by side, e.g. `[3, 2]`; equal by default. */
  weights?: readonly number[];
  /** Where shorter columns sit beside taller ones. */
  align?: 'start' | 'center' | 'end' | 'stretch';
  style?: StyleProp<ViewStyle>;
}

const ALIGN = {
  start: 'flex-start',
  center: 'center',
  end: 'flex-end',
  stretch: 'stretch',
} as const;

/**
 * A page's sections, side by side where the page has room for two columns
 * (see utils/responsive) and stacked in order where it does not. Stacked,
 * the result is exactly a column of cards `gap` apart, so a phone layout is
 * unchanged by adopting it.
 *
 * The element tree is the same either way, so a resize or a rotation
 * reflows the page without remounting its cards.
 */
export function ResponsiveColumns({ children, gap, weights, align = 'start', style }: ResponsiveColumnsProps) {
  const theme = useAppTheme();
  const { columns, columnGap } = useScreenLayout();
  const sideBySide = columns > 1;
  const items = Children.toArray(children);

  return (
    <View
      style={[
        sideBySide ? { flexDirection: 'row', alignItems: ALIGN[align], gap: columnGap } : { gap },
        style,
      ]}
    >
      {items.map((column, index) => (
        <FadeIn
          // Children.toArray has already keyed each child.
          key={(column as { key?: string }).key ?? index}
          delay={index * theme.motion.stagger * 2}
          style={[{ gap }, sideBySide && { flex: weights?.[index] ?? 1, minWidth: 0 }]}
        >
          {column}
        </FadeIn>
      ))}
    </View>
  );
}
