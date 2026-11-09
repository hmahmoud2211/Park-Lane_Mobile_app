import { useId, useMemo } from 'react';
import Svg, { Circle, Defs, LinearGradient, Path, Stop } from 'react-native-svg';

import { useAppTheme } from '../../hooks/useAppTheme';
import { clamp } from '../../utils/responsive';

export interface SpeedGaugeProps {
  /** How far the needle points, 0-1 of full scale. */
  fraction: number;
  width: number;
}

/*
 * Measured on the reference (assets/Screens/screen16.png): a ring of short
 * segments, opening at the bottom a little below the horizontal, coloured
 * left to right from royal blue through cyan and near-white into slate, between
 * two faint rims. The needle is a tapered cyan blade from the centre.
 */
const HALF_SWEEP = 102;
const SEGMENTS = 30;
/** Share of each segment's slot left as the gap after it. */
const GAP_SHARE = 0.24;
/** The band's inner edge, as a share of its outer radius. */
const BAND_INNER = 0.82;
/** Room around the ring for the outer rim and the glow. */
const PAD = 2;
const RIM_WIDTH = 1;
const NEEDLE_BASE = 3.4;
const NEEDLE_TIP = 0.6;
const PIVOT_RADIUS = 2.4;

/** A point on a circle about (cx, cy), `degrees` clockwise from the top. */
function point(cx: number, cy: number, r: number, degrees: number) {
  const radians = (degrees * Math.PI) / 180;
  return { x: cx + r * Math.sin(radians), y: cy - r * Math.cos(radians) };
}

function arc(cx: number, cy: number, r: number, from: number, to: number) {
  const a = point(cx, cy, r, from);
  const b = point(cx, cy, r, to);
  return `M ${a.x} ${a.y} A ${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${b.x} ${b.y}`;
}

/** Height the gauge takes for a width: down to the ring's lowest point. */
export function speedGaugeHeight(width: number): number {
  const r = width / 2 - PAD;
  return PAD + r - r * Math.cos((HALF_SWEEP * Math.PI) / 180) + PAD;
}

/** The Internet panel's dial: download speed against the gauge's full scale. */
export function SpeedGauge({ fraction, width }: SpeedGaugeProps) {
  const theme = useAppTheme();
  const id = useId().replace(/:/g, '');
  const height = speedGaugeHeight(width);

  const cx = width / 2;
  const outer = width / 2 - PAD;
  const cy = PAD + outer;
  const inner = outer * BAND_INNER;
  const band = outer - RIM_WIDTH * 2 - inner;

  const segments = useMemo(() => {
    const slot = (2 * HALF_SWEEP) / SEGMENTS;
    const r1 = outer - RIM_WIDTH * 2;
    return Array.from({ length: SEGMENTS }, (_, index) => {
      const from = -HALF_SWEEP + index * slot;
      const to = from + slot * (1 - GAP_SHARE);
      const a = point(cx, cy, r1, from);
      const b = point(cx, cy, r1, to);
      const c = point(cx, cy, inner, to);
      const d = point(cx, cy, inner, from);
      return `M ${a.x} ${a.y} A ${r1} ${r1} 0 0 1 ${b.x} ${b.y} L ${c.x} ${c.y} A ${inner} ${inner} 0 0 0 ${d.x} ${d.y} Z`;
    });
  }, [cx, cy, outer, inner]);

  // The needle: a tapered blade from the pivot to just inside the band.
  const angle = -HALF_SWEEP + 2 * HALF_SWEEP * clamp(fraction, 0, 1);
  const length = inner - 5;
  const tip = point(cx, cy, length, angle);
  const baseLeft = point(cx, cy, NEEDLE_BASE / 2, angle - 90);
  const baseRight = point(cx, cy, NEEDLE_BASE / 2, angle + 90);
  const tipLeft = point(tip.x, tip.y, NEEDLE_TIP / 2, angle - 90);
  const tipRight = point(tip.x, tip.y, NEEDLE_TIP / 2, angle + 90);
  const needle = `M ${baseLeft.x} ${baseLeft.y} L ${tipLeft.x} ${tipLeft.y} L ${tipRight.x} ${tipRight.y} L ${baseRight.x} ${baseRight.y} Z`;

  return (
    <Svg width={width} height={height}>
      <Defs>
        <LinearGradient id={`band-${id}`} x1="0" y1="0" x2={width} y2="0" gradientUnits="userSpaceOnUse">
          <Stop offset="0" stopColor={theme.colors.bmsGaugeLow} />
          <Stop offset="0.32" stopColor={theme.colors.electricCyan} />
          <Stop offset="0.5" stopColor={theme.colors.bmsGaugeTop} />
          <Stop offset="0.7" stopColor={theme.colors.bmsGaugePeak} />
          <Stop offset="1" stopColor={theme.colors.bmsGaugeEnd} />
        </LinearGradient>
        <LinearGradient
          id={`needle-${id}`}
          x1={cx}
          y1={cy}
          x2={tip.x}
          y2={tip.y}
          gradientUnits="userSpaceOnUse"
        >
          <Stop offset="0" stopColor={theme.colors.electricCyan} />
          <Stop offset="1" stopColor={theme.colors.bmsGaugeTop} />
        </LinearGradient>
      </Defs>

      {/* A soft glow under the band, then its two rims. */}
      <Path
        d={arc(cx, cy, inner + band / 2, -HALF_SWEEP, HALF_SWEEP)}
        stroke={theme.colors.bmsGaugeGlow}
        strokeWidth={band + 5}
        fill="none"
      />
      <Path d={arc(cx, cy, outer - RIM_WIDTH / 2, -HALF_SWEEP, HALF_SWEEP)} stroke={theme.colors.bmsGaugeRim} strokeWidth={RIM_WIDTH} fill="none" />
      <Path d={arc(cx, cy, inner - 2.5, -HALF_SWEEP, HALF_SWEEP)} stroke={theme.colors.bmsGaugeRim} strokeWidth={RIM_WIDTH} fill="none" />

      {segments.map((d, index) => (
        <Path key={index} d={d} fill={`url(#band-${id})`} />
      ))}

      <Path d={needle} fill={`url(#needle-${id})`} />
      <Circle cx={cx} cy={cy} r={PIVOT_RADIUS} fill={theme.colors.electricCyan} />
    </Svg>
  );
}
