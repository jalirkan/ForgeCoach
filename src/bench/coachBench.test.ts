// SPDX-License-Identifier: GPL-3.0-or-later
// The coach bench's dry run (what CI checks: every case builds the app's prompt
// and every listed answer is legal there) and the scoring machinery. No model calls.
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { COACH_SYSTEM } from '../prompt.ts';
import {
  BENCH_TYPES,
  caseProblems,
  compareReports,
  extractAnswer,
  formatAnswer,
  missingCards,
  parseAnswer,
  reportMarkdown,
  runBench,
  scoreReply,
  validateCase,
  type BuiltCase,
} from './coachBench.ts';
import { buildAll, readCards, readCases } from './benchFiles.ts';

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

describe('runs and reports', () => {
  const pick = ['block-comfort13-trade-fliers', 'mulligan-trample7-curve', 'pass-auto2026-no-target-yet'].map(byId);
  const replies: Record<string, string> = {
    'block-comfort13-trade-fliers': 'ANSWER: block:23>64',
    'mulligan-trample7-curve': 'ANSWER: mulligan',
    'pass-auto2026-no-target-yet': 'no line',
  };
  let t = 0;
  const now = () => (t += 500);

  it('asks each case once, scores it and summarises by type', async () => {
    const asked: string[] = [];
    const r = await runBench(
      pick,
      async (p) => {
        const id = pick.find((b) => b.prompt === p)!.case.id;
        asked.push(id);
        if (id === 'pass-auto2026-no-target-yet') throw new Error('helper busy');
        return { text: replies[id]!, model: 'test-model' };
      },
      { label: 'a', source: 'test', now },
    );
    expect(asked).toEqual(pick.map((b) => b.case.id));
    expect(r.summary.total).toMatchObject({ n: 3, score: 0, acceptable: 1, unacceptable: 1, invalid: 1 });
    expect(r.summary.byType.block).toMatchObject({ n: 1, score: 1 });
    expect(r.cases[2]).toMatchObject({ verdict: 'error', note: 'helper busy' });
    expect(r.model).toBe('test-model');
    expect(r.summary.latencyMs.median).toBeGreaterThan(0);
    const md = reportMarkdown(r);
    expect(md).toContain('**Score 0 / 3**');
    expect(md).toMatch(/\| block \| 1 \| 1 \|/);
  });

  it('shows which cases flipped between two runs', async () => {
    const run = (text: Record<string, string>, label: string) =>
      runBench(pick, async (p) => ({ text: text[pick.find((b) => b.prompt === p)!.case.id] ?? '' }), { label, source: 'test', now });
    const a = await run(replies, 'before');
    const b = await run({ ...replies, 'mulligan-trample7-curve': 'ANSWER: keep', 'block-comfort13-trade-fliers': 'ANSWER: block:23>42' }, 'after');
    const c = compareReports(a, b);
    expect(c.delta).toBe(0);
    expect(c.flips.map((f) => f.id).sort()).toEqual(['block-comfort13-trade-fliers', 'mulligan-trample7-curve']);
    expect(c.markdown).toContain('## Better (1)');
    expect(c.markdown).toContain('## Worse (1)');
  });
});
