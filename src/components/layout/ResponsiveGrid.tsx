import { type Key, type ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import { useLayoutSize } from '../../hooks/useLayoutSize';
import { clamp } from '../../utils/responsive';

export interface ResponsiveGridProps<T> {
  data: readonly T[];
  renderItem: (item: T, index: number) => ReactNode;
  keyExtractor: (item: T, index: number) => Key;
  /**
   * Narrowest an item may get. The grid fits as many columns as allow it,
   * within `minColumns` and `maxColumns`.
   */
  minItemWidth: number;
  /** Columns on the narrowest frames, i.e. the phone design's count. */
  minColumns?: number;
  maxColumns?: number;
  /** Space between columns. */
  gap: number;
  /** Space between rows; defaults to `gap`. */
  rowGap?: number;
  style?: StyleProp<ViewStyle>;
}

/**
 * Tiles in as many columns as the width allows: the phone design's two or
 * three, and more on tablets and desktops. Items in a short last row keep a
 * full column's width rather than stretching.
 *
 * The grid measures itself before its first paint (see useLayoutSize), so it
 * lays out for the column it sits in, not the window.
 */
export function ResponsiveGrid<T>({
  data,
  renderItem,
  keyExtractor,
  minItemWidth,
  minColumns = 1,
  maxColumns = 6,
  gap,
  rowGap = gap,
  style,
}: ResponsiveGridProps<T>) {
  const { ref, size, onLayout } = useLayoutSize();
  const fit = size.width > 0 ? Math.floor((size.width + gap) / (minItemWidth + gap)) : minColumns;
  const columns = clamp(fit, minColumns, maxColumns);

  return (
    <View ref={ref} onLayout={onLayout} style={style}>
      {/* Negative outer margins let each item carry half of the gap. */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -gap / 2, rowGap }}>
        {data.map((item, index) => (
          <View
            key={keyExtractor(item, index)}
            style={{ width: `${100 / columns}%`, paddingHorizontal: gap / 2 }}
          >
            {renderItem(item, index)}
          </View>
        ))}
      </View>
    </View>
  );
}
