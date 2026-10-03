// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import type { GameLog } from '../log.ts';
import { parseLog } from '../log.ts';
import {
  breakdown,
  cubeOfDeck,
  formatWhen,
  loadHistory,
  logToText,
  memoryKV,
  recentForm,
  recordFinishedGame,
  recordFromLog,
  summarize,
  type GameRecord,
  type GameResult,
} from './record.ts';

function makeLog(opts: { winner?: number | null; over?: boolean; startedAt?: string; gameId?: string; turn?: number; yourDeck?: string; path?: string } = {}): GameLog {
  const gameId = opts.gameId ?? 'g-1';
  const hello = {
    gameId,
    you: 0,
    seed: 7,
    forgeVersion: '2.0.14',
    forgeJarSha256: 'x',
    unsupportedCards: [],
    players: [
      { id: 0, name: 'You', isAi: false },
      { id: 1, name: 'AI-Seat1', isAi: true },
    ],
    match: {
      yourDeck: { name: opts.yourDeck ?? 'Azorius ETB', cards: 40, path: opts.path ?? '/home/j/decks/wu.dck' },
      aiDeck: { name: 'Rakdos Sacrifice', cards: 40 },
      aiProfile: 'Reckless',
      games: 1,
    },
  };
  const header = { v: 1, kind: 'session', gameId, startedAt: opts.startedAt ?? '2026-09-27T14:45:00.000Z', seed: 7, forgeVersion: '2.0.14', forgeJarSha256: 'x', seat: 0 };
  const state = { gameId, turn: opts.turn ?? 9, round: 5, phase: 'MAIN1', activePlayer: 0, priority: 0, gameOver: null, players: [], stack: [] };
  const over = { winner: opts.winner === undefined ? 0 : opts.winner, reason: 'LifeReachedZero', matchOver: true };
  const frames = [
    { v: 1, seq: 1, t: 1, type: 'hello_ok', body: hello, dir: 's2c' },
    { v: 1, seq: 2, t: 2, type: 'state', body: state, dir: 's2c' },
    ...(opts.over === false ? [] : [{ v: 1, seq: 3, t: 3, type: 'over', body: over, dir: 's2c' }]),
  ];
  return { header, frames, hello, over: opts.over === false ? null : over, seat: 0 } as unknown as GameLog;
}

const rec = (result: GameResult, date: string, extra: Partial<GameRecord> = {}): GameRecord => ({
  v: 1,
  id: date,
  gameId: date,
  date,
  yourDeck: 'A',
  aiDeck: 'B',
  aiProfile: 'Default',
  result,
  reason: null,
  turns: 8,
  gameNumber: null,
  gameCount: null,
  cubeId: null,
  hasLog: false,
  ...extra,
});

describe('recordFromLog', () => {
  it('reads a finished game', () => {
    const r = recordFromLog(makeLog())!;
    expect(r).toMatchObject({
      id: 'g-1@2026-09-27T14:45:00.000Z',
      gameId: 'g-1',
      date: '2026-09-27T14:45:00.000Z',
      yourDeck: 'Azorius ETB',
      aiDeck: 'Rakdos Sacrifice',
      aiProfile: 'Reckless',
      result: 'win',
      reason: 'LifeReachedZero',
      turns: 9,
    });
  });
  it('names losses and draws', () => {
    expect(recordFromLog(makeLog({ winner: 1 }))!.result).toBe('loss');
    expect(recordFromLog(makeLog({ winner: null }))!.result).toBe('draw');
  });
  it('returns null for an unfinished game', () => {
    expect(recordFromLog(makeLog({ over: false }))).toBeNull();
  });
  it('never stores a path for either deck', () => {
    const r = recordFromLog(makeLog({ path: '/secret/ai/path.dck' }))!;
    expect(JSON.stringify(r)).not.toContain('/secret');
  });
  it('finds the cube from the deck name or path', () => {
    expect(recordFromLog(makeLog({ yourDeck: 'Synergy Cube — WU blink' }))!.cubeId).toBe('synergy');
    expect(recordFromLog(makeLog({ path: '/decks/pauper-cube-180/ub.dck' }))!.cubeId).toBe('pauper');
    expect(cubeOfDeck('Mono red', null)).toBeNull();
    expect(cubeOfDeck('vintage cube draft 3')).toBe('vintage');
  });
});

describe('the store', () => {
  it('saves once per game and keeps the log openable', async () => {
    const kv = memoryKV();
    const log = makeLog();
    const r1 = await recordFinishedGame(log, kv);
    await recordFinishedGame(log, kv);
    expect(r1!.hasLog).toBe(true);
    expect(await kv.all()).toHaveLength(1);
    const text = await kv.getLog(r1!.id);
    const back = parseLog(text!);
    expect(back.over?.winner).toBe(0);
    expect(back.frames).toHaveLength(3);
    expect(logToText(log).split('\n').filter(Boolean)).toHaveLength(4);
  });
  it('skips a log that is too big, keeps the record', async () => {
    const kv = memoryKV();
    const r = await recordFinishedGame(makeLog(), kv, 10);
    expect(r!.hasLog).toBe(false);
    expect(await kv.getLog(r!.id)).toBeNull();
    expect(await kv.all()).toHaveLength(1);
  });
  it('ignores unfinished games and never throws', async () => {
    const kv = memoryKV();
    expect(await recordFinishedGame(makeLog({ over: false }), kv)).toBeNull();
    expect(await recordFinishedGame(null, kv)).toBeNull();
    const broken = { ...memoryKV(), put: () => Promise.reject(new Error('quota')) };
    expect(await recordFinishedGame(makeLog(), broken)).toBeNull();
  });
  it('lists newest first', async () => {
    const kv = memoryKV();
    await recordFinishedGame(makeLog({ gameId: 'a', startedAt: '2026-09-01T10:00:00Z' }), kv);
    await recordFinishedGame(makeLog({ gameId: 'b', startedAt: '2026-09-03T10:00:00Z' }), kv);
    await recordFinishedGame(makeLog({ gameId: 'c', startedAt: '2026-09-02T10:00:00Z' }), kv);
    expect((await loadHistory(kv)).map((r) => r.gameId)).toEqual(['b', 'c', 'a']);
  });
});

describe('numbers', () => {
  // newest first
  const recs = [
    rec('win', '2026-09-07'),
    rec('win', '2026-09-06'),
    rec('loss', '2026-09-05', { aiProfile: 'Reckless', yourDeck: 'C' }),
    rec('win', '2026-09-04'),
    rec('win', '2026-09-03'),
    rec('win', '2026-09-02'),
    rec('draw', '2026-09-01', { yourDeck: null }),
  ];
  it('summarizes the record and streaks', () => {
    expect(summarize(recs)).toEqual({ matches: 7, wins: 5, losses: 1, draws: 1, winRate: 5 / 6, streak: 2, bestStreak: 3 });
    expect(summarize([])).toMatchObject({ matches: 0, winRate: null, streak: 0, bestStreak: 0 });
  });
  it('gives recent form oldest first', () => {
    expect(recentForm(recs, 3)).toEqual(['loss', 'win', 'win']);
  });
  it('breaks down by deck and profile', () => {
    const byDeck = breakdown(recs, 'yourDeck');
    expect(byDeck.map((r) => r.key)).toEqual(['A', 'C', 'Unknown']);
    expect(byDeck[0]).toMatchObject({ matches: 5, wins: 5, losses: 0, winRate: 1 });
    const byProfile = breakdown(recs, 'aiProfile');
    expect(byProfile.find((r) => r.key === 'Reckless')).toMatchObject({ matches: 1, losses: 1, recent: ['loss'] });
  });
  it('formats dates like a ledger', () => {
    expect(formatWhen('2026-09-27T14:45:00Z', 'UTC')).toBe('Sep 27, 2026 · 2:45 PM');
  });
});
