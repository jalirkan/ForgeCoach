/*
 * ForgeCoach — watch/replay.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Playing a watch's draft back pick by pick (mtg-table D440). The lab's picks
 * take milliseconds and carry no times of their own, so the viewer paces them:
 * a step is one pick — the grid as that drafter saw it, the line it took lit —
 * and the last step is the two decks. Pools at a step hold every pick up to
 * and including it. Pure: the screen holds a ReplayState and feeds actions in.
 */
import type { WatchDraft, WatchPick, WatchSide } from './data.ts';

/** Milliseconds a pick stays up at 1×. */
export const BASE_PICK_MS = 1600;
export const SPEEDS = [0.5, 1, 2, 4] as const;
export type Speed = (typeof SPEEDS)[number];

export interface ReplayState {
  /** 0 … picks.length; picks.length is the decks. */
  i: number;
  playing: boolean;
  speed: Speed;
}

export type ReplayAction =
  | { kind: 'play' }
  | { kind: 'pause' }
  | { kind: 'toggle' }
  | { kind: 'next' }
  | { kind: 'prev' }
  | { kind: 'tick' }
  | { kind: 'restart' }
  | { kind: 'decks' }
  | { kind: 'speed'; speed: Speed }
  | { kind: 'seek'; i: number };

export const startReplay = (speed: Speed = 1): ReplayState => ({ i: 0, playing: true, speed });

/** The steps of a draft: each pick, then the decks. */
export const stepCount = (d: Pick<WatchDraft, 'picks'>): number => d.picks.length + 1;
export const atDecks = (s: ReplayState, d: Pick<WatchDraft, 'picks'>): boolean => s.i >= d.picks.length;

export function replayReducer(s: ReplayState, a: ReplayAction, d: Pick<WatchDraft, 'picks'>): ReplayState {
  const last = d.picks.length;
  const at = (i: number): number => Math.max(0, Math.min(last, Math.round(i)));
  switch (a.kind) {
    case 'play':
      // Play at the decks starts again from the first pick.
      return { ...s, i: s.i >= last ? 0 : s.i, playing: true };
    case 'pause':
      return { ...s, playing: false };
    case 'toggle':
      return replayReducer(s, { kind: s.playing ? 'pause' : 'play' }, d);
    case 'next':
      return { ...s, i: at(s.i + 1), playing: false };
    case 'prev':
      return { ...s, i: at(s.i - 1), playing: false };
    case 'tick': {
      if (!s.playing) return s;
      const i = at(s.i + 1);
      return { ...s, i, playing: i < last };
    }
    case 'restart':
      return { ...s, i: 0, playing: true };
    case 'decks':
      return { ...s, i: last, playing: false };
    case 'speed':
      return { ...s, speed: a.speed };
    case 'seek':
      return { ...s, i: at(a.i), playing: false };
  }
}

/** How long the current step stays before a tick. */
export const stepDelay = (s: ReplayState): number => Math.round(BASE_PICK_MS / s.speed);

export interface ReplayView {
  /** The pick on screen; null at the decks. */
  pick: WatchPick | null;
  /** 1-based grid number on screen (the last grid at the decks). */
  grid: number;
  /** For GridBoard: the grid's index (0-based), its slots and the opener's line on a second pick. */
  board: { g: number; grids: number; slots: Array<string | null>; firstLine: number | null } | null;
  /** Both pools up to and including this pick, in pick order. */
  pools: Record<WatchSide, string[]>;
  /** The cards this pick added (to its seat's pool). */
  fresh: string[];
  /** "Pick 7 of 36". */
  label: string;
}

export function replayView(d: WatchDraft, i: number): ReplayView {
  const last = d.picks.length;
  const k = Math.max(0, Math.min(last, i));
  const pools: Record<WatchSide, string[]> = { A: [], B: [] };
  const upto = k >= last ? last : k + 1;
  for (const p of d.picks.slice(0, upto)) pools[p.seat].push(...p.took);
  if (k >= last) {
    return { pick: null, grid: d.grids, board: null, pools, fresh: [], label: 'The decks' };
  }
  const pick = d.picks[k]!;
  const opener = pick.order === 2 ? d.picks[k - 1] : undefined;
  return {
    pick,
    grid: pick.grid,
    board: { g: pick.grid - 1, grids: d.grids, slots: pick.slots, firstLine: opener ? opener.line : null },
    pools,
    fresh: pick.took,
    label: `Pick ${pick.n} of ${last}`,
  };
}

/** The line's words as the grid screen says them ("the left column"). */
export function lineWords(l: number): string {
  return l < 3 ? (['the top row', 'the middle row', 'the bottom row'][l] ?? 'a row') : (['the left column', 'the middle column', 'the right column'][l - 3] ?? 'a column');
}
