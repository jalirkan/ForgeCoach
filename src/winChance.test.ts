// ForgeCoach — winChance.test.ts
// SPDX-License-Identifier: GPL-3.0-or-later
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { parseLog, type GameLog } from './log.ts';
import {
  buildRequest,
  buildRequests,
  decisionDrops,
  decisionSpans,
  DROP_THRESHOLD,
  evalPoints,
  isEvalState,
  band,
  dropKey,
  dropWhy,
  pct,
  pctBand,
  points,
  pointAt,
  readStates,
  turnChange,
  whyWords,
  type WinPoint,
} from './winChance.ts';
import type { GameStateBody } from './protocol.ts';
import { extractDecisions } from './decisions.ts';

function sample(file: string): GameLog {
  return parseLog(gunzipSync(readFileSync(new URL(`../public/samples/${file}`, import.meta.url))).toString('utf8'));
}

/**
 * Written by mtg-table's own reader (tools/ml encode.read_games, eval_serve.is_decision and
 * eval_serve.request_for, D361) over the same two recordings: the decision rows a client
 * scores and the frames whose events the request carries, by seq. The helper's encoder is
 * held to dataset.py's rows there; this holds ForgeCoach's request to the helper's reader.
 */
const golden = JSON.parse(readFileSync(new URL('./testdata/winchance-requests.golden.json', import.meta.url), 'utf8')) as {
  logs: { file: string; seat: number; decisionSeqs: number[]; tallySeqs: number[] }[];
};

const seqOf = (log: GameLog, frameIndex: number) => (log.frames[frameIndex] as { seq: number }).seq;

describe('the positions and requests (mtg-table D361 parity)', () => {
  for (const g of golden.logs) {
    it(`${g.file}: the decision rows mtg-table reads, and the history it reads`, () => {
      const log = sample(g.file);
      expect(log.seat).toBe(g.seat);
      const pts = evalPoints(log);
      expect(pts.map((p) => seqOf(log, p.frameIndex))).toEqual(g.decisionSeqs);
      const reqs = buildRequests(
        log,
        pts.map((p) => p.frameIndex),
      );
      expect(reqs.size).toBe(pts.length);
      const tallyEvents = new Map(readStates(log).map((s) => [seqOf(log, s.frameIndex), s.state.events]));
      for (const p of pts) {
        const r = reqs.get(p.frameIndex)!;
        const seq = seqOf(log, p.frameIndex);
        expect(r.seat).toBe(g.seat);
        expect(r.state).toBe(p.state);
        const want = g.tallySeqs.filter((s) => s < seq);
        expect(r.history.length).toBe(want.length);
        // Each history entry is that frame's own events and stack, untouched.
        r.history.forEach((h, i) => expect(h.events).toBe(tallyEvents.get(want[i]!)));
      }
      // One request on its own is the same as the batch's.
      const last = pts[pts.length - 1]!;
      expect(buildRequest(log, last.frameIndex)).toEqual(reqs.get(last.frameIndex));
    });
  }

  it('reads each seq once and server-to-client frames only, as encode.py does', () => {
    const log = sample('human-auto-42.jsonl.gz');
    const n = readStates(log).length;
    const first = readStates(log)[5]!;
    const dup = { ...log, frames: [...log.frames, { ...log.frames[first.frameIndex]! }, { ...log.frames[first.frameIndex]!, seq: 999999, dir: 'c2s' as const }] };
    expect(readStates(dup as GameLog).length).toBe(n);
  });

  it('a request carries the state and the events, nothing else', () => {
    const log = sample('human-comfort-13.jsonl.gz');
    const p = evalPoints(log)[20]!;
    const r = buildRequest(log, p.frameIndex)!;
    expect(Object.keys(r).sort()).toEqual(['history', 'seat', 'state']);
    for (const h of r.history) expect(Object.keys(h).sort()).toEqual(['events', 'stack']);
    expect(buildRequest(log, 0)).toBeNull(); // frame 0 is no state
  });

  it('isEvalState: the viewer holds priority in a main phase or combat, the game not over', () => {
    const st = (o: Partial<GameStateBody>) => ({ phase: 'MAIN1', priority: 0, gameOver: null, ...o }) as GameStateBody;
    expect(isEvalState(st({}), 0)).toBe(true);
    expect(isEvalState(st({ phase: 'COMBAT_DECLARE_BLOCKERS' }), 0)).toBe(true);
    expect(isEvalState(st({ priority: 1 }), 0)).toBe(false);
    expect(isEvalState(st({ phase: 'UPKEEP' }), 0)).toBe(false);
    expect(isEvalState(st({ phase: 'END_OF_TURN' }), 0)).toBe(false);
    expect(isEvalState(st({ phase: null }), 0)).toBe(false);
    expect(isEvalState(st({ gameOver: { winner: 0, reason: 'x' } as unknown as GameStateBody['gameOver'] }), 0)).toBe(false);
    expect(isEvalState(null, 0)).toBe(false);
  });
});

const P = (frameIndex: number, turn: number, p: number): WinPoint => ({ frameIndex, turn, p });

describe('turn change and drops', () => {
  const pts = [P(10, 1, 0.5), P(12, 1, 0.55), P(20, 2, 0.6), P(30, 3, 0.4), P(31, 3, 0.42)];
  it('pointAt: the newest at or before a frame', () => {
    expect(pointAt(pts)).toEqual(P(31, 3, 0.42));
    expect(pointAt(pts, 25)).toEqual(P(20, 2, 0.6));
    expect(pointAt(pts, 5)).toBeNull();
  });
  it('turnChange: against the last position of an earlier turn', () => {
    const c = turnChange(pts)!;
    expect(c.now.frameIndex).toBe(31);
    expect(c.before!.frameIndex).toBe(20);
    expect(c.delta).toBeCloseTo(-0.18);
    expect(turnChange(pts, 12)!.before).toBeNull();
    expect(turnChange(pts, 12)!.delta).toBeNull();
    expect(turnChange([])).toBeNull();
  });
  it('decisionDrops: a fall of 8 points or more with a decision before it, marked once at the last decision', () => {
    const d = decisionDrops(pts, [
      { frame: 21, id: 7 },
      { frame: 25, id: 8 },
      { frame: 11, id: 1 },
    ]);
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ id: 8, decisionFrame: 25, before: { frameIndex: 20 }, after: { frameIndex: 30 } });
    expect(d[0]!.drop).toBeCloseTo(0.2);
    // No decision of the player's in between: no marker, however large the fall.
    expect(decisionDrops(pts, [{ frame: 11, id: 1 }])).toEqual([]);
    // Exactly the threshold counts; less does not.
    expect(decisionDrops([P(1, 1, 0.5), P(2, 1, 0.5 - DROP_THRESHOLD)], [{ frame: 1, id: 0 }])).toHaveLength(1);
    expect(decisionDrops([P(1, 1, 0.5), P(2, 1, 0.43)], [{ frame: 1, id: 0 }])).toHaveLength(0);
    // A rise is never a drop.
    expect(decisionDrops([P(1, 1, 0.3), P(2, 1, 0.9)], [{ frame: 1, id: 0 }])).toEqual([]);
  });
  it('a decision that covers a stretch (a whole main phase) is marked for a fall that starts inside it', () => {
    expect(decisionDrops(pts, [{ frame: 13, end: 21, id: 3 }])).toMatchObject([{ id: 3, before: { frameIndex: 20 } }]);
    expect(decisionDrops(pts, [{ frame: 13, end: 20, id: 3 }])).toEqual([]);
  });
  it('decisionSpans: a replay decision lasts until the turn or phase moves on', () => {
    const log = sample('human-auto-42.jsonl.gz');
    const ds = extractDecisions(log);
    const spans = decisionSpans(log, ds.map((d, i) => ({ frameIndex: d.frameIndex, id: i })));
    expect(spans).toHaveLength(ds.length);
    const main1 = spans[1]!; // R1 · Your main 1
    expect(main1.frame).toBe(ds[1]!.frameIndex);
    expect(main1.end!).toBeGreaterThan(main1.frame);
    const states = readStates(log);
    // Every state frame inside the span is the same turn and phase as its first.
    const first = states.find((s) => s.frameIndex === main1.frame)!.state;
    for (const s of states.filter((x) => x.frameIndex >= main1.frame && x.frameIndex < main1.end!)) {
      expect([s.state.turn, s.state.phase]).toEqual([first.turn, first.phase]);
    }
    for (let k = 0; k + 1 < spans.length; k++) expect(spans[k]!.end!).toBeLessThanOrEqual(spans[k + 1]!.frame);
  });
  it('words', () => {
    expect(pct(0.537)).toBe('54%');
    expect(pct(1.2)).toBe('100%');
    expect(points(0.04)).toBe('+4');
    expect(points(-0.12)).toBe('−12');
    expect(points(0.001)).toBe('±0');
  });
});

describe('mtg-table D368: the models’ spread and why a drop fell', () => {
  it('band and pctBand', () => {
    expect(band(0.061)).toBe('± 6');
    expect(band(0.002)).toBe('± 1');
    expect(pctBand(0.62)).toBe('62%');
    expect(pctBand(0.62, 0.06)).toBe('62% ± 6');
  });

  it('dropWhy: the change of every bucket between the two positions, largest first, summing to the change', () => {
    const before = {
      buckets: [
        { key: 'me.board', label: 'your board', pts: 6 },
        { key: 'me.hand', label: 'cards in hand', pts: 2 },
        { key: 'card.me:Glorybringer', label: 'your Glorybringer', pts: 3 },
        { key: 'opp.life', label: 'their life', pts: -1 },
      ],
    };
    const after = {
      buckets: [
        { key: 'me.board', label: 'your board', pts: -3 },
        { key: 'me.hand', label: 'cards in hand', pts: -2 },
        { key: 'opp.life', label: 'their life', pts: 0.6 },
        { key: 'opp.board', label: 'their board', pts: -0.4 },
      ],
    };
    const all = dropWhy(before, after, 99, 0);
    const sum = (b: { buckets: { pts: number }[] }) => b.buckets.reduce((t, x) => t + x.pts, 0);
    expect(all.reduce((t, x) => t + x.pts, 0)).toBeCloseTo(sum(after) - sum(before), 12);
    expect(all.find((x) => x.key === 'card.me:Glorybringer')!.pts).toBe(-3); // it left: its whole share goes
    expect(all.find((x) => x.key === 'opp.board')!.pts).toBe(-0.4); // it came
    const top = dropWhy(before, after);
    expect(top.map((x) => x.key)).toEqual(['me.board', 'me.hand', 'card.me:Glorybringer']);
    expect(whyWords(top)).toBe('your board −9, cards in hand −4, your Glorybringer −3');
    expect(dropWhy(before, after, 3, 5).map((x) => x.key)).toEqual(['me.board']);
    expect(whyWords([{ key: 'x', label: 'their life', pts: 0.3 }])).toBe('');
    expect(whyWords([{ key: 'x', label: 'their life', pts: 2.6 }])).toBe('their life +3');
  });

  it('dropKey names a drop by its decision and the position it fell to', () => {
    const after: WinPoint = { frameIndex: 40, turn: 5, p: 0.3 };
    expect(dropKey({ id: 7, after })).toBe('7-40');
  });
});
