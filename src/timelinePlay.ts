/*
 * ForgeCoach — timelinePlay.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Playing a game's timeline forward from a chosen moment (the replay and the
 * watch of two bots, ui/GameView.tsx). Choosing a moment pauses there; Play
 * moves on one moment at a time at the chosen speed; on a game still being
 * played, reaching the newest moment hands over to following it ("Live"),
 * and Jump to live goes straight there. Before this a moment chosen in a
 * live watch held the board there for good (Justin's watch, 2026-10-17).
 *
 * Pure: the screen keeps the index of the moment shown (its own, per list),
 * hands it in with each action, and takes back the next index and whether it
 * is playing. A cursor at the newest moment of a live game is following:
 * new moments move it on (`grow`).
 */

/** Milliseconds a moment stays up at 1×: a decision, or one state frame (the recorder's 600 ms pace). */
export const STEP_MS = { decisions: 1500, frames: 600 } as const;
export const PLAY_SPEEDS = [0.5, 1, 2, 4] as const;
export type PlaySpeed = (typeof PLAY_SPEEDS)[number];
export type PlayList = keyof typeof STEP_MS;

export interface Cursor {
  /** The moment shown (0 … count − 1). */
  i: number;
  playing: boolean;
  speed: PlaySpeed;
}

export type CursorAction =
  /** A click in the list, the scrubber, a step key or a jump (a win-chance marker, the film room): pause there. */
  | { kind: 'select'; i: number; count: number }
  | { kind: 'play'; count: number; live: boolean }
  | { kind: 'pause' }
  | { kind: 'toggle'; count: number; live: boolean }
  /** The play timer: one moment on. */
  | { kind: 'tick'; count: number; live: boolean }
  /** The log grew from `prev` moments to `count`. */
  | { kind: 'grow'; prev: number; count: number; live: boolean }
  /** Jump to live: the newest moment, following. */
  | { kind: 'live'; count: number }
  | { kind: 'speed'; speed: PlaySpeed };

const clamp = (i: number, count: number) => Math.max(0, Math.min(Math.max(0, count - 1), Math.round(i)));
const lastOf = (count: number) => Math.max(0, count - 1);

/** At the newest moment of a game still being played: new moments carry the view on. */
export const following = (c: Pick<Cursor, 'i'>, count: number, live: boolean): boolean => live && count > 0 && c.i >= count - 1;

export function cursorReducer(c: Cursor, a: CursorAction): Cursor {
  switch (a.kind) {
    case 'select':
      return { ...c, i: clamp(a.i, a.count), playing: false };
    case 'play':
      if (a.count === 0) return { ...c, playing: false };
      // At the newest moment of a live game there is nothing to play: it is already following.
      if (c.i >= a.count - 1) return a.live ? { ...c, i: lastOf(a.count), playing: false } : { ...c, i: 0, playing: a.count > 1 };
      return { ...c, playing: true };
    case 'pause':
      return { ...c, playing: false };
    case 'toggle':
      return cursorReducer(c, c.playing ? { kind: 'pause' } : { kind: 'play', count: a.count, live: a.live });
    case 'tick': {
      if (!c.playing) return c;
      const i = clamp(c.i + 1, a.count);
      // The end of the list: a finished game stops there; a live one follows from there.
      return { ...c, i, playing: i < a.count - 1 };
    }
    case 'grow':
      // Sitting at the newest moment (not playing toward it): follow it.
      if (a.live && !c.playing && c.i >= a.prev - 1) return { ...c, i: lastOf(a.count) };
      return { ...c, i: clamp(c.i, a.count) };
    case 'live':
      return { ...c, i: lastOf(a.count), playing: false };
    case 'speed':
      return { ...c, speed: a.speed };
  }
}

/** How long the moment on screen stays before the next tick. */
export const stepDelay = (list: PlayList, speed: PlaySpeed): number => Math.round(STEP_MS[list] / speed);
