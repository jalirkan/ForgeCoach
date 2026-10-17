/*
 * ForgeCoach — timelinePlay.test.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The replay's play / pause / live state machine (GameView): a moment chosen
 * in a live watch no longer holds the view there for good.
 */
import { describe, expect, it } from 'vitest';
import { cursorReducer, following, stepDelay, type Cursor, type CursorAction } from './timelinePlay.ts';

const run = (c: Cursor, ...as: CursorAction[]) => as.reduce(cursorReducer, c);
const at = (i: number, playing = false): Cursor => ({ i, playing, speed: 1 });

describe('choosing a moment, then playing on from it', () => {
  it('choosing a moment pauses there, wherever it was', () => {
    expect(run(at(20, true), { kind: 'select', i: 4, count: 30 })).toEqual(at(4));
    expect(run(at(3), { kind: 'select', i: 99, count: 30 }).i).toBe(29);
  });
  it('Play moves on one moment a tick, from the chosen one', () => {
    const c = run(at(29), { kind: 'select', i: 4, count: 30 }, { kind: 'play', count: 30, live: true });
    expect(c).toEqual(at(4, true));
    expect(run(c, { kind: 'tick', count: 30, live: true }, { kind: 'tick', count: 30, live: true })).toEqual(at(6, true));
  });
  it('a tick while paused does nothing', () => {
    expect(run(at(4), { kind: 'tick', count: 30, live: true })).toEqual(at(4));
  });
  it('Pause holds; toggle plays and pauses', () => {
    const c = run(at(4, true), { kind: 'pause' }, { kind: 'tick', count: 30, live: false });
    expect(c).toEqual(at(4));
    expect(run(c, { kind: 'toggle', count: 30, live: false }).playing).toBe(true);
    expect(run(at(4, true), { kind: 'toggle', count: 30, live: false }).playing).toBe(false);
  });
  it('plays at the chosen speed', () => {
    expect(stepDelay('decisions', 1)).toBe(1500);
    expect(stepDelay('decisions', 2)).toBe(750);
    expect(stepDelay('decisions', 0.5)).toBe(3000);
    expect(stepDelay('frames', 4)).toBe(150);
    expect(run(at(4, true), { kind: 'speed', speed: 4 })).toEqual({ i: 4, playing: true, speed: 4 });
  });
});

describe('the live edge', () => {
  it('playing up to the newest moment of a live game hands over to following it', () => {
    let c = run(at(27), { kind: 'play', count: 30, live: true }, { kind: 'tick', count: 30, live: true }, { kind: 'tick', count: 30, live: true });
    expect(c).toEqual(at(29));
    expect(following(c, 30, true)).toBe(true);
    // New moments carry it on.
    c = run(c, { kind: 'grow', prev: 30, count: 33, live: true });
    expect(c.i).toBe(32);
  });
  it('a paused earlier moment stays put while the game goes on, until Jump to live', () => {
    let c = run(at(29), { kind: 'select', i: 10, count: 30 }, { kind: 'grow', prev: 30, count: 34, live: true });
    expect(c).toEqual(at(10));
    expect(following(c, 34, true)).toBe(false);
    c = run(c, { kind: 'live', count: 34 });
    expect(c).toEqual(at(33));
    expect(following(c, 34, true)).toBe(true);
  });
  it('while playing toward the edge, new moments do not jump it there', () => {
    expect(run(at(12, true), { kind: 'grow', prev: 30, count: 31, live: true })).toEqual(at(12, true));
  });
  it('Play at the live edge has nothing to play: it stays following', () => {
    expect(run(at(29), { kind: 'play', count: 30, live: true })).toEqual(at(29));
  });
  it('the first moments of a live game that started empty are followed', () => {
    expect(run(at(0), { kind: 'grow', prev: 0, count: 3, live: true }).i).toBe(2);
  });
});

describe('a finished game', () => {
  it('stops at the last moment; nothing follows', () => {
    const c = run(at(28, true), { kind: 'tick', count: 30, live: false });
    expect(c).toEqual(at(29));
    expect(following(c, 30, false)).toBe(false);
  });
  it('Play at the last moment starts again from the first', () => {
    expect(run(at(29), { kind: 'play', count: 30, live: false })).toEqual(at(0, true));
  });
  it('an empty list never plays', () => {
    expect(run(at(0), { kind: 'play', count: 0, live: false }).playing).toBe(false);
  });
});
