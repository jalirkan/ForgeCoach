// ForgeCoach — feedback.test.ts
// SPDX-License-Identifier: GPL-3.0-or-later
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { parseLog } from './log.ts';
import { extractDecisions } from './decisions.ts';
import {
  cleanNote,
  exportFeedback,
  FEEDBACK_KEY,
  feedbackKey,
  feedbackTarget,
  gameJoinKey,
  loadFeedback,
  MAX_ENTRIES,
  MAX_NOTE,
  rate,
  ratingOf,
  saveFeedback,
  type FeedbackTarget,
} from './feedback.ts';

const log = parseLog(gunzipSync(readFileSync(new URL('../public/samples/human-auto-42.jsonl.gz', import.meta.url))).toString('utf8'));
const NOW = () => Date.parse('2026-10-04T12:00:00Z');
const T: FeedbackTarget = { gameId: 'human-ws-7', seed: 7, startedAt: '2026-10-01T10:00:00Z', seq: 120, surface: 'play' };
const HELPER = { source: 'helper' as const, model: 'sonnet' };

function mem(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  };
}

describe('the target', () => {
  it('a decision is its state frame’s seq; the game is gameId + seed + startedAt', () => {
    const d = extractDecisions(log)[3]!;
    const t = feedbackTarget(log, d.frameIndex, 'replay')!;
    expect(t.gameId).toBe(log.header.gameId);
    expect(t.seq).toBe(log.frames[d.frameIndex]!.seq);
    expect(t.surface).toBe('replay');
    expect(feedbackTarget(log, null, 'review')!.seq).toBeNull();
    expect(feedbackTarget(log, 10_000_000, 'film')).toBeNull();
    expect(feedbackTarget(null, 0, 'play')).toBeNull();
  });

  it('the join key is human_collect.py’s manifest key (Python prints a missing value as None)', () => {
    expect(gameJoinKey(T)).toBe('human-ws-7|7|2026-10-01T10:00:00Z');
    expect(gameJoinKey({ ...T, seed: null })).toBe('human-ws-7|None|2026-10-01T10:00:00Z');
  });
});

describe('rating', () => {
  it('one entry per game, decision, surface, source and model; voting again replaces it', () => {
    let l = rate([], T, HELPER, { vote: 'up' }, NOW);
    l = rate(l, T, HELPER, { vote: 'down' }, NOW);
    expect(l).toHaveLength(1);
    expect(l[0]!.vote).toBe('down');
    l = rate(l, T, { source: 'apiKey', model: 'claude-x' }, { vote: 'up' }, NOW);
    l = rate(l, { ...T, surface: 'film' }, HELPER, { vote: 'up' }, NOW);
    l = rate(l, { ...T, seq: 121 }, HELPER, { vote: 'up' }, NOW);
    expect(l).toHaveLength(4);
    expect(new Set(l.map((e) => e.key)).size).toBe(4);
    expect(ratingOf(l, T, 'helper', 'sonnet')!.vote).toBe('down');
    expect(ratingOf(l, T, 'helper', 'opus')).toBeNull();
  });

  it('a note keeps the vote; a vote change keeps the note; null removes the entry', () => {
    let l = rate([], T, HELPER, { vote: 'down' }, NOW);
    l = rate(l, T, HELPER, { vote: 'down', note: '  ignored my\nopponent’s flyer  ' }, NOW);
    expect(l[0]!.note).toBe('ignored my opponent’s flyer');
    l = rate(l, T, HELPER, { vote: 'up' }, NOW);
    expect(l[0]!.note).toBe('ignored my opponent’s flyer');
    expect(rate(l, T, HELPER, { vote: null })).toEqual([]);
  });

  it('notes are one line and capped; empty is null', () => {
    expect(cleanNote('x'.repeat(500))).toHaveLength(MAX_NOTE);
    expect(cleanNote('   ')).toBeNull();
    expect(cleanNote('a\tb\u0000c')).toBe('a b c');
  });

  it('keeps the newest MAX_ENTRIES', () => {
    let l = rate([], { ...T, seq: 0 }, HELPER, { vote: 'up' }, NOW);
    for (let i = 1; i <= MAX_ENTRIES; i++) l = rate(l, { ...T, seq: i }, HELPER, { vote: 'up' }, NOW);
    expect(l).toHaveLength(MAX_ENTRIES);
    expect(l[0]!.seq).toBe(1);
  });
});

describe('storage and export', () => {
  it('round-trips; broken or foreign entries are dropped', () => {
    const s = mem();
    const l = rate([], T, HELPER, { vote: 'up', note: 'good' }, NOW);
    expect(saveFeedback(s, l)).toBe(true);
    expect(loadFeedback(s)).toEqual(l);
    s.setItem(FEEDBACK_KEY, JSON.stringify([...l, { v: 1, key: 'x' }, 7]));
    expect(loadFeedback(s)).toEqual(l);
    s.setItem(FEEDBACK_KEY, '{');
    expect(loadFeedback(s)).toEqual([]);
    expect(saveFeedback(s, [])).toBe(true);
    expect(s.getItem(FEEDBACK_KEY)).toBeNull();
    expect(loadFeedback(null)).toEqual([]);
  });

  it('the export carries the join key and no advice text', () => {
    let l = rate([], T, HELPER, { vote: 'up', note: 'clear' }, NOW);
    l = rate(l, { ...T, seq: null, surface: 'review' }, HELPER, { vote: 'down' }, () => NOW() - 1000);
    const x = exportFeedback(l, NOW);
    expect(x.kind).toBe('forgecoach-advice-feedback');
    expect(x.counts).toEqual({ up: 1, down: 1, notes: 1 });
    expect(x.entries.map((e) => e.surface)).toEqual(['review', 'play']);
    expect(x.entries[1]!.game.key).toBe('human-ws-7|7|2026-10-01T10:00:00Z');
    expect(Object.keys(x.entries[1]!).sort()).toEqual(['at', 'game', 'gameId', 'model', 'note', 'seed', 'seq', 'source', 'startedAt', 'surface', 'vote']);
    expect(feedbackKey(T, null, null)).toContain('#-#-');
  });
});
