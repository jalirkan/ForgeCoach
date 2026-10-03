// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { buildDecks } from '../cube/builder.ts';
import { context, loadRealMeta, samplePool } from '../cube/testdata/load.ts';
import { deckCount, deckFromBuild, initialDeck, mainNames, moveCard, setBasic, toMatchDeck } from './deck.ts';
import { colourCounts, curveOf, groupCards, kindCounts, metaFromCube, typeSummary } from './poolView.ts';

const ctx = context('synergy', loadRealMeta('synergy'));
const meta = metaFromCube(ctx, (n) => (n === 'Lightning Bolt' ? 'common' : n === 'Mayhem Devil' ? 'uncommon' : undefined));
const pool = samplePool(ctx.cube, 'BR', 45, 7);

describe('collection groups', () => {
  it('cmc: spells 0…5+ then lands, every card once, sorted by colour then mana value', () => {
    const g = groupCards(pool, meta, 'cmc');
    expect(g.at(-1)?.key).toBe('land');
    expect(g.reduce((s, x) => s + x.size, 0)).toBe(pool.length);
    for (const grp of g.filter((x) => x.key !== 'land')) for (const e of grp.entries) expect(meta(e.name).land).toBe(false);
  });
  it('stacks duplicates with a count', () => {
    const g = groupCards(['Opt', 'Opt', 'Lightning Bolt'], meta, 'none');
    expect(g[0]?.entries.find((e) => e.name === 'Opt')?.count).toBe(2);
    expect(g[0]?.size).toBe(3);
  });
  it('color, type and rarity', () => {
    expect(groupCards(['Lightning Bolt', 'Mayhem Devil'], meta, 'color').map((x) => x.key)).toEqual(['R', 'M']);
    expect(groupCards(['Lightning Bolt', 'Mayhem Devil'], meta, 'type').map((x) => x.key)).toEqual(['creature', 'instant']);
    expect(groupCards(['Lightning Bolt', 'Mayhem Devil', 'Opt'], meta, 'rarity').map((x) => x.key)).toEqual(['uncommon', 'common', 'unknown']);
    expect(groupCards(['Plains'], meta, 'rarity')[0]?.key).toBe('basic');
  });
  it('curve, colours, kinds and the type line', () => {
    const c = curveOf(['Lightning Bolt', 'Mayhem Devil', 'Blood Crypt'], meta);
    expect(c[1]).toBe(1);
    expect(c[3]).toBe(1);
    expect(colourCounts(['Mayhem Devil'], meta)).toMatchObject({ B: 1, R: 1 });
    expect(kindCounts(['Lightning Bolt', 'Mayhem Devil', 'Blood Crypt', 'Swamp'], meta)).toEqual({ creatures: 1, spells: 1, lands: 2 });
    expect(typeSummary(['Lightning Bolt', 'Mayhem Devil'], meta)).toBe('1 creature · 1 instant');
  });
});

describe('the deck after a draft', () => {
  it('starts with the whole pool main; cards and basics move', () => {
    let d = initialDeck(pool);
    expect(deckCount(d)).toBe(pool.length);
    d = moveCard(d, pool[0]!, 'side');
    expect(d.side).toEqual([pool[0]]);
    expect(deckCount(d)).toBe(pool.length - 1);
    d = setBasic(d, 'B', 3);
    expect(mainNames(d).filter((n) => n === 'Swamp')).toHaveLength(3);
    d = moveCard(d, 'Swamp', 'side');
    expect(d.basics.B).toBe(2);
    expect(d.side).toEqual([pool[0]]);
    expect(moveCard(d, 'Not In Pool', 'side')).toBe(d);
  });
  it('a suggested build is a legal 40 with the rest on the side', () => {
    const b = buildDecks(ctx, pool)[0]!;
    const d = deckFromBuild(b, pool);
    expect(deckCount(d)).toBe(40);
    expect(d.main.length + d.side.length).toBe(pool.length);
    expect(d.suggestion?.score).toBe(b.score);
    const m = toMatchDeck('Mine', d);
    expect(m.main.reduce((s, [n]) => s + n, 0)).toBe(40);
    expect(m.sideboard.reduce((s, [n]) => s + n, 0)).toBe(d.side.length);
  });
});
