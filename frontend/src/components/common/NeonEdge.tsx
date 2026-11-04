import { Fragment, memo, useId, useMemo } from 'react';
import { StyleSheet } from 'react-native';
import Svg, { Defs, LinearGradient, RadialGradient, Rect, Stop } from 'react-native-svg';

import { useAppTheme } from '../../hooks/useAppTheme';

export interface NeonEdgeProps {
  /** Size of the card the edge is drawn around. */
  width: number;
  height: number;
  radius: number;
  /** Stroke colour at the left and right ends. */
  colors: readonly [string, string];
  /** Glow colours at the bottom-left and bottom-right corners; default to `colors`. */
  bottomColors?: readonly [string, string];
}

const RING_WIDTH = 1.5;

type Corner = 'tl' | 'tr' | 'bl' | 'br';
const CORNERS: readonly Corner[] = ['tl', 'tr', 'bl', 'br'];

/**
 * The glowing card edge from the My Unit design, drawn as one SVG that
 * overhangs the card so its halo can spill past the edge. Back to front: the
 * corner halo, a dark separating ring, the inner wash (stronger near the
 * corners), then the stroke: a dim base, a glow around each corner and a
 * specular highlight.
 *
 * Rings are concentric rounded rects rather than blur filters, which
 * react-native-svg renders inconsistently across platforms. Each corner glow
 * is the same ring painted with a radial gradient centred on that corner.
 */
function NeonEdgeSvg({ width, height, radius, colors, bottomColors }: NeonEdgeProps) {
  const theme = useAppTheme();
  const neon = theme.glass.neon;

  const rawId = useId();
  const id = useMemo(() => {
    const base = rawId.replace(/:/g, '');
    return (name: string) => `neon-${name}-${base}`;
  }, [rawId]);

  const overhang = neonEdgeOverhang(neon.haloRings.length);

  // A rounded rect whose stroke centreline sits `inset` inside the card's edge
  // (negative insets fall outside it), in the overhanging SVG's coordinates.
  const ring = (inset: number) => ({
    x: overhang + inset,
    y: overhang + inset,
    width: Math.max(0, width - 2 * inset),
    height: Math.max(0, height - 2 * inset),
    rx: Math.max(0, radius - inset),
    ry: Math.max(0, radius - inset),
    fill: 'none',
  });

  const glowRadius = Math.min(neon.cornerGlowRadius, width * neon.cornerGlowMaxSpan);
  const cornerCentre: Record<Corner, { cx: number; cy: number }> = {
    tl: { cx: overhang, cy: overhang },
    tr: { cx: overhang + width, cy: overhang },
    bl: { cx: overhang, cy: overhang + height },
    br: { cx: overhang + width, cy: overhang + height },
  };
  const cornerColour = (corner: Corner) => {
    const pair = corner[0] === 'b' && bottomColors ? bottomColors : colors;
    return corner[1] === 'l' ? pair[0] : pair[1];
  };
  const cornerStrength = (corner: Corner) => (corner[0] === 'b' ? neon.bottomCornerOpacity : 1);

  const strokeInset = neon.strokeWidth / 2;
  const innerRingCount = Math.floor(neon.innerGlowWidth / RING_WIDTH);
  const { highlightCenter: center, highlightSpread: spread } = neon;

  return (
    <Svg
      width={width + overhang * 2}
      height={height + overhang * 2}
      style={[styles.svg, { left: -overhang, top: -overhang }]}
      pointerEvents="none"
    >
      <Defs>
        <LinearGradient id={id('base')} x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0" stopColor={neon.baseFrom} />
          <Stop offset="0.6" stopColor={neon.baseFrom} />
          <Stop offset="1" stopColor={colors[1]} />
        </LinearGradient>
        <LinearGradient id={id('inner')} x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0" stopColor={neon.innerGlowFrom} stopOpacity={neon.innerGlowFromOpacity} />
          <Stop offset="0.6" stopColor={neon.innerGlowFrom} stopOpacity={neon.innerGlowFromOpacity} />
          <Stop offset="1" stopColor={colors[1]} />
        </LinearGradient>
        <LinearGradient id={id('shine')} x1="0" y1="0" x2="1" y2="0">
          <Stop offset={center - spread} stopColor={neon.highlightColor} stopOpacity={0} />
          <Stop offset={center} stopColor={neon.highlightColor} stopOpacity={neon.highlightOpacity} />
          <Stop offset={center + spread} stopColor={neon.highlightColor} stopOpacity={0} />
        </LinearGradient>
        {CORNERS.map((corner) => {
          const { cx, cy } = cornerCentre[corner];
          const colour = cornerColour(corner);
          const strength = cornerStrength(corner);
          return (
            <RadialGradient
              key={corner}
              id={id(corner)}
              cx={cx}
              cy={cy}
              r={glowRadius}
              fx={cx}
              fy={cy}
              gradientUnits="userSpaceOnUse"
            >
              <Stop offset="0" stopColor={colour} stopOpacity={strength} />
              <Stop
                offset="0.5"
                stopColor={colour}
                stopOpacity={strength * neon.cornerGlowMidOpacity}
              />
              <Stop offset="1" stopColor={colour} stopOpacity={0} />
            </RadialGradient>
          );
        })}
      </Defs>

      {neon.haloRings.map((opacity, index) => {
        const inset = -(1 + RING_WIDTH / 2 + index * RING_WIDTH);
        return (
          <Fragment key={`halo-${index}`}>
            {CORNERS.map((corner) => (
              <Rect
                key={corner}
                {...ring(inset)}
                stroke={`url(#${id(corner)})`}
                strokeOpacity={opacity}
                strokeWidth={RING_WIDTH}
              />
            ))}
          </Fragment>
        );
      })}

      <Rect
        {...ring(-0.5)}
        stroke={neon.shadowColor}
        strokeOpacity={neon.shadowOpacity}
        strokeWidth={1}
      />

      {Array.from({ length: innerRingCount }, (_, index) => (
        <Rect
          key={`inner-${index}`}
          {...ring(neon.strokeWidth + RING_WIDTH / 2 + index * RING_WIDTH)}
          stroke={`url(#${id('inner')})`}
          strokeOpacity={
            neon.innerGlowOpacity * Math.exp(-(index * RING_WIDTH) / neon.innerGlowFalloff)
          }
          strokeWidth={RING_WIDTH}
        />
      ))}

      {neon.cornerWashRings.map((opacity, index) => {
        const inset = neon.strokeWidth + RING_WIDTH / 2 + index * RING_WIDTH;
        return (
          <Fragment key={`wash-${index}`}>
            {CORNERS.map((corner) => (
              <Rect
                key={corner}
                {...ring(inset)}
                stroke={`url(#${id(corner)})`}
                strokeOpacity={opacity}
                strokeWidth={RING_WIDTH}
              />
            ))}
          </Fragment>
        );
      })}

      <Rect
        {...ring(strokeInset)}
        stroke={`url(#${id('base')})`}
        strokeOpacity={neon.baseOpacity}
        strokeWidth={neon.strokeWidth}
      />
      {CORNERS.map((corner) => (
        <Rect
          key={`corner-${corner}`}
          {...ring(strokeInset)}
          stroke={`url(#${id(corner)})`}
          strokeWidth={neon.strokeWidth}
        />
      ))}
      <Rect {...ring(strokeInset)} stroke={`url(#${id('shine')})`} strokeWidth={neon.strokeWidth} />
    </Svg>
  );
}

const samePair = (a?: readonly [string, string], b?: readonly [string, string]) =>
  a === b || (!!a && !!b && a[0] === b[0] && a[1] === b[1]);

/**
 * Callers pass their colour pairs as fresh array literals, so compare them by
 * value: the edge is dozens of SVG shapes and must not redraw on every render
 * of its card (e.g. each keystroke in the Visitor Access form).
 */
export const NeonEdge = memo(
  NeonEdgeSvg,
  (prev, next) =>
    prev.width === next.width &&
    prev.height === next.height &&
    prev.radius === next.radius &&
    samePair(prev.colors, next.colors) &&
    samePair(prev.bottomColors, next.bottomColors),
);

/** How far the edge's halo reaches past the card, for callers that need room. */
export function neonEdgeOverhang(haloRingCount: number): number {
  return Math.ceil(1 + haloRingCount * RING_WIDTH);
}

const styles = StyleSheet.create({
  svg: {
    position: 'absolute',
  },
});
