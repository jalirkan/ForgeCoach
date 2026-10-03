// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { buildDecks, checkBuild, dckText, deckText, evaluateBuild, mainDeck, sideboard, swapOptions, DECK_SIZE } from './builder.ts';
import { castableIn } from './facts.ts';
import { cardValue } from './score.ts';
import { context, loadMeta, loadRealMeta, samplePool, type CubeId } from './testdata/load.ts';

const CUBES: Array<[CubeId, string]> = [
  ['synergy', 'BR'],
  ['modern-era', 'UG'],
  ['vintage', 'WU'],
  ['pauper', 'WG'],
];

describe('buildDecks', () => {
  for (const [id, colors] of CUBES) {
    for (const withMeta of [false, true]) {
      it(`${id}${withMeta ? ' + lab meta' : ''}: a legal 40 in the pool's colours`, () => {
        const ctx = context(id, withMeta ? loadRealMeta(id) : null);
        const pool = samplePool(ctx.cube, colors, 45, 3);
        const builds = buildDecks(ctx, pool);
        const [best] = builds;
        expect(best).toBeDefined();
        if (!best) return;
        expect(checkBuild(best, pool, ctx)).toEqual([]);
        expect(mainDeck(best).reduce((s, [n]) => s + n, 0)).toBe(DECK_SIZE);
        expect(best.landCount).toBeGreaterThanOrEqual(16);
        expect(best.landCount).toBeLessThanOrEqual(17);
        expect(best.spells.length + best.landCount).toBe(DECK_SIZE);
        for (const s of best.spells) expect(castableIn(ctx.facts.get(s)!, best.colors + (best.splash ?? ''))).toBe(true);
        // The lab's numbers may prefer a neighbouring pair by a hair; the pool's own pair is always offered.
        if (withMeta) expect(builds.some((b) => b.colors === colors)).toBe(true);
        else expect(best.colors).toBe(colors);
        expect(best.reasons.length).toBeGreaterThan(2);
      });
    }
  }

  it('returns up to three distinct builds, best first', () => {
    const ctx = context('synergy');
    const builds = buildDecks(ctx, samplePool(ctx.cube, 'BR', 45, 3));
    expect(builds).toHaveLength(3);
    expect(new Set(builds.map((b) => b.key)).size).toBe(3);
    expect(builds[0]!.score).toBeGreaterThanOrEqual(builds[1]!.score);
    expect(builds[1]!.score).toBeGreaterThanOrEqual(builds[2]!.score);
  });

  it('is deterministic', () => {
    const a = buildDecks(context('pauper'), samplePool(context('pauper').cube, 'BR', 44, 9));
    const b = buildDecks(context('pauper'), samplePool(context('pauper').cube, 'BR', 44, 9));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('honours a fixed spell count (22–24 → 18–16 lands)', () => {
    const ctx = context('synergy');
    const pool = samplePool(ctx.cube, 'WG', 45, 5);
    for (const n of [22, 23, 24] as const) {
      const [b] = buildDecks(ctx, pool, { spells: n });
      expect(b!.spells).toHaveLength(n);
      expect(b!.landCount).toBe(DECK_SIZE - n);
      expect(checkBuild(b!, pool, ctx)).toEqual([]);
    }
  });

  it('basics follow the pips and add up', () => {
    const ctx = context('synergy');
    const pool = samplePool(ctx.cube, 'BR', 45, 3);
    const [b] = buildDecks(ctx, pool);
    const basics = Object.values(b!.basics).reduce((s, x) => s + (x ?? 0), 0);
    expect(basics + b!.nonbasics.length).toBe(b!.landCount);
    expect(b!.basics.B).toBeGreaterThanOrEqual(5);
    expect(b!.basics.R).toBeGreaterThanOrEqual(5);
    // An on-colour shock in the pool is played.
    if (pool.includes('Blood Crypt')) expect(b!.nonbasics).toContain('Blood Crypt');
  });

  it('works without Scryfall data (document colours only)', () => {
    const ctx = context('synergy', null, false);
    const pool = samplePool(ctx.cube, 'BR', 45, 3);
    const [b] = buildDecks(ctx, pool);
    expect(b!.colors).toBe('BR');
    expect(checkBuild(b!, pool, ctx)).toEqual([]);
  });

  it('a short pool gives its best partial deck and says what is missing', () => {
    const ctx = context('synergy');
    const pool = samplePool(ctx.cube, 'BR', 15, 3);
    const [b] = buildDecks(ctx, pool);
    expect(b!.missing).toBeGreaterThan(0);
    expect(b!.reasons.join(' ')).toMatch(/short of a full deck/);
  });
});

describe('the meta', () => {
  const pool = [
    // A Rakdos sacrifice pool with Skullclamp and Young Pyromancer.
    'Blood Artist', 'Zulaport Cutthroat', 'Viscera Seer', 'Carrion Feeder', 'Priest of Forgotten Gods', 'Village Rites',
    'Deadly Dispute', 'Bone Shards', 'Fatal Push', 'Go for the Throat', "Stitcher's Supplier", 'Bloodghast', 'Gravecrawler',
    'Woe Strider', 'Grim Haruspex', 'Midnight Reaper', 'Ophiomancer', 'Young Pyromancer', 'Goblin Bombardment', 'Pia Nalaar',
    'Hordeling Outburst', 'Lightning Bolt', 'Burst Lightning', 'Kari Zev, Skyship Raider', 'Legion Warboss', 'Mayhem Devil',
    'Juri, Master of the Revue', 'Skullclamp', 'Hangarback Walker', 'Walking Ballista', 'Mishra\'s Bauble', 'Blood Crypt',
    'Bloodstained Mire', 'Persist', 'Archon of Cruelty', 'Cauldron Familiar', 'Opt', 'Brainstorm', 'Swords to Plowshares',
    'Llanowar Elves', 'Thraben Inspector', 'Hallowed Fountain',
  ];

  it('moves card values toward the lab’s win rates, weighted by games', () => {
    const plain = context('synergy');
    const lab = context('synergy', loadMeta());
    expect(cardValue('Skullclamp', lab)).toBeGreaterThan(cardValue('Skullclamp', plain));
    expect(cardValue('Carrion Feeder', lab)).toBeLessThan(cardValue('Carrion Feeder', plain));
  });

  it('uses the archetype’s land count, pair lift and win rate in the build', () => {
    const lab = context('synergy', loadMeta());
    const [b] = buildDecks(lab, pool);
    expect(b!.colors).toBe('BR');
    expect(b!.metaArchetype).toBe('BR-SAC');
    expect(b!.landCount).toBe(16);
    expect(b!.landNote).toMatch(/BR-SAC decks won 60% of 50 games with 16/);
    expect(b!.parts.archetype).toBeGreaterThan(0);
    expect(b!.reasons.join('\n')).toMatch(/Blood Artist \+ Goblin Bombardment: \+8% together/);
    expect(b!.reasons.join('\n')).toMatch(/Skullclamp \+ Young Pyromancer: \+6% together/);
    const plain = buildDecks(context('synergy'), pool)[0]!;
    expect(plain.landNote).not.toMatch(/lab/);
    expect(plain.parts.archetype).toBe(0);
  });

  it('ignores a pair seen in too few games', () => {
    const lab = context('synergy', loadMeta());
    const [b] = buildDecks(lab, pool);
    expect(b!.pairs.some((p) => p.a === 'Persist' || p.b === 'Persist')).toBe(false);
  });
});

describe('editing and export', () => {
  const ctx = context('synergy');
  const pool = samplePool(ctx.cube, 'BR', 45, 3);
  const [b] = buildDecks(ctx, pool);

  it('swap options say what each swap does to the score', () => {
    const out = b!.spells[0]!;
    const opts = swapOptions(ctx, pool, b!, out);
    expect(opts.length).toBeGreaterThan(0);
    for (let i = 1; i < opts.length; i++) expect(opts[i - 1]!.delta).toBeGreaterThanOrEqual(opts[i]!.delta);
    const first = opts[0]!;
    const swapped = evaluateBuild(ctx, pool, b!.colors, b!.splash, b!.spells.map((s) => (s === out ? first.name : s)), { landCount: b!.landCount, n: b!.spells.length });
    expect(swapped.score).toBe(first.score);
    // The builder already maximised the score: no single swap improves it by much.
    expect(first.delta).toBeLessThanOrEqual(0.5);
  });

  it('exports a text list and a Forge .dck', () => {
    const txt = deckText(b!, pool);
    expect(txt.startsWith('Deck\n')).toBe(true);
    expect(txt).toMatch(/\nSideboard\n/);
    const dck = dckText(b!, pool, 'Rakdos test');
    expect(dck).toMatch(/^\[metadata\]\nName=Rakdos test\n\[Main\]\n/);
    const mainLines = dck.split('[Main]\n')[1]!.split('[Sideboard]')[0]!.trim().split('\n');
    expect(mainLines.reduce((s, l) => s + Number(l.split(' ')[0]), 0)).toBe(40);
    expect(sideboard(b!, pool).length).toBe(pool.length - b!.spells.length - b!.nonbasics.length);
  });
});

describe('thin pools', () => {
  const ctx = context('synergy');
  const by = (colour: string, n: number) => ctx.cube.cards.filter((c) => c.colorHint === colour).slice(0, n).map((c) => c.name);
  const pool = [...by('W', 8), ...by('U', 8), ...by('B', 8), "Mishra's Bauble", 'Mind Stone', 'Hallowed Fountain', 'Watery Grave', 'Godless Shrine', 'Polluted Delta'];

  it('offers 18-land and three-colour builds when no pair reaches 23 spells, flagged thin', () => {
    const all = buildDecks(ctx, pool, {}, 10);
    const thin = all.filter((b) => b.thin);
    expect(thin.length).toBeGreaterThan(0);
    const best = all[0]!;
    expect(best.thin).not.toBeNull();
    expect(checkBuild(best, pool, ctx)).toEqual([]);
    if (best.thin === 'three') {
      expect(best.colors).toHaveLength(3);
      expect([17, 18]).toContain(best.landCount);
    } else {
      expect(best.landCount).toBe(18);
      expect(best.spells).toHaveLength(22);
    }
    expect(best.reasons.join(' ')).toMatch(/Thin pool/);
    const three = all.find((b) => b.thin === 'three');
    expect(three?.colors).toBe('WUB');
  });

  it('a normal pool never gets thin builds', () => {
    const p = samplePool(ctx.cube, 'BR', 45, 3);
    expect(buildDecks(ctx, p, {}, 10).every((b) => b.thin === null && b.landCount <= 17)).toBe(true);
  });

  it('three colours need a dual or fixer for the third colour', () => {
    // No duals, and no fixer (Deadly Dispute's Treasure counts as one).
    const noDuals = pool.filter((n) => !ctx.facts.get(n)?.land && !ctx.facts.get(n)?.fixer);
    expect(buildDecks(ctx, noDuals, {}, 20).some((b) => b.thin === 'three')).toBe(false);
  });
});
