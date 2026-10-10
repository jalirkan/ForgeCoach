/*
 * ForgeCoach — cube/guides/guides.test.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { aiFlagsFromDoc } from '../../draft/aiFlags.ts';
import { labCards } from '../../draft/cards.ts';
import { aiStep, apply, legalLines, newDraft, toAct, type GridDraft } from '../../draft/draft.ts';
import { buildPickPrompt } from '../../draft/pickPrompt.ts';
import { buildDecks } from '../builder.ts';
import { buildDeckPrompt } from '../deckPrompt.ts';
import { DRAFT_CUBES } from '../cubes.ts';
import { parseMeta, type CubeMeta } from '../meta.ts';
import { archetypeRows } from '../metaView.ts';
import { context, loadCube, loadInfos, loadRealMeta, samplePool, type CubeId } from '../testdata/load.ts';
import { archetypeColours, GUIDE_SECTION_MAX_CHARS, GUIDES, guideFor, guideForTitle, guidePromptSection, matchArchetypes } from './index.ts';
import { archetypeLab, guideLabFacts, LAB_MIN_GAMES, topArchetype } from './lab.ts';

const doc = (id: string) => readFileSync(new URL(`../../../public/cubes/${id}-cube-180.md`, import.meta.url), 'utf8');

/** Cubes with no guide: Evan's list has no archetypes to write one from (its How to draft tab says so). */
const NO_GUIDE = ['evybaby'];

describe('every drafted cube has a guide, and every card a guide names is in its cube', () => {
  it('one guide per listed cube, found by id and by the document title', () => {
    const guided = DRAFT_CUBES.filter((c) => !NO_GUIDE.includes(c.id));
    expect(GUIDES.map((g) => g.cubeId).sort()).toEqual(guided.map((c) => c.id).sort());
    for (const c of NO_GUIDE) {
      expect(guideFor(c)).toBeNull();
      expect(guideForTitle(loadCube(c as CubeId).title)).toBeNull();
    }
    for (const c of guided) {
      expect(guideFor(c.id)?.cubeId).toBe(c.id);
      expect(guideForTitle(loadCube(c.id as CubeId).title)?.cubeId).toBe(c.id);
    }
    expect(guideFor('nope')).toBeNull();
    expect(guideForTitle('Some other cube')).toBeNull();
  });

  for (const g of GUIDES) {
    describe(g.cubeId, () => {
      const cube = loadCube(g.cubeId as CubeId);
      const names = new Set(cube.cards.map((c) => c.name));
      const infos = loadInfos(g.cubeId as CubeId, cube);

      it('3–5 signpost and key cards per archetype, all in the cube list, all with Scryfall text', () => {
        expect(g.archetypes.length).toBeGreaterThanOrEqual(8);
        for (const a of g.archetypes) {
          expect(a.cards.length, a.id).toBeGreaterThanOrEqual(3);
          expect(a.cards.length, a.id).toBeLessThanOrEqual(5);
          for (const n of a.cards) {
            expect(names.has(n), `${g.cubeId}/${a.id}: ${n}`).toBe(true);
            expect(infos.get(n)?.found, `${n} in the Scryfall snapshot`).toBe(true);
          }
          for (const s of [a.plan, a.pickEarly, a.traps, a.curve]) expect(s.length).toBeGreaterThan(10);
          expect(a.curve).toMatch(/\b1[5-8]\b.*lands/);
        }
        expect(new Set(g.archetypes.map((a) => a.id)).size).toBe(g.archetypes.length);
      });

      it('covers every archetype the cube document names', () => {
        for (const d of cube.archetypes) {
          if (!d.colors) continue;
          const covered = g.archetypes.some((a) => {
            const wide = a.colors + (a.also ?? '');
            return [...a.colors].every((c) => d.colors.includes(c)) && [...d.colors].every((c) => wide.includes(c));
          });
          expect(covered, `${g.cubeId}: ${d.name} (${d.colors})`).toBe(true);
        }
      });

      it('names only flagged cards that are in the cube, and agrees with the document’s own flags', () => {
        for (const n of [...g.forge.flagged.all, ...g.forge.flagged.random]) expect(names.has(n), n).toBe(true);
        const fromDoc = aiFlagsFromDoc(doc(g.cubeId), [...names]);
        if (fromDoc.all.size + fromDoc.random.size > 0) {
          expect([...fromDoc.all].sort()).toEqual([...g.forge.flagged.all].sort());
          expect([...fromDoc.random].sort()).toEqual([...g.forge.flagged.random].sort());
        }
        expect(g.forge.points.length).toBeGreaterThanOrEqual(4);
      });

      it('has the principles: valuing, three formats, splashing', () => {
        expect(g.principles.valuing.length).toBeGreaterThanOrEqual(3);
        expect(g.principles.formats.winston).toMatch(/three colours|third colour/);
        expect(g.principles.formats.winston).toMatch(/18 lands/);
        expect(g.principles.formats.grid).toBeTruthy();
        expect(g.principles.formats.booster).toBeTruthy();
        expect(g.principles.splash).toBeTruthy();
        expect(g.summary.length).toBeLessThan(800);
        expect(g.teaser.length).toBeLessThan(140);
      });

      it('writes no lab numbers into the guide itself', () => {
        const text = JSON.stringify(g);
        expect(text).not.toMatch(/\d+(\.\d+)?\s?%/);
        expect(text).not.toMatch(/\bwin rate\b/i);
      });
    });
  }
});

describe('matching a pool’s colours to a guide archetype', () => {
  const syn = guideFor('synergy')!;
  it('an exact pair first', () => {
    expect(matchArchetypes(syn, 'BR')[0]?.id).toBe('BR-sac');
    expect(matchArchetypes(syn, 'UW')[0]?.id).toBe('WU-blink');
    expect(matchArchetypes(syn, 'GB')[0]?.id).toBe('BG-counters');
  });
  it('a three-colour deck finds the archetype that adds that colour', () => {
    expect(matchArchetypes(syn, 'WBR')[0]?.id).toBe('BR-sac');
    expect(matchArchetypes(guideFor('omega')!, 'WB')[0]?.id).toBe('W-tokens');
    expect(matchArchetypes(guideFor('omega')!, 'RG')[0]?.id).toBe('G-ramp');
  });
  it('nothing for no colours', () => {
    expect(matchArchetypes(syn, '')).toEqual([]);
  });
  it('labels colours for people', () => {
    expect(archetypeColours({ colors: 'BR', also: 'W' })).toBe('Rakdos, often with W');
    expect(archetypeColours({ colors: 'G' })).toBe('Green-based');
    expect(archetypeColours({ colors: '' })).toBe('Any colours');
  });
});

describe('the coach prompt section', () => {
  it('quotes the archetype the colours point to, capped', () => {
    const s = guidePromptSection(guideFor('synergy'), 'BR')!;
    expect(s).toMatch(/^## Cube guide/);
    expect(s).toContain('### Rakdos sacrifice');
    expect(s).toContain('Key cards: Goblin Bombardment, Viscera Seer');
    expect(s).toMatch(/Pick early: /);
    expect(s).toMatch(/Traps: /);
    expect(s.length).toBeLessThanOrEqual(GUIDE_SECTION_MAX_CHARS);
    for (const g of GUIDES) for (const c of ['', 'WU', 'UB', 'BR', 'RG', 'WG', 'WB', 'UR', 'BG', 'WR', 'UG', 'WUB']) expect(guidePromptSection(g, c)!.length).toBeLessThanOrEqual(GUIDE_SECTION_MAX_CHARS);
  });
  it('before the player has colours: the cube in one paragraph and its archetypes', () => {
    const s = guidePromptSection(guideFor('pauper'), '')!;
    expect(s).toContain(guideFor('pauper')!.summary);
    expect(s).toMatch(/Archetypes: Azorius skies and blink/);
  });
  it('never more than the cap, cutting whole archetypes', () => {
    const s = guidePromptSection(guideFor('vintage'), 'UR', 600)!;
    expect(s.length).toBeLessThanOrEqual(600);
    expect(s.match(/^### /gm)?.length ?? 0).toBeLessThanOrEqual(1);
  });
  it('null without a guide', () => {
    expect(guidePromptSection(null, 'BR')).toBeNull();
  });
});

describe('lab facts come from meta.json at runtime', () => {
  it('the top archetype by shrunk win rate, with its sample and the AI-vs-AI caveat', () => {
    for (const id of ['synergy', 'modern-era', 'vintage', 'pauper'] as const) {
      const meta = loadRealMeta(id);
      const lab = guideLabFacts(meta)!;
      expect(lab.facts.length).toBeGreaterThanOrEqual(1);
      expect(lab.facts.length).toBeLessThanOrEqual(2);
      expect(lab.caveat).toMatch(/Forge AIs/);
      const top = topArchetype(meta);
      if (top) {
        expect(top.games).toBeGreaterThanOrEqual(LAB_MIN_GAMES);
        const better = archetypeRows(meta).filter((r) => r.games >= LAB_MIN_GAMES && (r.win ?? 0) > (top.win ?? 0));
        expect(better).toEqual([]);
        expect(lab.facts[0]).toContain(top.id);
        expect(lab.facts[0]).toContain(`${top.games} games`);
      }
    }
  });

  it('follows the data, not the guide: other numbers, other facts', () => {
    const meta: CubeMeta = parseMeta({
      schema: 1,
      cube: {},
      sample: { drafts: 3, games: 40 },
      cards: {},
      archetypes: [
        { id: 'WU-ETB', colors: 'WU', primaryTheme: 'ETB', decks: 4, games: 20, winRate: 0.4 },
        { id: 'BR-SAC', colors: 'BR', primaryTheme: 'SAC', decks: 4, games: 20, winRate: 0.6 },
        { id: 'UG', colors: 'UG', decks: 1, games: 2, winRate: 1 },
      ],
      pairs: [],
      lands: { overall: { '16': { games: 30, winRate: 0.5 }, '17': { games: 10, winRate: 0.5 } } },
    });
    const lab = guideLabFacts(meta)!;
    expect(lab.facts[0]).toMatch(/Rakdos Sacrifice \(BR-SAC\), 5\d% .* over 20 games from 4 decks/);
    expect(lab.facts[1]).toBe('Land counts: 16 lands won 50% of 30 games, 17 lands won 50% of 10 games.');
    expect(lab.caveat).toContain('40 games from 3 drafts');
  });

  it('nothing without a meta (as when a cube ships none, or it fails to load)', () => {
    expect(guideLabFacts(null)).toBeNull();
    expect(archetypeLab(null, guideFor('omega')!.archetypes[0]!)).toBeNull();
  });

  it('a guide archetype’s own record pools the matching lab archetypes', () => {
    const meta = loadRealMeta('synergy');
    const blink = guideFor('synergy')!.archetypes.find((a) => a.id === 'WU-blink')!;
    const lab = archetypeLab(meta, blink)!;
    expect(lab.ids).toEqual(['WU-ETB']);
    expect(lab.games).toBe(meta.archetypes.find((a) => a.id === 'WU-ETB')?.games);
    expect(lab.text).toMatch(/^Lab: WU-ETB, \d+ games, \d+% win rate/);
    const thin = parseMeta({ schema: 1, cube: {}, cards: {}, archetypes: [{ id: 'WU-ETB', colors: 'WU', primaryTheme: 'ETB', decks: 1, games: 3, winRate: 1 }], pairs: [] });
    expect(archetypeLab(thin, blink)?.text).toMatch(/only 3 games: too few to read/);
  });
});

describe('the guide in the draft and deckbuilding coach prompts', () => {
  it('the deck prompt quotes the build’s archetype', () => {
    const ctx = context('synergy', loadRealMeta('synergy'));
    const pool = samplePool(ctx.cube, 'BR', 45, 3);
    const b = buildDecks(ctx, pool).find((x) => x.colors === 'BR')!;
    const p = buildDeckPrompt({ ctx, pool, build: b, infos: new Map() });
    expect(p.user).toContain('## Cube guide');
    expect(p.user).toContain('### Rakdos sacrifice');
    expect(p.user.indexOf('## Cube guide')).toBeLessThan(p.user.indexOf('## Card text (pool)'));
  });

  it('the pick prompt quotes the pool’s archetype once there is one', () => {
    const ctx = context('pauper', loadRealMeta('pauper'));
    const names = ctx.cube.cards.map((c) => c.name);
    let d = newDraft({ cubeId: 'pauper', format: 'grid', cube: names, seed: 4, youFirst: true, now: 1 });
    const early = buildPickPrompt({ ctx, draft: d, infos: new Map() });
    expect(early.user).toContain('## Cube guide');
    expect(early.user).toContain('Archetypes: Azorius skies and blink');
    const cards = labCards(ctx);
    for (let i = 0; i < 12 && !d.done; i++) d = toAct(d) === 'ai' ? aiStep(d, cards) : apply(d, { kind: 'line', line: legalLines(d as GridDraft)[0]! }, 1);
    const later = buildPickPrompt({ ctx, draft: d, infos: new Map() });
    expect(later.user).toMatch(/## Cube guide[^]*### /);
  });
});
