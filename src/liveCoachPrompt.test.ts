// SPDX-License-Identifier: GPL-3.0-or-later
// The live coach's prompt (prompt.ts 'short', Settings → Coach style, the default while
// playing) and auto-coach's plan question, over every recorded game, with real card text.
import { readFileSync, readdirSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { parseLog, type GameLog } from './log.ts';
import { extractDecisions } from './decisions.ts';
import type { CardInfo } from './cards.ts';
import { buildCoachPrompt, coachCardNames, coachSystem, PROMPT_FORMATS, type PromptFormat } from './prompt.ts';
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
    expect(u).toMatch(/my turn 8 is next\. Plan my turn/);
    expect(u).toMatch(/everything I control untaps/);
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
