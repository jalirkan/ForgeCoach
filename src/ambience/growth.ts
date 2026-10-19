/*
 * ForgeCoach — ambience/growth.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Growth between stages (spec 1.6): the scenery grows a little with every
 * land, not only at the stage thresholds. Between two thresholds a slot shows
 * its stage's picture with the next stage's picture cross-faded over it by an
 * eased fraction of its progress (model.ts `stageProgress`): 3 lands is stage
 * 2 with stage 3 at about half; 4 lands is stage 3. A land's change animates
 * over the pack's `growth.seconds` (1.2 s by default), at once with reduced
 * motion. Pure and DOM-free; the drawing is ui/ambience/SceneryStrip.tsx.
 *
 * The fade stack ({@link fadeStack}) is the state of one picture slot across
 * renders: the current picture at full, the next stage's over it at the fade.
 * When the next stage's picture becomes the current one (a land crossed a
 * threshold), it keeps fading up to full while the old picture stays beneath
 * it, so the stage-up is as smooth as the lands between; once the fade has
 * run, {@link settleFades} drops what is no longer shown. At most two
 * pictures stay after a settle; three only for the length of one fade.
 */
import type { PackGrowth } from './manifest.ts';

/** The ease of a progress fraction (0..1): sine in-out, so half a stage is half the next picture. */
export function easeGrowth(p: number): number {
  if (!(p > 0)) return 0;
  if (p >= 1) return 1;
  return Math.round((0.5 - 0.5 * Math.cos(Math.PI * p)) * 1000) / 1000;
}

/**
 * How strongly the next stage shows over the current one, 0..1: the eased
 * progress, when the pack lets it (`growth.crossfade`) and there is a next
 * stage with something new to show; 0 otherwise (and at a progress of 1,
 * which means fully grown, with no next stage).
 */
export function nextStageFade(progress: number | undefined, hasNext: boolean, growth: PackGrowth): number {
  const p = progress ?? 0;
  if (!growth.crossfade || !hasNext || !(p > 0) || p >= 1) return 0;
  return easeGrowth(p);
}

/**
 * Spec 1.10: how strongly a slot's next stage shows over the current one on
 * the half board. A half picture is a whole painting with its own horizon,
 * so two of them half-transparent read as a double exposure (two horizons,
 * the next stage's spires ghosted over this one's): between two thresholds a
 * half picture stays the stage's own (0) and the slot only widens; the next
 * picture arrives at its threshold, through its frames (1.7) or the fade over
 * the old picture held beneath. Strip layers (`picture` false) cross-fade by
 * the progress as in 1.6.
 */
export function slotStageFade(progress: number | undefined, hasNext: boolean, growth: PackGrowth, picture: boolean): number {
  return picture ? 0 : nextStageFade(progress, hasNext, growth);
}

/** How long one land's fade takes, in ms: the pack's `growth.seconds`, 0 with reduced motion. */
export function growthMs(growth: PackGrowth, reduced: boolean): number {
  return reduced ? 0 : Math.round(Math.max(0, growth.seconds) * 1000);
}

/** One picture in a fade stack. */
export type FadeRole =
  /** The current stage's picture, at full. */
  | 'cur'
  /** The next stage's, over it, at the fade. */
  | 'next'
  /** The picture the current one replaced, kept at full beneath it while it fades up. */
  | 'base'
  /** A picture no longer wanted, fading out over the rest. */
  | 'out';

export interface FadeEntry<T> {
  key: string;
  payload: T;
  role: FadeRole;
  /** The opacity it is drawn at when it first appears (0 for a picture fading in). */
  from: number;
  /** The opacity it is heading to. */
  opacity: number;
}

export interface FadeWant<T> {
  key: string;
  payload: T;
}

/** The most pictures a slot's stack holds, for the length of one fade (two once it settles). */
export const MAX_FADE_ENTRIES = 3;

/** Under this the next picture is not drawn at all. */
const MIN_FADE = 0.005;

/**
 * The stack after a change: `cur` at full, `next` over it at `fade` (left
 * out at 0 or when it is `cur`), ordered bottom to top. With `instant` (the
 * first paint, reduced motion, a fade of 0 s) exactly that; otherwise what was
 * shown fades rather than jumps: a `next` that became `cur` keeps the old
 * picture beneath it (`base`), and pictures no longer wanted fade out on top
 * (`out`). Entries keep their key, so the drawing keeps its element and a
 * CSS transition carries the opacity.
 */
export function fadeStack<T>(prev: readonly FadeEntry<T>[], cur: FadeWant<T> | null, next: FadeWant<T> | null, fade: number, instant: boolean): FadeEntry<T>[] {
  const nextOn = !!next && fade > MIN_FADE && next.key !== cur?.key;
  const f = Math.min(1, Math.max(0, fade));
  if (instant || !prev.length) {
    const out: FadeEntry<T>[] = [];
    if (cur) out.push({ key: cur.key, payload: cur.payload, role: 'cur', from: 1, opacity: 1 });
    if (nextOn) out.push({ key: next.key, payload: next.payload, role: 'next', from: instant ? f : 0, opacity: f });
    return out;
  }
  const was = new Map(prev.map((e) => [e.key, e]));
  const wanted = new Set([cur?.key, nextOn ? next.key : undefined].filter((k): k is string => !!k));
  // A picture already kept beneath stays beneath until the settle (a second land in the middle of a fade).
  const bottom: FadeEntry<T>[] = prev.filter((e) => e.role === 'base' && !wanted.has(e.key)).map((e) => ({ ...e, opacity: 1 }));
  const top: FadeEntry<T>[] = [];
  if (cur) {
    const p = was.get(cur.key);
    if (p && (p.role === 'next' || p.role === 'out')) {
      // It was fading in over another picture (the next stage's, now this stage's): that one stays beneath until it is whole.
      const under = prev.find((e) => e.role === 'cur' && !wanted.has(e.key));
      if (under) bottom.push({ ...under, role: 'base', opacity: 1 });
    }
    bottom.push({ key: cur.key, payload: cur.payload, role: 'cur', from: p ? p.from : 1, opacity: 1 });
  }
  if (nextOn) {
    const p = was.get(next.key);
    top.push({ key: next.key, payload: next.payload, role: 'next', from: p ? p.from : 0, opacity: f });
  }
  // Everything else that was shown fades out over the rest (a jump, a fade that fell back to 0).
  const kept = new Set([...bottom, ...top].map((e) => e.key));
  const outs = prev.filter((e) => !kept.has(e.key) && e.opacity > 0).map((e): FadeEntry<T> => ({ ...e, role: 'out', opacity: 0 }));
  const all = [...bottom, ...top, ...outs];
  // The cap drops the pictures fading out first (the last listed), then the oldest base.
  while (all.length > MAX_FADE_ENTRIES) {
    let i = -1;
    for (let j = all.length - 1; j >= 0; j--) if (all[j]!.role === 'out') {
      i = j;
      break;
    }
    if (i < 0) i = all.findIndex((e) => e.role === 'base');
    if (i < 0) break;
    all.splice(i, 1);
  }
  return all;
}

/** After a fade has run: only the current picture and the next one remain, each where it was heading. */
export function settleFades<T>(stack: readonly FadeEntry<T>[]): FadeEntry<T>[] {
  return stack.filter((e) => (e.role === 'cur' || e.role === 'next') && e.opacity > 0).map((e) => ({ ...e, from: e.opacity }));
}

/** Does the stack hold pictures that only last for a fade (a base, or one fading out)? */
export function fadeBusy<T>(stack: readonly FadeEntry<T>[]): boolean {
  return stack.some((e) => e.role === 'base' || e.role === 'out');
}
