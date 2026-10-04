/*
 * ForgeCoach — ui/longPress.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Long-press on touch: hold a finger still on a card for LONG_PRESS_MS and its
 * details open, without acting on it. The click the browser sends when the
 * finger lifts is swallowed. A finger that moves more than LONG_PRESS_SLOP px
 * (scrolling the hand, panning the board) or slides off is not a long-press.
 * The mouse never long-presses: it has hover and right-click.
 *
 * The state machine is DOM-free (timers injected) so it is tested in node;
 * `useLongPress` wires it to React pointer events.
 */
import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { MouseEvent, PointerEvent } from 'react';

export const LONG_PRESS_MS = 450;
export const LONG_PRESS_SLOP = 8;

export interface PressTimers {
  set(fn: () => void, ms: number): unknown;
  clear(id: unknown): void;
}

export interface LongPressOptions {
  /** Opens the details. */
  onLong: () => void;
  timers: PressTimers;
  ms?: number;
  slop?: number;
  /** A short buzz when the press lands (navigator.vibrate). */
  haptic?: () => void;
}

export interface LongPress {
  /** A pointer went down. Only a primary, non-mouse pointer starts the timer. */
  down(x: number, y: number, pointerType: string, isPrimary?: boolean): void;
  /** The pointer moved: past the slop, the press is off. */
  move(x: number, y: number): void;
  /** Up, cancel, or the pointer left the element. */
  cancel(): void;
  /** The click after a pointer-up: true when it ends a long-press and must be swallowed. */
  takeClick(): boolean;
  /**
   * The browser's own context menu (a right-click, or a touch browser's long-press).
   * Returns whether the details should open now: false when the timer already opened them.
   */
  context(pointerType: string | undefined): boolean;
  /** Whether a timer is running (tests). */
  readonly pending: boolean;
}

export function createLongPress({ onLong, timers, ms = LONG_PRESS_MS, slop = LONG_PRESS_SLOP, haptic }: LongPressOptions): LongPress {
  let timer: unknown = null;
  let at: { x: number; y: number } | null = null;
  let fired = false;

  const stop = () => {
    if (timer !== null) timers.clear(timer);
    timer = null;
    at = null;
  };

  return {
    down(x, y, pointerType, isPrimary = true) {
      fired = false;
      stop();
      if (pointerType === 'mouse' || !isPrimary) return;
      at = { x, y };
      timer = timers.set(() => {
        timer = null;
        fired = true;
        haptic?.();
        onLong();
      }, ms);
    },
    move(x, y) {
      if (!at || timer === null) return;
      if (Math.abs(x - at.x) > slop || Math.abs(y - at.y) > slop) stop();
    },
    cancel: stop,
    takeClick() {
      if (!fired) return false;
      fired = false;
      return true;
    },
    context(pointerType) {
      if (fired) return false;
      stop();
      // A touch browser's own long-press: the click that may follow is swallowed too.
      fired = pointerType === 'touch';
      return true;
    },
    get pending() {
      return timer !== null;
    },
  };
}

/** A short haptic tick where the device has one. */
export function pressBuzz(): void {
  try {
    navigator.vibrate?.(12);
  } catch {
    /* not supported */
  }
}

export const pressTimers: PressTimers = {
  set: (fn, ms) => window.setTimeout(fn, ms),
  clear: (id) => window.clearTimeout(id as number),
};

export interface LongPressHandlers {
  onPointerDown: (e: PointerEvent<HTMLElement>) => void;
  onPointerMove: (e: PointerEvent<HTMLElement>) => void;
  onPointerUp: () => void;
  onPointerCancel: () => void;
  onPointerLeave: (e: PointerEvent<HTMLElement>) => void;
  onContextMenu: (e: MouseEvent<HTMLElement>) => void;
}

/**
 * React wiring. `onLong` opens the details (null: no long-press at all). Call
 * `takeClick()` first thing in the element's onClick and return when it is true.
 */
export function useLongPress(onLong: (() => void) | null): { handlers: LongPressHandlers | null; takeClick: () => boolean } {
  const latest = useRef(onLong);
  latest.current = onLong;
  const press = useMemo(() => createLongPress({ onLong: () => latest.current?.(), timers: pressTimers, haptic: pressBuzz }), []);
  useEffect(() => () => press.cancel(), [press]);
  const enabled = onLong !== null;
  const takeClick = useCallback(() => press.takeClick(), [press]);
  const handlers = useMemo<LongPressHandlers | null>(
    () =>
      enabled
        ? {
            onPointerDown: (e) => press.down(e.clientX, e.clientY, e.pointerType, e.isPrimary),
            onPointerMove: (e) => press.move(e.clientX, e.clientY),
            onPointerUp: () => press.cancel(),
            onPointerCancel: () => press.cancel(),
            onPointerLeave: (e) => {
              if (e.pointerType !== 'mouse') press.cancel();
            },
            onContextMenu: (e) => {
              e.preventDefault();
              if (press.context((e.nativeEvent as globalThis.PointerEvent).pointerType)) latest.current?.();
            },
          }
        : null,
    [enabled, press],
  );
  return { handlers, takeClick };
}
