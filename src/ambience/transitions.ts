/*
 * ForgeCoach — ambience/transitions.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Transition frames between stages (spec 1.7): when a land steps a biome's
 * stage, a pack with `transitions` plays that step's few in-between pictures
 * with hard cuts, each held a moment (about 200 ms: limited animation, a
 * drawing about every fifth frame at 24 fps), then fades into the new stage's own picture.
 * Losing a land plays the same frames backwards. A step without frames, a
 * shape a step has no frames for, a jump of more than two stages, the first
 * paint and reduced motion keep the 1.6 cross-fade (or the instant change).
 * Pure and DOM-free; the drawing is ui/ambience/SceneryStrip.tsx.
 */
import type { PackBiome, PackTransitions } from './manifest.ts';

/** Which of a stage's half pictures a slot is showing. */
export type TransitionShape = 'desktop' | 'phone';

/** One picture of a playing sequence. */
export interface TweenFrame {
  src: string;
  holdMs: number;
}

/** A step sequence chains at most this many stage steps (a bigger jump just cross-fades). */
export const MAX_CHAINED_STEPS = 2;

/**
 * The frames to play when a slot's stage goes from `from` to `to`, in order,
 * at the slot's shape; null when the change should cross-fade instead: no
 * transitions, no change, a jump of more than {@link MAX_CHAINED_STEPS},
 * or any crossed step missing (or without a picture at this shape). Growing
 * plays each step forward; shrinking plays them backwards.
 */
export function transitionFrames(biome: PackBiome | undefined | null, from: number, to: number, shape: TransitionShape): TweenFrame[] | null {
  const t = biome?.transitions;
  if (!t || !biome || from === to || from < 1 || to < 1 || Math.abs(to - from) > MAX_CHAINED_STEPS) return null;
  const last = biome.stages.length;
  if (Math.max(from, to) > last) return null;
  const out: TweenFrame[] = [];
  const up = to > from;
  for (let s = from; s !== to; s += up ? 1 : -1) {
    const step = t.steps.find((x) => x.from === (up ? s : s - 1));
    if (!step) return null;
    const pics: TweenFrame[] = [];
    for (const f of step.frames) {
      const src = shape === 'phone' ? f.phone : f.src;
      if (!src) return null;
      pics.push({ src, holdMs: f.holdMs });
    }
    out.push(...(up ? pics : pics.reverse()));
  }
  return out.length ? out : null;
}

/** When each frame starts (ms from the step), and when the last one's hold ends: the fade into the stage begins there. */
export function tweenTimeline(frames: readonly TweenFrame[]): { starts: number[]; holdEnd: number } {
  const starts: number[] = [];
  let at = 0;
  for (const f of frames) {
    starts.push(at);
    at += f.holdMs;
  }
  return { starts, holdEnd: at };
}

/** The whole sequence's length in ms: every hold, then the fade into the stage. */
export function tweenLength(frames: readonly TweenFrame[], fadeMs: number): number {
  return tweenTimeline(frames).holdEnd + Math.max(0, fadeMs);
}

/**
 * Where a sequence is `elapsed` ms after the step: the frame on screen
 * (hard cuts, no blending between frames), whether the last one is fading
 * into the stage, and whether it is over.
 */
export function tweenAt(frames: readonly TweenFrame[], fadeMs: number, elapsed: number): { index: number; fading: boolean; done: boolean } {
  const { starts, holdEnd } = tweenTimeline(frames);
  if (!frames.length || elapsed >= holdEnd + Math.max(0, fadeMs)) return { index: Math.max(0, frames.length - 1), fading: false, done: true };
  if (elapsed >= holdEnd) return { index: frames.length - 1, fading: true, done: false };
  let i = 0;
  while (i + 1 < starts.length && elapsed >= starts[i + 1]!) i++;
  return { index: i, fading: false, done: false };
}

/** Does this change play frames at all: a pack's transitions, motion allowed, and a stage seen before (not the first paint)? */
export function tweenAllowed(transitions: PackTransitions | null | undefined, reduced: boolean, previous: number | null): boolean {
  return !!transitions && !reduced && previous !== null;
}

/**
 * The frames worth having in the cache before the next land: the step from
 * the slot's stage to the next one (the likely change), at the slot's
 * shape. Empty when there is none.
 */
export function nextStepFrames(biome: PackBiome | undefined | null, stage: number, shape: TransitionShape): string[] {
  if (!biome || stage < 1 || stage >= biome.stages.length) return [];
  return (transitionFrames(biome, stage, stage + 1, shape) ?? []).map((f) => f.src);
}
