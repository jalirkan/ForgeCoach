/*
 * ForgeCoach — cube/evybaby.test.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Evybaby's New Cube: Evan's own 360-card list (public/cubes/evybaby-cube-360.md),
 * with no themes, archetypes, prices or guide; its lab meta (J110, j110Metas.test.ts) has no
 * numbers for the cards Forge lacks. The document, the registry, the no-meta card values
 * (what a page without the meta falls back to), every draft format on it, and the cards
 * Forge 2.0.14 has no script for kept out of what the engine is handed.
 */
import { describe, expect, it } from 'vitest';
import { aiFlagsFromDoc } from '../draft/aiFlags.ts';
import { labCards } from '../draft/cards.ts';
import { FORGE_SIDEBOARD_MAX, forForge, matchDeck } from '../draft/deck.ts';
import { newDraft, selfPlay, type BoosterDraft, type GridDraft, type WinstonDraft } from '../draft/draft.ts';
import { guideFor } from './guides/index.ts';
import { buildDecks } from './builder.ts';
import { cubeInfo, cubeShortName, loadCubeDoc, loadShippedMeta } from './cubes.ts';
import { labOnly } from './score.ts';
import { context, loadCube, loadCubeText, loadInfos } from './testdata/load.ts';

const text = loadCubeText('evybaby');
const cube = loadCube('evybaby');
const names = cube.cards.map((c) => c.name);
const by = new Map(cube.cards.map((c) => [c.name, c]));

/** Reality Fracture (2026-10-02), after Forge 2.0.14's build. */
const NOT_IN_FORGE = [
  'Rescue Girl, First Responder', 'Flickering Hound', 'Generous Revival', 'Apex Witchstalker', 'Pompous Battlemage', 'Awaken the Inferno', 'Fblthp, Knows the Way',
  'Theorix Charm', 'Twisted Fates', 'Twinned Vision', 'Saheeli, Jewel of Avishkar', 'Primal Witchstalker', "Warrior's Blades",
];

describe('the Evybaby document', () => {
  it("Evan's 360 names, one of each, in his export's colour groups, every one in the Scryfall snapshot", () => {
    expect(cube.title).toBe("Evybaby's New Cube");
    expect(cube.warnings).toEqual([]);
    expect(cube.cards).toHaveLength(360);
    expect(new Set(names).size).toBe(360);
    expect(cube.sections.map((s) => `${s.name} ${s.kind} ${s.parsed}`)).toEqual([
      'White colour 49', 'Blue colour 49', 'Black colour 50', 'Red colour 50', 'Green colour 49', 'Colorless colorless 10', 'Multicolor gold 73', 'Lands lands 30',
    ]);
    // His order: the export's first and last spells, and names with diacritics as Scryfall spells them (NFC).
    expect(names[0]).toBe('Descendant of Storms');
    expect(names[329]).toBe('Path to the World Tree');
    for (const n of ['Lórien Revealed', 'Troll of Khazad-dûm', 'Glóin the Mighty', 'Asmoranomardicadaistinaculdacar', 'Anchovy & Banana Pizza']) {
      expect(by.has(n), n).toBe(true);
      expect(n.normalize('NFC')).toBe(n);
    }
    const infos = loadInfos('evybaby', cube);
    expect([...infos.values()].filter((i) => i.found)).toHaveLength(360);
    // Double-faced, adventure and prepare cards by their front face (Forge's key); Scryfall's full name says so.
    expect(infos.get('Bonecrusher Giant')?.scryfallName).toBe('Bonecrusher Giant // Stomp');
    expect(infos.get('Elite Interceptor')?.scryfallName).toBe('Elite Interceptor // Rejoinder');
  });

  it('adds nothing Evan did not write: no themes, archetypes or prices', () => {
    expect(cube.themes).toEqual([]);
    expect(cube.archetypes).toEqual([]);
    expect(cube.hasPrices).toBe(false);
    for (const c of cube.cards) {
      expect(c.themes, c.name).toEqual([]);
      expect(c.tags, c.name).toEqual([]);
    }
    expect(guideFor('evybaby')).toBeNull();
  });

  it('gold cards carry their colour pair; three five-colour cards none; lands in three cycles of ten', () => {
    expect(by.get('Lurrus of the Dream-Den')).toMatchObject({ section: 'Multicolor', pair: 'WB', colorHint: 'WB' });
    expect(by.get('Lingering Souls')).toMatchObject({ pair: 'WB' });
    for (const n of ["Dragonbroods' Relic", 'Everything Pizza', 'Path to the World Tree']) expect(by.get(n)?.pair, n).toBeUndefined();
    const lands = cube.cards.filter((c) => c.land);
    expect(lands).toHaveLength(30);
    for (const g of ['Shocklands', 'Surveil lands', 'Fetchlands']) expect(lands.filter((c) => c.group === g), g).toHaveLength(10);
  });

  it('names the 13 cards Forge 2.0.14 lacks, and its AI flags', () => {
    expect(cube.forgeMissing).toEqual(NOT_IN_FORGE);
    const f = aiFlagsFromDoc(text, names);
    expect([...f.all].sort()).toEqual(['Divergent Equation', 'Faithless Looting', 'Goblin Bombardment', 'Goblin Welder', "Mishra's Bauble", 'Prismatic Ending']);
    expect([...f.random].sort()).toEqual(['Emrakul\'s Messenger', 'Farseek', 'Halo Forager', 'Micromancer', 'Nishoba Brawler', 'Soulherder', "Witch's Oven"]);
  });
});

describe('the registry', () => {
  const info = cubeInfo('evybaby')!;
  it('lists it under the title Evan gave it, its own size, and its lab data', () => {
    expect(info).toMatchObject({ title: "Evybaby's New Cube", file: 'evybaby-cube-360', size: 360 });
    expect(info.labData).toBeUndefined();
    expect(cubeShortName(info)).toBe('Evybaby');
    expect(cubeShortName(cubeInfo('fair-fight')!)).toBe('Fair Fight');
    expect(info.humanData).toBeUndefined();
  });
  it('loads the document from public/cubes/ and asks for its meta.json beside it', async () => {
    const asked: string[] = [];
    const fetcher = async (u: string) => {
      asked.push(u);
      return u.endsWith('/cubes/evybaby-cube-360.md') ? new Response(text) : new Response('', { status: 404 });
    };
    expect((await loadCubeDoc(info, '/ForgeCoach/', fetcher)).cards).toHaveLength(360);
    expect(await loadShippedMeta(info, '/ForgeCoach/', fetcher)).toBeNull();
    expect(asked).toEqual(['/ForgeCoach/cubes/evybaby-cube-360.md', '/ForgeCoach/cubes/evybaby-cube-360.meta.json']);
  });
});

describe('drafting it with no lab data (the no-meta prior)', () => {
  const ctx = context('evybaby');
  const cards = labCards(ctx);

  it('every card has facts from Scryfall and a value, and the values spread', () => {
    expect(ctx.meta).toBeNull();
    for (const n of names) {
      expect(ctx.facts.get(n), n).toBeDefined();
      expect(Number.isFinite(cards.get(n)?.rating), n).toBe(true);
    }
    expect(ctx.facts.get('Lórien Revealed')?.colors).toBe('U');
    expect(ctx.facts.get('Everything Pizza')?.colors).toBe('');
    expect(new Set(names.map((n) => cards.get(n)!.rating.toFixed(3))).size).toBeGreaterThan(30);
  });

  it('a grid draft runs to the end: 18 grids of the 360, the two pools build 40-card decks', () => {
    const end = selfPlay(newDraft({ cubeId: 'evybaby', format: 'grid', cube: names, seed: 360, youFirst: false, now: 0 }), cards) as GridDraft;
    expect(end.done).toBe(true);
    expect(end.grids).toBe(18);
    expect(end.dealt).toHaveLength(162);
    expect(end.log.filter((e) => e.kind === 'line')).toHaveLength(36);
    const total = end.picks.you.length + end.picks.ai.length;
    expect(total).toBeGreaterThanOrEqual(90);
    expect(new Set([...end.picks.you, ...end.picks.ai]).size).toBe(total);
    for (const pool of [end.picks.you, end.picks.ai]) {
      const b = buildDecks(labOnly(ctx), pool)[0]!;
      expect(b.missing).toBe(0);
      expect(b.spells.length + b.nonbasics.length + Object.values(b.basics).reduce((s, n) => s + (n ?? 0), 0)).toBe(40);
    }
  });

  it('Winston deals 90 of them; an eight-seat booster draft uses every card', () => {
    const w = selfPlay(newDraft({ cubeId: 'evybaby', format: 'winston', cube: names, seed: 7, youFirst: true, now: 0 }), cards) as WinstonDraft;
    expect(w.done).toBe(true);
    expect(w.dealt).toHaveLength(90);
    const b = newDraft({ cubeId: 'evybaby', format: 'booster', cube: names, seed: 7, youFirst: true, seats: 8, now: 0 }) as BoosterDraft;
    expect(b.packSize).toBe(15);
    expect(b.dealt).toHaveLength(360);
    const end = selfPlay(b, cards) as BoosterDraft;
    expect(end.done).toBe(true);
    expect(end.picks.you).toHaveLength(45);
  });
});

describe('cards Forge has no script for (draft/deck.ts forForge)', () => {
  const ctx = context('evybaby');
  const missing = cube.forgeMissing!;

  it("the AI's deck is built without them, sideboard included", () => {
    // A pool holding all 13 and enough else to build from.
    const pool = [...missing, ...names.filter((n) => !missing.includes(n)).slice(0, 47)];
    const kept = pool.filter((n) => !missing.includes(n));
    const ai = buildDecks(labOnly(ctx), kept)[0]!;
    const md = matchDeck('AI Drafter', ai, kept);
    for (const [, n] of [...md.main, ...(md.sideboard ?? [])]) expect(missing.includes(n), n).toBe(false);
  });

  it('a player deck: them off the sideboard, named when in the main deck', () => {
    const d = { name: 'Justin', main: [[1, 'Lightning Bolt'], [1, 'Twisted Fates'], [17, 'Mountain']] as Array<[number, string]>, sideboard: [[1, 'Theorix Charm'], [1, 'Opt']] as Array<[number, string]> };
    expect(forForge(d, missing)).toEqual({ deck: { ...d, sideboard: [[1, 'Opt']] }, blocked: ['Twisted Fates'] });
    expect(forForge(d, undefined)).toEqual({ deck: d, blocked: [] });
    expect(forForge(d, [])).toEqual({ deck: d, blocked: [] });
  });

  it("the engine's sideboard stops at Forge's 15 (more and it asks again between games, forever)", () => {
    const side = names.slice(0, 40).map((n) => [1, n] as [number, string]);
    const d = { name: 'Justin', main: [[23, 'Opt'], [17, 'Mountain']] as Array<[number, string]>, sideboard: [[3, 'Island'], ...side] as Array<[number, string]> };
    const got = forForge(d, undefined).deck.sideboard!;
    expect(got.reduce((s, [n]) => s + n, 0)).toBe(FORGE_SIDEBOARD_MAX);
    expect(got.slice(0, 2)).toEqual([[3, 'Island'], side[0]]);
    expect(forForge(d, undefined).deck.main).toBe(d.main);
  });
});
