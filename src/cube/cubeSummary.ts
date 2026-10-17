/*
 * ForgeCoach — cube/cubeSummary.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The cube builder's live summary of a cube being made from the library:
 * count against the size aimed at, colour balance, curve, type mix,
 * multicolour and land counts, and the warnings — cards Forge lacks or that
 * nobody vouched for, Forge's AI:RemoveDeck flags, names listed twice, cards
 * not in the library, a size the drafts deal short, and colours a Grid draft
 * leaves short of playables. Pure.
 *
 * The Grid check: a Grid draft deals 9 × min(18, ⌊n/9⌋) cards, and each of
 * the two drafters takes a third of every grid. A two-colour deck wants about
 * 23 nonland cards, and the other drafter wants some of the same ones, so a
 * colour is short when even its best pair deals fewer than 46 nonland cards
 * castable with that pair (colourless ones included).
 */
import { COLOURS, colourPairs, type Colour } from './colors.ts';
import { BUCKETS, bucketOf, KIND_ORDER, kindOf, mvBin, type Bucket, type CardKind, type Library, type LibraryCard } from './library.ts';

export const GRID_DEAL = 162;
export const WINSTON_DEAL = 90;
export const GRID_PAIR_NEED = 46;

export type WarningKind = 'forge' | 'forge-unknown' | 'ai-all' | 'ai-random' | 'duplicate' | 'unknown' | 'size' | 'deal' | 'colour' | 'balance';

export interface CubeWarning {
  kind: WarningKind;
  /** stop: the engine will refuse it; warn: worth fixing; note: worth knowing. */
  level: 'stop' | 'warn' | 'note';
  text: string;
  cards?: string[];
}

export interface CubeSummary {
  count: number;
  target: number | null;
  buckets: Record<Bucket, number>;
  /** Nonland cards a colour can play: its own mono-coloured cards plus the gold ones that include it. */
  perColour: Record<Colour, number>;
  /** Nonland mana values, bins 0–6 and 7+. */
  curve: number[];
  kinds: Record<CardKind, number>;
  multicolour: number;
  lands: number;
  /** Lands that make or fetch two colours or more. */
  fixing: number;
  /** Cards the lab played, and their average lab win rate. */
  rated: number;
  avgLab: number | null;
  warnings: CubeWarning[];
}

const list = (names: string[], max = 6) => (names.length <= max ? names.join(', ') : `${names.slice(0, max).join(', ')} and ${names.length - max} more`);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const castableIn = (c: Pick<LibraryCard, 'colors'>, pair: string) => [...c.colors].every((x) => pair.includes(x));

export function summarizeCube(names: string[], lib: Library, target: number | null = null): CubeSummary {
  const buckets = Object.fromEntries(BUCKETS.map((b) => [b, 0])) as Record<Bucket, number>;
  const perColour = Object.fromEntries(COLOURS.map((c) => [c, 0])) as Record<Colour, number>;
  const kinds = Object.fromEntries(KIND_ORDER.map((k) => [k, 0])) as Record<CardKind, number>;
  const curve = [0, 0, 0, 0, 0, 0, 0, 0];
  let multicolour = 0;
  let lands = 0;
  let fixing = 0;
  let rated = 0;
  let labSum = 0;
  const seen = new Set<string>();
  const dupes = new Set<string>();
  const unknown: string[] = [];
  const cards: LibraryCard[] = [];
  for (const n of names) {
    if (seen.has(n)) {
      dupes.add(n);
      continue;
    }
    seen.add(n);
    const c = lib.byName.get(n);
    if (!c) {
      unknown.push(n);
      continue;
    }
    cards.push(c);
  }
  for (const c of cards) {
    const b = bucketOf(c);
    buckets[b]++;
    kinds[kindOf(c)]++;
    if (b === 'land') {
      lands++;
      if ((c.produces ?? '').length >= 2) fixing++;
    } else {
      curve[mvBin(c.mv)]!++;
      for (const x of c.colors) perColour[x as Colour]++;
      if (c.colors.length > 1) multicolour++;
    }
    if (c.lab) {
      rated++;
      labSum += c.lab.winRate;
    }
  }
  const count = seen.size;
  const warnings: CubeWarning[] = [];

  const noForge = cards.filter((c) => c.forge === false).map((c) => c.name);
  if (noForge.length)
    warnings.push({ kind: 'forge', level: 'stop', cards: noForge, text: `${plural(noForge.length, 'card')} Forge has no script for: ${list(noForge)}. They draft as normal, but the bot never plays them and you take them out of your deck before a game.` });
  const unsure = cards.filter((c) => c.forge === null).map((c) => c.name);
  if (unsure.length) warnings.push({ kind: 'forge-unknown', level: 'warn', cards: unsure, text: `Not known whether Forge has ${list(unsure)}: if it doesn’t, the engine refuses a deck that holds one.` });
  const aiAll = cards.filter((c) => c.ai === 'All').map((c) => c.name);
  if (aiAll.length) warnings.push({ kind: 'ai-all', level: 'warn', cards: aiAll, text: `The bot plays ${plural(aiAll.length, 'card')} badly (Forge rates them AI:RemoveDeck:All): ${list(aiAll)}.` });
  const aiRandom = cards.filter((c) => c.ai === 'Random').map((c) => c.name);
  if (aiRandom.length) warnings.push({ kind: 'ai-random', level: 'note', cards: aiRandom, text: `Forge leaves ${plural(aiRandom.length, 'card')} out of its random decks (AI:RemoveDeck:Random): ${list(aiRandom)}.` });
  if (dupes.size) warnings.push({ kind: 'duplicate', level: 'warn', cards: [...dupes], text: `Listed twice: ${list([...dupes])}. A cube holds one of each; the drafts deal it once.` });
  if (unknown.length) warnings.push({ kind: 'unknown', level: 'warn', cards: unknown, text: `Not in the library: ${list(unknown)}. Nothing is known about ${unknown.length === 1 ? 'it' : 'them'} here.` });

  if (target !== null && count !== target) {
    warnings.push({ kind: 'size', level: 'warn', text: count < target ? `${count} of ${target}: ${target - count} to go.` : `${count - target} over ${target}.` });
  }
  if (count > 0 && count < GRID_DEAL) {
    const grids = Math.floor(count / 9);
    const parts = [`A Grid draft deals ${grids === 0 ? 'no grid' : plural(grids, 'grid')} of 9 instead of 18`];
    if (count < WINSTON_DEAL) parts.push(`a Winston draft deals ${count} cards instead of 90`);
    warnings.push({ kind: 'deal', level: count < 90 ? 'warn' : 'note', text: `${parts.join('; ')}.` });
  }

  // Colours a Grid draft leaves short (see the header).
  const nonland = cards.filter((c) => bucketOf(c) !== 'land');
  const dealt = Math.min(GRID_DEAL, Math.floor(count / 9) * 9);
  const frac = count > 0 ? dealt / count : 0;
  const colours = COLOURS.filter((c) => perColour[c] > 0);
  if (nonland.length >= 20 && colours.length >= 2) {
    const best: Partial<Record<Colour, number>> = {};
    for (const p of colourPairs()) {
      const n = Math.floor(nonland.filter((c) => castableIn(c, p)).length * frac);
      for (const x of p) best[x as Colour] = Math.max(best[x as Colour] ?? 0, n);
    }
    const short = colours.filter((c) => (best[c] ?? 0) < GRID_PAIR_NEED);
    if (short.length) {
      const words = short.map((c) => `${colourWord(c)} ${best[c] ?? 0}`);
      warnings.push({
        kind: 'colour',
        level: 'warn',
        text: `Short for a Grid draft: ${words.join(', ')} — the playables a Grid draft deals in each colour’s best pair. Two drafters want about ${GRID_PAIR_NEED} there: 23 each for a two-colour deck.`,
      });
    }
    const mono = colours.map((c) => buckets[c]);
    const mean = mono.reduce((a, b) => a + b, 0) / mono.length;
    const thin = colours.filter((c) => buckets[c] < mean * 0.7);
    if (thin.length && mean >= 5) warnings.push({ kind: 'balance', level: 'note', text: `Fewer ${list(thin.map(colourWord))} cards than the other colours (${thin.map((c) => buckets[c]).join(', ')} against an average of ${Math.round(mean)}).` });
  }

  return { count, target, buckets, perColour, curve, kinds, multicolour, lands, fixing, rated, avgLab: rated ? labSum / rated : null, warnings };
}

const WORD: Record<Colour, string> = { W: 'white', U: 'blue', B: 'black', R: 'red', G: 'green' };
const colourWord = (c: string) => WORD[c as Colour] ?? c;
