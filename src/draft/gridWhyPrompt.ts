/*
 * ForgeCoach — draft/gridWhyPrompt.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The coach prompt behind the grid hint's "Explain more" (ui/draft/GridHint.tsx):
 * two or three sentences on why the hinted line's cards go together — the plan
 * they build towards, how they fit the drafter's pool, what to look for next.
 * Deterministic and short: the line's cards with their cube themes and exact
 * text, the pick helper's blurb (draft/gridBlurb.ts), the pool by name and
 * theme, the cube's themes they touch, and the cube guide's section for the
 * pool's colours. Only what the player can see goes in.
 */
import type { CardInfo } from '../cards.ts';
import type { Prompt } from '../prompt.ts';
import { colourLabel } from '../cube/colors.ts';
import { guideFor, guidePromptSection } from '../cube/guides/index.ts';
import { poolColours } from '../cube/pick.ts';
import type { CubeContext } from '../cube/score.ts';
import type { GridBlurb } from './gridBlurb.ts';

export const GRID_WHY_SYSTEM = `You are a Magic: The Gathering cube draft coach. The player is in a two-player Grid draft and the page's pick helper recommends taking one line of three cards. Explain, in two or three plain sentences and no more, why these cards go together: the archetype or plan they build towards, how they fit the player's current pool, and what to look for in the next picks. Use the card text given, never memory of a card. No headings, no lists, no preamble.`;

/** Guide text kept short: the explanation is two or three sentences. */
export const GRID_WHY_GUIDE_MAX = 700;

export interface GridWhyInput {
  ctx: CubeContext;
  cubeId: string;
  blurb: GridBlurb;
  pool: string[];
  /** Exact card text, by name: at least the line's cards. */
  infos: Map<string, CardInfo>;
}

function oracle(name: string, info: CardInfo | undefined): string {
  if (!info || !info.found) return `${name} — (card text unavailable)`;
  const head = [name, info.manaCost, '—', info.typeLine].filter(Boolean).join(' ');
  const pt = info.power !== undefined && info.toughness !== undefined ? ` [${info.power}/${info.toughness}]` : '';
  return `${head}${pt}\n  ${info.oracleText.replace(/\n/g, '\n  ')}`;
}

const themesOf = (name: string, ctx: CubeContext) => ctx.byName.get(name)?.themes ?? [];

/** The cards whose text the prompt carries: the line's. */
export const gridWhyCards = (blurb: GridBlurb): string[] => blurb.cards.map((c) => c.name);

export function buildGridWhyPrompt({ ctx, cubeId, blurb, pool, infos }: GridWhyInput): Prompt {
  const lines: string[] = [];
  const pair = poolColours(pool, ctx);
  lines.push(`# ${ctx.cube.title} — Grid draft`);
  lines.push(`Pick helper: ${blurb.title.toLowerCase()}.`);
  lines.push('', '## The line');
  for (const c of blurb.cards) {
    const t = themesOf(c.name, ctx);
    lines.push(`- ${c.name} (value ${Math.round(c.value)}${t.length ? `; themes ${t.join(' ')}` : ''})${c.reasons.length ? `: ${c.reasons.join('; ')}` : ''}`);
  }
  if (blurb.leaves) lines.push(blurb.leaves);
  if (blurb.close) lines.push(blurb.close);
  lines.push('', `## Your pool (${pool.length})${pair.length === 2 ? `, leaning ${colourLabel(pair)}` : ''}`);
  lines.push(pool.length ? [...pool].sort().map((n) => (themesOf(n, ctx).length ? `${n} [${themesOf(n, ctx).join(' ')}]` : n)).join('; ') : '(empty: this is the first pick)');
  // The cube's themes the line touches.
  const codes = [...new Set(blurb.cards.flatMap((c) => themesOf(c.name, ctx)))];
  const themes = ctx.cube.themes.filter((t) => codes.includes(t.code));
  if (themes.length) {
    lines.push('', '## Cube themes');
    for (const t of themes) lines.push(`- ${t.code} ${t.name}: ${t.idea}${t.connects.length ? ` (connects to ${t.connects.join(', ')})` : ''}`);
  }
  const guide = pair.length === 2 ? guidePromptSection(guideFor(cubeId), pair, GRID_WHY_GUIDE_MAX) : null;
  if (guide) lines.push('', guide);
  lines.push('', '## Card text');
  for (const n of gridWhyCards(blurb)) lines.push(oracle(n, infos.get(n)));
  lines.push('', 'Why do these cards go together for me? Two or three sentences.');
  return { system: GRID_WHY_SYSTEM, user: lines.join('\n') };
}
