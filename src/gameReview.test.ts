// SPDX-License-Identifier: GPL-3.0-or-later
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { parseLog, type GameLog } from './log.ts';
import type { CardInfo } from './cards.ts';
import type { GameStateBody } from './protocol.ts';
import { isHidden } from './protocol.ts';
import { liveMoment } from './bench/coachBench.ts';
import {
  boardSummary,
  decisionState,
  fmtInterval,
  fmtRate,
  fmtRegret,
  isTie,
  keyDecisions,
  knowledgeLine,
  knowledgeWarning,
  parseReviewReport,
  reportMatchesLog,
  reviewExplainPrompt,
  reviewTimeline,
  ReviewReportError,
  tokenCardIds,
  tokenLabel,
  verdictLabel,
} from './gameReview.ts';

function load(name: string): GameLog {
  const bytes = readFileSync(new URL(`../public/samples/${name}.jsonl.gz`, import.meta.url));
  return parseLog(gunzipSync(bytes).toString('utf8'));
}
const auto = load('human-auto-42');
const comfort = load('human-comfort-13');
const rawFixture = JSON.parse(readFileSync(new URL('./testdata/human-auto-42.review.handmade.json', import.meta.url), 'utf8')) as Record<string, unknown>;
const fixture = () => structuredClone(rawFixture) as Record<string, unknown> & { decisions: Record<string, unknown>[] };

function decision(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    frame: 1091,
    stateFrame: 1082,
    turn: 13,
    round: 7,
    phase: 'COMBAT_DECLARE_ATTACKERS',
    type: 'attack',
    status: 'ok',
    stage: 'deep',
    measure: 'wins',
    played: 'attack:25,31',
    playedOption: 'attack:25,31',
    best: 'attack:none',
    forgeChoice: 'attack:31',
    regret: 0.12,
    regretLo: 0.03,
    regretHi: 0.21,
    verdict: 'mistake',
    clear: true,
    options: [
      { token: 'attack:none', label: 'no attack', n: 48, winRate: 0.61, winLo: 0.47, winHi: 0.73, regret: 0, regretLo: 0, regretHi: 0.04, best: true, forge: false, played: false },
      { token: 'attack:25,31', label: 'attack', n: 48, winRate: 0.49, winLo: 0.35, winHi: 0.63, regret: 0.12, regretLo: 0.03, regretHi: 0.21, best: false, forge: false, played: true },
    ],
    ...over,
  };
}
const report = (decisions: unknown[], over: Record<string, unknown> = {}) => ({ v: 1, kind: 'game-review', gameId: 'human-auto-42', seat: 0, decisions, keyMoments: [], ...over });

describe('ties and what the engine knew', () => {
  it('reads a close call with zero regret as a tie: not a key moment, worded as within noise', () => {
    const tie = decision({ verdict: 'close', regret: 0, regretLo: -0.08, regretHi: 0.08 });
    const r = parseReviewReport(report([tie, decision({ frame: 1263, stateFrame: 1254 })], { keyMoments: [1091, 1263] }));
    const d = r.decisions[0]!;
    expect(isTie(d)).toBe(true);
    expect(verdictLabel(d)).toBe('Close call — a tie');
    expect(r.keyMoments).toEqual([1263]);
    expect(r.warnings.join('\n')).toMatch(/tie with the best option/);
    expect(keyDecisions(r.decisions, [], 5).map((x) => x.frame)).toEqual([1263]);
    const p = reviewExplainPrompt(r, auto, [d]);
    expect(p.user).toContain("as well as the engine's best within noise; not an error");
  });

  it('reads knowledge.opponentModel, or works it out from knowledge.opponent', () => {
    const k = (knowledge: unknown) => parseReviewReport(report([], { knowledge })).knowledge.opponentModel;
    expect(k({ opponentModel: 'basic-lands', opponent: 'whatever' })).toBe('basic-lands');
    expect(k({ opponentModel: 'pool' })).toBe('pool');
    expect(k({ opponentModel: 'evil', opponent: 'unknown' })).toBe('basic-lands');
    expect(k({ opponent: 'pool: cube' })).toBe('pool');
    expect(k({ opponent: 'public: streamed' })).toBe('deck');
    expect(k({})).toBeNull();
  });

  it('warns, on screen and in the prompt, when the opponent was modelled as basic lands', () => {
    const r = parseReviewReport(report([decision()], { knowledge: { opponentModel: 'basic-lands', opponent: 'unknown' } }));
    expect(knowledgeWarning(r.knowledge)).toMatch(/flatters you/);
    expect(knowledgeWarning({ opponent: null, ownDeck: null, opponentModel: 'pool' })).toBeNull();
    const p = reviewExplainPrompt(r, auto, r.decisions);
    expect(p.user).toMatch(/WARNING: modelled as basic lands.*every number flatters the player/);
  });
});

describe('parseReviewReport', () => {
  it('reads the fixture report for the sample log', () => {
    const r = parseReviewReport(rawFixture);
    expect(r.gameId).toBe('human-auto-42');
    expect(r.seat).toBe(0);
    expect(r.decisions).toHaveLength(14);
    expect(r.warnings).toEqual([]);
    expect(r.keyMoments).toEqual([489, 1091, 1215, 1263, 1425]);
    expect(r.summary).toEqual({ decisions: 14, graded: 10, best: 4, closeCalls: 3, mistakes: 3, notGraded: 4, trivial: 2, deepened: 4 });
    const pym = r.decisions.find((d) => d.frame === 489)!;
    expect(pym).toMatchObject({ type: 'spell', verdict: 'mistake', clear: true, measure: 'wins', stage: 'deep', played: 'cast:6', best: 'cast:2', forgeChoice: 'cast:5' });
    expect(pym.triage).toMatchObject({ measure: 'leaf', best: 'cast:2' });
    const block = r.decisions.find((d) => d.frame === 1215)!;
    expect(block.options.find((o) => o.token === 'block:94>91')!.alias).toBe('block:95>91');
    expect(block.fidelity).toHaveLength(2);
    expect(r.createdAt?.toISOString()).toBe('2026-10-03T21:00:00.000Z');
    expect(r.knowledge.opponent).toMatch(/^pool/);
    expect(r.config.deepK).toBe(6);
  });

  it('accepts the JSON text too', () => {
    expect(parseReviewReport(JSON.stringify(rawFixture)).decisions).toHaveLength(14);
  });

  it('refuses things that are not a game review at all', () => {
    for (const bad of [null, 42, 'not json', [], {}, { kind: 'game-review', v: 2, gameId: 'g', seat: 0 }, { kind: 'other', v: 1, gameId: 'g', seat: 0 }, { kind: 'game-review', v: 1, seat: 0 }, { kind: 'game-review', v: 1, gameId: '../etc', seat: 0 }, { kind: 'game-review', v: 1, gameId: 'g' }]) {
      expect(() => parseReviewReport(bad)).toThrow(ReviewReportError);
    }
  });

  it('drops bad decisions with a warning instead of failing the report', () => {
    const r = parseReviewReport(
      report([
        decision(),
        'nonsense',
        decision({ frame: -3 }),
        decision({ frame: 1200, stateFrame: 1300 }),
        decision({ frame: 1210, type: 'mulligan' }),
        decision({ frame: 1091 }), // a duplicate frame
      ]),
    );
    expect(r.decisions.map((d) => d.frame)).toEqual([1091]);
    expect(r.warnings).toHaveLength(5);
    expect(r.warnings.join('\n')).toMatch(/second decision at frame 1091/);
  });

  it('range-checks rates and regrets, and ignores unknown fields', () => {
    const r = parseReviewReport(
      report([
        decision({
          extra: { evil: true },
          options: [
            { token: 'attack:none', winRate: 1.7, winLo: -0.2, winHi: 0.9, regret: 0, best: true, played: false, __proto__: { x: 1 } },
            { token: 'attack:25,31', winRate: 0.5, winLo: 0.6, winHi: 0.7, regret: 0.12, regretLo: 0.03, regretHi: 0.21, played: true },
            { token: 'DROP TABLE', winRate: 0.5 },
            { token: 'attack:31', winRate: '0.5', n: -4 },
          ],
        }),
      ]),
    );
    const [none, mine, other] = r.decisions[0]!.options;
    expect(none!.winRate).toBeNull();
    expect(none!.winLo).toBeNull();
    expect(none!.winHi).toBe(0.9);
    // An interval that does not hold its point is dropped.
    expect(mine!.winLo).toBeNull();
    expect(mine!.winHi).toBeNull();
    expect(other!.winRate).toBeNull();
    expect(other!.n).toBeNull();
    expect(r.decisions[0]!.options).toHaveLength(3);
    expect(r.warnings.join('\n')).toMatch(/1 unreadable option/);
    expect(Object.keys(r.decisions[0]!)).not.toContain('extra');
  });

  it('cleans and caps untrusted strings', () => {
    const r = parseReviewReport(
      report([decision({ notes: ['line\u0000one‮evil', 'x'.repeat(5000), { message: 'from object' }, 7], fidelity: 'not a list', error: '<script>alert(1)</script>' })], {
        knowledge: { opponent: 'pool:\nlots\tof\u0007junk' },
        yardstick: 'y'.repeat(500),
      }),
    );
    const d = r.decisions[0]!;
    expect(d.notes[0]).toBe('line one evil');
    expect(d.notes[1]!.length).toBeLessThanOrEqual(240);
    expect(d.notes[2]).toBe('from object');
    expect(d.notes[3]).toBe('7');
    expect(d.fidelity).toEqual([]);
    // Text stays text: React renders it, nothing turns it into markup.
    expect(d.error).toBe('<script>alert(1)</script>');
    expect(r.knowledge.opponent).toBe('pool: lots of junk');
    expect(r.yardstick.length).toBeLessThanOrEqual(60);
  });

  it('never calls a decision whose regret interval includes zero a mistake', () => {
    const r = parseReviewReport(report([decision({ regretLo: -0.02, clear: true })]));
    expect(r.decisions[0]!.verdict).toBe('close');
    expect(r.decisions[0]!.clear).toBe(false);
    expect(r.warnings.join('\n')).toMatch(/includes zero; shown as a close call/);
    const unknown = parseReviewReport(report([decision({ regretLo: undefined, regretHi: undefined })]));
    expect(unknown.decisions[0]!.verdict).toBe('close');
  });

  it('derives `clear` from the interval, not from the report', () => {
    const r = parseReviewReport(report([decision({ verdict: 'close', regretLo: 0.01, clear: false }), decision({ frame: 1263, stateFrame: 1254, verdict: 'close', regretLo: 0, clear: true })]));
    expect(r.decisions[0]!.clear).toBe(true);
    expect(r.decisions[1]!.clear).toBe(false);
  });

  it('shows a decision with nothing to compare as not graded', () => {
    const r = parseReviewReport(
      report([decision({ status: 'unsupported', verdict: 'mistake' }), decision({ frame: 1263, stateFrame: 1254, options: [] }), decision({ frame: 1300, stateFrame: 1290, playedOption: null })]),
    );
    expect(r.decisions.map((d) => d.verdict)).toEqual(['not-graded', 'not-graded', 'not-graded']);
    expect(r.summary.notGraded).toBe(3);
  });

  it('reads a missing measure as a leaf estimate, never as a win rate', () => {
    const r = parseReviewReport(report([decision({ measure: 'percent' })]));
    expect(r.decisions[0]!.measure).toBe('leaf');
    expect(r.warnings.join('\n')).toMatch(/short-horizon/);
  });

  it('keeps only key moments that have a decision, in order, once', () => {
    const r = parseReviewReport(report([decision(), decision({ frame: 1263, stateFrame: 1254 })], { keyMoments: [1263, 999, 1091, 1263, 'x'] }));
    expect(r.keyMoments).toEqual([1263, 1091]);
  });

  it('caps very long decision lists', () => {
    const many = Array.from({ length: 450 }, (_, i) => decision({ frame: 10 + i, stateFrame: 5 }));
    const r = parseReviewReport(report(many));
    expect(r.decisions).toHaveLength(400);
    expect(r.warnings[0]).toMatch(/first 400 of 450/);
  });
});

describe('reportMatchesLog', () => {
  it('matches the fixture to its sample log', () => {
    const m = reportMatchesLog(parseReviewReport(rawFixture), auto);
    expect(m.ok).toBe(true);
    expect(m.problems).toEqual([]);
    expect(m.decisions).toHaveLength(14);
  });

  it('refuses another game or another seat', () => {
    const r = parseReviewReport(rawFixture);
    const m = reportMatchesLog(r, comfort);
    expect(m.ok).toBe(false);
    expect(m.problems[0]).toMatch(/human-comfort-13/);
    expect(reportMatchesLog({ ...r, seat: 1 }, auto).ok).toBe(false);
  });

  it('leaves out decisions past the end of the log or not on a state', () => {
    const f = fixture();
    f.decisions.push({ ...f.decisions[0]!, frame: 99999, stateFrame: 99990 });
    f.decisions.push({ ...f.decisions[0]!, frame: 20, stateFrame: 19 });
    const m = reportMatchesLog(parseReviewReport(f), auto);
    expect(m.ok).toBe(true);
    expect(m.decisions).toHaveLength(14);
    expect(m.problems).toHaveLength(2);
  });

  it('uses frames as liveMoment does: the state frame is the last state before the moment', () => {
    for (const d of parseReviewReport(rawFixture).decisions) {
      expect(liveMoment(auto, d.frame).state).toBe(decisionState(auto, d));
    }
  });
});

describe('tokenLabel', () => {
  const r = parseReviewReport(rawFixture);
  const at = (frame: number) => decisionState(auto, r.decisions.find((d) => d.frame === frame)!)!;

  it('names cards from the state at the decision', () => {
    expect(tokenLabel('cast:6', at(489), 0)).toBe('Cast Pym Particles');
    expect(tokenLabel('pass', at(489), 0)).toBe('Pass (cast nothing)');
    expect(tokenLabel('attack:25,31', at(1091), 0)).toBe('Attack with Aerial Doombot and Quake, Agent of S.H.I.E.L.D.');
    expect(tokenLabel('attack:none', at(1091), 0)).toBe('No attack');
    expect(tokenLabel('block:none', at(1215), 0)).toBe('No blocks');
    expect(tokenLabel('target:44', at(518), 0)).toBe('Target Peggy Carter, Secret Agent');
  });

  it('tells apart same-named cards: whose, then which', () => {
    expect(tokenLabel('block:94>91', at(1215), 0)).toBe('Your Soldier Token #94 blocks their Soldier Token');
    expect(tokenLabel('target:65', at(1283), 0)).toBe('Target their Aerial Doombot');
    expect(tokenLabel('target:25', at(1283), 0)).toBe('Target your Aerial Doombot');
  });

  it('never names a card the viewer cannot see', () => {
    const st = at(1091);
    const opp = st.players.find((p) => p.id !== 0)!;
    const hiddenIds = opp.zones.hand.cards.filter(isHidden).map((c) => c.id);
    const id = hiddenIds[0] ?? 999999;
    expect(tokenLabel(`cast:${id}`, st, 0)).toBe(`Cast card #${id}`);
    expect(tokenLabel('cast:999999', st, 0)).toBe('Cast card #999999');
  });

  it('falls back to the engine label for tokens it does not know', () => {
    expect(tokenLabel('mulligan', null, 0, 'Take a mulligan')).toBe('Take a mulligan');
    expect(tokenLabel('mulligan', null)).toBe('mulligan');
  });

  it('lists the card ids a token names', () => {
    expect(tokenCardIds('block:94>91,95>91')).toEqual([94, 91, 95]);
    expect(tokenCardIds('attack:none')).toEqual([]);
    expect(tokenCardIds('pass')).toEqual([]);
  });
});

describe('words and numbers', () => {
  it('formats win rates and leaf scores differently', () => {
    expect(fmtRate(0.613, 'wins')).toBe('61%');
    expect(fmtRate(0.613, 'leaf')).toBe('0.61');
    expect(fmtRegret(0.12, 'wins')).toBe('12 pts');
    expect(fmtRegret(0.12, 'leaf')).toBe('0.12');
    expect(fmtInterval(0.47, 0.73, 'wins')).toBe('47–73%');
    expect(fmtInterval(-0.03, 0.21, 'wins', 'regret')).toBe('−3 to 21 pts');
    expect(fmtInterval(0.47, 0.73, 'leaf')).toBe('0.47–0.73');
    expect(fmtInterval(null, 0.73, 'leaf')).toBe('');
  });

  it('says the verdicts plainly', () => {
    expect(verdictLabel({ verdict: 'mistake', clear: true })).toBe('Mistake — clear');
    expect(verdictLabel({ verdict: 'close', clear: false })).toBe('Close call');
    expect(verdictLabel({ verdict: 'best', clear: false })).toBe('Best play');
  });

  it('describes what the engine knew about the opponent', () => {
    expect(knowledgeLine({ opponent: 'pool: x', ownDeck: null, opponentModel: 'pool' })).toMatch(/cube pool.*never the AI’s list/);
    expect(knowledgeLine({ opponent: 'unknown', ownDeck: null, opponentModel: 'basic-lands' })).toMatch(/basic lands.*never the AI’s list/);
    expect(knowledgeLine({ opponent: 'public: streamed deck list', ownDeck: null, opponentModel: 'deck' })).toMatch(/marked public/);
  });
});

describe('reviewTimeline and keyDecisions', () => {
  const r = parseReviewReport(rawFixture);

  it('groups decisions by turn in frame order and ranks the key moments', () => {
    const t = reviewTimeline(r.decisions, r.keyMoments);
    expect(t.map((x) => x.turn)).toEqual([1, 3, 5, 7, 9, 11, 13, 14, 15, 16, 18, 20]);
    const t7 = t.find((x) => x.turn === 7)!;
    expect(t7.items.map((i) => i.decision.frame)).toEqual([489, 518]);
    expect(t7.items[0]!.keyRank).toBe(1);
    expect(t7.items[1]!.keyRank).toBeNull();
    const flat = t.flatMap((x) => x.items.map((i) => i.decision.frame));
    expect(flat).toEqual([...flat].sort((a, b) => a - b));
  });

  it('picks the key moments first, then other mistakes and close calls', () => {
    expect(keyDecisions(r.decisions, r.keyMoments, 5).map((d) => d.frame)).toEqual([489, 1091, 1215, 1263, 1425]);
    expect(keyDecisions(r.decisions, r.keyMoments, 3).map((d) => d.frame)).toEqual([489, 1091, 1215]);
    // Without key moments: mistakes first, by regretHi.
    const k = keyDecisions(r.decisions, [], 6);
    expect(k.slice(0, 3).every((d) => d.verdict === 'mistake')).toBe(true);
    expect(k.slice(3).every((d) => d.verdict === 'close')).toBe(true);
  });
});

describe('reviewExplainPrompt', () => {
  const r = parseReviewReport(rawFixture);
  const keys = keyDecisions(r.decisions, r.keyMoments, 5);
  const cards = new Map<string, CardInfo>([
    ['Pym Particles', { name: 'Pym Particles', found: true, manaCost: '{1}{U}', typeLine: 'Instant', oracleText: 'Target creature gains vigilance until end of turn and can’t be blocked this turn.\nDraw a card.', power: null, toughness: null, loyalty: null } as unknown as CardInfo],
  ]);
  const p = reviewExplainPrompt(r, auto, keys, cards);

  it('is deterministic: the same input gives the same bytes', () => {
    const again = reviewExplainPrompt(parseReviewReport(structuredClone(rawFixture)), load('human-auto-42'), keyDecisions(parseReviewReport(rawFixture).decisions, r.keyMoments, 5), new Map(cards));
    expect(again.system).toBe(p.system);
    expect(again.user).toBe(p.user);
  });

  it('carries each moment with its board, options table, verdict and measure', () => {
    expect(p.user.match(/^## Moment \d/gm)).toHaveLength(5);
    expect(p.user).toContain('## Moment 1: Turn 7 · main 1 (your turn) · main phase');
    expect(p.user).toContain('The player chose: Cast Pym Particles.');
    expect(p.user).toContain('Engine best: Cast A.I.M. Scientists.');
    expect(p.user).toContain("Forge's AI would have chosen: Cast Quantum Reduction.");
    expect(p.user).toMatch(/- Cast Pym Particles: 38% \(25–51%\); regret 14 pts \(5–23 pts\); n=48 — PLAYED/);
    expect(p.user).toMatch(/- Cast A\.I\.M\. Scientists: 52% \(40–64%\).* — ENGINE BEST/);
    expect(p.user).toContain('Verdict: mistake — the interval excludes zero');
    expect(p.user).toContain('Life: you 20; Forge AI 20.');
    expect(p.user).toMatch(/Your hand: .*Quantum Reduction/);
    expect(p.user).toContain("Yardstick: the best play against Forge's Default AI playing both seats.");
    expect(p.user).toContain('# Card text\nPym Particles {1}{U} — Instant');
  });

  it('says close call where the interval includes zero, never mistake', () => {
    const attack = p.user.slice(p.user.indexOf('## Moment 2'), p.user.indexOf('## Moment 3'));
    expect(attack).toContain('Verdict: close call — the interval includes zero; do not call it a mistake.');
    expect(attack).not.toMatch(/Verdict: mistake/);
    expect(p.system).toMatch(/includes zero, call it a close call — never a mistake/);
  });

  it('labels leaf numbers as short-horizon scores, not win rates', () => {
    const block = p.user.slice(p.user.indexOf('## Moment 3'), p.user.indexOf('## Moment 4'));
    expect(block).toContain('short-horizon score (playouts to the end of this turn, scored by an evaluator; NOT a win rate)');
    expect(block).toMatch(/- Your Soldier Token #94 blocks their Soldier Token: 0\.50 \(0\.44–0\.56\)/);
    expect(block.replace(/95% interval/g, '').match(/\d+%/g)).toBeNull();
    expect(block).toContain('Engine notes: Identical Soldier Tokens are one option.');
    expect(p.system).toMatch(/never call it a win rate/);
  });

  it('shows only what the viewer saw: the opponent’s hand is a count', () => {
    for (const d of keys) {
      const st = decisionState(auto, d)!;
      const opp = st.players.find((x) => x.id !== auto.seat)!;
      for (const c of [...opp.zones.hand.cards, ...(opp.zones.library.cards ?? [])]) {
        if (!isHidden(c)) continue;
        expect(p.user).not.toContain(`#${c.id}`);
      }
    }
    expect(p.user).toMatch(/Opponent's hand: \d+ cards? \(hidden\)\./);
    expect(p.system).toMatch(/Never claim to know them/);
    expect(p.user).toContain("never the AI's real list");
  });

  it('asks for about three sentences per moment and explains, not re-solves', () => {
    expect(p.system).toMatch(/about three sentences per moment/);
    expect(p.system).toMatch(/explain the numbers, not to re-solve/);
    expect(p.user).toMatch(/# Question\nExplain these 5 moments/);
  });
});

describe('boardSummary', () => {
  it('counts lands and names the rest, with the opponent’s hand as a count', () => {
    const st = liveMoment(auto, 1091).state as GameStateBody;
    const lines = boardSummary(st, 0);
    expect(lines[0]).toBe('Life: you 20; Forge AI 20.');
    expect(lines[1]).toMatch(/^Your battlefield: \d+ lands; .*Quake, Agent of S\.H\.I\.E\.L\.D\./);
    expect(lines[4]).toMatch(/^Opponent's hand: \d+ cards? \(hidden\)\.$/);
  });
});

describe('the engine-produced sample report', () => {
  const real = JSON.parse(readFileSync(new URL('../public/samples/human-auto-42.review.json', import.meta.url), 'utf8')) as unknown;

  it('is accepted as-is, with no warnings, and matches its log', () => {
    const r = parseReviewReport(real);
    expect(r.warnings).toEqual([]);
    expect(r.decisions.length).toBe((real as { decisions: unknown[] }).decisions.length);
    const s = (real as { summary: Record<string, number> }).summary;
    for (const k of ['decisions', 'graded', 'best', 'closeCalls', 'mistakes', 'notGraded', 'trivial', 'deepened'] as const) expect(r.summary[k]).toBe(s[k]);
    const m = reportMatchesLog(r, auto);
    expect(m.ok).toBe(true);
    expect(m.problems).toEqual([]);
  });

  it('reads the pool model and its key moments, with no basic-lands warning', () => {
    const r = parseReviewReport(real);
    expect(r.knowledge.opponentModel).toBe('pool');
    expect(knowledgeWarning(r.knowledge)).toBeNull();
    expect(r.keyMoments).toEqual((real as { keyMoments: number[] }).keyMoments.filter((f) => !isTie(r.decisions.find((d) => d.frame === f)!)));
    const p = reviewExplainPrompt(r, auto, keyDecisions(r.decisions, r.keyMoments));
    expect(p.user).toContain("Opponent's hidden cards in the playouts: sampled from the cube pool, never the AI's real list.");
    expect(p.user).not.toMatch(/WARNING/);
  });
});
