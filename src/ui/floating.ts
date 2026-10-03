/*
 * ForgeCoach — ui/floating.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Where a draggable floating panel (the game log on a desktop) may sit: kept
 * on screen with its header reachable, whatever the window did since it was
 * last placed. Pure.
 */

export interface PanelPos {
  x: number;
  y: number;
}

/** Clamp a panel's top-left so at least `grip` px of it (and all of its header) stay in the viewport. */
export function clampPanel(pos: PanelPos, size: { w: number; h: number }, view: { w: number; h: number }, grip = 80): PanelPos {
  const x = Math.min(Math.max(pos.x, grip - size.w), view.w - grip);
  const y = Math.min(Math.max(pos.y, 0), view.h - 44);
  return { x: Math.round(x), y: Math.round(y) };
}

/** Read a stored position ("x,y"); null when absent or malformed. */
export function parsePos(s: string | null | undefined): PanelPos | null {
  const m = /^(-?\d+),(-?\d+)$/.exec(s ?? '');
  return m ? { x: Number(m[1]), y: Number(m[2]) } : null;
}
