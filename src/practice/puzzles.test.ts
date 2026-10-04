// ForgeCoach — practice/puzzles.test.ts
// SPDX-License-Identifier: GPL-3.0-or-later
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { parseLog, type GameLog } from '../log.ts';
import { extractDecisions } from '../decisions.ts';
import { cardIndex } from '../decisions.ts';
import { parseReviewReport } from '../gameReview.ts';
import { isHidden } from '../protocol.ts';
import { FILM_SYSTEM } from '../filmRoom.ts';
import {
  checkAnswer,
  derivedOptions,
  emptyBook,
  loadBook,
  MAX_PUZZLES,
  mergePuzzles,
  normalizePick,
  playedInDecision,
  practiceOrder,
  PUZZLE_KEY,
  puzzleAnswerKey,
  puzzlePrompt,
  puzzlesFromGame,
  recordTry,
  removeGame,
  saveBook,
  summarizeBook,
  swingWords,
  type EngineOption,
  type Puzzle,
  type PuzzleGame,
} from './puzzles.ts';

function sample(name: string): GameLog {
  return parseLog(gunzipSync(readFileSync(new URL(`../../public/samples/${name}.jsonl.gz`, import.meta.url))).toString('utf8'));
}
const report = () => parseReviewReport(readFileSync(new URL('../../public/samples/human-auto-42.review.json', import.meta.url), 'utf8'));
const game = (ref: string): PuzzleGame => ({ ref, sample: null, title: ref });
const NOW = () => Date.parse('2026-10-04T12:00:00Z');

function memStorage(): Storage {
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

describe('puzzles from a game', () => {
  it('human-auto-42 with its engine review: engine-graded puzzles use the report’s options, named from the log', () => {
    const log = sample('human-auto-42');
    const ds = extractDecisions(log);
    const ps = puzzlesFromGame({ log, decisions: ds, report: report(), game: game('g42'), now: NOW });
    const graded = ps.filter((p) => p.engine);
    expect(graded.length).toBeGreaterThanOrEqual(2);
    for (const p of graded) {
      expect(p.multi).toBe(false);
      expect(p.derived).toBe(false);
      // The report's tokens, and the played one is among them.
      expect(p.options.map((o) => o.id)).toEqual(p.engine!.options.map((o) => o.id));
      expect(p.played).toHaveLength(1);
      expect(p.options.some((o) => o.id === p.played[0])).toBe(true);
      expect(p.engine!.best === null || p.options.some((o) => o.id === p.engine!.best)).toBe(true);
      expect(p.question).toMatch(/\?$/);
    }
    // One puzzle per decision.
    expect(new Set(ps.map((p) => p.id)).size).toBe(ps.length);
    // The heuristic film's attack is kept beside the engine's moments (graded by the engine when it graded that attack).
    expect(ps.some((p) => p.kind === 'attack')).toBe(true);
  });

  it('option labels only name cards the viewer could see in the board state', () => {
    const log = sample('human-auto-42');
    const ps = puzzlesFromGame({ log, decisions: extractDecisions(log), report: report(), game: game('g42'), now: NOW });
    for (const p of ps) {
      const f = log.frames[p.boardFrame]!;
      expect(f.type).toBe('state');
      const ids = cardIndex(f.body as never);
      for (const o of p.options) {
        for (const id of o.cardIds) {
          const c = ids.get(id);
          // A card the viewer cannot see is never named by its id's card.
          if (!c || isHidden(c)) expect(o.label).toMatch(new RegExp(`#${id}|card #`));
        }
      }
    }
  });

  it('without a report: derived options for main phases and attacks, what was played read from the engine’s events', () => {
    for (const name of ['human-auto-42', 'human-comfort-13']) {
      const log = sample(name);
      const ds = extractDecisions(log);
      const ps = puzzlesFromGame({ log, decisions: ds, game: game(name), now: NOW });
      expect(ps.length).toBeGreaterThan(0);
      for (const p of ps) {
        expect(p.engine).toBeNull();
        expect(p.derived).toBe(true);
        expect(['main', 'attack']).toContain(p.kind);
        expect(p.options.at(-1)!.id).toBe('none');
        for (const id of p.played) expect(p.options.some((o) => o.id === id)).toBe(true);
        expect(p.boardFrame).toBe(p.decisionFrame);
        expect(p.swing.source).toBe('heuristic');
      }
    }
  });

  it('a main phase lists the lands while the land drop is unused, the spells the mana covers, and what was played', () => {
    const log = sample('human-comfort-13');
    const ds = extractDecisions(log);
    const d = ds.find((x) => x.kind === 'main' && x.actions.some((a) => a.startsWith('cast ')))!;
    const dv = derivedOptions(log, d, log.seat)!;
    expect(dv.multi).toBe(true);
    const casts = d.actions.filter((a) => a.startsWith('cast ')).map((a) => a.replace(/^cast /, '').replace(/ targeting .*$/, ''));
    for (const n of casts) expect(dv.played).toContain(`cast:${n}`);
    const did = playedInDecision(log, d, log.seat);
    expect(did.casts.length).toBe(casts.length);
  });

  it('an attack lists the untapped, non-sick creatures and those that attacked', () => {
    const log = sample('human-auto-42');
    const ds = extractDecisions(log);
    const d = ds.find((x) => x.kind === 'attack' && x.actions.some((a) => a.startsWith('attacked')))!;
    const dv = derivedOptions(log, d, log.seat)!;
    expect(dv.played.length).toBeGreaterThanOrEqual(1);
    expect(dv.played.every((id) => id.startsWith('atk:'))).toBe(true);
    const none = ds.find((x) => x.kind === 'attack' && x.actions.includes('declared no attackers'));
    if (none) {
      const nv = derivedOptions(log, none, log.seat);
      if (nv) expect(nv.played).toEqual(['none']);
    }
  });

  it('other kinds of moment make no derived puzzle', () => {
    const log = sample('human-auto-42');
    const ds = extractDecisions(log);
    for (const d of ds.filter((x) => x.kind === 'block' || x.kind === 'choice')) expect(derivedOptions(log, d, log.seat)).toBeNull();
  });
});

// ---------------------------------------------------------------------------

function engineOpt(id: string, winRate: number, regret: number | null, lo: number | null, hi: number | null): EngineOption {
  return { id, n: 200, winRate, winLo: winRate - 0.05, winHi: winRate + 0.05, regret, regretLo: lo, regretHi: hi };
}

function gradedPuzzle(measure: 'wins' | 'leaf' = 'wins'): Pick<Puzzle, 'options' | 'multi' | 'played' | 'engine'> {
  return {
    multi: false,
    options: [
      { id: 'pass', label: 'Pass (cast nothing)', cardIds: [] },
      { id: 'cast:1', label: 'Cast Opt', cardIds: [1] },
      { id: 'cast:2', label: 'Cast Shock', cardIds: [2] },
      { id: 'cast:3', label: 'Cast Bear', cardIds: [3] },
      { id: 'cast:4', label: 'Cast Elk', cardIds: [4] },
    ],
    played: ['cast:2'],
    engine: {
      frame: 10,
      measure,
      best: 'cast:1',
      verdict: 'Mistake — clear',
      warning: null,
      options: [
        engineOpt('pass', 0.4, 0.2, 0.12, 0.28),
        engineOpt('cast:1', 0.6, 0, 0, 0),
        engineOpt('cast:2', 0.5, 0.1, -0.02, 0.22),
        engineOpt('cast:3', 0.598, 0.002, -0.05, 0.05),
        { id: 'cast:4', n: null, winRate: null, winLo: null, winHi: null, regret: null, regretLo: null, regretHi: null },
      ],
    },
  };
}

describe('checking an answer', () => {
  it('the engine’s pick', () => {
    const r = checkAnswer(gradedPuzzle(), ['cast:1']);
    expect(r.outcome).toBe('best');
    expect(r.sameAsGame).toBe(false);
  });

  it('a regret interval that includes zero is a close call, never a mistake', () => {
    const r = checkAnswer(gradedPuzzle(), ['cast:2']);
    expect(r.outcome).toBe('close');
    expect(r.sameAsGame).toBe(true);
    expect(r.headline).not.toMatch(/mistake/i);
    expect(r.detail).toMatch(/includes zero/);
    expect(r.detail).toMatch(/not a mistake/);
  });

  it('a tie is a tie', () => {
    expect(checkAnswer(gradedPuzzle(), ['cast:3']).outcome).toBe('tie');
  });

  it('only an interval wholly above zero says the engine prefers another line', () => {
    const r = checkAnswer(gradedPuzzle(), ['pass']);
    expect(r.outcome).toBe('worse');
    expect(r.detail).toMatch(/wholly above zero/);
    expect(r.detail).toMatch(/Cast Opt \(60%\)/);
  });

  it('no interval: a close call', () => {
    const p = gradedPuzzle();
    p.engine!.options[0] = { ...p.engine!.options[0]!, regretLo: null, regretHi: null };
    expect(checkAnswer(p, ['pass']).outcome).toBe('close');
  });

  it('an option the engine did not score', () => {
    expect(checkAnswer(gradedPuzzle(), ['cast:4']).outcome).toBe('ungraded');
  });

  it('a short-horizon measure is never called a win rate', () => {
    const r = checkAnswer(gradedPuzzle('leaf'), ['cast:1']);
    expect(r.detail).toMatch(/not a win rate/);
    expect(r.detail).toMatch(/0\.60/);
  });

  it('without the engine, only “as in the game” or “different”', () => {
    const p: Pick<Puzzle, 'options' | 'multi' | 'played' | 'engine'> = {
      multi: true,
      options: [
        { id: 'land:Island', label: 'Play Island', cardIds: [1] },
        { id: 'cast:Opt', label: 'Cast Opt', cardIds: [2] },
        { id: 'none', label: 'Play nothing', cardIds: [] },
      ],
      played: ['land:Island', 'cast:Opt'],
      engine: null,
    };
    expect(checkAnswer(p, ['cast:Opt', 'land:Island']).outcome).toBe('same');
    expect(checkAnswer(p, ['land:Island']).outcome).toBe('different');
    expect(checkAnswer(p, ['land:Island']).detail).toMatch(/no right answer/);
    // "Play nothing" with other picks means the other picks.
    expect(normalizePick(p, ['none', 'cast:Opt'])).toEqual(['cast:Opt']);
    expect(normalizePick(p, ['none'])).toEqual(['none']);
    expect(normalizePick(p, ['bogus'])).toEqual([]);
    expect(checkAnswer({ ...p, played: ['none'] }, ['none']).outcome).toBe('same');
  });
});

// ---------------------------------------------------------------------------

function fakePuzzle(id: string, over: Partial<Puzzle> = {}): Puzzle {
  return {
    v: 1,
    id,
    game: game(id.split(':')[0]!),
    addedAt: '2026-10-01T00:00:00.000Z',
    decisionFrame: 1,
    boardFrame: 1,
    turn: 3,
    phase: 'MAIN1',
    kind: 'main',
    title: 'Turn 3 · your main 1',
    question: 'What would you play?',
    multi: true,
    derived: true,
    options: [
      { id: 'cast:Opt', label: 'Cast Opt', cardIds: [2] },
      { id: 'none', label: 'Play nothing', cardIds: [] },
    ],
    played: ['none'],
    playedWords: ['passed without playing anything'],
    swing: { source: 'heuristic', before: 0.6, after: 0.5, drop: 0.1, beforeTurn: 3, afterTurn: 4, measure: null },
    engine: null,
    tries: [],
    ...over,
  };
}

describe('the puzzle book', () => {
  it('round-trips through storage; a broken one reads as empty', () => {
    const s = memStorage();
    expect(loadBook(s)).toEqual(emptyBook());
    const book = mergePuzzles(emptyBook(), [fakePuzzle('a:f1')], 'a');
    expect(saveBook(s, book)).toBe(true);
    expect(loadBook(s)).toEqual(book);
    s.setItem(PUZZLE_KEY, '{nope');
    expect(loadBook(s)).toEqual(emptyBook());
    s.setItem(PUZZLE_KEY, JSON.stringify({ v: 1, puzzles: [{ v: 1, id: 3 }, fakePuzzle('b:f1')], scanned: ['b', 4] }));
    const back = loadBook(s);
    expect(back.puzzles.map((p) => p.id)).toEqual(['b:f1']);
    expect(back.scanned).toEqual(['b']);
    expect(loadBook(null)).toEqual(emptyBook());
  });

  it('merging keeps tries and order, takes the engine’s numbers and a better swing', () => {
    let book = mergePuzzles(emptyBook(), [fakePuzzle('a:f1'), fakePuzzle('a:f2')], 'a');
    book = recordTry(book, 'a:f1', ['none'], 'same', NOW);
    const engine = gradedPuzzle().engine;
    const upgraded = fakePuzzle('a:f1', { engine, multi: false, derived: false, swing: { source: 'eval', before: 0.7, after: 0.4, drop: 0.3, beforeTurn: 3, afterTurn: 4, measure: null } });
    book = mergePuzzles(book, [upgraded], 'a');
    expect(book.scanned).toEqual(['a']);
    const a = book.puzzles[0]!;
    expect(a.id).toBe('a:f1');
    expect(a.engine).toEqual(engine);
    expect(a.swing.source).toBe('eval');
    expect(a.tries).toHaveLength(1);
    // A worse source never replaces a better swing, and no engine never drops one.
    book = mergePuzzles(book, [fakePuzzle('a:f1')]);
    expect(book.puzzles[0]!.swing.source).toBe('eval');
    expect(book.puzzles[0]!.engine).toEqual(engine);
    expect(removeGame(book, 'a').puzzles).toEqual([]);
  });

  it('keeps at most MAX_PUZZLES, dropping the oldest untried', () => {
    const many = Array.from({ length: MAX_PUZZLES + 5 }, (_, i) => fakePuzzle(`g${i}:f1`, { addedAt: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString() }));
    let book = mergePuzzles(emptyBook(), many.slice(0, 1));
    book = recordTry(book, 'g0:f1', ['none'], 'same', NOW);
    book = mergePuzzles(book, many.slice(1));
    expect(book.puzzles).toHaveLength(MAX_PUZZLES);
    expect(book.puzzles.some((p) => p.id === 'g0:f1')).toBe(true);
    expect(book.puzzles.some((p) => p.id === 'g1:f1')).toBe(false);
  });

  it('practice order: untried first (newest first), then tried longest ago', () => {
    const p1 = fakePuzzle('a:f1', { addedAt: '2026-10-01T00:00:00Z' });
    const p2 = fakePuzzle('a:f2', { addedAt: '2026-10-02T00:00:00Z' });
    const p3 = fakePuzzle('a:f3', { tries: [{ at: '2026-10-03T00:00:00Z', chose: ['none'], outcome: 'same' }] });
    const p4 = fakePuzzle('a:f4', { tries: [{ at: '2026-10-02T00:00:00Z', chose: ['none'], outcome: 'best' }], engine: gradedPuzzle().engine });
    expect(practiceOrder([p3, p1, p4, p2]).map((p) => p.id)).toEqual(['a:f2', 'a:f1', 'a:f4', 'a:f3']);
    expect(summarizeBook([p1, p2, p3, p4])).toEqual({ total: 4, tried: 2, graded: 1, engineAgreed: 1 });
  });
});

describe('words and the coach prompt', () => {
  it('swing words name the source honestly', () => {
    expect(swingWords({ source: 'eval', before: 0.62, after: 0.41, drop: 0.21, beforeTurn: 5, afterTurn: 6, measure: null })).toBe('62% → 41% (−21 points) by the next time you held priority (turn 6)');
    expect(swingWords({ source: 'heuristic', before: 0.62, after: 0.41, drop: 0.21, beforeTurn: 5, afterTurn: 6, measure: null })).toMatch(/rough/);
    expect(swingWords({ source: 'review', before: 0.6, after: 0.5, drop: 0.1, beforeTurn: 5, afterTurn: 5, measure: 'leaf' })).toMatch(/short-horizon/);
  });

  it('the puzzle prompt is the film prompt plus the practice section, deterministic', () => {
    const log = sample('human-auto-42');
    const ds = extractDecisions(log);
    const ps = puzzlesFromGame({ log, decisions: ds, report: report(), game: game('g42'), now: NOW });
    const p = ps.find((x) => x.engine)!;
    const d = ds.find((x) => x.frameIndex === p.decisionFrame)!;
    const a = puzzlePrompt(log, p, d, new Map(), [p.options[0]!.id]);
    const b = puzzlePrompt(log, p, d, new Map(), [p.options[0]!.id]);
    expect(a).toEqual(b);
    expect(a.system).toBe(FILM_SYSTEM);
    expect(a.user).toMatch(/# Practice\n/);
    expect(a.user).toMatch(/practice pick/);
    expect(a.user).toMatch(/engine best/);
    expect(a.user).toMatch(/includes zero is a close call/);
    expect(a.user.indexOf('# Practice')).toBeLessThan(a.user.indexOf('# Question'));
    expect(puzzleAnswerKey(p, [p.options[0]!.id])).not.toBe(puzzleAnswerKey(p, [p.options[1]!.id]));
  });
});
