import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import type { LayoutChangeEvent, View } from 'react-native';

export interface LayoutSize {
  width: number;
  height: number;
}

const EMPTY: LayoutSize = { width: 0, height: 0 };

/** Any host view or text: all of them expose the DOM-style measuring API. */
type Measurable = { getBoundingClientRect(): { width: number; height: number } };

/**
 * A view's size, known on the frame it first appears.
 *
 * `onLayout` alone reports the size only after the first frame is on screen,
 * so anything drawn from it (the neon card edge, gradient text) pops in a
 * frame late. The New Architecture lets a layout effect read layout
 * synchronously, before paint, so the first frame already has the size;
 * `onLayout` then tracks later changes.
 *
 * Attach `ref` and `onLayout` to the same view. Pass `enabled: false` to skip
 * the work for callers that do not need the size.
 */
export function useLayoutSize<T extends Measurable = View>(enabled = true) {
  const ref = useRef<T>(null);
  const [size, setSize] = useState<LayoutSize>(EMPTY);

  const update = useCallback((width: number, height: number) => {
    setSize((current) =>
      Math.abs(current.width - width) < 0.01 && Math.abs(current.height - height) < 0.01
        ? current
        : { width, height },
    );
  }, []);

  useLayoutEffect(() => {
    if (!enabled) {
      return;
    }
    const rect = ref.current?.getBoundingClientRect();
    if (rect && rect.width > 0) {
      update(rect.width, rect.height);
    }
  }, [enabled, update]);

  const onLayout = useCallback(
    (event: LayoutChangeEvent) => {
      if (enabled) {
        update(event.nativeEvent.layout.width, event.nativeEvent.layout.height);
      }
    },
    [enabled, update],
  );

  return { ref, size, onLayout };
}
