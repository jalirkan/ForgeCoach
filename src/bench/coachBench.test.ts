// SPDX-License-Identifier: GPL-3.0-or-later
// The coach bench's dry run (what CI checks: every case builds the app's prompt
// and every listed answer is legal there) and the scoring machinery. No model calls.
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { COACH_SYSTEM } from '../prompt.ts';
import { coachSystem } from '../prompt.ts';
import { CoachError } from '../claude.ts';
import {
  BENCH_TYPES,
  benchThinking,
  buildCase,
  calibration,
  caseProblems,
  parseModelByType,
  promptSections,
  transientKind,
  caseStats,
  compareReports,
  extractAnswer,
  formatAnswer,
  missingCards,
  normalizeReport,
  parseAnswer,
  reportMarkdown,
  runBench,
  summarize,
  scoreReply,
  validateCase,
  type BenchReport,
  type BenchType,
  type BuiltCase,
  type CaseResult,
  type Sample,
} from './coachBench.ts';
import { bootstrapMean, signTest, wilson } from './benchStats.ts';
import { buildAll, readCards, readCases, readLogFile } from './benchFiles.ts';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const loaded = readCases(ROOT);
const cards = readCards(ROOT);
const { built, errors } = buildAll(
  ROOT,
  loaded.filter((l) => l.value).map((l) => l.value!),
  cards,
);
const byId = (id: string): BuiltCase => {
  const b = built.find((x) => x.case.id === id);
  if (!b) throw new Error(`no case ${id}`);
  return b;
};

describe('coach bench — dry run over bench/coach/cases', () => {
  it('has cases, every file valid and named after its id', () => {
    expect(loaded.length).toBeGreaterThanOrEqual(20);
    for (const l of loaded) expect(l.errors, l.file).toEqual([]);
    const ids = loaded.map((l) => l.value!.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('builds every case from its log', () => {
    expect(errors).toEqual([]);
    expect(built.length).toBe(loaded.length);
  });

  it('lists only legal answers, at the moment the case names', () => {
    for (const b of built) expect(caseProblems(b), b.case.id).toEqual([]);
  });

  it('has card text for every card the prompts name', () => {
    for (const b of built) expect(missingCards(b.moment.log, b.moment.decision, cards), b.case.id).toEqual([]);
  });

  it('covers every decision type with high-confidence cases', () => {
    const types = new Set(built.filter((b) => b.case.confidence === 'high').map((b) => b.case.type));
    for (const t of BENCH_TYPES) expect(types.has(t), t).toBe(true);
  });

  it('adds the bench section only to the bench prompt', () => {
    for (const b of built) {
      expect(b.prompt.system).toBe(COACH_SYSTEM);
      expect(b.appPrompt.system).toBe(COACH_SYSTEM);
      expect(b.appPrompt.user).not.toContain('# Bench answer');
      expect(b.appPrompt.user).not.toContain('ANSWER:');
      expect(b.prompt.user.startsWith(b.appPrompt.user)).toBe(true);
      expect(b.prompt.user).toMatch(/# Bench answer[\s\S]*ANSWER:/);
    }
  });

  it('never shows the opponent’s hidden hand', () => {
    for (const b of built) {
      const opp = b.moment.decision.state.players.find((p) => p.id !== b.case.seat)!;
      const hidden = opp.zones.hand.cards.length === 0 || opp.zones.hand.cards.every((c) => c.hidden === true || c.faceDownHidden === true);
      if (hidden) expect(b.appPrompt.user).toMatch(new RegExp(`Hand: ${opp.zones.hand.count} cards \\(hidden\\)`));
    }
  });
});

describe('answers', () => {
  it('parses and canonicalises answer tokens', () => {
    const f = (s: string) => {
      const p = parseAnswer(s);
      return p ? formatAnswer(p) : null;
    };
    expect(f('keep')).toBe('keep');
    expect(f(' **Mulligan** ')).toBe('mulligan');
    expect(f('cast: #27')).toBe('cast:27');
    expect(f('`target:64`.')).toBe('target:64');
    expect(f('attack: #34, #21 26')).toBe('attack:21,26,34');
    expect(f('attack:none')).toBe('attack:none');
    expect(f('block: 26>49, 34 -> 49')).toBe('block:26>49,34>49');
    expect(f('block:none')).toBe('block:none');
    expect(f('attack the opponent')).toBeNull();
    expect(f('block:34')).toBeNull();
  });

  it('reads the last ANSWER line, whatever the markdown around it', () => {
    expect(extractAnswer('**Play:** keep\n\nANSWER: keep')).toBe('keep');
    expect(extractAnswer('ANSWER: mulligan\nmore text\n**ANSWER:** `keep`')).toBe('keep');
    expect(extractAnswer('- answer: attack:none')).toBe('attack:none');
    expect(extractAnswer('no machine line here')).toBeNull();
  });

  it('scores acceptable, blunder, other, illegal and missing replies', () => {
    const b = byId('block-comfort13-trade-fliers');
    expect(scoreReply(b, 'ANSWER: block:23>64')).toMatchObject({ verdict: 'acceptable', score: 1 });
    expect(scoreReply(b, 'ANSWER: block:23>42')).toMatchObject({ verdict: 'unacceptable', score: -1 });
    expect(scoreReply(b, 'ANSWER: block:none')).toMatchObject({ verdict: 'other', score: 0 });
    expect(scoreReply(b, 'ANSWER: block:42>23')).toMatchObject({ verdict: 'illegal', score: 0 });
    expect(scoreReply(b, 'ANSWER: cast:3')).toMatchObject({ verdict: 'illegal', score: 0 });
    expect(scoreReply(b, 'Block the Ant.')).toMatchObject({ verdict: 'missing', score: 0 });
  });

  it('treats identical creatures as interchangeable', () => {
    const b = byId('block-trample7-first-strike');
    // The case lists 34+26 as the double block; 21+34 is the same block with another 3/2.
    expect(scoreReply(b, 'ANSWER: block:21>49,34>49').verdict).toBe('acceptable');
    expect(scoreReply(b, 'ANSWER: block:21>49').verdict).toBe('unacceptable');
    const a = byId('attack-trample7-no-blockers');
    expect(scoreReply(a, 'ANSWER: attack:34,26,21').verdict).toBe('acceptable');
    expect(scoreReply(a, 'ANSWER: attack:21,26').verdict).toBe('other');
  });

  it('knows a ground creature cannot block a flier', () => {
    const b = byId('block-auto7-must-block');
    expect(scoreReply(b, 'ANSWER: block:26>64')).toMatchObject({ verdict: 'illegal' });
    expect(scoreReply(b, 'ANSWER: block:26>42,4>42').verdict).toBe('acceptable');
  });

  it('checks case files', () => {
    expect(validateCase({}).ok).toBe(false);
    const bad = validateCase({ id: 'X y', log: 'a', seat: 0, type: 'nope', moment: { mode: 'live' }, acceptable: [], unacceptable: [], rationale: '', confidence: 'mid' });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors.length).toBeGreaterThanOrEqual(6);
  });
});

describe('runs and repeated sampling', () => {
  const pick = ['block-comfort13-trade-fliers', 'mulligan-trample7-curve', 'pass-auto2026-no-target-yet'].map(byId);
  const replies: Record<string, string> = {
    'block-comfort13-trade-fliers': 'ANSWER: block:23>64',
    'mulligan-trample7-curve': 'ANSWER: mulligan',
    'pass-auto2026-no-target-yet': 'no line',
  };
  let t = 0;
  const now = () => (t += 500);
  const idOf = (p: unknown) => pick.find((b) => b.prompt === p)!.case.id;

  it('asks each case `repeat` times, keeps every answer and aggregates per case', async () => {
    const asked: string[] = [];
    const r = await runBench(
      pick,
      async (p) => {
        const id = idOf(p);
        asked.push(id);
        if (id === 'pass-auto2026-no-target-yet') throw new Error('helper busy');
        return { text: replies[id]!, model: 'test-model' };
      },
      { label: 'a', source: 'test', repeat: 3, concurrency: 2, now },
    );
    expect(asked).toHaveLength(9);
    expect(r.repeat).toBe(3);
    const block = r.cases.find((c) => c.id === 'block-comfort13-trade-fliers')!;
    expect(block.samples).toHaveLength(3);
    expect(block.stats).toMatchObject({ n: 3, valid: 3, meanScore: 1, acceptable: 3, agreement: 1 });
    expect(r.cases.find((c) => c.id === 'mulligan-trample7-curve')!.stats).toMatchObject({ meanScore: -1, unacceptable: 3 });
    const err = r.cases.find((c) => c.id === 'pass-auto2026-no-target-yet')!;
    // A plain error (no transient kind) is not retried: one call, one transport error.
    expect(err.samples[0]).toMatchObject({ verdict: 'error', note: 'helper busy', attempts: 1 });
    expect(err.stats).toMatchObject({ valid: 0, meanScore: null, unparsed: 0, errors: 3 });
    expect(r.model).toBe('test-model');
    // Transport errors are their own metric: not format failures, not in the score.
    expect(r.summary.total.formatFailure!.mean).toBe(0);
    expect(r.summary.total.errors).toBe(3);
    expect(r.summary.total.transportError!.mean).toBeCloseTo(1 / 3);
    expect(r.summary.total.score!.mean).toBe(0);
    const md = reportMarkdown(r);
    expect(md).toContain('3 answers per case');
    expect(md).toMatch(/\| block \| 1 \|/);
    expect(md).toMatch(/WARNING — TRANSPORT ERRORS: 3 of 9 calls/);
  });

  it('never has more calls in flight than the concurrency', async () => {
    let live = 0;
    let peak = 0;
    await runBench(
      pick,
      async () => {
        peak = Math.max(peak, ++live);
        await new Promise((r) => setTimeout(r, 2));
        live--;
        return { text: 'ANSWER: keep' };
      },
      { label: 'c', source: 'test', repeat: 2, concurrency: 2, now },
    );
    expect(peak).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Fake results (no model, no cases): aggregation, intervals, comparison

const sample = (verdict: Sample['verdict'], answer = 'x'): Sample => {
  const score = verdict === 'acceptable' ? 1 : verdict === 'unacceptable' ? -1 : 0;
  const valid = verdict === 'acceptable' || verdict === 'unacceptable' || verdict === 'other';
  return { verdict, score, answer: valid ? answer : null, canonical: valid ? answer : null, latencyMs: 1000, text: '' };
};
/** A fake case from a string of verdict letters: a acceptable, b blunder, o other, m missing. Answers are named by letter. */
const fake = (id: string, letters: string, type: BenchType = 'attack', confidence: 'high' | 'low' = 'high'): CaseResult => {
  const v = { a: 'acceptable', b: 'unacceptable', o: 'other', m: 'missing' } as const;
  const samples = [...letters].map((l) => sample(v[l as keyof typeof v], l));
  return { id, type, confidence, samples, stats: caseStats(samples) };
};
const fakeReport = (label: string, cases: CaseResult[]): BenchReport => ({
  bench: 2, label, startedAt: '2026-01-01T00:00:00.000Z', source: 'fake', model: null, repeat: Math.max(...cases.map((c) => c.stats.n)), cases, summary: summarize(cases),
});

describe('aggregation', () => {
  it('counts verdicts, agreement and distinct answers per case', () => {
    const k = fake('c', 'aaob').stats;
    expect(k).toMatchObject({ n: 4, valid: 4, acceptable: 2, other: 1, unacceptable: 1, unparsed: 0, agreement: 0.5 });
    expect(k.meanScore).toBeCloseTo(0.25);
    expect(k.answers).toEqual([{ answer: 'a', count: 2 }, { answer: 'b', count: 1 }, { answer: 'o', count: 1 }]);
  });

  it('keeps format failures out of the quality score', () => {
    const k = fake('c', 'aam').stats;
    expect(k).toMatchObject({ valid: 2, unparsed: 1, meanScore: 1 });
    expect(k.answers.map((a) => a.answer)).toContain('(missing)');
    expect(fake('d', 'mm').stats.meanScore).toBeNull();
  });

  it('summarises per type and overall, skipping low-confidence cases', () => {
    const s = summarize([fake('a1', 'aaa'), fake('a2', 'aab', 'attack'), fake('b1', 'bbb', 'block'), fake('l', 'bbb', 'block', 'low'), fake('m1', 'amm', 'block')]);
    expect(s.lowConfidence).toBe(1);
    expect(s.total.cases).toBe(4);
    expect(s.byType.attack!.score!.mean).toBeCloseTo((1 + 1 / 3) / 2);
    expect(s.byType.block!.blunder!.mean).toBeCloseTo(0.5);
    expect(s.total.formatFailure!.mean).toBeCloseTo(2 / 12);
    expect(s.total.unstable).toBe(2); // aab and amm: agreement 2/3 = 0.667 < 0.67
  });
});

describe('intervals', () => {
  it('wilson matches known values and stays inside 0–1', () => {
    const w = wilson(8, 10)!;
    expect(w.mean).toBe(0.8);
    expect(w.lo).toBeCloseTo(0.4902, 3);
    expect(w.hi).toBeCloseTo(0.9433, 3);
    expect(wilson(0, 10)!.lo).toBe(0);
    expect(wilson(10, 10)!.hi).toBeCloseTo(1, 10);
    expect(wilson(0, 0)).toBeNull();
  });

  it('bootstrap brackets the mean, is reproducible and narrows with more data', () => {
    const xs = [1, 0, 1, 1, 0, -1, 1, 0, 1, 1];
    const a = bootstrapMean(xs)!;
    expect(a).toEqual(bootstrapMean(xs));
    expect(a.mean).toBeCloseTo(0.5);
    expect(a.lo).toBeLessThan(a.mean);
    expect(a.hi).toBeGreaterThan(a.mean);
    const wide = bootstrapMean([1, -1, 1, -1])!;
    const narrow = bootstrapMean(Array.from({ length: 100 }, (_, i) => (i % 2 ? 1 : -1)))!;
    expect(narrow.hi - narrow.lo).toBeLessThan(wide.hi - wide.lo);
    expect(bootstrapMean([0.5])).toEqual({ mean: 0.5, lo: 0.5, hi: 0.5 });
    expect(bootstrapMean([])).toBeNull();
  });

  it('sign test is exact', () => {
    expect(signTest(0, 0)).toBe(1);
    expect(signTest(5, 0)).toBeCloseTo(0.0625);
    expect(signTest(4, 1)).toBeCloseTo(0.375);
    expect(signTest(3, 3)).toBe(1);
  });
});

describe('paired comparison', () => {
  const ids = Array.from({ length: 10 }, (_, i) => `c${i}`);
  const A = fakeReport('A', ids.map((id) => fake(id, 'aob')));

  it('says no detectable difference for identical runs', () => {
    const c = compareReports(A, fakeReport('A2', ids.map((id) => fake(id, 'aob'))));
    expect(c.verdict).toBe('none');
    expect(c.flips).toEqual([]);
    expect(c.paired).toMatchObject({ n: 10, up: 0, down: 0 });
    expect(c.markdown).toContain('No detectable difference');
  });

  it('calls B better when most cases improve, and flags full flips only', () => {
    // 8 cases go from mixed (aob) to always acceptable (aaa); one is mixed both ways; one gets worse in one answer only.
    const B = fakeReport('B', ids.map((id, i) => fake(id, i < 8 ? 'aaa' : i === 8 ? 'aob' : 'oab')));
    const c = compareReports(A, B);
    expect(c.verdict).toBe('better');
    expect(c.verdictText).toMatch(/^B \(B\) is better/);
    expect(c.paired).toMatchObject({ n: 10, up: 8, down: 0, ties: 2 });
    expect(c.paired.mean!.lo).toBeGreaterThan(0);
    expect(c.paired.total!.mean).toBeCloseTo(c.paired.mean!.mean * 10);
    expect(c.paired.signP).toBeCloseTo(2 / 256);
    // aob vs aaa: B's lowest (1) is not above A's highest (1): a better mean but no flip.
    expect(c.flips).toEqual([]);
    expect(c.cases.find((x) => x.id === 'c0')!.diff).toBeCloseTo(1 - 0);
  });

  it('flags a flip only when every answer of one run beats every answer of the other', () => {
    const a = fakeReport('A', [fake('x', 'bbb'), fake('y', 'bab'), fake('z', 'aaa')]);
    const b = fakeReport('B', [fake('x', 'aaa'), fake('y', 'aab'), fake('z', 'ooo')]);
    const c = compareReports(a, b);
    expect(c.flips.map((f) => `${f.id}:${f.flip}`)).toEqual(['x:better', 'z:worse']);
  });

  it('calls B worse, and lists unstable cases from either run', () => {
    const B = fakeReport('B', ids.map((id, i) => fake(id, i < 8 ? 'bbb' : 'aob')));
    const c = compareReports(A, B);
    expect(c.verdict).toBe('worse');
    expect(c.unstable).toHaveLength(10);
    expect(c.unstable.find((u) => u.id === 'c9')!.unstable).toEqual(['A', 'B']);
    expect(c.unstable.find((u) => u.id === 'c0')!.unstable).toEqual(['A']);
  });

  it('refuses to call a difference from too few paired cases, and ignores low-confidence ones', () => {
    const a = fakeReport('A', [fake('x', 'bbb'), fake('y', 'bbb', 'attack', 'low')]);
    const b = fakeReport('B', [fake('x', 'aaa'), fake('y', 'aaa', 'attack', 'low')]);
    const c = compareReports(a, b);
    expect(c.verdict).toBe('none');
    expect(c.paired.n).toBe(1);
    expect(c.verdictText).toContain('only 1 paired case');
  });

  it('reports cases present in one run only', () => {
    const c = compareReports(fakeReport('A', [fake('x', 'aaa'), fake('only-a', 'aaa')]), fakeReport('B', [fake('x', 'aaa'), fake('only-b', 'aaa')]));
    expect(c.onlyA).toEqual(['only-a']);
    expect(c.onlyB).toEqual(['only-b']);
  });
});

describe('old single-sample result files', () => {
  const v1 = {
    bench: 1,
    label: 'old',
    startedAt: '2026-01-01T00:00:00.000Z',
    source: 'helper',
    model: null,
    cases: [
      ...Array.from({ length: 6 }, (_, i) => ({ id: `c${i}`, type: 'attack', confidence: 'high', verdict: 'acceptable', score: 1, answer: 'attack:none', canonical: 'attack:none', latencyMs: 900, text: '' })),
      { id: 'bad', type: 'block', confidence: 'high', verdict: 'missing', score: 0, answer: null, canonical: null, note: 'no ANSWER: line', latencyMs: 900, text: '' },
    ],
    summary: {},
  };

  it('loads as N=1 with a warning', () => {
    const { report, warnings } = normalizeReport(v1);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('N=1');
    expect(report).toMatchObject({ bench: 2, repeat: 1 });
    expect(report.cases[0]!.stats).toMatchObject({ n: 1, meanScore: 1, agreement: 1 });
    expect(report.cases[6]!.stats).toMatchObject({ n: 1, meanScore: null, unparsed: 1 });
    expect(report.summary.total.formatFailure!.mean).toBeCloseTo(1 / 7);
  });

  it('compares against a repeated run without flagging flips', () => {
    const old = normalizeReport(v1).report;
    const b = fakeReport('new', [...Array.from({ length: 6 }, (_, i) => fake(`c${i}`, 'bbb', 'attack')), fake('bad', 'aaa', 'block')]);
    const c = compareReports(old, b);
    expect(c.warnings.join(' ')).toContain('one answer per case');
    expect(c.flips).toEqual([]);
    expect(c.paired.n).toBe(6);
    expect(c.verdict).toBe('worse');
    expect(c.markdown).toContain('Warning');
  });

  it('round-trips a new file and rejects other JSON', () => {
    const r = fakeReport('r', [fake('x', 'aab')]);
    expect(normalizeReport(JSON.parse(JSON.stringify(r))).report.cases[0]!.stats).toEqual(r.cases[0]!.stats);
    expect(() => normalizeReport({ hello: 1 })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Retries, transport errors, latency, layouts, calibration, regret

describe('retries and transport errors', () => {
  const one = [byId('mulligan-trample7-curve')];
  const fixedNow = () => 0;

  it('retries busy and rate-limited calls with backoff, and only the answer is recorded', async () => {
    const waits: number[] = [];
    let calls = 0;
    const r = await runBench(
      one,
      async () => {
        calls++;
        if (calls === 1) throw new CoachError('busy', 'helper_busy', 429);
        if (calls === 2) throw new CoachError('rate', 'rate_limit', 429);
        return { text: 'ANSWER: keep' };
      },
      { label: 'r', source: 't', now: fixedNow, sleep: async (ms) => void waits.push(ms) },
    );
    expect(calls).toBe(3);
    expect(waits).toEqual([2000, 4000]);
    expect(r.cases[0]!.samples).toHaveLength(1);
    expect(r.cases[0]!.samples[0]).toMatchObject({ verdict: 'acceptable', attempts: 3 });
    expect(r.summary.errors).toBe(0);
    expect(reportMarkdown(r)).not.toContain('TRANSPORT ERRORS:');
  });

  it('gives network and 5xx errors two retries, then records a transport error with its kind', async () => {
    let calls = 0;
    const r = await runBench(
      one,
      async () => {
        calls++;
        throw new CoachError('broke', 'network');
      },
      { label: 'r', source: 't', now: fixedNow, sleep: async () => {} },
    );
    expect(calls).toBe(3);
    expect(r.cases[0]!.samples[0]).toMatchObject({ verdict: 'error', errorKind: 'network', attempts: 3 });
    expect(r.cases[0]!.stats).toMatchObject({ errors: 1, unparsed: 0, agreement: 1, answers: [] });
  });

  it('never retries a final error (a bad key, a refused page)', async () => {
    let calls = 0;
    await runBench(
      one,
      async () => {
        calls++;
        throw new CoachError('no', 'auth', 401);
      },
      { label: 'r', source: 't', now: fixedNow, sleep: async () => {} },
    );
    expect(calls).toBe(1);
    expect(transientKind(new CoachError('x', 'overloaded', 529))).toEqual({ kind: 'overloaded', budget: 'busy' });
    expect(transientKind({ status: 503 })).toEqual({ kind: '503', budget: 'network' });
    expect(transientKind(new CoachError('x', 'not_logged_in'))).toBeNull();
  });

  it('honours abort: a call cut short while backing off is not a sample', async () => {
    const ctrl = new AbortController();
    const r = await runBench(
      one,
      async () => {
        throw new CoachError('busy', 'helper_busy', 429);
      },
      {
        label: 'r',
        source: 't',
        now: fixedNow,
        signal: ctrl.signal,
        sleep: async () => {
          ctrl.abort();
        },
      },
    );
    expect(r.cases).toEqual([]);
  });

  it('leaves time in the helper queue out of the latency', async () => {
    let t = 0;
    const r = await runBench(
      one,
      async () => {
        t += 9000;
        return { text: 'ANSWER: keep', queuedMs: 6000 };
      },
      { label: 'r', source: 't', now: () => t },
    );
    expect(r.cases[0]!.samples[0]!.latencyMs).toBe(3000);
    expect(r.summary.byType.mulligan!.latencyMs.median).toBe(3000);
    expect(reportMarkdown(r)).toMatch(/\| mulligan \| 1 \|.*\| 3\.0 s \| 3\.0 s \|/);
  });

  it('tells each call which case it is for (a model per type)', async () => {
    const types: string[] = [];
    await runBench(pick2(), async (_p, _s, ctx) => {
      types.push(ctx!.type);
      return { text: 'ANSWER: keep' };
    }, { label: 'r', source: 't', now: fixedNow });
    expect(types.sort()).toEqual(['block', 'mulligan']);
    expect(parseModelByType('mulligan=claude-haiku-4-5, play_draw=claude-haiku-4-5', ['claude-haiku-4-5'])).toEqual({ mulligan: 'claude-haiku-4-5', play_draw: 'claude-haiku-4-5' });
    expect(() => parseModelByType('mulligan=gpt', ['claude-haiku-4-5'])).toThrow(/not one of/);
    expect(() => parseModelByType('opening=claude-haiku-4-5', ['claude-haiku-4-5'])).toThrow(/not a decision type/);
  });

  it('an old file whose busy errors were format failures now reads them as transport errors', () => {
    const r = fakeReport('old', [{ ...fake('x', 'aa'), samples: [...fake('x', 'aa').samples, { ...sample('acceptable'), verdict: 'error', score: 0, answer: null, canonical: null, text: 'busy' }] }]);
    const n = normalizeReport(JSON.parse(JSON.stringify(r))).report;
    expect(n.cases[0]!.stats).toMatchObject({ n: 3, errors: 1, unparsed: 0, agreement: 1 });
    expect(n.summary.errors).toBe(1);
  });
});

function pick2(): BuiltCase[] {
  return [byId('mulligan-trample7-curve'), byId('block-comfort13-trade-fliers')];
}

describe('the answer-first layout', () => {
  const c = byId('block-comfort13-trade-fliers').case;

  it('asks for the ANSWER line first and uses the answer-first system prompt', () => {
    const b = buildCase(c, readFullLog(c.log), cards, { format: 'answer-first' });
    expect(b.prompt.system).toBe(coachSystem('answer-first'));
    expect(b.prompt.user).toMatch(/# Bench answer[\s\S]*FIRST line[\s\S]*ANSWER:/);
    expect(b.format).toBe('answer-first');
  });

  it('the scorer reads either layout', () => {
    const b = buildCase(c, readFullLog(c.log), cards, { format: 'answer-first' });
    expect(scoreReply(b, 'ANSWER: block:23>64\n**Answer:** block the Ant with the Drake\n**Play:** …')).toMatchObject({ verdict: 'acceptable' });
    expect(scoreReply(b, '**Answer:** block the Ant\nANSWER: block:23>64\n**Play:** …')).toMatchObject({ verdict: 'acceptable' });
    expect(extractAnswer('ANSWER: keep\nlater: ANSWER: mulligan', 'first')).toBe('keep');
    expect(extractAnswer('**Answer:** keep it\nANSWER: mulligan', 'first')).toBe('mulligan');
    // The classic layout still reads the last line.
    expect(scoreReply(byId(c.id), '**Play:** …\nANSWER: block:23>64')).toMatchObject({ verdict: 'acceptable' });
  });

  it('records the stated confidence and rule of each reply', async () => {
    const r = await runBench([byId(c.id)], async () => ({ text: '**Play:** …\n**Rule:** trade on your terms\n**Confidence:** medium — close\nANSWER: block:23>64' }), { label: 'r', source: 't', now: () => 0 });
    expect(r.cases[0]!.samples[0]!.stated).toEqual({ confidence: 'medium', rule: 'trade on your terms' });
  });
});

function readFullLog(path: string) {
  return readLogFile(`${ROOT}/${path}`);
}

describe('prompt size by section', () => {
  it('splits each prompt into its sections and ranks them by share', () => {
    const rows = promptSections(built.map((b) => b.prompt));
    const names = rows.map((r) => r.name);
    for (const n of ['System prompt', 'Decision', 'You (state)', 'Opponent (state)', 'Card text', 'Question', 'Bench answer']) expect(names).toContain(n);
    expect(rows.reduce((a, r) => a + r.share, 0)).toBeCloseTo(1, 5);
    for (let i = 1; i < rows.length; i++) expect(rows[i]!.share).toBeLessThanOrEqual(rows[i - 1]!.share);
  });
});

describe('calibration', () => {
  /** A case whose answers state `conf` and score per `letters`. */
  const stated = (id: string, letters: string, conf: 'high' | 'medium' | 'low' | null): CaseResult => {
    const c = fake(id, letters);
    const samples = c.samples.map((s) => (conf ? { ...s, stated: { confidence: conf } } : s));
    return { ...c, samples, stats: caseStats(samples) };
  };

  it('says plainly when the data is too thin', () => {
    const cal = calibration([stated('a', 'aaa', 'high'), stated('b', 'bbb', 'low')]);
    expect(cal.thin).toBe(true);
    expect(cal.text).toMatch(/Too little data/);
    expect(cal.rows.map((r) => [r.level, r.samples, r.cases])).toEqual([
      ['high', 3, 1],
      ['low', 3, 1],
    ]);
    expect(calibration([fake('x', 'aaa')]).text).toMatch(/No answer stated a confidence/);
  });

  it('finds that confidence tracks the score when it does, and says so when it runs backwards', () => {
    const cases = [
      ...Array.from({ length: 6 }, (_, i) => stated(`h${i}`, i < 5 ? 'aaa' : 'aao', 'high')),
      ...Array.from({ length: 6 }, (_, i) => stated(`l${i}`, i < 4 ? 'bbo' : 'oob', 'low')),
    ];
    const cal = calibration(cases);
    expect(cal.thin).toBe(false);
    expect(cal.gap!.from).toBe('high');
    expect(cal.gap!.to).toBe('low');
    expect(cal.gap!.diff.lo).toBeGreaterThan(0);
    expect(cal.text).toMatch(/tracks the score/);
    const flipped = cases.map((c) => ({ ...c, samples: c.samples.map((s) => ({ ...s, stated: { confidence: s.stated!.confidence === 'high' ? 'low' : 'high' } as const })) }));
    expect(calibration(flipped).text).toMatch(/backwards/);
    expect(reportMarkdown(fakeReport('r', cases))).toMatch(/## Calibration: stated confidence vs score[\s\S]*\| high \| 18 \| 6 \|/);
  });

  it('runs on regret instead of the score when samples carry it', () => {
    const withRegret = (id: string, conf: 'high' | 'low', v: number): CaseResult => {
      const c = fake(id, 'aaa');
      const samples = c.samples.map((s) => ({ ...s, stated: { confidence: conf }, regret: { value: v, lo: v - 0.01, hi: v + 0.01 } }));
      return { ...c, samples, stats: caseStats(samples) };
    };
    const cases = [...Array.from({ length: 5 }, (_, i) => withRegret(`h${i}`, 'high', 0.01 * i)), ...Array.from({ length: 5 }, (_, i) => withRegret(`l${i}`, 'low', 0.2 + 0.01 * i))];
    const cal = calibration(cases, 'regret');
    expect(cal.metric).toBe('regret');
    expect(cal.gap!.diff.hi).toBeLessThan(0);
    expect(cal.text).toMatch(/tracks regret/);
    expect(reportMarkdown(fakeReport('r', cases))).toMatch(/Calibration: stated confidence vs regret/);
  });
});

describe('regret as the headline (synthetic: the engine grader is not built yet)', () => {
  const ids = Array.from({ length: 8 }, (_, i) => `c${i}`);
  const graded = (label: string, regret: (i: number) => number, letters = 'aob') =>
    fakeReport(
      label,
      ids.map((id, i) => {
        const c = fake(id, letters);
        const v = regret(i);
        const samples = c.samples.map((s) => ({ ...s, regret: { value: v, lo: Math.max(0, v - 0.02), hi: v + 0.02 } }));
        return { ...c, samples, stats: caseStats(samples) };
      }),
    );

  it('makes mean regret the headline once both runs carry it, with the pass rate secondary', () => {
    // Same pass rate; B's suggestions lose less win rate.
    const c = compareReports(graded('A', (i) => 0.1 + 0.01 * i), graded('B', (i) => 0.02 + 0.005 * i));
    expect(c.headline).toBe('regret');
    expect(c.verdict).toBe('better');
    expect(c.pairedRegret!.mean!.hi).toBeLessThan(0);
    expect(c.paired.n).toBe(8);
    expect(c.markdown).toMatch(/\*\*Verdict \(mean regret, lower is better\): B \(B\) is better/);
    expect(c.markdown).toMatch(/Secondary: the pass rate/);
    expect(c.markdown.indexOf('Mean regret A')).toBeLessThan(c.markdown.indexOf('Quality score A'));
  });

  it('calls B worse when its regret is higher, whatever the pass rate says', () => {
    const c = compareReports(graded('A', () => 0.02, 'bbb'), graded('B', (i) => 0.2 + 0.01 * i, 'aaa'));
    expect(c.headline).toBe('regret');
    expect(c.verdict).toBe('worse');
    expect(c.paired.mean!.lo).toBeGreaterThan(0); // the pass rate alone would have said better
  });

  it('keeps the score headline while samples carry no regret', () => {
    const c = compareReports(fakeReport('A', ids.map((id) => fake(id, 'aob'))), fakeReport('B', ids.map((id) => fake(id, 'aaa'))));
    expect(c.headline).toBe('score');
    expect(c.pairedRegret).toBeNull();
    expect(c.markdown).not.toMatch(/mean regret/);
    expect(summarize([fake('x', 'aaa')]).total.regret).toBeNull();
  });
});

describe('a comparison with transport errors', () => {
  it('warns loudly that it is not trustworthy', () => {
    const ids = Array.from({ length: 6 }, (_, i) => `c${i}`);
    const withErrors = fakeReport(
      'busy',
      ids.map((id) => {
        const c = fake(id, 'aa');
        const samples = [...c.samples, { ...sample('acceptable'), verdict: 'error' as const, score: 0, answer: null, canonical: null, text: 'busy', errorKind: 'helper_busy' }];
        return { ...c, samples, stats: caseStats(samples) };
      }),
    );
    const c = compareReports(fakeReport('A', ids.map((id) => fake(id, 'aaa'))), withErrors);
    expect(c.untrustworthy).toBe(true);
    expect(c.markdown).toMatch(/WARNING — TRANSPORT ERRORS: 6 of 18 calls in B \(busy\).*helper_busy ×6/);
    expect(c.markdown).toMatch(/This comparison is not trustworthy/);
    expect(c.verdictText).toMatch(/Not trustworthy/);
    expect(c.unstable).toEqual([]); // busy errors no longer fake an unstable case
  });
});

describe('--thinking (mtg-table D346)', () => {
  const ok = (thinking?: ('off' | 'low' | 'default')[]) => ({ state: 'ok' as const, baseUrl: 'http://127.0.0.1:8643', claude: '2', models: [], checkedAt: 0, ...(thinking ? { thinking } : {}) });
  it('sends the value only when the helper offers it', () => {
    expect(benchThinking(undefined, 'helper', ok(['off', 'low', 'default']))).toEqual({});
    expect(benchThinking('off', 'helper', ok(['off', 'low', 'default']))).toEqual({ send: 'off' });
    expect(benchThinking('low', 'helper', ok(['off', 'low', 'default']))).toEqual({ send: 'low' });
    expect(benchThinking('default', 'helper', ok(['off', 'low', 'default']))).toEqual({ send: 'default' });
    const old = benchThinking('off', 'helper', ok());
    expect(old.send).toBeUndefined();
    expect(old.note).toMatch(/does not offer "thinking"/);
  });
  it('refuses a bad value and the API source', () => {
    expect(benchThinking('none', 'helper', ok(['off']))).toMatchObject({ error: expect.stringMatching(/off, low or default/) });
    expect(benchThinking('off', 'api', null)).toMatchObject({ error: expect.stringMatching(/helper only/) });
  });
  it('is recorded in the report, its header and a comparison warning', () => {
    const a = fakeReport('A', [fake('x', 'aaa')]);
    const b: BenchReport = { ...fakeReport('B', [fake('x', 'aaa')]), thinking: 'off' };
    expect(reportMarkdown(b)).toContain('· thinking: off');
    expect(reportMarkdown(a)).not.toContain('thinking:');
    expect(normalizeReport(JSON.parse(JSON.stringify(b))).report.thinking).toBe('off');
    expect(compareReports(a, b).markdown).toMatch(/cap the coach's thinking differently \(A default, B off\)/);
    expect(compareReports(a, { ...a, label: 'A2' }).markdown).not.toMatch(/thinking differently/);
  });
});
