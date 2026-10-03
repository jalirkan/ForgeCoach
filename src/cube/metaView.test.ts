// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { loadRealMeta } from './testdata/load.ts';
import { parseMeta } from './meta.ts';
import {
  archetypeName,
  axisTicks,
  archetypeRows,
  cardRows,
  cubeCardIndex,
  curveBars,
  groupDeck,
  intervalDomain,
  metaSubtitle,
  pairsFor,
  pct,
  searchArchetypes,
  shrinkRate,
  signedPct,
  sortArchetypes,
  sortCards,
  stripGeometry,
} from './metaView.ts';

const synergy = loadRealMeta('synergy');

describe('archetype names', () => {
  it('names guilds with the theme', () => {
    expect(archetypeName({ id: 'WU-ETB', colors: 'WU', primaryTheme: 'ETB' })).toBe('Azorius ETB');
    expect(archetypeName({ id: 'BR-SAC', colors: 'BR', primaryTheme: 'SAC' })).toBe('Rakdos Sacrifice');
    expect(archetypeName({ id: 'UB-FLK', colors: 'UB', primaryTheme: 'FLK' })).toBe('Dimir Blink');
  });
  it('names three-colour and mono builds', () => {
    expect(archetypeName({ id: 'WUB-ART', colors: 'WUB', primaryTheme: 'ART' })).toBe('Esper Artifacts');
    expect(archetypeName({ id: 'URG-SPL', colors: 'URG', primaryTheme: 'SPL' })).toBe('Temur Spells');
    expect(archetypeName({ id: 'R-AGG', colors: 'R', primaryTheme: 'AGG' })).toBe('Mono-Red Aggro');
  });
  it('drops a "none" theme and falls back to the document or the code', () => {
    expect(archetypeName({ id: 'UG', colors: 'UG', primaryTheme: 'none' })).toBe('Simic');
    expect(archetypeName({ id: 'WB-XYZ', colors: 'WB', primaryTheme: 'XYZ' }, { XYZ: 'Party / adventurers' })).toBe('Orzhov Party');
    expect(archetypeName({ id: 'WB-QQ', colors: 'WB', primaryTheme: 'QQ' })).toBe('Orzhov QQ');
  });
});

describe('archetype rows', () => {
  const rows = archetypeRows(synergy);
  it('has shares that sum to one', () => {
    expect(rows).toHaveLength(27);
    expect(rows.reduce((s, r) => s + r.share, 0)).toBeCloseTo(1, 6);
    const wu = rows.find((r) => r.id === 'WU-ETB')!;
    expect(wu.name).toBe('Azorius ETB');
    expect(wu.decks).toBe(12);
    expect(wu.share).toBeCloseTo(12 / 80, 6);
    expect(wu.keyCards.slice(0, 3)).toEqual(['Lingering Souls', 'Bonesplitter', 'Thraben Inspector']);
    expect(wu.avgCurve.map((b) => b.mv)).toEqual(['1', '2', '3', '4', '5', '6+']);
    expect(wu.sampleDeck).toHaveLength(40);
  });
  it('shrinks a raw rate with the lab prior', () => {
    const wu = rows.find((r) => r.id === 'WU-ETB')!;
    expect(wu.winRaw).toBeCloseTo(0.6429, 4);
    expect(wu.win).toBeCloseTo(shrinkRate(0.6429, 28, 20, 0.4994), 6);
    expect(wu.shrunk).toBe(true);
    expect(wu.win!).toBeLessThan(wu.winRaw!);
  });
  it('prefers a shrunk rate in the data', () => {
    const m = parseMeta({ schema: 1, archetypes: [{ id: 'WU', colors: 'WU', decks: 1, games: 2, winRate: 1, winRateShrunk: 0.55 }] });
    expect(archetypeRows(m)[0]!.win).toBe(0.55);
  });
  it('sorts and searches', () => {
    expect(sortArchetypes(rows, 'share')[0]!.id).toBe('WU-ETB');
    const byWin = sortArchetypes(rows, 'win');
    for (let i = 1; i < byWin.length; i++) expect(byWin[i - 1]!.win!).toBeGreaterThanOrEqual(byWin[i]!.win!);
    expect(sortArchetypes(rows, 'name', false)[0]!.name.localeCompare(sortArchetypes(rows, 'name', false)[1]!.name)).toBeLessThanOrEqual(0);
    expect(searchArchetypes(rows, 'azorius').every((r) => r.colors === 'WU')).toBe(true);
    expect(searchArchetypes(rows, 'lingering souls').some((r) => r.id === 'WU-ETB')).toBe(true);
  });
  it('writes the subtitle from the sample', () => {
    expect(metaSubtitle(synergy)).toBe('AI-vs-AI cube lab · 40 drafts · 95 games · 80 decks');
  });
});

describe('interval strip', () => {
  it('maps fractions to per cent of width, clamped', () => {
    expect(stripGeometry(0.505, [0.45, 0.56])).toEqual({ dot: 50.5, lo: 45, hi: 56, mid: 50 });
    expect(stripGeometry(1.2, [-0.1, 0.9])).toEqual({ dot: 100, lo: 0, hi: 90, mid: 50 });
    expect(stripGeometry(0.4, null).lo).toBeNull();
  });
  it('zooms a chart domain to tens around the data', () => {
    expect(intervalDomain([{ win: 0.55, ci: [0.41, 0.79] }])).toEqual([0.4, 0.8]);
    expect(intervalDomain([])).toEqual([0.5, 0.5]);
    expect(axisTicks([0.3, 0.7])).toEqual([0.3, 0.4, 0.5, 0.6, 0.7]);
    expect(axisTicks([0, 1])).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1]);
  });
});

describe('cards', () => {
  const rows = cardRows(synergy);
  it('covers the cube with stats', () => {
    expect(rows).toHaveLength(180);
    const ti = rows.find((r) => r.name === 'Thraben Inspector')!;
    expect(ti).toMatchObject({ colors: 'W', mv: 1, games: 48, aiLimited: false });
    expect(ti.shrunk).toBeCloseTo(0.6469, 4);
  });
  it('shows no raw win rate for an unplayed card', () => {
    expect(rows.find((r) => r.name === "Ajani's Pridemate")!.winRate).toBeNull();
  });
  it('sorts by shrunk rate, games and pick rate', () => {
    const s = sortCards(rows, 'shrunk');
    expect(s[0]!.shrunk!).toBeGreaterThanOrEqual(s[1]!.shrunk!);
    expect(sortCards(rows, 'games')[0]!.games).toBe(Math.max(...rows.map((r) => r.games)));
    expect(sortCards(rows, 'pickRate', false)[0]!.pickRate).toBe(Math.min(...rows.map((r) => r.pickRate ?? 1)));
  });
  it('reads an AI-limited flag', () => {
    const m = parseMeta({ schema: 1, cards: { X: { games: 3, aiLimited: true }, Y: { games: 3 } } });
    expect(cardRows(m).find((r) => r.name === 'X')!.aiLimited).toBe(true);
    expect(cardRows(m).find((r) => r.name === 'Y')!.aiLimited).toBe(false);
  });
});

describe('archetype detail', () => {
  const wu = archetypeRows(synergy).find((r) => r.id === 'WU-ETB')!;
  it('groups the sample deck and collapses basics', () => {
    const groups = groupDeck(wu.sampleDeck!, cubeCardIndex(synergy));
    expect(groups.reduce((s, g) => s + g.count, 0)).toBe(40);
    const lands = groups.find((g) => g.label === 'Lands')!;
    expect(lands.entries[0]).toEqual({ name: 'Island', count: 8 });
    expect(lands.entries).toContainEqual({ name: 'Plains', count: 7 });
    expect(groups.at(-1)!.label).toBe('Lands');
    expect(groups.find((g) => g.label === 'Creatures')!.entries.some((e) => e.name === 'Thraben Inspector')).toBe(true);
  });
  it('finds pairs inside the colours, best lift first', () => {
    const pairs = pairsFor(synergy, 'WU');
    const idx = cubeCardIndex(synergy);
    expect(pairs.length).toBeGreaterThan(0);
    for (const p of pairs) {
      for (const n of [p.a, p.b]) for (const c of (idx.get(n)!.colors as string[]) ?? []) expect('WU').toContain(c);
      expect(p.gain).toBeGreaterThan(0);
    }
    for (let i = 1; i < pairs.length; i++) expect(pairs[i - 1]!.gain).toBeGreaterThanOrEqual(pairs[i]!.gain);
  });
  it('orders curve keys numerically', () => {
    expect(curveBars({ '6+': 1, '2': 3, '1': 2 }).map((b) => b.mv)).toEqual(['1', '2', '6+']);
  });
});

describe('formatting', () => {
  it('formats rates', () => {
    expect(pct(0.505)).toBe('50.5%');
    expect(pct(null)).toBe('—');
    expect(signedPct(0.062)).toBe('+6.2%');
    expect(signedPct(-0.03)).toBe('−3.0%');
  });
});
