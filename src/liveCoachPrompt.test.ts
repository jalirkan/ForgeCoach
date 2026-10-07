// SPDX-License-Identifier: GPL-3.0-or-later
// The live coach's prompt (prompt.ts 'short', Settings → Coach style, the default while
// playing) and auto-coach's plan question, over every recorded game, with real card text.
import { readFileSync, readdirSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { parseLog, type GameLog } from './log.ts';
import { extractDecisions } from './decisions.ts';
import type { CardInfo } from './cards.ts';
import { buildCoachPrompt, coachCardNames, coachSystem, planCardNames, PLAN_SYSTEM, PROMPT_FORMATS, type PromptFormat } from './prompt.ts';
import { liveDecision } from './ui/play/liveDecision.ts';
import { planDue } from './ui/play/autoPlan.ts';
import type { GameStateBody } from './protocol.ts';

const root = new URL('../', import.meta.url);
const cardsJson = JSON.parse(readFileSync(new URL('bench/coach/cards.json', root), 'utf8')) as Record<string, CardInfo>;
const ALL = new Map(Object.entries(cardsJson));
const files = [
  ...readdirSync(new URL('public/samples/', root)).filter((f) => f.endsWith('.jsonl.gz')).map((f) => new URL(`public/samples/${f}`, root)),
  ...readdirSync(new URL('bench/coach/logs/', root)).map((f) => new URL(`bench/coach/logs/${f}`, root)),
];
const logs: GameLog[] = files.map((u) => parseLog(gunzipSync(readFileSync(u)).toString('utf8')));
const bytes = (s: string) => new TextEncoder().encode(s).length;

/** The cards the prompt would be sent (the coach's names, from the bench snapshot). */
function cardsFor(log: GameLog, d: Parameters<typeof coachCardNames>[1]): Map<string, CardInfo> {
  const m = new Map<string, CardInfo>();
  for (const n of coachCardNames(log, d)) if (ALL.has(n)) m.set(n, ALL.get(n)!);
  return m;
}

/** Every auto-coach-like moment late in a game (turn 15 on): main phases, attacks, blocks. */
function lateMoments() {
  const out: Array<{ log: GameLog; d: ReturnType<typeof extractDecisions>[number] }> = [];
  for (const log of logs) for (const d of extractDecisions(log, { cards: ALL })) if (d.state.turn >= 15 && ['main', 'attack', 'block'].includes(d.kind)) out.push({ log, d });
  return out;
}

/** The live prompt's cap: system + user, UTF-8. The detailed layout ran to 10.6 KB here by turn 22. */
const LIVE_PROMPT_CAP = 8 * 1024;

describe('the live prompt stays small all game', () => {
  const late = lateMoments();
  const size = (format: PromptFormat) =>
    late.map(({ log, d }) => {
      const p = buildCoachPrompt(log, d, cardsFor(log, d), { format });
      return bytes(p.system) + bytes(p.user);
    });

  it('has late-game moments to measure', () => {
    expect(late.length).toBeGreaterThan(20);
  });

  it(`at turn 15 and later, every short-style prompt is under ${LIVE_PROMPT_CAP / 1024} KB`, () => {
    expect(Math.max(...size('short'))).toBeLessThanOrEqual(LIVE_PROMPT_CAP);
  });

  it('(the detailed layout, which live play used before, does not fit)', () => {
    expect(Math.max(...size('classic'))).toBeGreaterThan(LIVE_PROMPT_CAP);
  });

  it('the short system prompt is under half the classic one', () => {
    expect(bytes(coachSystem('short'))).toBeLessThan(bytes(coachSystem('classic')) / 2);
  });

  it('auto-coach plans fit the same cap', () => {
    let n = 0;
    for (const log of logs) {
      const asked = new Set<number>();
      for (let i = 0; i < log.frames.length; i++) {
        const f = log.frames[i]!;
        if (f.type !== 'state') continue;
        const s = f.body as GameStateBody;
        const due = planDue(s, log.seat, asked);
        if (due === null) continue;
        asked.add(due);
        const sub = { ...log, frames: log.frames.slice(0, i + 1) };
        const d = liveDecision({ log: sub, state: s, input: null, ask: null, seat: log.seat });
        if (!d) continue;
        const p = buildCoachPrompt(sub, d, cardsFor(sub, d), { format: 'short', plan: { forTurn: due } });
        expect(bytes(p.system) + bytes(p.user)).toBeLessThanOrEqual(LIVE_PROMPT_CAP);
        n++;
      }
    }
    expect(n).toBeGreaterThan(50);
  });
});

describe('the short style and the plan question', () => {
  const log = logs[0]!;
  const d = extractDecisions(log, { cards: ALL }).find((x) => x.kind === 'main' && x.state.turn >= 5)!;

  it('is a prompt format the bench can run too', () => {
    expect(PROMPT_FORMATS).toContain('short');
  });

  it('asks for command lines and one short why, the rest after a "---"', () => {
    const sys = coachSystem('short');
    for (const s of ['`Play: <action>`', '`Mana: <sources>`', '`Block: <your creature> → <their attacker>`', '`Hold:', '`Why: <one short phrase, under 12 words>`', 'a line with only `---`', '**Rule:**', '**Confidence:**', '**Details:**'])
      expect(sys).toContain(s);
    expect(sys).toMatch(/No preamble, no restating the board, no hedging/);
    // The hidden-information rule stays.
    expect(sys).toMatch(/never name or assume a hidden card/);
  });

  it('keeps the full state table for the position', () => {
    for (const { log: l, d: x } of lateMoments()) {
      const table = (f: PromptFormat) => buildCoachPrompt(l, x, cardsFor(l, x), { format: f }).user.split('# Card text')[0];
      expect(table('short')).toBe(table('classic'));
    }
  });

  it("leaves out the text of a card only in my graveyard unless it works from there (its name stays)", () => {
    let dropped = 0;
    for (const { log: l, d: x } of lateMoments()) {
      const short = buildCoachPrompt(l, x, cardsFor(l, x), { format: 'short' }).user;
      for (const c of x.state.players.find((p) => p.id === l.seat)!.zones.graveyard.cards) {
        const n = (c as { name?: string }).name;
        if (!n || !ALL.has(n) || !short.includes(`Graveyard: `)) continue;
        expect(short).toContain(n);
        if (!short.includes(`${n} {`) && !short.includes(`${n} —`)) dropped++;
      }
    }
    expect(dropped).toBeGreaterThan(0);
  });

  it("the plan at the opponent's end step asks for my next turn, untap and an unknown draw included", () => {
    const s = { ...d.state, activePlayer: 1 - log.seat!, phase: 'END_OF_TURN', turn: 7 } as GameStateBody;
    const u = buildCoachPrompt(log, { ...d, state: s }, cardsFor(log, d), { format: 'short', plan: { forTurn: 8 } }).user;
    expect(u).toMatch(/Decision type: plan my turn 8/);
    expect(u).toMatch(/my turn 8 is next\. My side above is shown as on my turn: untapped, nothing summoning sick\. Plan my turn/);
    expect(u).toMatch(/Mana sources on my turn \(everything untaps\): /);
    expect(u).toMatch(/"If you draw <a land \/ a creature …>:" line only when that card would change the plan/);
  });

  it('a plan asked in my own turn plans the rest of it', () => {
    const s = { ...d.state, activePlayer: log.seat!, phase: 'UPKEEP', turn: 9 } as GameStateBody;
    const u = buildCoachPrompt(log, { ...d, state: s }, cardsFor(log, d), { format: 'short', plan: { forTurn: 9 } }).user;
    expect(u).toMatch(/It is my turn 9 \(.*\)\. Plan the rest of my turn/);
  });

  it('the classic and answer-first layouts are unchanged (bench, film room, review, practice)', () => {
    expect(coachSystem('classic')).toMatch(/\*\*Play:\*\* one recommended line as numbered steps/);
    expect(coachSystem('answer-first')).toMatch(/\*\*Answer:\*\* the recommended play in one line/);
    expect(coachSystem('classic')).not.toMatch(/---/);
  });
});

/** Every auto-coach plan of every recorded game: [log, decision, forTurn]. */
function allPlans() {
  const out: Array<{ log: GameLog; d: NonNullable<ReturnType<typeof liveDecision>>; forTurn: number }> = [];
  for (const log of logs) {
    const asked = new Set<number>();
    for (let i = 0; i < log.frames.length; i++) {
      const f = log.frames[i]!;
      if (f.type !== 'state') continue;
      const due = planDue(f.body as GameStateBody, log.seat, asked);
      if (due === null) continue;
      asked.add(due);
      const sub = { ...log, frames: log.frames.slice(0, i + 1) };
      const d = liveDecision({ log: sub, state: f.body as GameStateBody, input: null, ask: null, seat: log.seat });
      if (d) out.push({ log: sub, d, forTurn: due });
    }
  }
  return out;
}

describe("the live plan's tighter prompt (short style + plan)", () => {
  const plans = allPlans();
  const short = (x: (typeof plans)[number]) => buildCoachPrompt(x.log, x.d, cardsFor(x.log, x.d), { format: 'short', plan: { forTurn: x.forTurn } });
  const yours = (u: string) => u.slice(u.indexOf('## YOU'), u.indexOf('## OPPONENT'));
  const theirs = (u: string) => u.slice(u.indexOf('## OPPONENT'), u.indexOf('# Card text'));

  it('uses the plan system prompt, shorter than the short style’s', () => {
    for (const x of plans.slice(0, 5)) expect(short(x).system.startsWith(PLAN_SYSTEM)).toBe(true);
    expect(bytes(PLAN_SYSTEM)).toBeLessThan(bytes(coachSystem('short')));
    for (const s of ['Play: <one action>', 'Mana: <sources>', 'Attack: <creatures>', 'Hold:', 'If you draw', 'Why: <one phrase, under 12 words>', 'a line with only ---', '**Rule:**', '**Confidence:**', '**Details:**'])
      expect(PLAN_SYSTEM).toContain(s);
    expect(PLAN_SYSTEM).toMatch(/never name or assume a hidden card/);
  });

  it('late-game plans (turn 9 on) are at least 10% smaller than the short style’s full table', () => {
    let tight = 0;
    let full = 0;
    for (const x of plans.filter((p) => p.forTurn >= 9)) {
      const p = short(x);
      const q = buildCoachPrompt(x.log, x.d, cardsFor(x.log, x.d), { format: 'short' });
      tight += bytes(p.system) + bytes(p.user);
      full += bytes(q.system) + bytes(q.user);
      expect(bytes(p.system) + bytes(p.user)).toBeLessThanOrEqual(7 * 1024);
    }
    expect(tight / full).toBeLessThan(0.9);
  });

  it("at the opponent's end step my side is shown as on my turn; theirs keeps TAPPED", () => {
    let theirTapped = 0;
    for (const x of plans.filter((p) => p.d.state.activePlayer !== p.log.seat)) {
      const u = short(x).user;
      expect(yours(u)).not.toMatch(/TAPPED|SUMMONING SICK|ATTACKING|BLOCKING|damage \d|Mana pool|Untapped mana sources/);
      expect(yours(u)).toMatch(/Mana sources on my turn \(everything untaps\): \d+/);
      // What is open now stays said, for an instant before my turn.
      expect(yours(u)).toMatch(/Untapped now, before my turn: (none|\d+ — )/);
      expect(theirs(u)).not.toMatch(/SUMMONING SICK|Spells cast this turn|left the battlefield this turn/);
      if (/TAPPED/.test(theirs(u))) theirTapped++;
    }
    expect(theirTapped).toBeGreaterThan(10);
  });

  it('counts every land I control as mana on my turn', () => {
    for (const x of plans.filter((p) => p.d.state.activePlayer !== p.log.seat && p.forTurn >= 9)) {
      const u = short(x).user;
      const lands = Number(/Lands \((\d+)\)/.exec(yours(u))![1]);
      const mana = Number(/Mana sources on my turn \(everything untaps\): (\d+)/.exec(u)![1]);
      expect(mana).toBeGreaterThanOrEqual(lands - 2); // a land that makes no mana, or a colour the log did not record
    }
  });

  it('card text: the cards that matter, without reminder text; a cut card keeps its name in the table', () => {
    let cut = 0;
    for (const x of plans.filter((p) => p.forTurn >= 9)) {
      const cards = cardsFor(x.log, x.d);
      const keep = new Set(planCardNames(x.log, x.d, cards));
      const u = short(x).user;
      const text = u.slice(u.indexOf('# Card text'), u.indexOf('# Question'));
      expect(text).not.toMatch(/\(Draw a card, then discard|\(This creature can|reminder/);
      const elsewhere = new Set(coachCardNames(x.log, x.d, { graveyard: false }));
      for (const n of coachCardNames(x.log, x.d)) {
        // Only in my graveyard and doing nothing from there: a plan has its count, not its name.
        if (keep.has(n) || !elsewhere.has(n)) continue;
        cut++;
        expect(u.slice(0, u.indexOf('# Card text'))).toContain(n);
      }
      // A card in my hand that next turn's mana can cast keeps its text.
      const me = x.d.state.players.find((p) => p.id === x.log.seat)!;
      for (const c of me.zones.hand.cards) {
        const n = (c as { name?: string }).name;
        const cost = (c as { manaCost?: string }).manaCost ?? '';
        if (n && cards.has(n) && /^\{[0-9]\}|^\{[WUBRG]\}$/.test(cost) && cost.length <= 6) expect(keep.has(n)).toBe(true);
      }
    }
    expect(cut).toBeGreaterThan(20);
  });

  it('a plan asked in my own turn keeps the state as it is (untapped sources, my land drop)', () => {
    const mine = plans.filter((p) => p.d.state.activePlayer === p.log.seat);
    expect(mine.length).toBeGreaterThan(3);
    for (const x of mine) {
      const u = short(x).user;
      expect(yours(u)).toMatch(/Untapped mana sources: /);
      expect(yours(u)).toMatch(/Land drop this turn: /);
    }
  });

  it('other questions in the short style, and the plan in the detailed style, are unchanged', () => {
    const x = plans.find((p) => p.forTurn >= 9)!;
    const detailed = buildCoachPrompt(x.log, x.d, cardsFor(x.log, x.d), { format: 'classic', plan: { forTurn: x.forTurn } });
    expect(detailed.user).toMatch(/Untapped mana sources: /);
    expect(detailed.user).toMatch(/Graveyard: /);
    expect(detailed.user).toMatch(/everything I control untaps/);
    expect(detailed.system.startsWith(coachSystem('classic'))).toBe(true);
  });
});
