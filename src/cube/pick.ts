/*
 * ForgeCoach — cube/pick.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The pick helper for two-player Grid and Winston drafts.
 *
 * A card's pick value for a drafter (with their pool so far):
 *
 *   card value (meta + prior; a land at 0.8 of it)
 *   + 0.8 · synergy with the pool (its top themes, meta pair lift)
 *   + colour fit, growing with commitment (= pool size / 20, at most 1):
 *       in the pool's top two colours +6, colourless +3,
 *       a strong one-pip splash −6, anything else −18;
 *       a dual making both top colours +10.
 *
 * A set taken at once (a grid line, a Winston pile) is worth its best card
 * plus 0.6 of each other card.
 *
 * Grid, picking first (all nine cards there): each row/column is worth its set
 * value to you, minus half of the best line the opponent can then take (valued
 * for THEIR pool when you have entered it, else by plain card value) — in a
 * two-player draft what they take is what you play against. Picking second
 * (some slots gone): each line still holding cards, by its set value.
 *
 * Winston: take the pile when it beats passing by a margin (6, 3, 0 for piles
 * 1–3). Passing is worth the best expected pile still to come — a pile of k
 * unseen cards is valued from the cube cards neither of you holds, by order
 * statistics — less a quarter of what this pile (plus a card) is worth to the
 * opponent, who sees it next.
 */
import { castableIn, splashColourOf } from './facts.ts';
import { colourLabel, wubrg } from './colors.ts';
import { SPLASH_MIN } from './builder.ts';
import { cardValue, synergyOf, themeCountsOf, topThemes, type CubeContext } from './score.ts';

export interface PickParts {
  card: number;
  synergy: number;
  colour: number;
  total: number;
}

/** The pool's colour weights (value mass, split over a gold card's colours). */
export function colourMass(pool: string[], ctx: CubeContext): Record<string, number> {
  const m: Record<string, number> = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  for (const p of pool) {
    const f = ctx.facts.get(p);
    if (!f || f.land || !f.colors) continue;
    for (const c of f.colors) m[c] = (m[c] ?? 0) + cardValue(p, ctx) / f.colors.length;
  }
  return m;
}

/** The pool's two heaviest colours, WUBRG order ('' for an empty pool). */
export function poolColours(pool: string[], ctx: CubeContext): string {
  const m = colourMass(pool, ctx);
  const order = Object.entries(m)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1] || 'WUBRG'.indexOf(a[0]) - 'WUBRG'.indexOf(b[0]))
    .slice(0, 2)
    .map(([c]) => c);
  return wubrg(order);
}

export const commitment = (pool: string[]) => Math.min(1, pool.length / 20);

/** Pick value of one card for a drafter holding `pool`. */
export function pickValue(name: string, pool: string[], ctx: CubeContext): PickParts {
  const f = ctx.facts.get(name);
  const k = commitment(pool);
  const pair = poolColours(pool, ctx);
  const raw = cardValue(name, ctx);
  const card = f?.land ? raw * 0.8 : raw;
  const onColour = pool.filter((p) => {
    const pf = ctx.facts.get(p);
    return pf && (pair.length < 2 || castableIn(pf, pair));
  });
  const top = new Set(topThemes(onColour, ctx, 3).map(([t]) => t));
  const counts = themeCountsOf(onColour, ctx);
  const synergy = 0.8 * synergyOf(name, new Set(onColour), top, counts, ctx).total;
  let colour = 0;
  if (f && pair.length === 2) {
    if (f.land) {
      const makes = [...pair].filter((c) => f.produces.includes(c)).length;
      colour = makes === 2 ? 10 * k : makes === 1 && f.produces.length >= 2 ? 3 * k : -4 * k;
    } else if (!f.colors) colour = 3 * k;
    else if (castableIn(f, pair)) colour = 6 * k;
    else if (splashColourOf(f, pair) && raw >= SPLASH_MIN) colour = -6 * k;
    else colour = -18 * k;
  }
  const r = (x: number) => Math.round(x * 10) / 10;
  return { card: r(card), synergy: r(synergy), colour: r(colour), total: r(card + synergy + colour) };
}

/** Best card plus 0.6 × each other card. */
export function setValue(values: number[]): number {
  const v = [...values].map((x) => Math.max(0, x)).sort((a, b) => b - a);
  return v.reduce((s, x, i) => s + (i === 0 ? x : 0.6 * x), 0);
}

/** Value for the opponent: for their pool when known, else plain card value. */
function oppValues(names: string[], oppPool: string[] | undefined, ctx: CubeContext): number[] {
  return names.map((n) => (oppPool && oppPool.length ? pickValue(n, oppPool, ctx).total : cardValue(n, ctx)));
}

// ---------------------------------------------------------------------------
// Grid

export interface GridLine {
  id: string;
  label: string;
  slots: number[];
}

export const GRID_LINES: GridLine[] = [
  { id: 'R1', label: 'Top row', slots: [0, 1, 2] },
  { id: 'R2', label: 'Middle row', slots: [3, 4, 5] },
  { id: 'R3', label: 'Bottom row', slots: [6, 7, 8] },
  { id: 'C1', label: 'Left column', slots: [0, 3, 6] },
  { id: 'C2', label: 'Middle column', slots: [1, 4, 7] },
  { id: 'C3', label: 'Right column', slots: [2, 5, 8] },
];

export interface GridOption {
  line: GridLine;
  cards: string[];
  /** Set value to you. */
  mine: number;
  /** The opponent's best reply after this pick (first pick only). */
  reply: { line: GridLine; cards: string[]; value: number } | null;
  total: number;
  reasons: string[];
}

export interface GridAdvice {
  first: boolean;
  options: GridOption[];
  best: GridOption | null;
}

export const DENIAL = 0.5;

/** `slots`: nine card names (row-major) or null where a card is gone. */
export function recommendGrid(slots: Array<string | null>, pool: string[], ctx: CubeContext, oppPool?: string[]): GridAdvice {
  const filled = slots.filter((s): s is string => !!s);
  const first = filled.length === 9;
  const cardsOf = (l: GridLine, gone: Set<number> = new Set()) => l.slots.filter((i) => !gone.has(i) && slots[i]).map((i) => slots[i] as string);
  const mineOf = new Map(filled.map((n) => [n, pickValue(n, pool, ctx)]));
  const pair = poolColours(pool, ctx);
  const options: GridOption[] = [];
  for (const line of GRID_LINES) {
    const cards = cardsOf(line);
    if (cards.length === 0) continue;
    const vals = cards.map((c) => mineOf.get(c)?.total ?? 0);
    const mine = setValue(vals);
    let reply: GridOption['reply'] = null;
    if (first) {
      const gone = new Set(line.slots);
      for (const other of GRID_LINES) {
        if (other.id === line.id) continue;
        const rc = cardsOf(other, gone);
        if (rc.length === 0) continue;
        const v = setValue(oppValues(rc, oppPool, ctx));
        if (!reply || v > reply.value) reply = { line: other, cards: rc, value: Math.round(v * 10) / 10 };
      }
    }
    const total = mine - (reply ? DENIAL * reply.value : 0);
    options.push({ line, cards, mine: Math.round(mine * 10) / 10, reply, total: Math.round(total * 10) / 10, reasons: [] });
  }
  options.sort((a, b) => b.total - a.total || (a.line.id < b.line.id ? -1 : 1));
  for (const o of options) o.reasons = gridReasons(o, options, mineOf, pair, ctx);
  return { first, options, best: options[0] ?? null };
}

function fitText(name: string, pair: string, ctx: CubeContext): string {
  const f = ctx.facts.get(name);
  if (!f || pair.length < 2) return '';
  if (f.land) return [...pair].every((c) => f.produces.includes(c)) ? 'your dual' : '';
  if (!f.colors) return 'colourless';
  return castableIn(f, pair) ? `on colour (${colourLabel(pair)})` : splashColourOf(f, pair) ? 'a splash' : 'off colour';
}

function gridReasons(o: GridOption, all: GridOption[], mineOf: Map<string, PickParts>, pair: string, ctx: CubeContext): string[] {
  const r: string[] = [];
  const sorted = [...o.cards].sort((a, b) => (mineOf.get(b)?.total ?? 0) - (mineOf.get(a)?.total ?? 0));
  const head = sorted[0];
  if (head) {
    const p = mineOf.get(head);
    const fit = fitText(head, pair, ctx);
    const syn = p && p.synergy >= 3 ? `, synergy +${p.synergy} with your pool` : '';
    r.push(`${head} (${p?.total ?? 0}${fit ? `, ${fit}` : ''}${syn})${sorted.length > 1 ? ` with ${sorted.slice(1).join(' and ')}` : ''}.`);
  }
  if (o.reply) r.push(`They likely answer with the ${o.reply.line.label.toLowerCase()}: ${o.reply.cards.join(', ')} (worth ${o.reply.value} to them).`);
  const best = all[0];
  if (best && best !== o) r.push(`${Math.round((best.total - o.total) * 10) / 10} behind the ${best.line.label.toLowerCase()}.`);
  return r;
}

// ---------------------------------------------------------------------------
// Winston

export interface WinstonInput {
  pile: string[];
  /** Which pile you are looking at: 1, 2 or 3. */
  pileIndex: 1 | 2 | 3;
  /** Sizes of piles 1–3 (for the ones you have not looked at); default 1 each. */
  sizes?: [number, number, number];
  pool: string[];
  oppPool?: string[];
  /** Cards known to be out of the stack (seen in piles, taken, discarded). */
  seen?: string[];
}

export interface WinstonAdvice {
  action: 'take' | 'pass';
  take: number;
  pass: number;
  margin: number;
  reasons: string[];
  cards: Array<{ name: string; value: number }>;
}

export const WINSTON_MARGIN = [6, 3, 0];

/** Expected set value of k cards drawn from `values` (order statistics on the empirical distribution). */
export function expectedSet(values: number[], k: number): number {
  if (k <= 0 || values.length === 0) return 0;
  const v = [...values].sort((a, b) => a - b);
  const n = v.length;
  let eMax = 0;
  for (let i = 0; i < n; i++) eMax += (v[i] ?? 0) * (((i + 1) / n) ** k - (i / n) ** k);
  const mean = v.reduce((s, x) => s + x, 0) / n;
  return eMax + 0.6 * (k - 1) * mean;
}

export function recommendWinston(input: WinstonInput, ctx: CubeContext): WinstonAdvice {
  const { pile, pileIndex, pool, oppPool } = input;
  const sizes = input.sizes ?? [1, 1, 1];
  const known = new Set([...pool, ...(oppPool ?? []), ...pile, ...(input.seen ?? [])]);
  const unseen = ctx.cube.cards.filter((c) => !known.has(c.name)).map((c) => pickValue(c.name, pool, ctx).total);
  const cards = pile.map((n) => ({ name: n, value: pickValue(n, pool, ctx).total })).sort((a, b) => b.value - a.value);
  const take = setValue(cards.map((c) => c.value));
  // Passing: the best expected pile still ahead, or the blind top card after pile 3.
  const blind = expectedSet(unseen, 1);
  let future = blind;
  const ahead: string[] = [];
  for (let i = 3; i > pileIndex; i--) {
    const e = expectedSet(unseen, Math.max(1, sizes[i - 1] ?? 1));
    if (e > future) future = e;
    ahead.push(`pile ${i} (${sizes[i - 1] ?? 1} unseen card${(sizes[i - 1] ?? 1) === 1 ? '' : 's'}) ≈ ${Math.round(e)}`);
  }
  const theirs = setValue(oppValues(pile, oppPool, ctx)) + 0.6 * (unseen.length ? unseen.reduce((s, x) => s + x, 0) / unseen.length : 0);
  const pass = future - 0.25 * theirs;
  const margin = WINSTON_MARGIN[pileIndex - 1] ?? 0;
  const action = take >= pass + margin ? 'take' : 'pass';
  const r1 = (x: number) => Math.round(x * 10) / 10;
  const reasons: string[] = [];
  const pair = poolColours(pool, ctx);
  if (cards[0]) {
    const fit = fitText(cards[0].name, pair, ctx);
    reasons.push(`This pile is worth ${r1(take)} to you: ${cards.map((c) => `${c.name} ${c.value}`).join(', ')}${fit ? ` — ${cards[0].name} is ${fit}` : ''}.`);
  } else reasons.push('The pile is empty.');
  reasons.push(
    `Passing: ${ahead.length ? ahead.join(', ') + ', ' : ''}the blind top card ≈ ${Math.round(blind)}; less ${r1(0.25 * theirs)} for what the opponent gets if they take this pile plus a card.`,
  );
  reasons.push(action === 'take' ? `Take it: ${r1(take)} beats ${r1(pass)}${margin ? ` by more than the pile-${pileIndex} margin of ${margin}` : ''}.` : `Pass: ${r1(take)} is not ${margin ? `${margin} better than` : 'better than'} ${r1(pass)}.`);
  return { action, take: r1(take), pass: r1(pass), margin, reasons, cards };
}
