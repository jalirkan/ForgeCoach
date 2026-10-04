/*
 * ForgeCoach — ui/keyboardInset.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * How much of the bottom of the layout the on-screen keyboard covers, as the
 * CSS variable `--kb-inset` on the root element (0px when there is none).
 *
 * Android Chrome resizes the layout itself (index.html asks for
 * `interactive-widget=resizes-content`), so there the inset stays 0. iOS Safari
 * and older Android only shrink the visual viewport and leave fixed elements
 * (the ask sheet, its Confirm button) under the keyboard: the sheets lift
 * themselves by this variable (ask.css, play.css). A pinch-zoom also shrinks the
 * visual viewport; that is not a keyboard, so a zoomed page reports 0.
 */

/** Smaller than this is browser chrome settling (the URL bar), not a keyboard. */
export const KEYBOARD_MIN_PX = 80;

export interface ViewportLike {
  height: number;
  offsetTop: number;
  scale: number;
}

/** The keyboard's height in CSS px over the layout viewport, or 0. */
export function keyboardInset(layoutHeight: number, vv: ViewportLike | null | undefined): number {
  if (!vv || !Number.isFinite(layoutHeight) || layoutHeight <= 0) return 0;
  if (!Number.isFinite(vv.height) || !Number.isFinite(vv.offsetTop)) return 0;
  if (vv.scale > 1.01) return 0;
  const covered = Math.round(layoutHeight - vv.height - Math.max(0, vv.offsetTop));
  return covered >= KEYBOARD_MIN_PX ? covered : 0;
}

interface WindowLike {
  innerHeight: number;
  visualViewport?: (ViewportLike & EventTarget) | null;
  requestAnimationFrame(fn: () => void): number;
}

/** Keeps `--kb-inset` on `root` current. Returns a function that stops it. */
export function trackKeyboardInset(win: WindowLike, root: { style: { setProperty(n: string, v: string): void } }): () => void {
  const vv = win.visualViewport;
  if (!vv) return () => {};
  let last = -1;
  let queued = false;
  const update = () => {
    queued = false;
    const px = keyboardInset(win.innerHeight, vv);
    if (px === last) return;
    last = px;
    root.style.setProperty('--kb-inset', `${px}px`);
  };
  const schedule = () => {
    if (queued) return;
    queued = true;
    win.requestAnimationFrame(update);
  };
  vv.addEventListener('resize', schedule);
  vv.addEventListener('scroll', schedule);
  update();
  return () => {
    vv.removeEventListener('resize', schedule);
    vv.removeEventListener('scroll', schedule);
  };
}
