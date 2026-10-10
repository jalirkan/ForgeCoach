/*
 * ForgeCoach — livePlan/filterMana.test.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Filter mana (a mana ability whose own cost needs mana) on real states:
 * Forge's Auto never pays with one, a click does (mtg-table D419's Prism and
 * Signet probes on real Forge), so a generic-cost filter counts at its net — a
 * Signet +1, Prophetic Prism 0 but a converter of one other mana into any
 * colour — and the coach's checker takes a plan that uses either.
 *   - prism-state.json: mtg-table's s2-search-p20-s6 game 2, seq 694/695 (six
 *     lands and the Prism; Welcoming Vampire {2}{W} could not be paid then).
 *   - signet-probe.json: the Signet probe's turn 6 and turn 8 (Swamp, Swamp,
 *     Azorius Signet untapped).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { GameStateBody, InputBody } from '../protocol.ts';
import { checkPlan } from './check.ts';
import { ManaBudget, availableMana, isFilterCost, manaLines, payProblem } from './mana.ts';
import type { Oracle } from './oracle.ts';
import { parsePlan } from './parse.ts';
import { planView } from './prompt.ts';

const oracleOf = (map: Record<string, string>): Oracle => ({
  text: (n) => map[n] ?? null,
  faceCost: () => null,
  faces: () => [],
});

interface At {
  state: GameStateBody;
  input: InputBody;
}
const read = <T,>(f: string): T => JSON.parse(readFileSync(new URL(`./testdata/${f}`, import.meta.url), 'utf8')) as T;
const PRISM = read<At & { oracle: Record<string, string> }>('prism-state.json');
const SIGNET = read<{ oracle: Record<string, string>; turn6: At; turn8: At }>('signet-probe.json');

const handCard = (st: GameStateBody, name: string) => st.players[0]!.zones.hand.cards.find((c) => 'name' in c && c.name === name);

function check(at: At, oracle: Oracle, ...steps: string[]) {
  const p = parsePlan(`PLAN: test.\nSTEPS:\n${steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}\nEND`);
  if (!p.ok) throw new Error(p.error);
  return checkPlan({ steps: p.steps, moment: { kind: 'turn', atAttack: false, ask: null } as never, state: at.state, me: 0, oracle, landsPlayed: 1, input: at.input, ask: null });
}

describe('filter mana', () => {
  it('s2-search-p20-s6: six lands and Prophetic Prism are 6 mana, and the Prism can make the white', () => {
    const oracle = oracleOf(PRISM.oracle);
    expect(PRISM.oracle['Prophetic Prism']).toBe('When this artifact enters, draw a card.\n{1}, {T}: Add one mana of any color.');
    const avail = availableMana(PRISM.state, 0, oracle);
    expect(avail.total).toBe(6);
    expect(avail.sources.map((s) => s.name)).toEqual(['Island', 'Swamp', 'Swamp', 'Swamp', 'Island', 'Swamp']);
    expect(avail.filters.map((f) => [f.name, f.colors, f.cost])).toEqual([['Prophetic Prism', 'any', '{1}']]);
    expect(payProblem(handCard(PRISM.state, 'Welcoming Vampire'), PRISM.state, 0, oracle)).toBeNull();
    expect(planView(PRISM.state, 0, { oracle })).toMatch(/Untapped mana: 6 \(Island, Swamp, Swamp, Swamp, Island, Swamp: U B B B U B\); Prophetic Prism \(\{1\}: turns one of it into any colour\)\./);
  });

  it("s2-search-p20-s6: the checker takes Sonnet's recorded plan (Vampire with the Prism's white, then Grim Haruspex), and not a third spell", () => {
    const oracle = oracleOf(PRISM.oracle);
    expect(check(PRISM, oracle, 'cast Welcoming Vampire', 'cast Grim Haruspex').ok).toBe(true);
    const more = check(PRISM, oracle, 'cast Welcoming Vampire', 'cast Grim Haruspex', 'cast Thraben Inspector');
    expect(more.ok).toBe(false);
    expect(more.first?.step.n).toBe(3);
    // the Prism turns ONE mana: two white spells at once are too many
    const b = new ManaBudget(PRISM.state, 0, oracle);
    expect(b.spend('{2}{W}', 'a')).toBeNull();
    expect(b.spend('{W}', 'b')).toMatch(/white/);
  });

  it('Signet probe: Azorius Signet beside two Swamps is 3 mana with one W and one U; the checker takes Lions with its white, and Pristine Talisman {3}', () => {
    const oracle = oracleOf(SIGNET.oracle);
    expect(SIGNET.oracle['Azorius Signet']).toBe('{1}, {T}: Add {W}{U}.');
    const avail = availableMana(SIGNET.turn6.state, 0, oracle);
    expect(avail.total).toBe(3);
    expect(avail.sources.map((s) => [s.name, s.colors === 'any' ? 'any' : [...s.colors].join(''), s.amount, s.filter === true])).toEqual([
      ['Swamp', 'B', 1, false],
      ['Swamp', 'B', 1, false],
      ['Azorius Signet', 'WU', 1, true],
    ]);
    expect(check(SIGNET.turn6, oracle, 'cast Savannah Lions').ok).toBe(true);
    expect(check(SIGNET.turn8, oracle, 'cast Pristine Talisman').ok).toBe(true);
    // the Signet makes one W: two Lions are one too many; the Lions and the Talisman are 4 of 3
    expect(check(SIGNET.turn6, oracle, 'cast Savannah Lions #18', 'cast Savannah Lions #13').ok).toBe(false);
    expect(check(SIGNET.turn6, oracle, 'cast Savannah Lions', 'cast Pristine Talisman').ok).toBe(false);
  });

  it('card-index texts: a land keeps its free line; net counting; a board-count or hybrid filter is nothing', () => {
    expect(isFilterCost('{1}, {T}')).toBe(true);
    expect(isFilterCost('{W/U}, {T}')).toBe(true);
    expect(isFilterCost('{T}, Sacrifice this artifact')).toBe(false);
    expect(manaLines('{T}: Add {C}.\n{W/U}, {T}: Add {W}{W}, {W}{U}, or {U}{U}.')).toEqual({ free: '{T}: Add {C}.', filter: true, generic: null });
    expect(manaLines('{2}, {T}: Add {B} for each Swamp you control.').generic?.produced).toBeNull();
    const g = manaLines('{1}, {T}: Add {U}{B}.').generic!;
    expect([g.cost, g.costMv, g.produced]).toEqual(['{1}', 1, 2]);
  });
});
