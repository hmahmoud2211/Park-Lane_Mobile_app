import { Children, Fragment, useMemo, type ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { useAppTheme } from '../../hooks/useAppTheme';

export interface DividedRowProps {
  children: ReactNode;
  /**
   * Relative column widths, one per child. Omitted entries default to 1, so
   * leaving this out gives equal columns.
   */
  weights?: readonly number[];
  /** Space on each side of a separator. */
  gap?: number;
  style?: StyleProp<ViewStyle>;
}

/**
 * Columns separated by faint vertical hairlines, as in the My Unit cards'
 * figure rows. Separators stretch to the tallest column.
 */
export function DividedRow({ children, weights, gap = 12, style }: DividedRowProps) {
  const theme = useAppTheme();

  const styles = useMemo(
    () =>
      StyleSheet.create({
        row: {
          flexDirection: 'row',
          alignItems: 'stretch',
        },
        separator: {
          width: StyleSheet.hairlineWidth,
          marginHorizontal: gap,
          backgroundColor: theme.colors.dividerSubtle,
        },
      }),
    [gap, theme],
  );

  const columns = Children.toArray(children);

  return (
    <View style={[styles.row, style]}>
      {columns.map((column, index) => (
        <Fragment key={index}>
          {index > 0 ? <View style={styles.separator} /> : null}
          <View style={{ flex: weights?.[index] ?? 1 }}>{column}</View>
        </Fragment>
      ))}
    </View>
  );
}
