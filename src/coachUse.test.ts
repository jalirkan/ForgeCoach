// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { answerWasShown, COACH_USE_KEY, COACH_USE_KIND, exportCoachUse, loadCoachUse, MAX_COACH_GAMES, noteAnswerShown, noteGamePlayed, splitGame } from './coachUse.ts';

function mem() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m };
}
const GAME = 'human-ws-12345|12345|2026-10-08T18:00:00.000Z#0';
let t = Date.parse('2026-10-08T18:00:00Z');
const now = () => (t += 1000);

describe('coach use per game (mtg-table D414)', () => {
  it('splits autoPlan.ts game keys into the collector key and the seat', () => {
    expect(splitGame(GAME)).toEqual({ key: 'human-ws-12345|12345|2026-10-08T18:00:00.000Z', seat: 0 });
    expect(splitGame('match-m1|None|None#1')).toEqual({ key: 'match-m1|None|None', seat: 1 });
    for (const bad of ['', 'x#0', 'a|b|c', 'a|b|c#x', 'a|b|c#-1']) expect(splitGame(bad)).toBeNull();
  });

  it('notes a game once, then counts each shown answer once by kind, with model and source', () => {
    const s = mem();
    expect(noteGamePlayed(s, GAME, now)).toBe(true);
    expect(noteGamePlayed(s, GAME, now)).toBe(false);
    expect(noteAnswerShown(s, GAME, { key: 'p1', kind: 'plan', model: 'claude-sonnet-4-5', source: 'helper' }, now)).toBe(true);
    expect(noteAnswerShown(s, GAME, { key: 'p1', kind: 'plan', model: 'claude-sonnet-4-5', source: 'helper' }, now)).toBe(false);
    expect(noteAnswerShown(s, GAME, { key: 'a1', kind: 'ask', model: 'claude-sonnet-4-5', source: 'helper' }, now)).toBe(true);
    const [g] = loadCoachUse(s);
    expect(g).toMatchObject({ key: 'human-ws-12345|12345|2026-10-08T18:00:00.000Z', seat: 0, plans: 1, asks: 1, models: ['claude-sonnet-4-5'], sources: ['helper'] });
  });

  it('never records a game that was not noted (a table of two, a replay)', () => {
    const s = mem();
    expect(noteAnswerShown(s, 'friend-m1-seat0|7|2026-10-08T18:00:00Z#0', { key: 'k', kind: 'ask', model: null, source: null }, now)).toBe(false);
    expect(s.m.has(COACH_USE_KEY)).toBe(false);
  });

  it('counts only answers that ended with text', () => {
    expect(answerWasShown({ status: 'done', text: 'Play: Forest' })).toBe(true);
    expect(answerWasShown({ status: 'stopped', text: 'Play: For' })).toBe(true);
    expect(answerWasShown({ status: 'done', text: '  ' })).toBe(false);
    expect(answerWasShown({ status: 'error', text: 'x' })).toBe(false);
    expect(answerWasShown({ status: 'streaming', text: 'x' })).toBe(false);
    expect(answerWasShown(undefined)).toBe(false);
  });

  it('exports in the shape the collector reads, and a game without advice says coachUsed false', () => {
    const s = mem();
    noteGamePlayed(s, GAME, now);
    noteGamePlayed(s, 'match-m1759600000000|42|2026-10-08T19:00:00Z#0', now);
    noteAnswerShown(s, GAME, { key: 'p1', kind: 'plan', model: 'm', source: 'apiKey' }, now);
    const x = exportCoachUse(loadCoachUse(s), now);
    expect(x.kind).toBe(COACH_USE_KIND);
    expect(x.v).toBe(1);
    expect(x.games.map((g) => [g.key, g.seat, g.coachUsed, g.answers, g.plans, g.asks])).toEqual([
      ['human-ws-12345|12345|2026-10-08T18:00:00.000Z', 0, true, 1, 1, 0],
      ['match-m1759600000000|42|2026-10-08T19:00:00Z', 0, false, 0, 0, 0],
    ]);
    expect(JSON.stringify(x)).not.toMatch(/counted/);
  });

  it('survives junk and keeps the newest games', () => {
    const s = mem();
    s.setItem(COACH_USE_KEY, '{nope');
    expect(loadCoachUse(s)).toEqual([]);
    s.setItem(COACH_USE_KEY, JSON.stringify([{ key: 'a|b|c', seat: 0, plans: -1 }, 3]));
    expect(loadCoachUse(s)).toEqual([]);
    for (let i = 0; i < MAX_COACH_GAMES + 5; i++) noteGamePlayed(s, `human-ws-${i}|${i}|2026-10-08T18:00:00Z#0`, now);
    const list = loadCoachUse(s);
    expect(list.length).toBe(MAX_COACH_GAMES);
    expect(list.some((g) => g.key.startsWith('human-ws-0|'))).toBe(false);
    expect(noteGamePlayed(null, GAME, now)).toBe(false);
  });
});
