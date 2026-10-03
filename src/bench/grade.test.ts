// SPDX-License-Identifier: GPL-3.0-or-later
// The engine-graded bench (mtg-table's coach grader): answer → option mapping,
// regret in samples and reports, low-information tables, regrading an old run,
// answer lists from a table, and the held-out split. No engine and no model calls.
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  buildCase,
  caseStats,
  gradeRegret,
  inSplit,
  parseAnswer,
  regradeReport,
  reportMarkdown,
  runBench,
  scoreReply,
  summarize,
  validateCase,
  type BenchCase,
  type BuiltCase,
  type CaseResult,
  type Sample,
} from './coachBench.ts';
import {
  answerLists,
  caseGradeOf,
  chooseHoldout,
  gradeProblems,
  isLowInfo,
  LOW_INFO_HALF_WIDTH,
  seriousFidelity,
  type CaseGrade,
  type GradeOption,
} from './grade.ts';
import { readCards, readCases, readLogFile } from './benchFiles.ts';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const cards = readCards(ROOT);
const caseById = (id: string): BenchCase => readCases(ROOT).find((l) => l.value?.id === id)!.value!;

const opt = (token: string, winRate: number, regret: number, half = 0.04, extra: Partial<GradeOption> = {}): GradeOption => ({
  token,
  n: 200,
  winRate,
  winLo: winRate - 0.07,
  winHi: winRate + 0.07,
  regret,
  regretLo: Math.max(0, regret - half),
  regretHi: regret + half,
  ...extra,
});
const table = (options: GradeOption[], noise = 0.04): CaseGrade => ({ v: 1, yardstick: 'forge-default', playouts: 200 * options.length, noise, options });

function graded(id: string, grade: CaseGrade): BuiltCase {
  const c = { ...caseById(id), grade };
  return buildCase(c, readLogFile(`${ROOT}/${c.log}`), cards);
}

describe('answer → option', () => {
  const alpha = graded(
    'attack-trample7-alpha',
    table([opt('attack:none', 0.4, 0.3, 0.1), opt('attack:21,22', 0.62, 0.08), opt('attack:21,22,26,32,34', 0.7, 0, 0.02, { best: true })]),
  );

  it('maps an answer to the option of the same creature classes (identical 3/2s are interchangeable)', () => {
    const r = gradeRegret(alpha, parseAnswer('attack:26,32')!);
    expect(r?.option).toBe('attack:21,22');
    expect(r?.value).toBeCloseTo(0.08);
    expect(gradeRegret(alpha, parseAnswer('attack: #34, #32, #26, #22, #21')!)?.value).toBe(0);
  });

  it('gives no regret for an answer the table lacks, or a case with no table', () => {
    expect(gradeRegret(alpha, parseAnswer('attack:21')!)).toBeNull();
    const plain = buildCase(caseById('attack-trample7-alpha'), readLogFile(`${ROOT}/${caseById('attack-trample7-alpha').log}`), cards);
    expect(gradeRegret(plain, parseAnswer('attack:none')!)).toBeNull();
  });

  it('scoreReply carries the regret for a legal answer, and none for a format failure', () => {
    expect(scoreReply(alpha, 'Swing.\nANSWER: attack:none').regret?.value).toBeCloseTo(0.3);
    expect(scoreReply(alpha, 'Swing.\nANSWER: attack:none').verdict).toBe('unacceptable');
    expect(scoreReply(alpha, 'no answer line').regret).toBeUndefined();
    expect(scoreReply(alpha, 'ANSWER: attack:99').regret).toBeUndefined();
  });

  it('marks a wide interval as low-information', () => {
    expect(isLowInfo({ regretLo: 0, regretHi: 2 * LOW_INFO_HALF_WIDTH + 0.01 })).toBe(true);
    expect(isLowInfo({ regretLo: 0.1, regretHi: 0.2 })).toBe(false);
    expect(gradeRegret(alpha, parseAnswer('attack:none')!)?.lowInfo).toBe(true);
    expect(gradeRegret(alpha, parseAnswer('attack:21,22')!)?.lowInfo).toBeUndefined();
  });

  it('reads an alias (another copy of the same card) as the graded option', () => {
    const spell = graded(
      'spell-comfort13-turn3-play',
      table([opt('pass', 0.3, 0.2), opt('cast:27', 0.5, 0, 0.03, { best: true }), opt('cast:31', 0.45, 0.05), opt('cast:8', 0.4, 0.1, 0.03, { alias: 'cast:31' })]),
    );
    expect(gradeRegret(spell, parseAnswer('cast:8')!)?.value).toBeCloseTo(0.1);
  });
});

describe('a case with a table', () => {
  it('validates the table and the holdout flag', () => {
    const c = { ...caseById('attack-trample7-alpha') };
    expect(validateCase({ ...c, grade: table([opt('attack:none', 0.4, 0.3)]) }).ok).toBe(false);
    expect(validateCase({ ...c, grade: table([opt('attack:none', 0.4, 0.3), opt('attack:21', 0.7, 0)]) }).ok).toBe(true);
    expect(validateCase({ ...c, holdout: 'yes' }).ok).toBe(false);
    expect(gradeProblems({ v: 1, yardstick: 'perfect', playouts: 1, noise: 0, options: [] }).length).toBeGreaterThan(0);
  });

  it('splits dev and held-out cases', () => {
    expect(inSplit({}, 'dev')).toBe(true);
    expect(inSplit({ holdout: true }, 'dev')).toBe(false);
    expect(inSplit({ holdout: true }, 'holdout')).toBe(true);
    expect(inSplit({}, 'holdout')).toBe(false);
    expect(inSplit({ holdout: true }, 'all')).toBe(true);
  });
});

describe('regret in a run and its report', () => {
  const alpha = graded(
    'attack-trample7-alpha',
    table([opt('attack:none', 0.4, 0.3, 0.12), opt('attack:21,22,26,32,34', 0.7, 0, 0.02, { best: true })]),
  );
  const block = graded('block-number7-hellion', table([opt('block:none', 0.3, 0.2), opt('block:33>55', 0.5, 0, 0.03, { best: true })]));

  it('fills regret per answer, counts graded, ungraded and low-information answers, and reports noise', async () => {
    const replies = new Map([
      ['attack-trample7-alpha', ['ANSWER: attack:none', 'ANSWER: attack:21,22,26,32,34', 'ANSWER: attack:21']],
      ['block-number7-hellion', ['ANSWER: block:33>55', 'ANSWER: block:33>55', 'oops']],
    ]);
    const seen = new Map<string, number>();
    const r = await runBench([alpha, block], async (_p, _s, ctx) => {
      const i = seen.get(ctx!.id) ?? 0;
      seen.set(ctx!.id, i + 1);
      return { text: replies.get(ctx!.id)![i]! };
    }, { label: 't', source: 'test', repeat: 3, now: () => 0 });
    const a = r.cases.find((c) => c.id === 'attack-trample7-alpha')!;
    expect(a.graded).toBe(true);
    expect(a.stats.graded).toBe(2);
    expect(a.stats.ungraded).toBe(1);
    expect(a.stats.lowInfo).toBe(1);
    expect(a.stats.meanRegret).toBeCloseTo(0.15);
    const b = r.cases.find((c) => c.id === 'block-number7-hellion')!;
    expect(b.stats.meanRegret).toBe(0);
    expect(b.stats.unparsed).toBe(1); // the format failure has no regret and stays a format failure
    const t = r.summary.total;
    expect(t.regret?.mean).toBeCloseTo(0.075);
    expect(t.gradedCases).toBe(2);
    expect(t.lowInfoAnswers).toBe(1);
    expect(t.regretInformative?.mean).toBeCloseTo(0);
    expect(t.regretNoise).toBeGreaterThan(0);
    const md = reportMarkdown(r);
    expect(md).toMatch(/\*\*Mean regret 0\.0[78] \[/);
    expect(md).toMatch(/grading noise ±0\.\d\d per answer/);
    expect(md).toMatch(/low-information \(interval wider than ±0\.08\): 1 — mean regret without them/);
    expect(md).toMatch(/yardstick is Forge Default/);
  });

  it('regrades an older run from the cases’ current tables', () => {
    const s = (canonical: string): Sample => ({ verdict: 'other', score: 0, answer: canonical, canonical, latencyMs: 1, text: `ANSWER: ${canonical}` });
    const samples = [s('attack:none'), s('attack:21,22,26,32,34')];
    const cases: CaseResult[] = [{ id: 'attack-trample7-alpha', type: 'attack', confidence: 'high', samples, stats: caseStats(samples) }];
    const before = { bench: 2 as const, label: 'old', startedAt: '', source: 'x', model: null, repeat: 2, cases, summary: summarize(cases) };
    expect(before.summary.total.regret).toBeNull();
    const after = regradeReport(before, [alpha]);
    expect(after.graded).toBe(2);
    expect(after.report.summary.total.regret?.mean).toBeCloseTo(0.15);
    expect(after.report.cases[0]!.graded).toBe(true);
  });
});

describe('answer lists and the held-out set', () => {
  it('accepts the best and its statistical ties, rejects clear blunders', () => {
    const g = table([
      opt('pass', 0.2, 0.45, 0.05),
      opt('cast:1', 0.65, 0, 0.03, { best: true }),
      opt('cast:2', 0.62, 0.03, 0.04),
      opt('cast:3', 0.55, 0.1, 0.12),
      opt('cast:4', 0.62, 0.03, 0.04, { alias: 'cast:2' }),
    ]);
    const l = answerLists(g);
    expect(l.acceptable).toEqual(['cast:1', 'cast:2', 'cast:3']);
    expect(l.unacceptable).toEqual(['pass']);
    expect(answerLists(g, (t) => t !== 'cast:2').acceptable).toEqual(['cast:1', 'cast:3', 'cast:4']);
  });

  it('tells hidden-card guesses from fidelity losses that change the position', () => {
    expect(seriousFidelity(['face-down #5 is a guess from the hidden cards'])).toEqual([]);
    expect(seriousFidelity(['P/T of Bear #4: log 4/4, rebuilt 2/2'])).toHaveLength(1);
  });

  it('turns a grader line into a case table only when it graded something', () => {
    expect(caseGradeOf({ status: 'trivial', options: [opt('pass', 1, 0)] })).toBeNull();
    const g = caseGradeOf({ status: 'ok', playouts: 400, noise: 0.03, opponent: 'deck:d.dck', options: [opt('pass', 0.4, 0.1), opt('cast:2', 0.5, 0, 0.03, { best: true, forge: true })], config: { horizon: -1 } });
    expect(g?.yardstick).toBe('forge-default');
    expect(g?.options[1]!.forge).toBe(true);
    expect(g?.horizon).toBe(-1);
  });

  it('holds out a fixed, type-spread set, keeping cases already held out', () => {
    const cs = ['a', 'b', 'c', 'd', 'e', 'f'].map((id, i) => ({ id, type: i % 2 ? 'spell' : 'block' }));
    const h = chooseHoldout(cs, 2);
    expect(h).toEqual(chooseHoldout([...cs].reverse(), 2));
    expect(new Set(h.map((id) => cs.find((c) => c.id === id)!.type)).size).toBe(2);
    const again = chooseHoldout(cs.map((c) => ({ ...c, holdout: c.id === 'f' })), 2);
    expect(again).toContain('f');
    expect(again.length).toBe(2);
  });
});
