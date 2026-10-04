// ForgeCoach — filmRoom.test.ts
// SPDX-License-Identifier: GPL-3.0-or-later
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { parseLog, type GameLog } from './log.ts';
import { extractDecisions, type Decision } from './decisions.ts';
import { evalPoints, type WinPoint } from './winChance.ts';
import { parseReviewReport, isTie } from './gameReview.ts';
import type { GameStateBody } from './protocol.ts';
import { isHidden } from './protocol.ts';
import { visibleName } from './review.ts';
import {
  decisionSwings,
  dropWords,
  FILM_MIN_DROP,
  FILM_SYSTEM,
  filmKey,
  filmPrompt,
  heuristicPoints,
  heuristicScore,
  miniBoard,
  pickFilm,
  reviewMoments,
  turningPoints,
  type FilmMoment,
} from './filmRoom.ts';

function sample(name: string): GameLog {
  return parseLog(gunzipSync(readFileSync(new URL(`../public/samples/${name}.jsonl.gz`, import.meta.url))).toString('utf8'));
}
const report = () => parseReviewReport(readFileSync(new URL('../public/samples/human-auto-42.review.json', import.meta.url), 'utf8'));

const SAMPLES = ['human-auto-42', 'human-comfort-13'] as const;

/**
 * Injected win chance: flat at 50% with a small wobble, and a fall of `drops[i]`
 * planted across decision `i` — the score drops at the first scored position after
 * that decision ends, and stays down (as a real fall would).
 */
function injected(log: GameLog, ds: Decision[], drops: Record<number, number>): WinPoint[] {
  const ends = Object.entries(drops).map(([i, size]) => ({ end: Math.max(ds[+i]!.frameIndex, ds[+i]!.endFrameIndex), size }));
  return evalPoints(log).map((s, k) => {
    let p = 0.5 + (k % 2 ? 0.005 : -0.005);
    for (const e of ends) if (s.frameIndex > e.end) p -= e.size;
    // Keep it a probability; the planted falls are small enough not to clip.
    return { frameIndex: s.frameIndex, turn: s.state.turn, p: Math.min(1, Math.max(0, p + 0.3)) };
  });
}

/** Decisions with a scored position on both sides (the ones a turning point can be). */
function scorable(log: GameLog, ds: Decision[]): number[] {
  return decisionSwings(ds, heuristicPoints(log)).map((s) => s.decision.index);
}

describe('turning points from the win chance (injected values)', () => {
  for (const name of SAMPLES) {
    it(`${name}: the three planted falls, largest first, at the right decisions`, () => {
      const log = sample(name);
      const ds = extractDecisions(log);
      const ok = scorable(log, ds);
      expect(ok.length).toBeGreaterThan(6);
      const [a, b, c] = [ok[1]!, ok[Math.floor(ok.length / 2)]!, ok[ok.length - 2]!];
      const pts = injected(log, ds, { [a]: 0.08, [b]: 0.2, [c]: 0.13 });
      const film = pickFilm({ log, decisions: ds, evalPoints: pts });
      expect(film.source).toBe('eval');
      expect(film.note).toBeNull();
      expect(film.moments.map((m) => m.decision.index)).toEqual([b, c, a]);
      expect(film.moments.map((m) => m.rank)).toEqual([1, 2, 3]);
      for (const m of film.moments) {
        // before: at or before the decision; after: the first scored position after it ends.
        expect(m.before.frameIndex).toBeLessThanOrEqual(Math.max(m.decision.frameIndex, m.decision.endFrameIndex));
        const end = Math.max(m.decision.frameIndex, m.decision.endFrameIndex);
        expect(m.after.frameIndex).toBeGreaterThan(end);
        expect(pts.filter((p) => p.frameIndex > end && p.frameIndex < m.after.frameIndex)).toEqual([]);
        expect(m.drop).toBeCloseTo(m.before.p - m.after.p, 10);
        expect(m.source).toBe('eval');
      }
      expect(film.moments[0]!.drop).toBeCloseTo(0.2, 1);
    });

    it(`${name}: no fall of ${FILM_MIN_DROP * 100} points → no moment, and the source stays the win chance`, () => {
      const log = sample(name);
      const ds = extractDecisions(log);
      const film = pickFilm({ log, decisions: ds, evalPoints: injected(log, ds, {}) });
      expect(film.source).toBe('eval');
      expect(film.moments).toEqual([]);
    });
  }

  it('spans never share a start, and every span is one of the viewer’s own decisions', () => {
    for (const name of SAMPLES) {
      const log = sample(name);
      const ds = extractDecisions(log);
      const spans = decisionSwings(ds, heuristicPoints(log));
      const starts = spans.map((s) => s.before.frameIndex);
      expect(new Set(starts).size).toBe(starts.length);
      for (const s of spans) expect(ds).toContain(s.decision);
      // The mulligan has no scored position before it.
      expect(spans.some((s) => s.decision.kind === 'choice' && s.decision.state.turn === 0)).toBe(false);
    }
  });

  it('a decision with nothing scored after it (the game ended) is not a turning point', () => {
    const log = sample('human-auto-42');
    const ds = extractDecisions(log);
    const last = ds[ds.length - 1]!;
    const pts: WinPoint[] = evalPoints(log)
      .filter((s) => s.frameIndex <= Math.max(last.frameIndex, last.endFrameIndex))
      .map((s) => ({ frameIndex: s.frameIndex, turn: s.state.turn, p: s.frameIndex >= last.frameIndex ? 0.1 : 0.9 }));
    const tps = turningPoints(ds, pts, 'eval');
    expect(tps.some((m) => m.decision === last)).toBe(false);
  });
});

describe('fallbacks', () => {
  it('no helper model: the engine review report when one is open', () => {
    const log = sample('human-auto-42');
    const ds = extractDecisions(log);
    const film = pickFilm({ log, decisions: ds, evalPoints: null, report: report() });
    expect(film.source).toBe('review');
    expect(film.note).toMatch(/No win chance/);
    expect(film.moments.length).toBe(3);
    const r = report();
    for (const m of film.moments) {
      const rd = r.decisions.find((x) => x.frame === m.review!.frame)!;
      expect(rd.verdict === 'mistake' || rd.verdict === 'close').toBe(true);
      expect(isTie(rd)).toBe(false);
      expect(m.before.p).toBeGreaterThanOrEqual(m.after.p);
      expect(m.decision.frameIndex).toBeLessThanOrEqual(rd.stateFrame);
      // The replay decision it lands on is the same turn and phase (a shared boundary frame goes to the later decision).
      expect(m.decision.state.turn).toBe(rd.turn);
      expect(m.decision.state.phase).toBe(rd.phase);
    }
    // The engine's key moments come first.
    expect(film.moments[0]!.review!.frame).toBe(r.keyMoments.find((f) => film.moments.some((m) => m.review!.frame === f)));
  });

  it('too few scored positions counts as no win chance', () => {
    const log = sample('human-auto-42');
    const ds = extractDecisions(log);
    const one = [{ frameIndex: evalPoints(log)[0]!.frameIndex, turn: 1, p: 0.5 }];
    expect(pickFilm({ log, decisions: ds, evalPoints: one, report: report() }).source).toBe('review');
    expect(pickFilm({ log, decisions: ds, evalPoints: one }).source).toBe('heuristic');
  });

  it('no helper and no report: the heuristic swing, labelled as such', () => {
    for (const name of SAMPLES) {
      const log = sample(name);
      const ds = extractDecisions(log);
      const film = pickFilm({ log, decisions: ds, evalMissing: 'No win chance: no coach helper.' });
      expect(film.source).toBe('heuristic');
      expect(film.note).toBe('No win chance: no coach helper. No engine review is open.');
      expect(film.moments.length).toBe(3);
      for (const m of film.moments) {
        expect(m.drop).toBeGreaterThanOrEqual(FILM_MIN_DROP);
        expect(dropWords(m)).toMatch(/rough swing/);
      }
    }
  });

  it('a report with nothing to explain falls through to the heuristic', () => {
    const log = sample('human-auto-42');
    const ds = extractDecisions(log);
    const r = report();
    const none = { ...r, keyMoments: [], decisions: r.decisions.map((d) => ({ ...d, verdict: 'best' as const })) };
    expect(reviewMoments(log, ds, none)).toEqual([]);
    const film = pickFilm({ log, decisions: ds, report: none });
    expect(film.source).toBe('heuristic');
    expect(film.note).toMatch(/graded no mistake or close call/);
  });
});

describe('the heuristic score', () => {
  const st = (meLife: number, oppLife: number, oppHand = 3): GameStateBody =>
    ({
      players: [
        { id: 0, life: meLife, poison: 0, zones: { battlefield: { cards: [] }, hand: { count: 3, cards: [] } } },
        { id: 1, life: oppLife, poison: 0, zones: { battlefield: { cards: [] }, hand: { count: oppHand, cards: [] } } },
      ],
    }) as unknown as GameStateBody;
  it('is even when the sides are, and moves with life and cards in hand', () => {
    expect(heuristicScore(st(20, 20), 0)).toBeCloseTo(0.5, 10);
    expect(heuristicScore(st(20, 10), 0)).toBeGreaterThan(0.5);
    expect(heuristicScore(st(10, 20), 0)).toBeLessThan(0.5);
    expect(heuristicScore(st(20, 20, 1), 0)).toBeGreaterThan(0.5);
    expect(heuristicScore(st(20, 10), 1)).toBeCloseTo(1 - heuristicScore(st(20, 10), 0), 10);
  });
  it('reads the opponent’s hand as a count only', () => {
    const log = sample('human-comfort-13');
    const s = evalPoints(log)[10]!.state;
    const mb = miniBoard(s, log.seat)!;
    const opp = s.players.find((p) => p.id !== log.seat)!;
    expect(mb.them.hand).toBe(opp.zones.hand.count);
    expect(opp.zones.hand.cards.every((c) => isHidden(c))).toBe(true);
  });
});

/** Every card name the log shows the viewer at any point. */
function allNames(log: GameLog): Set<string> {
  const out = new Set<string>();
  for (const f of log.frames) {
    if (f.type !== 'state') continue;
    const s = f.body as GameStateBody;
    for (const p of s.players) for (const z of Object.values(p.zones)) for (const c of z.cards) {
      const n = visibleName(c);
      if (n) out.add(n);
    }
  }
  return out;
}
function namesAt(s: GameStateBody): Set<string> {
  const out = new Set<string>();
  for (const p of s.players) for (const z of Object.values(p.zones)) for (const c of z.cards) {
    const n = visibleName(c);
    if (n) out.add(n);
  }
  for (const c of s.stackCards ?? []) {
    const n = visibleName(c);
    if (n) out.add(n);
  }
  return out;
}

describe('the prompt', () => {
  const films = () => {
    const log = sample('human-auto-42');
    const ds = extractDecisions(log);
    const r = report();
    const ok = scorable(log, ds);
    return {
      log,
      r,
      eval: pickFilm({ log, decisions: ds, evalPoints: injected(log, ds, { [ok[3]!]: 0.12, [ok[9]!]: 0.2, [ok[14]!]: 0.05 }) }),
      review: pickFilm({ log, decisions: ds, report: r }),
      heuristic: pickFilm({ log, decisions: ds }),
    };
  };

  it('is deterministic (snapshot), for each source', () => {
    const f = films();
    const p = (m: FilmMoment) => filmPrompt(f.log, m, new Map(), { report: f.r });
    for (const src of ['eval', 'review', 'heuristic'] as const) {
      const m = f[src].moments[0]!;
      expect(p(m)).toEqual(p(m));
      expect(p(m).system).toBe(FILM_SYSTEM);
      expect(p(m).user).toMatchSnapshot(src);
    }
  });

  it('asks in the answer format coachAnswer.ts reads (Rule / Confidence)', () => {
    expect(FILM_SYSTEM).toMatch(/\*\*Rule:\*\*/);
    expect(FILM_SYSTEM).toMatch(/\*\*Confidence:\*\* high, medium or low/);
    expect(FILM_SYSTEM).toMatch(/\*\*What happened:\*\*/);
    expect(FILM_SYSTEM).toMatch(/\*\*Instead:\*\*/);
  });

  it('holds the state, the options, what was done and the scores before and after', () => {
    const f = films();
    const m = f.eval.moments[0]!;
    const u = filmPrompt(f.log, m, new Map()).user;
    expect(u).toMatch(/^# Decision\n/);
    expect(u).toMatch(/\n## YOU — /);
    expect(u).toMatch(/\n# What you could do\n/);
    expect(u).toMatch(/\n# What you did\n/);
    expect(u).toContain(`Before the decision (turn ${m.before.turn}): ${Math.round(m.before.p * 100)}%`);
    expect(u).toContain(`): ${Math.round(m.after.p * 100)}%.`);
    expect(u.match(/# Question/g)?.length).toBe(1);
    const h = filmPrompt(f.log, f.heuristic.moments[0]!, new Map()).user;
    expect(h).toContain('NOT a win chance');
    const r = filmPrompt(f.log, f.review.moments[0]!, new Map(), { report: f.r }).user;
    expect(r).toContain('ENGINE BEST');
    expect(r).toContain('PLAYED');
  });

  it('only names cards the viewer could see at the decision (or its own actions name)', () => {
    const f = films();
    const every = allNames(f.log);
    for (const film of [f.eval, f.review, f.heuristic]) {
      for (const m of film.moments) {
        const u = filmPrompt(f.log, m, new Map(), { report: f.r }).user;
        const seen = namesAt(m.decision.state);
        const acted = m.decision.actions.join('\n');
        const later = [...every].filter((n) => !seen.has(n) && !acted.includes(n) && n.length > 4);
        // Option labels from the engine review read the same state; nothing from after the decision.
        for (const n of later) expect(u.includes(n), `${n} at turn ${m.turn}`).toBe(false);
      }
    }
  });

  it('keys change with the source and the score', () => {
    const f = films();
    const m = f.eval.moments[0]!;
    expect(filmKey('g', m)).toBe(filmKey('g', { ...m }));
    expect(filmKey('g', m)).not.toBe(filmKey('g', { ...m, source: 'heuristic' }));
    expect(filmKey('g', m)).not.toBe(filmKey('g', { ...m, drop: m.drop + 0.05 }));
  });
});
