/*
 * ForgeCoach — draft/aiLabel.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * What the page calls the AI drafter's deck: its colours as far as the
 * player has seen them, e.g. "Red, mostly (6 known)" or "Black-Red (from 14
 * known cards)", and "Unknown so far" when the known cards say too little.
 * Built from `knownAiCards` only — never from `picks.ai`, which holds Winston
 * piles and Booster picks the player never saw (hidden information). The
 * same label names the AI's deck for the match launcher, so the board, the
 * game history and the coach (which reads the public deck name) see no more
 * than the player did. No archetype: the known cards are too few to name one
 * honestly, and an archetype id in the name would be quoted by the coach.
 * DOM-free.
 */
import { COLOUR_NAME, COLOURS, type Colour } from '../cube/colors.ts';
import type { CubeContext } from '../cube/score.ts';
import { safeDeckName } from './launch.ts';
import { knownAiCards, type Draft } from './draft.ts';

/** Fewer coloured, nonland known cards than this and the label says "Unknown so far". */
export const MIN_COLOURED = 3;
/** Fewer than this and the colours are hedged ("…, mostly"). */
export const FIRM_COLOURED = 8;

export interface AiLabel {
  /** The colours named, WUBRG letters ('' when none are named). */
  colours: string;
  /** "Red, mostly (6 known)", "Black-Red (from 14 known cards)", "Unknown so far". */
  text: string;
  /** Known AI cards (all of them, lands included). */
  known: number;
  /** Known coloured nonland cards: the evidence behind `colours`. */
  coloured: number;
}

/** Colour names in WUBRG order: "BR" → "Black-Red". */
export function colourWords(colours: string): string {
  return COLOURS.filter((c) => colours.includes(c))
    .map((c) => COLOUR_NAME[c])
    .join('-');
}

/**
 * The label from a list of cards the player knows the AI has. Pass only known
 * cards: this function trusts its input and has no way to tell.
 */
export function aiLabelFrom(known: string[], ctx: Pick<CubeContext, 'facts'>): AiLabel {
  const counts: Record<Colour, number> = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  let coloured = 0;
  for (const n of known) {
    const f = ctx.facts.get(n);
    if (!f || f.land || !f.colors) continue;
    coloured++;
    for (const c of f.colors) if (c in counts) counts[c as Colour]++;
  }
  const n = known.length;
  const base = { known: n, coloured };
  if (n === 0) return { ...base, colours: '', text: 'Unknown so far' };
  if (coloured < MIN_COLOURED) return { ...base, colours: '', text: `Unknown so far (${n} known)` };
  const floor = Math.max(2, Math.ceil(coloured * 0.25));
  const top = COLOURS.filter((c) => counts[c] >= floor)
    .sort((a, b) => counts[b] - counts[a] || COLOURS.indexOf(a) - COLOURS.indexOf(b))
    .slice(0, 2);
  const colours = COLOURS.filter((c) => top.includes(c)).join('');
  if (!colours) return { ...base, colours: '', text: `No clear colours (${n} known)` };
  const words = colourWords(colours);
  const text = coloured < FIRM_COLOURED ? `${words}, mostly (${n} known)` : `${words} (from ${n} known card${n === 1 ? '' : 's'})`;
  return { ...base, colours, text };
}

/** The label for a draft: from `knownAiCards(d)` only. */
export function aiDeckLabel(d: Draft, ctx: Pick<CubeContext, 'facts'>): AiLabel {
  return aiLabelFrom(knownAiCards(d), ctx);
}

/** The AI deck's public name for the match launcher (and so the board, history and coach). */
export function aiDeckName(d: Draft, ctx: Pick<CubeContext, 'facts'>): string {
  return safeDeckName(`AI Drafter - ${aiDeckLabel(d, ctx).text}`, 'AI Drafter');
}
