// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { arcOf, ARC_TURNS, gradeCss, gradeFor, lightInputOf, outcomeAt, stormOf } from './light.ts';

const g = (turn: number, life = 20, outcome: 'won' | 'lost' | 'draw' | null = null) => gradeFor({ turn, life, outcome });

describe('the game arc', () => {
  it('runs cool and flat at the start to warm and rich at ARC_TURNS, and stays there', () => {
    expect(arcOf(1)).toBe(0);
    expect(arcOf(0)).toBe(0);
    expect(arcOf(ARC_TURNS)).toBe(1);
    expect(arcOf(40)).toBe(1);
    const early = g(1);
    const late = g(ARC_TURNS);
    expect(early.tint[2]).toBeGreaterThan(early.tint[0]); // blue over red: cool
    expect(late.tint[0]).toBeGreaterThan(late.tint[2]); // red over blue: warm
    expect(late.contrast).toBeGreaterThan(early.contrast);
    expect(late.saturate).toBeGreaterThan(early.saturate);
    expect(early.brightness).toBe(1);
  });
  it('moves a little every turn, never jumps', () => {
    for (let t = 1; t < ARC_TURNS; t++) {
      const a = g(t);
      const b = g(t + 1);
      expect(Math.abs(b.contrast - a.contrast)).toBeLessThan(0.02);
      expect(Math.abs(b.tint[0] - a.tint[0])).toBeLessThan(20);
    }
  });
});

describe('low life', () => {
  it('a storm from 5 life down, full at 0', () => {
    expect(stormOf(20)).toBe(0);
    expect(stormOf(6)).toBe(0);
    expect(stormOf(5)).toBeGreaterThan(0);
    expect(stormOf(0)).toBe(1);
    expect(stormOf(-3)).toBe(1);
    const calm = g(8, 12);
    const storm = g(8, 1);
    expect(storm.saturate).toBeLessThan(calm.saturate);
    expect(storm.brightness).toBeLessThan(calm.brightness);
    expect(storm.tintAlpha).toBeGreaterThan(calm.tintAlpha);
  });
});

describe('game over', () => {
  it("the winner's half glows, the loser's goes to dusk, a draw dims both", () => {
    const won = g(10, 3, 'won');
    const lost = g(10, 0, 'lost');
    const draw = g(10, 0, 'draw');
    expect(won.brightness).toBeGreaterThan(1);
    expect(won.tint[0]).toBeGreaterThan(200);
    expect(lost.brightness).toBeLessThan(0.85);
    expect(lost.saturate).toBeLessThan(0.7);
    expect(draw.brightness).toBeLessThan(1);
    expect(draw.brightness).toBeGreaterThan(lost.brightness);
  });
});

describe('the CSS', () => {
  it('a filter and a tint, numbers only', () => {
    const c = gradeCss(g(1));
    expect(c.filter).toMatch(/^brightness\([\d.]+\) contrast\([\d.]+\) saturate\([\d.]+\)$/);
    expect(c.tint).toMatch(/^rgb\(\d+, \d+, \d+\)$/);
    expect(Number(c.tintAlpha)).toBeGreaterThan(0);
  });
});

describe('from the log', () => {
  const state = (turn: number, lives: [number, number]) => ({ type: 'state', body: { turn, players: [{ id: 0, life: lives[0] }, { id: 1, life: lives[1] }] } });
  const frames = [state(1, [20, 20]), state(9, [4, 17]), { type: 'over', body: { winner: 1, reason: null } }] as never[];
  it('the outcome only once the over frame is at or before the board', () => {
    expect(outcomeAt({ frames }, 1, 0)).toBeNull();
    expect(outcomeAt({ frames }, 2, 0)).toBe('lost');
    expect(outcomeAt({ frames }, 2, 1)).toBe('won');
    expect(outcomeAt({ frames: [...frames.slice(0, 2), { type: 'over', body: { winner: null, reason: null } }] as never[] }, 2, 0)).toBe('draw');
  });
  it("a player's turn, life and outcome; null for a player the state lacks", () => {
    const st = (frames[1] as { body: never }).body;
    expect(lightInputOf({ frames }, 1, st, 0)).toEqual({ turn: 9, life: 4, outcome: null });
    expect(lightInputOf({ frames }, 1, st, 7)).toBeNull();
    expect(lightInputOf({ frames }, 1, null, 0)).toBeNull();
  });
});

describe('the switch', () => {
  it('off by default; ?light=on / off for this page; only with the scenery on', async () => {
    const { DEFAULT_PREFS, effectivePrefs, lightOn } = await import('./prefs.ts');
    expect(DEFAULT_PREFS.light).toBe(false);
    expect(lightOn(DEFAULT_PREFS)).toBe(false);
    expect(lightOn(effectivePrefs(DEFAULT_PREFS, '?light=on', ''))).toBe(true);
    expect(lightOn(effectivePrefs({ ...DEFAULT_PREFS, light: true }, '', '#ambience?light=off'))).toBe(false);
    expect(lightOn(effectivePrefs(DEFAULT_PREFS, '?light=1&scenery=off', ''))).toBe(false);
    expect(effectivePrefs(DEFAULT_PREFS, '?light=maybe', '')).toBe(DEFAULT_PREFS);
  });
});
