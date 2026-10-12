/*
 * ForgeCoach — cube/twobert.test.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Evan's Twobert Cube: his second list, 180 cards as he gave them
 * (public/cubes/twobert-cube-180.md; revised 2026-10-12, ten swaps), with no
 * themes, archetypes, guide or lab meta. The document, the registry, drafts on
 * it, and the four Reality Fracture cards Forge 2.0.14 lacks kept out of what
 * the engine is handed.
 */
import { describe, expect, it } from 'vitest';
import { labCards } from '../draft/cards.ts';
import { matchDeck } from '../draft/deck.ts';
import { newDraft, selfPlay, type GridDraft } from '../draft/draft.ts';
import { guideFor } from './guides/index.ts';
import { buildDecks } from './builder.ts';
import { cubeInfo, cubeShortName } from './cubes.ts';
import { labOnly } from './score.ts';
import { context, loadCube, loadInfos } from './testdata/load.ts';

const cube = loadCube('twobert');
const names = cube.cards.map((c) => c.name);

const NOT_IN_FORGE = ['Flickering Hound', 'Null Summoner', 'Twinned Vision', 'Primal Witchstalker'];

/** Evan's revised list (evanstwobert1.txt): ten out, ten in. */
const SWAPPED_OUT = [
  'Palace Jailer', 'Champion of Wits', 'Unsummon', 'Pelt Collector', 'Rishkar, Peema Renegade',
  'Scute Swarm', 'Anthem of Champions', 'Shelinda, Yevon Acolyte', 'Carmen, Cruel Skymarcher', 'Grist, the Hunger Tide',
];
const SWAPPED_IN = [
  'Flickering Hound', 'Mystic Confluence', 'Bespoke Bō', 'Bristly Bill, Spine Sower', 'Endurance',
  'Ramunap Excavator', 'Renegade Rallier', 'Yasharn, Implacable Earth', 'Syr Vondam, Sunstar Exemplar', 'Cauldron of Essence',
];

describe('the Twobert document', () => {
  it("Evan's 180 names, one of each, every one in the Scryfall snapshot", () => {
    expect(cube.title).toBe("Evan's Twobert Cube");
    expect(cube.warnings).toEqual([]);
    expect(cube.cards).toHaveLength(180);
    expect(new Set(names).size).toBe(180);
    expect(cube.sections.map((s) => `${s.name} ${s.kind} ${s.parsed}`)).toEqual([
      'White colour 22', 'Blue colour 23', 'Black colour 23', 'Red colour 22', 'Green colour 21', 'Colorless colorless 13', 'Multicolor gold 34', 'Lands lands 22',
    ]);
    const infos = loadInfos('twobert', cube);
    for (const n of names) expect(infos.has(n), n).toBe(true);
    expect(names).toContain('Troll of Khazad-dûm');
    expect(names).toContain('Lórien Revealed');
  });

  it('is the revised list: ten cards out, ten in, each in its colour group', () => {
    for (const n of SWAPPED_OUT) expect(names, n).not.toContain(n);
    for (const n of SWAPPED_IN) expect(names, n).toContain(n);
    const group = (n: string) => cube.cards.find((c) => c.name === n)?.section;
    expect(SWAPPED_IN.map(group)).toEqual(['White', 'Blue', 'Blue', 'Green', 'Green', 'Green', 'Multicolor', 'Multicolor', 'Multicolor', 'Multicolor']);
  });

  it('names the four cards Forge 2.0.14 lacks', () => {
    expect([...(cube.forgeMissing ?? [])].sort()).toEqual([...NOT_IN_FORGE].sort());
  });

  it('is registered, with no lab data and no guide', () => {
    const info = cubeInfo('twobert')!;
    expect(info).toMatchObject({ file: 'twobert-cube-180', size: 180, labData: false });
    expect(cubeShortName(info)).toBe('Twobert');
    expect(guideFor('twobert')).toBeNull();
  });
});

describe('drafting it', () => {
  const ctx = context('twobert');
  it('a grid draft runs to the end and both pools build a 40', () => {
    const d = selfPlay(newDraft({ cubeId: 'twobert', format: 'grid', cube: names, seed: 7, youFirst: false, now: 0 }), labCards(ctx)) as GridDraft;
    expect(d.done).toBe(true);
    expect(d.dealt).toHaveLength(162);
    for (const pool of [d.picks.you, d.picks.ai]) expect(buildDecks(labOnly(ctx), pool)[0]).toBeTruthy();
  });

  it("the AI's deck never holds a card Forge lacks once the missing cards are kept out", () => {
    const kept = names.filter((n) => !NOT_IN_FORGE.includes(n)).slice(0, 60);
    const ai = buildDecks(labOnly(ctx), kept)[0]!;
    const md = matchDeck('AI Drafter', ai, kept);
    for (const [, n] of [...md.main, ...(md.sideboard ?? [])]) expect(NOT_IN_FORGE.includes(n), n).toBe(false);
  });
});
