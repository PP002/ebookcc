export type HorizontalDirection = 'left' | 'right';

export interface FlipKeyEventLike {
  key?: string;
  code?: string;
  keyCode?: number;
  which?: number;
}

const LEFT_KEYS = new Set([
  'ArrowLeft',
  'Left',
  'DPadLeft',
  'DPAD_LEFT',
  'NavigationLeft',
]);

const RIGHT_KEYS = new Set([
  'ArrowRight',
  'Right',
  'DPadRight',
  'DPAD_RIGHT',
  'NavigationRight',
]);

/**
 * Normalizes horizontal navigation keys across standard keyboards, BlackBerry Passport
 * capacitive touch keyboard cursor/swipe mode, and BlackBerry Classic optical trackpad (D-Pad).
 */
export function getHorizontalKeyDirection(e: FlipKeyEventLike): HorizontalDirection | null {
  const key = e.key || '';
  const code = e.code || '';
  const keyCode = e.keyCode ?? e.which ?? 0;

  if (
    LEFT_KEYS.has(key) ||
    code === 'ArrowLeft' ||
    keyCode === 37 || // DOM VK_LEFT
    keyCode === 21 // Android KEYCODE_DPAD_LEFT
  ) {
    return 'left';
  }

  if (
    RIGHT_KEYS.has(key) ||
    code === 'ArrowRight' ||
    keyCode === 39 || // DOM VK_RIGHT
    keyCode === 22 // Android KEYCODE_DPAD_RIGHT
  ) {
    return 'right';
  }

  return null;
}

/**
 * Checks if focus/event target is an editable field or interactive range/select control
 * where arrow keys or wheel events must remain dedicated to the control.
 */
export function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName?.toUpperCase();
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'OPTION') {
    return true;
  }
  if (el.isContentEditable) return true;
  if (typeof el.getAttribute === 'function' && el.getAttribute('contenteditable') === 'true') {
    return true;
  }
  if (typeof el.closest === 'function' && el.closest('[contenteditable="true"]')) {
    return true;
  }
  return false;
}

/**
 * Checks whether an ancestor element between startEl and boundaryEl can currently scroll
 * horizontally in the requested deltaX direction.
 */
export function canElementScrollHorizontally(
  startEl: EventTarget | null,
  deltaX: number,
  boundaryEl?: HTMLElement | null
): boolean {
  let node = startEl as HTMLElement | null;
  while (node && node !== boundaryEl) {
    if (node.nodeType === 1) {
      const style = node.ownerDocument?.defaultView?.getComputedStyle?.(node);
      const overflowX = style?.overflowX;
      if (
        (overflowX === 'auto' || overflowX === 'scroll' || overflowX === 'overlay') &&
        node.scrollWidth > node.clientWidth + 2
      ) {
        if (deltaX > 0 && node.scrollLeft + node.clientWidth < node.scrollWidth - 2) {
          return true;
        }
        if (deltaX < 0 && node.scrollLeft > 2) {
          return true;
        }
      }
    }
    node = node.parentElement;
  }
  return false;
}

export interface WheelPageFlipperOptions {
  /** Accumulated horizontal delta threshold in px before flipping a page (default: 28). */
  threshold?: number;
  /** Minimum ms between consecutive page flips to swallow trackpad momentum inertia (default: 420). */
  cooldownMs?: number;
  /** Idle gap ms after which partial delta accumulation resets (default: 180). */
  resetGapMs?: number;
  /** Optional guard predicate; return false to let native wheel behavior run untouched. */
  shouldHandle?: (e: WheelEvent) => boolean;
}

/**
 * Attaches a non-passive wheel + legacy mousewheel listener that translates horizontal
 * capacitive touch keyboard swipes (BlackBerry Passport), optical trackpad swipes
 * (BlackBerry Classic), and trackpad horizontal flicks into single discrete page flips
 * while ignoring vertical scrolling and pinch-zoom.
 */
export function attachWheelPageFlipper(
  target: HTMLElement | Document | Window,
  onFlip: (dir: HorizontalDirection) => void,
  options: WheelPageFlipperOptions = {}
): () => void {
  const threshold = options.threshold ?? 28;
  const cooldownMs = options.cooldownMs ?? 420;
  const resetGapMs = options.resetGapMs ?? 180;

  let accumX = 0;
  let lastEventTime = 0;
  let lastFlipTime = 0;
  let sawModernWheel = false;

  const normalizeDeltas = (e: any): { dx: number; dy: number } => {
    let dx = typeof e.deltaX === 'number' ? e.deltaX : 0;
    let dy = typeof e.deltaY === 'number' ? e.deltaY : 0;

    if (dx === 0 && typeof e.wheelDeltaX === 'number') {
      dx = -e.wheelDeltaX;
    }
    if (dy === 0 && typeof e.wheelDeltaY === 'number') {
      dy = -e.wheelDeltaY;
    }

    // Line / Page deltaMode normalization
    if (e.deltaMode === 1) {
      dx *= 16;
      dy *= 16;
    } else if (e.deltaMode === 2) {
      dx *= 400;
      dy *= 400;
    }

    return { dx, dy };
  };

  const processWheel = (e: WheelEvent) => {
    if (e.ctrlKey || e.metaKey) return;
    if (isEditableTarget(e.target)) return;
    if (options.shouldHandle && !options.shouldHandle(e)) return;

    const { dx, dy } = normalizeDeltas(e);
    if (dx === 0) return;

    const absX = Math.abs(dx);
    const absY = Math.abs(dy);

    // Must be predominantly horizontal so vertical scrolling (up-down) stays native
    if (absX <= absY * 1.05) return;

    const boundary = target instanceof HTMLElement ? target : null;
    if (canElementScrollHorizontally(e.target, dx, boundary)) return;

    // Prevent browser horizontal overscroll / history back-forward navigation
    if (e.cancelable) {
      e.preventDefault();
    }

    const now = Date.now();

    // Suppress trackpad/capacitive inertia events right after a page flip
    if (now - lastFlipTime < cooldownMs) {
      accumX = 0;
      lastEventTime = now;
      return;
    }

    if (now - lastEventTime > resetGapMs || (accumX !== 0 && Math.sign(accumX) !== Math.sign(dx))) {
      accumX = 0;
    }

    accumX += dx;
    lastEventTime = now;

    if (Math.abs(accumX) >= threshold) {
      const dir: HorizontalDirection = accumX > 0 ? 'right' : 'left';
      accumX = 0;
      lastFlipTime = now;
      onFlip(dir);
    }
  };

  const onModernWheel = (e: Event) => {
    sawModernWheel = true;
    processWheel(e as WheelEvent);
  };

  const onLegacyMouseWheel = (e: Event) => {
    if (sawModernWheel) return;
    processWheel(e as WheelEvent);
  };

  target.addEventListener('wheel', onModernWheel, { passive: false });
  target.addEventListener('mousewheel', onLegacyMouseWheel, { passive: false });

  return () => {
    target.removeEventListener('wheel', onModernWheel);
    target.removeEventListener('mousewheel', onLegacyMouseWheel);
  };
}
