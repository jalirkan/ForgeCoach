/*
 * ForgeCoach — cube/deckPrompt.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The deckbuilding coach prompt: the drafted pool, the proposed build and its
 * score, the other builds, the cube lab's highlights, and the oracle text of
 * every pool card. Deterministic (same inputs, same bytes) so answers can be
 * compared and the prompt can be copied into the Claude app. The coach
 * explains and suggests; the page never applies its suggestions by itself.
 */
import type { CardInfo } from '../cards.ts';
import type { Prompt } from '../prompt.ts';
import { BASIC_NAMES, COLOURS, BASIC_OF, colourLabel } from './colors.ts';
import { CURVE_LABELS, PART_LABEL, sideboard, type DeckBuild, type ScoreParts } from './builder.ts';
import { findArchetype } from './meta.ts';
import { cardValue, metaValue, pairsAmong, pairWeight, pct, type CubeContext } from './score.ts';

export const DECK_SYSTEM = `You are a Magic: The Gathering deckbuilding coach for a two-player cube draft (Grid or Winston), 40-card decks, best of three. The player drafted the pool below; the page proposed a build with a score and its reasons. Help them end up with the strongest deck for real games.

How to work:
- Use the card text given, never memory of a card. Card values are the page's estimate (0-100, about 50 = filler, 70 = strong); "lab" numbers come from Forge AIs drafting and playing this cube — small samples with wide intervals, so treat them as hints, not facts.
- Judge the deck as it will play: curve and early plays, removal count, threats, how it wins, mana (sources per colour, splash sources, 16 vs 17 lands), and which synergies are real (an enabler with too few payoffs is not a synergy).
- You cannot edit the deck. Suggest changes as swaps the player can make: "−Card Out / +Card In — reason". At most three, each with a concrete reason; say when the page's build is already right.
- Only pool cards can go in the deck (basic lands are free). Keep it at exactly 40 cards.

Answer format — short, no preamble:
**Verdict** — one or two sentences on the build and its plan.
**Swaps** — up to three "−Out / +In — reason" lines (or "None").
**Mana** — land count and basics split, one line.
**How it wins / what to watch** — two or three bullets for playing it.
**Sideboard** — one line on what comes in against what, for games 2 and 3.
Then answer the player's own question, if there is one.`;

export interface DeckPromptInput {
  ctx: CubeContext;
  pool: string[];
  build: DeckBuild;
  /** Other builds the page offered (best first). */
  alternatives?: DeckBuild[];
  /** Scryfall card data by name (cards.ts); missing names are flagged. */
  infos: Map<string, CardInfo>;
  /** The draft format, when known. */
  format?: 'grid' | 'winston' | null;
  question?: string;
}

const r1 = (x: number) => Math.round(x * 10) / 10;
const byName = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function cardLine(name: string, ctx: CubeContext): string {
  const f = ctx.facts.get(name);
  const card = ctx.byName.get(name);
  const bits = [f && !f.land ? `MV ${f.mv}` : 'land', `value ${cardValue(name, ctx)}`];
  const m = metaValue(name, ctx);
  if (m && m.games > 0) bits.push(`lab ${pct(m.winRate)} in ${m.games} games`);
  const tags = [...(card?.themes ?? []), ...(card?.tags ?? [])];
  if (tags.length) bits.push(tags.join(' '));
  return `- ${name} (${bits.join('; ')})`;
}

function partsLine(p: ScoreParts): string {
  return (Object.keys(p) as Array<keyof ScoreParts>)
    .filter((k) => p[k] !== 0)
    .map((k) => `${PART_LABEL[k]} ${p[k] > 0 && k !== 'quality' ? '+' : ''}${p[k]}`)
    .join(', ');
}

function landsLine(b: DeckBuild): string {
  const basics = COLOURS.filter((c) => (b.basics[c] ?? 0) > 0).map((c) => `${b.basics[c]} ${BASIC_OF[c]}`);
  return `${b.landCount} lands: ${[...b.nonbasics, ...basics].join(', ')}`;
}

function oracleBlock(name: string, info: CardInfo | undefined): string {
  if (!info || !info.found) return `${name} — (card text unavailable)`;
  const head = [name, info.manaCost, '—', info.typeLine].filter(Boolean).join(' ');
  const pt = info.power !== undefined && info.toughness !== undefined ? ` [${info.power}/${info.toughness}]` : info.loyalty ? ` [loyalty ${info.loyalty}]` : '';
  return `${head}${pt}\n  ${info.oracleText.replace(/\n/g, '\n  ')}`;
}

export function buildDeckPrompt(input: DeckPromptInput): Prompt {
  const { ctx, pool, build: b, infos } = input;
  const meta = ctx.meta?.meta ?? null;
  const out: string[] = [];
  out.push(`# Cube: ${ctx.cube.title}`);
  out.push(`Two-player ${input.format === 'grid' ? 'Grid draft' : input.format === 'winston' ? 'Winston draft' : 'cube draft'}, 40-card decks, best of three. Pool: ${pool.filter((p) => !BASIC_NAMES.has(p)).length} cards.`);
  if (ctx.cube.themes.length) out.push(`Cube themes: ${ctx.cube.themes.map((t) => `${t.code} = ${t.name}`).join('; ')}.`);
  if (meta?.sample) {
    const s = meta.sample;
    out.push(`Cube lab sample: ${s.drafts ?? '?'} drafts, ${s.games ?? '?'} games between Forge AIs${s.aiProfile ? ` (${s.aiProfile} profile)` : ''}.`);
  }

  out.push('', `## Proposed build: ${b.name} — ${colourLabel(b.colors)}${b.splash ? ` splashing ${b.splash}` : ''}`);
  out.push(`Score ${b.score} (${partsLine(b.parts)}).`);
  out.push(`Curve ${b.curve.join('/')} for MV ${CURVE_LABELS.join('/')}; target ${b.curveTarget.map((x) => Math.round(x)).join('/')}. ${b.creatures} creatures, ${b.interaction} removal/counter spells, average MV ${b.avgMv}.`);
  if (b.missing) out.push(`The pool is ${b.missing} playable(s) short of a full deck in these colours.`);
  out.push('', `Spells (${b.spells.length}):`);
  for (const s of b.spells) out.push(cardLine(s, ctx));
  out.push('', landsLine(b));
  out.push('', 'The page’s reasons:');
  for (const r of b.reasons) out.push(`- ${r}`);
  if (b.cuts.length) {
    out.push('', 'Strong on-colour cards left out, and why:');
    for (const c of b.cuts) out.push(`- ${c.name}: ${c.reason}`);
  }

  const alts = (input.alternatives ?? []).filter((a) => a.key !== b.key);
  if (alts.length) {
    out.push('', '## Other builds the page offered');
    for (const a of alts) {
      const only = a.spells.filter((s) => !b.spells.includes(s));
      out.push(`- ${a.name} (${a.key}), score ${a.score}${only.length ? `; plays ${only.slice(0, 8).join(', ')}${only.length > 8 ? '…' : ''}` : ''}`);
    }
  }

  const rest = sideboard(b, pool).filter((s) => !b.spells.includes(s));
  if (rest.length) {
    out.push('', `## Rest of the pool (${rest.length})`);
    for (const s of [...new Set(rest)].sort(byName)) out.push(cardLine(s, ctx));
  }

  if (meta) {
    out.push('', '## Cube lab highlights');
    const arch = findArchetype(meta, b.colors, b.themes[0]?.[0]);
    const same = meta.archetypes.filter((a) => a.colors === b.colors).sort((x, y) => (y.games ?? 0) - (x.games ?? 0) || byName(x.id, y.id));
    for (const a of same.slice(0, 4)) {
      out.push(
        `- Archetype ${a.id}${a === arch ? ' (this build)' : ''}: ${a.games ?? 0} games, won ${typeof a.winRate === 'number' ? pct(a.winRate) : '?'}${a.ci ? ` (${pct(a.ci[0])}–${pct(a.ci[1])})` : ''}${a.avgLands ? `, average ${r1(a.avgLands)} lands` : ''}${a.keyCards?.length ? `; key cards ${a.keyCards.slice(0, 6).join(', ')}` : ''}.`,
      );
    }
    const pairs = pairsAmong(pool, ctx)
      .filter((p) => p.gain > 0.03 && pairWeight(p) >= 0.2)
      .slice(0, 8);
    for (const p of pairs) out.push(`- ${p.a} + ${p.b}: ${pct(p.gain, true)} together over ${p.games ?? '?'} games.`);
    const lands = meta.lands?.byArchetype?.[arch?.id ?? ''] ?? meta.lands?.overall;
    if (lands) {
      const rows = Object.entries(lands)
        .sort((x, y) => Number(x[0]) - Number(y[0]))
        .map(([k, s]) => `${k} lands ${pct(s.winRate)} of ${s.games}`);
      out.push(`- Land counts${meta.lands?.byArchetype?.[arch?.id ?? ''] ? ` (${arch?.id})` : ''}: ${rows.join(', ')}.`);
    }
    if (meta.splash && typeof meta.splash.vsNoSplash === 'number') out.push(`- Splashing decks: ${pct(meta.splash.vsNoSplash, true)} win rate vs not splashing, over ${meta.splash.games ?? '?'} games.`);
  }

  out.push('', '## Card text (pool)');
  for (const s of [...new Set(pool)].filter((p) => !BASIC_NAMES.has(p)).sort(byName)) out.push(oracleBlock(s, infos.get(s)));

  out.push('', '## Question');
  out.push(input.question?.trim() || 'Is this the best deck the pool makes? What would you change, and how should it be played?');
  return { system: DECK_SYSTEM, user: out.join('\n') };
}
