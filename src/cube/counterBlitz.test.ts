/*
 * ForgeCoach — cube/counterBlitz.test.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Counter Blitz: Justin's Final Fantasy X Commander deck (public/cubes/counter-blitz-fic.md),
 * a deck he owns rather than a cube (cubes.ts `kind: 'deck'`). The document, the registry (never
 * drafted with a friend or on the lab's pages, no lab data), the whole-list pool the deck assistant opens,
 * the 40s built from it, and Draft vs AI on it (Booster and Winston; too small for Grid).
 */
import { describe, expect, it } from 'vitest';
import { labCards } from '../draft/cards.ts';
import { gridFits, newDraft, selfPlay, type BoosterDraft, type WinstonDraft } from '../draft/draft.ts';
import { buildDecks } from './builder.ts';
import { AI_DRAFT_CUBES, CUBES, DRAFT_CUBES, OWNED_DECKS, cubeInfo, loadShippedMeta } from './cubes.ts';
import { guideFor } from './guides/index.ts';
import { COUNTER_BLITZ_GUIDE_ID, COUNTER_BLITZ_GUIDE_TEXT, defaultGuide } from '../guide.ts';
import { mentionedCards } from './parseCube.ts';
import { deckPool } from './pools.ts';
import { labOnly } from './score.ts';
import { context, loadCube, loadCubeText, loadInfos } from './testdata/load.ts';

const text = loadCubeText('counter-blitz');
const cube = loadCube('counter-blitz');
const names = cube.cards.map((c) => c.name);
const by = new Map(cube.cards.map((c) => [c.name, c]));

/** Cards that make mana only for "your commander's color identity": nothing outside Commander. */
const COMMANDER_ONLY = ['Arcane Signet', 'Command Tower', 'Path of Ancestry'];

describe('the Counter Blitz document', () => {
  it('the precon less its basics and three Commander-only cards: 88 names, one of each, every one in the Scryfall snapshot', () => {
    expect(cube.title).toBe('Counter Blitz (Final Fantasy X)');
    expect(cube.warnings).toEqual([]);
    expect(cube.cards).toHaveLength(88);
    expect(new Set(names).size).toBe(88);
    expect(cube.sections.map((s) => `${s.name} ${s.kind} ${s.parsed}`)).toEqual([
      'White colour 20', 'Blue colour 9', 'Green colour 20', 'Colorless colorless 3', 'Multicolor gold 10', 'Lands lands 26',
    ]);
    const infos = loadInfos('counter-blitz', cube);
    expect([...infos.values()].filter((i) => i.found)).toHaveLength(88);
    for (const n of ['Forest', 'Island', 'Plains']) expect(by.has(n), n).toBe(false);
    expect(cube.themes).toEqual([]);
    expect(cube.archetypes).toEqual([]);
    expect(cube.hasPrices).toBe(false);
  });

  it('leaves out the cards that make no mana without a commander, and says so', () => {
    for (const n of COMMANDER_ONLY) {
      expect(by.has(n), n).toBe(false);
      expect(text).toContain(`- ${n}`);
    }
    // Forge of Heroes still taps for colourless: it stays.
    expect(by.get('Forge of Heroes')).toMatchObject({ land: true });
  });

  it('the commander and the three-colour cards carry no pair; two-colour cards carry theirs', () => {
    for (const n of ["Tidus, Yuna's Guardian", 'Yuna, Grand Summoner', 'Endless Detour']) {
      expect(by.get(n)?.section, n).toBe('Multicolor');
      expect(by.get(n)?.pair, n).toBeUndefined();
    }
    expect(by.get('Wakka, Devoted Guardian')).toMatchObject({ pair: 'WG', colorHint: 'WG' });
    expect(by.get('Kimahri, Valiant Guardian')).toMatchObject({ pair: 'UG', colorHint: 'UG' });
  });

  it('claims nothing about Forge it has not checked', () => {
    expect(cube.forgeMissing).toBeUndefined();
  });
});

describe('Counter Blitz in the registry', () => {
  const info = cubeInfo('counter-blitz')!;

  it('is a deck: listed, sized, drafted only against the AI (after the cubes), no lab data, no draft guide', async () => {
    expect(info).toMatchObject({ file: 'counter-blitz-fic', size: 88, kind: 'deck', labData: false });
    expect(OWNED_DECKS.map((c) => c.id)).toEqual(['counter-blitz']);
    expect(DRAFT_CUBES.some((c) => c.id === 'counter-blitz')).toBe(false);
    expect(DRAFT_CUBES).toHaveLength(CUBES.length - 1);
    expect(AI_DRAFT_CUBES.map((c) => c.id)).toEqual([...DRAFT_CUBES.map((c) => c.id), 'counter-blitz']);
    expect(guideFor('counter-blitz')).toBeNull();
    let asked = 0;
    const fetcher = async () => {
      asked++;
      return { ok: false, status: 404, text: async () => '', json: async () => null };
    };
    expect(await loadShippedMeta(info, '/', fetcher)).toBeNull();
    expect(asked).toBe(0);
  });
});

describe('building from the whole deck', () => {
  it('the pool is the whole list, once each', () => {
    const p = deckPool('counter-blitz', 'Counter Blitz', [...names, names[0]!], 5);
    expect(p).toMatchObject({ cubeId: 'counter-blitz', name: 'Counter Blitz', opp: [], format: null, updatedAt: 5 });
    expect(p.cards).toEqual(names);
  });

  it('three 40-card builds of two colours, none using a Commander-only card', () => {
    const builds = buildDecks(labOnly(context('counter-blitz')), names);
    expect(builds).toHaveLength(3);
    for (const b of builds) {
      expect(b.missing).toBe(0);
      expect(b.spells.length + b.nonbasics.length + Object.values(b.basics).reduce((s, n) => s + (n ?? 0), 0)).toBe(40);
      expect(b.colors).toHaveLength(2);
      for (const n of [...b.spells, ...b.nonbasics]) expect(COMMANDER_ONLY.includes(n), n).toBe(false);
    }
  });
});

describe('Draft vs AI on the deck', () => {
  const ctx = context('counter-blitz');
  const cards = labCards(ctx);

  it('is too small for Grid (9 grids leave a drafter short of playables); every cube fits', () => {
    expect(gridFits(88)).toBe(false);
    for (const c of DRAFT_CUBES) expect(gridFits(c.size), c.id).toBe(true);
  });

  it('Winston and a two-seat booster draft leave both drafters a 40-card deck with nothing missing', () => {
    for (const seed of [1, 2, 3]) {
      const w = selfPlay(newDraft({ cubeId: 'counter-blitz', format: 'winston', cube: names, seed, youFirst: true, now: 0 }), cards) as WinstonDraft;
      const b = selfPlay(newDraft({ cubeId: 'counter-blitz', format: 'booster', cube: names, seed, youFirst: true, seats: 2, now: 0 }), cards) as BoosterDraft;
      expect(w.done && b.done, `seed ${seed}`).toBe(true);
      expect(w.dealt).toHaveLength(88);
      expect(b.packSize).toBe(14);
      for (const pool of [w.picks.you, w.picks.ai, b.picks.you, b.picks.ai]) {
        const d = buildDecks(labOnly(ctx), pool)[0]!;
        expect(d.missing, `seed ${seed}`).toBe(0);
        expect(d.spells.length + d.nonbasics.length + Object.values(d.basics).reduce((s, n) => s + (n ?? 0), 0)).toBe(40);
      }
    }
  });
});

describe('the Counter Blitz play guide (guide.ts)', () => {
  /** Every card the guide names, as written in it. */
  const NAMED = [
    'Shelinda, Yevon Acolyte', 'Maester Seymour', "Tromell, Seymour's Butler", 'Wakka, Devoted Guardian', 'Duskshell Crawler', 'Generous Patron', 'Gyre Sage',
    'Incubation Druid', 'Summon: Ixion', 'Auron, Venerated Guardian', 'Summon: Yojimbo', 'Path to Exile', 'Destroy Evil', 'Collective Effort', 'Damning Verdict',
    'Farewell', 'Inspiring Call', 'Gatta and Luzzu', 'Sphere Grid', 'Chocobo Knights', 'Lord Jyscal Guado', 'Walking Ballista', 'Promise of Loyalty',
  ];

  it('is a built-in, and names only cards in the deck, all of them green, white or colourless', () => {
    expect(defaultGuide(COUNTER_BLITZ_GUIDE_ID)?.text).toBe(COUNTER_BLITZ_GUIDE_TEXT);
    // Tidus and Yuna are named only to say a two-colour build leaves them out.
    expect(mentionedCards(COUNTER_BLITZ_GUIDE_TEXT, names).sort()).toEqual([...NAMED, "Tidus, Yuna's Guardian", 'Yuna, Grand Summoner'].sort());
    for (const n of NAMED) expect([...(by.get(n)?.colorHint ?? '')].every((c) => 'WG'.includes(c)), n).toBe(true);
  });
});
