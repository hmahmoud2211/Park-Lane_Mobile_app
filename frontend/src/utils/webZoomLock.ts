import { Platform } from 'react-native';

const STYLE_ID = 'parklane-zoom-lock';
const VIEWPORT = 'width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover';

/** Ctrl/Cmd with these keys is the browser's zoom in, zoom out and reset shortcut. */
const ZOOM_KEYS = new Set(['+', '=', '-', '_', '0']);

/**
 * Locks the page at 100% on web, so the screens, which are laid out for a
 * fixed phone frame, cannot be pinched, double-tapped or keyed out of shape.
 * Native builds have nothing to lock: no screen enables a ScrollView zoom.
 *
 * Each browser needs its own measure, so all of them are installed together:
 *  - The viewport meta caps the scale. Android Chrome honours it, and it also
 *    stops iOS Safari zooming into a form field on focus.
 *  - iOS Safari ignores that cap for pinches, so its `gesture*` events and
 *    multi-finger touches are cancelled, and `touch-action` stops double-tap zoom.
 *  - Desktop browsers zoom on Ctrl/Cmd + wheel (and trackpad pinches, which
 *    arrive as that) or Ctrl/Cmd with + - 0, so those are cancelled too.
 *
 * The browser's own menu zoom cannot be reached from a page, so it still works.
 */
export function installWebZoomLock(): void {
  if (Platform.OS !== 'web' || typeof document === 'undefined') {
    return;
  }

  if (document.getElementById(STYLE_ID)) {
    return;
  }

  let meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = 'viewport';
    document.head.appendChild(meta);
  }
  meta.content = VIEWPORT;

  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = [
    'html, body {',
    // Pans still scroll; pinch and double-tap zoom are left out.
    '  touch-action: pan-x pan-y;',
    '  -webkit-text-size-adjust: 100%;',
    '  text-size-adjust: 100%;',
    '}',
  ].join('\n');
  document.head.appendChild(style);

  const block = (event: Event) => event.preventDefault();
  // Listeners must be non-passive, or the browser ignores preventDefault.
  const active = { passive: false } as const;

  for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
    document.addEventListener(type, block, active);
  }

  document.addEventListener(
    'touchmove',
    (event: TouchEvent) => {
      if (event.touches.length > 1) {
        event.preventDefault();
      }
    },
    active,
  );

  window.addEventListener(
    'wheel',
    (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
      }
    },
    active,
  );

  window.addEventListener('keydown', (event: KeyboardEvent) => {
    if ((event.ctrlKey || event.metaKey) && ZOOM_KEYS.has(event.key)) {
      event.preventDefault();
    }
  });
}
