import Svg, { Circle, Line, Polyline } from 'react-native-svg';

import { useAppTheme } from '../../hooks/useAppTheme';

export interface SparklineProps {
  /** Oldest first. */
  values: readonly number[];
  /** Drawn as a dashed line when it falls inside the plotted span. */
  refHigh?: number | null;
  width?: number;
  height?: number;
  accessibilityLabel: string;
}

const PAD = 4;

/**
 * A lab test's trend at a glance: the results as a line, the latest as a
 * dot, and any result above the normal range in the error colour.
 */
export function Sparkline({ values, refHigh, width = 104, height = 34, accessibilityLabel }: SparklineProps) {
  const theme = useAppTheme();
  if (values.length < 2) return null;
  const all = refHigh != null ? [...values, refHigh] : [...values];
  const min = Math.min(...all);
  const max = Math.max(...all);
  const span = max - min || 1;
  const x = (i: number) => PAD + (i * (width - 2 * PAD)) / (values.length - 1);
  const y = (v: number) => height - PAD - ((v - min) * (height - 2 * PAD)) / span;
  const above = (v: number) => refHigh != null && v > refHigh;
  const last = values.length - 1;

  return (
    <Svg width={width} height={height} accessible accessibilityLabel={accessibilityLabel}>
      {refHigh != null ? (
        <Line
          x1={PAD}
          x2={width - PAD}
          y1={y(refHigh)}
          y2={y(refHigh)}
          stroke={theme.colors.textMuted}
          strokeWidth={1}
          strokeDasharray="3 3"
        />
      ) : null}
      <Polyline
        points={values.map((v, i) => `${x(i)},${y(v)}`).join(' ')}
        fill="none"
        stroke={theme.colors.accent}
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {values.map((v, i) => (
        <Circle
          key={i}
          cx={x(i)}
          cy={y(v)}
          r={i === last ? 3.5 : 2.2}
          fill={above(v) ? theme.colors.error : theme.colors.accent}
        />
      ))}
    </Svg>
  );
}
