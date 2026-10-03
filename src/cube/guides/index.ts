/*
 * ForgeCoach — cube/guides/index.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The "How to draft this cube" guides, looking them up, matching a pool's
 * colours to a guide archetype, and the compact guide section of the draft
 * and deckbuilding coach prompts (never the in-game ones: coachContext.ts
 * covers those). DOM-free.
 */
import { COLOUR_NAME, colourLabel, wubrg, type Colour } from '../colors.ts';
import { MODERN_ERA_GUIDE } from './modernEra.ts';
import { OMEGA_GUIDE } from './omega.ts';
import { PAUPER_GUIDE } from './pauper.ts';
import { PEASANT_GUIDE } from './peasant.ts';
import { SYNERGY_GUIDE } from './synergy.ts';
import type { CubeGuide, GuideArchetype } from './types.ts';
import { VINTAGE_GUIDE } from './vintage.ts';

export type { CubeGuide, GuideArchetype } from './types.ts';

export const GUIDES: CubeGuide[] = [SYNERGY_GUIDE, MODERN_ERA_GUIDE, VINTAGE_GUIDE, PAUPER_GUIDE, OMEGA_GUIDE, PEASANT_GUIDE];

export function guideFor(cubeId: string | null | undefined): CubeGuide | null {
  return GUIDES.find((g) => g.cubeId === cubeId) ?? null;
}

/** The guide for a cube document, by its title ("The Synergy Cube — version 1 …"). */
export function guideForTitle(title: string | null | undefined): CubeGuide | null {
  return title ? (GUIDES.find((g) => g.docTitle.test(title)) ?? null) : null;
}

/** "Rakdos", "Green-based, often with R/U", "Any colours". */
export function archetypeColours(a: Pick<GuideArchetype, 'colors' | 'also'>): string {
  const main = !a.colors ? 'Any colours' : a.colors.length === 1 ? `${COLOUR_NAME[a.colors as Colour]}-based` : colourLabel(a.colors);
  return a.also ? `${main}, often with ${[...a.also].join('/')}` : main;
}

/**
 * The guide archetypes that fit a pool's colours, best first, with a score.
 * A pair that matches the archetype's main colours beats one that only
 * touches them; an "any colours" archetype fits anything, weakly.
 */
function scoreArchetypes(guide: CubeGuide, colors: string): Array<{ a: GuideArchetype; score: number }> {
  const pool = wubrg(colors);
  if (!pool) return [];
  return guide.archetypes
    .map((a, i) => {
      const main = [...a.colors];
      const also = [...(a.also ?? '')];
      const hit = main.filter((c) => pool.includes(c)).length;
      const extra = [...pool].filter((c) => !main.includes(c));
      const extraOk = extra.filter((c) => also.includes(c)).length;
      let score = main.length === 0 ? 0.5 : hit * 2 - (main.length - hit) * 2 - (extra.length - extraOk) + extraOk * 0.5;
      if (main.length && a.colors === pool) score += 2;
      return { a, i, score };
    })
    .filter((s) => s.score > 0)
    .sort((x, y) => y.score - x.score || x.i - y.i)
    .map(({ a, score }) => ({ a, score }));
}

export function matchArchetypes(guide: CubeGuide, colors: string, max = 2): GuideArchetype[] {
  return scoreArchetypes(guide, colors)
    .slice(0, max)
    .map((s) => s.a);
}

/** Hard cap on the guide section of a coach prompt, in characters. */
export const GUIDE_SECTION_MAX_CHARS = 1800;

/** Whole blocks while they fit; the first block is cut line by line if it alone is too long. */
function cap(blocks: string[][], max: number): string {
  const out: string[] = [];
  let n = 0;
  for (const [bi, b] of blocks.entries()) {
    const size = b.reduce((t, l) => t + l.length + 1, 0);
    if (n + size <= max) {
      out.push(...b);
      n += size;
      continue;
    }
    if (bi > 1) break;
    for (const l of b) {
      if (n + l.length + 1 > max) break;
      out.push(l);
      n += l.length + 1;
    }
    break;
  }
  return out.join('\n');
}

function archetypeBlock(a: GuideArchetype): string[] {
  return [
    `### ${a.name} (${archetypeColours(a)})`,
    `Plan: ${a.plan}`,
    `Key cards: ${a.cards.join(', ')}.`,
    `Pick early: ${a.pickEarly}`,
    `Traps: ${a.traps}`,
    `Curve: ${a.curve}`,
  ];
}

/**
 * The guide section for a draft or deckbuilding prompt: the archetype(s) the
 * player's colours point to, or, before they have colours, the cube in one
 * paragraph and its archetype names. Null when the cube has no guide.
 */
export function guidePromptSection(guide: CubeGuide | null, colors: string, max = GUIDE_SECTION_MAX_CHARS): string | null {
  if (!guide) return null;
  const head = '## Cube guide (written for this cube; advice, not rules)';
  // The best fit, and a second one only when it fits exactly as well (two Izzet decks in one cube).
  const scored = scoreArchetypes(guide, colors);
  const fits = scored.filter((s, i) => i === 0 || (i === 1 && s.score === scored[0]?.score)).map((s) => s.a);
  const blocks: string[][] = [[head]];
  if (fits.length) for (const a of fits) blocks.push(archetypeBlock(a));
  else blocks.push([guide.summary, `Archetypes: ${guide.archetypes.map((a) => `${a.name} (${a.colors || 'any'})`).join('; ')}.`]);
  return cap(blocks, max);
}
