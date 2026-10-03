/*
 * ForgeCoach — draft/pickPrompt.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The coach prompt for one pick of a draft against the AI: the choice in
 * front of the player (a grid, or the Winston pile they are looking at), their
 * pool, what they know the AI has, the pick helper's call with its numbers,
 * and the oracle text of every card involved. Only what the player can see
 * goes in: never the AI's hidden Winston picks or the stack.
 */
import type { CardInfo } from '../cards.ts';
import type { Prompt } from '../prompt.ts';
import { colourLabel } from '../cube/colors.ts';
import { GRID_LINES, pickValue, poolColours, poolProfile, recommendGrid, recommendWinston } from '../cube/pick.ts';
import { cardValue, metaValue, pct, type CubeContext } from '../cube/score.ts';
import { knownAiCards, progress, type Draft } from './draft.ts';

export const PICK_SYSTEM = `You are a Magic: The Gathering draft coach sitting beside a player in a two-player cube draft against an AI drafter (Grid or Winston). Both players will build 40-card decks from what they draft and play each other, so what the AI takes is what the player will face.

How to work:
- Use the card text given, never memory of a card. Card values are the page's estimate (0-100, about 50 = filler, 70 = strong); "lab" numbers come from Forge AIs drafting and playing this cube — small samples, treat them as hints.
- Weigh raw power, the player's colours and how committed they are, synergy with their pool, mana fixing, curve, and denial (what the AI gets if the player passes it).
- The page's pick helper gives a call with numbers. Agree or disagree with it plainly, and say why.

Answer format — short, no preamble:
**Pick** — the line or the action (Take / Pass), in one sentence.
**Why** — two or three bullets.
**Watch for** — one line on what to look for in the next picks.
Then answer the player's own question, if there is one.`;

function oracle(name: string, info: CardInfo | undefined): string {
  if (!info || !info.found) return `${name} — (card text unavailable)`;
  const head = [name, info.manaCost, '—', info.typeLine].filter(Boolean).join(' ');
  const pt = info.power !== undefined && info.toughness !== undefined ? ` [${info.power}/${info.toughness}]` : '';
  return `${head}${pt}\n  ${info.oracleText.replace(/\n/g, '\n  ')}`;
}

function cardLine(name: string, ctx: CubeContext): string {
  const f = ctx.facts.get(name);
  const bits = [f && !f.land ? `MV ${f.mv}` : 'land', `value ${cardValue(name, ctx)}`];
  const m = metaValue(name, ctx);
  if (m && m.games > 0) bits.push(`lab ${pct(m.winRate)} in ${m.games} games`);
  const themes = ctx.byName.get(name)?.themes ?? [];
  if (themes.length) bits.push(themes.join(' '));
  return `${name} (${bits.join('; ')})`;
}

export interface PickPromptInput {
  ctx: CubeContext;
  draft: Draft;
  infos: Map<string, CardInfo>;
  question?: string;
}

/** The cards a pick prompt needs text for: the choice and the player's pool. */
export function pickPromptCards(d: Draft): string[] {
  const choice = d.format === 'grid' ? d.slots.filter((s): s is string => !!s) : d.format === 'booster' ? (d.table[0] ?? []) : (d.piles[d.look] ?? []);
  return [...new Set([...choice, ...d.picks.you])];
}

export function buildPickPrompt({ ctx, draft: d, infos, question }: PickPromptInput): Prompt {
  const you = d.picks.you;
  const aiKnown = knownAiCards(d);
  const lines: string[] = [];
  lines.push(`# ${ctx.cube.title} — ${d.format === 'grid' ? 'Grid' : 'Winston'} draft vs the AI`);
  lines.push(`${progress(d).label}. You hold ${you.length} cards; the AI holds ${d.picks.ai.length}.`);
  const pair = poolColours(you, ctx);
  if (pair) lines.push(`Your colours so far: ${colourLabel(pair)}.`);
  lines.push('');
  if (d.format === 'grid') {
    const first = d.firstLine === null;
    lines.push(`## The grid (you pick ${first ? 'first' : 'second'})`);
    for (let r = 0; r < 3; r++) lines.push(`Row ${r + 1}: ${[0, 1, 2].map((c) => d.slots[r * 3 + c] ?? '—').join(' | ')}`);
    const adv = recommendGrid(d.slots, you, ctx, aiKnown);
    if (adv.best) {
      lines.push('', `Pick helper: take the ${adv.best.line.label.toLowerCase()} (score ${adv.best.total}).`);
      for (const o of adv.options.slice(0, 4)) lines.push(`- ${o.line.label}: ${o.cards.join(', ')} — ${o.total}${o.reply ? `; AI's likely answer ${o.reply.line.label.toLowerCase()} worth ${o.reply.value}` : ''}`);
    }
  } else if (d.format === 'booster') {
    const pack = d.table[0] ?? [];
    lines.push(`## ${progress(d).label}: the pack (${pack.length} cards, ${d.seats} drafters)`);
    for (const n of [...pack].sort((a, b) => cardValue(b, ctx) - cardValue(a, ctx))) lines.push(`- ${cardLine(n, ctx)}`);
    const best = bestBoosterPick(pack, you, ctx, aiKnown);
    if (best) lines.push('', `Pick helper: ${best.name} (${best.value}).`);
  } else {
    const i = d.look as 0 | 1 | 2;
    const pile = d.piles[i] ?? [];
    const sizes = d.piles.map((p) => p.length) as [number, number, number];
    lines.push(`## Pile ${i + 1} of 3 (${pile.length} card${pile.length === 1 ? '' : 's'}); piles are ${sizes.join(' / ')} cards, ${d.stack.length} left in the stack`);
    for (const n of pile) lines.push(`- ${cardLine(n, ctx)}`);
    const adv = recommendWinston({ pile, pileIndex: (i + 1) as 1 | 2 | 3, sizes, pool: you, oppPool: aiKnown, seen: d.seen.you }, ctx);
    lines.push('', `Pick helper: ${adv.action === 'take' ? 'take it' : 'pass'} (take ${adv.take} vs pass ${adv.pass}).`);
  }
  lines.push('', `## Your pool (${you.length})`);
  for (const n of [...you].sort()) lines.push(`- ${cardLine(n, ctx)}`);
  lines.push('', `## What you know the AI has (${aiKnown.length} of ${d.picks.ai.length})`);
  lines.push(aiKnown.length ? aiKnown.join(', ') : '(nothing seen yet)');
  lines.push('', '## Card text');
  for (const n of pickPromptCards(d)) lines.push(oracle(n, infos.get(n)));
  if (question?.trim()) lines.push('', `## My question`, question.trim());
  return { system: PICK_SYSTEM, user: lines.join('\n') };
}

/** Grid line ids of src/cube/pick.ts in this module's numbering (rows 0-2, columns 3-5). */
export const LINE_IDS = GRID_LINES.map((l) => l.id);

/** The pick helper's choice from a booster pack (src/cube/pick.ts values for your pool). */
export function bestBoosterPick(pack: string[], pool: string[], ctx: CubeContext, _opp: string[] = []): { name: string; value: number; ranked: Array<{ name: string; value: number }> } | null {
  if (!pack.length) return null;
  const prof = poolProfile(pool, ctx);
  const ranked = pack.map((n) => ({ name: n, value: pickValue(n, pool, ctx, prof).total })).sort((a, b) => b.value - a.value || (a.name < b.name ? -1 : 1));
  const top = ranked[0]!;
  return { name: top.name, value: top.value, ranked };
}
