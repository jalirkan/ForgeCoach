/*
 * ForgeCoach — livePlan/filterMana.test.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Filter mana (a mana ability whose own cost needs mana: Prophetic Prism,
 * Signets, filter lands' second line) is no mana of its own: Forge's Auto never
 * pays with it. The real state is mtg-table's s2-search-p20-s6 game 2, seq 694.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { GameStateBody } from '../protocol.ts';
import { availableMana, isFilterCost, manaLines, payProblem } from './mana.ts';
import type { Oracle } from './oracle.ts';

const oracleOf = (map: Record<string, string>): Oracle => ({
  text: (n) => map[n] ?? null,
  faceCost: () => null,
  faces: () => [],
});

const FIX = JSON.parse(readFileSync(new URL('./testdata/prism-state.json', import.meta.url), 'utf8')) as {
  oracle: Record<string, string>;
  state: GameStateBody;
};

describe('filter mana', () => {
  it('s2-search-p20-s6: six lands and Prophetic Prism are 6 mana with no white', () => {
    const oracle = oracleOf(FIX.oracle);
    expect(FIX.oracle['Prophetic Prism']).toBe('When this artifact enters, draw a card.\n{1}, {T}: Add one mana of any color.');
    const avail = availableMana(FIX.state, 0, oracle);
    expect(avail.total).toBe(6);
    expect(avail.sources.map((s) => s.name)).toEqual(['Island', 'Swamp', 'Swamp', 'Swamp', 'Island', 'Swamp']);
    expect(avail.sources.some((s) => s.colors === 'any' || s.colors.has('W'))).toBe(false);
    const vampire = FIX.state.players[0]!.zones.hand.cards.find((c) => 'name' in c && c.name === 'Welcoming Vampire');
    expect(payProblem(vampire, FIX.state, 0, oracle)).toMatch(/needs 1 white mana, and your untapped mana makes no white/);
  });

  it('a land keeps its free line; a land with only filter lines and filter artifacts add nothing', () => {
    expect(isFilterCost('{1}, {T}')).toBe(true);
    expect(isFilterCost('{W/U}, {T}')).toBe(true);
    expect(isFilterCost('{T}, Sacrifice this artifact')).toBe(false);
    const texts: Record<string, string> = {
      'Mystic Gate': '{T}: Add {C}.\n{W/U}, {T}: Add {W}{W}, {W}{U}, or {U}{U}.',
      'Sungrass Prairie': '{1}, {T}: Add {G}{W}.',
      'Dimir Signet': '{1}, {T}: Add {U}{B}.',
      'Prophetic Prism': 'When this artifact enters, draw a card.\n{1}, {T}: Add one mana of any color.',
    };
    expect(manaLines(texts['Mystic Gate']!)).toEqual({ free: '{T}: Add {C}.', filter: true });
    const base = FIX.state.players[0]!.zones.battlefield.cards.find((c) => 'name' in c && c.name === 'Island')!;
    const perm = (id: number, name: string, types: string) => ({ ...base, id, name, types, tapped: false });
    const players = FIX.state.players.map((p, i) =>
      i === 0
        ? { ...p, zones: { ...p.zones, battlefield: { count: 4, cards: [perm(901, 'Mystic Gate', 'Land - Gate'), perm(902, 'Sungrass Prairie', 'Land'), perm(903, 'Dimir Signet', 'Artifact'), perm(904, 'Prophetic Prism', 'Artifact')] } } }
        : p,
    );
    const avail = availableMana({ ...FIX.state, players } as GameStateBody, 0, oracleOf(texts));
    expect(avail.total).toBe(1);
    expect(avail.sources.map((s) => [s.name, s.colors === 'any' ? 'any' : [...s.colors]])).toEqual([['Mystic Gate', ['C']]]);
    expect(avail.known).toBe(true);
  });
});
