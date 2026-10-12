/*
 * ForgeCoach — play/tableDecks.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Play vs Bot's table (common-sense pass item 8, the way Endstep's practice
 * table asks): your deck, the bot's deck and the opponent, chosen before the
 * game. "As the engine has them" is plain Play as before — POST /engine/start
 * wakes the last setup. Any other choice builds both decks here and starts
 * the engine on them through the match launcher (draft/launch.ts
 * `launchMatch`, POST /match, mtg-table docs/match-launcher.md), which takes
 * two decklists and nothing else: mtg-table's helper has no deck list of its
 * own to offer.
 *
 * Where a deck comes from:
 * - your Draft vs Bot draft: your deck as you built it; the bot's deck from
 *   that draft (its list is never shown, as at a real table);
 * - a pool saved in Draft & build: its best build (cube/builder.ts);
 * - a fresh deck from a cube: a seeded Grid draft between two of the
 *   drafting bots (draft/draft.ts `selfPlay`), then the best build of one
 *   side — the playtest's own recipe (e2e/playtest/decks.mjs). For the bot,
 *   a deck nobody has seen.
 *
 * This file is the choice (options, what is remembered); building the decks
 * is play/tableBuild.ts, loaded only when Play is pressed. Pure.
 */
import type { SavedPool } from '../cube/pools.ts';
import type { SavedDraft } from '../draft/store.ts';

export type DeckChoice =
  | { kind: 'engine' }
  | { kind: 'draft' }
  | { kind: 'pool'; id: string }
  | { kind: 'cube'; cube: string };

export interface TableChoice {
  mine: DeckChoice;
  theirs: DeckChoice;
  /** Best of one or three. */
  games: 1 | 3;
}

export const ENGINE_DECKS: TableChoice = { mine: { kind: 'engine' }, theirs: { kind: 'engine' }, games: 1 };

export interface CubeRef {
  id: string;
  title: string;
}

export interface DeckOption {
  choice: DeckChoice;
  label: string;
}

export const choiceKey = (c: DeckChoice): string => (c.kind === 'pool' ? `pool:${c.id}` : c.kind === 'cube' ? `cube:${c.cube}` : c.kind);

export function choiceFromKey(k: string): DeckChoice | null {
  if (k === 'engine' || k === 'draft') return { kind: k };
  if (k.startsWith('pool:') && k.length > 5) return { kind: 'pool', id: k.slice(5) };
  if (k.startsWith('cube:') && k.length > 5) return { kind: 'cube', cube: k.slice(5) };
  return null;
}

/** What you can play: the engine's decks, your Draft vs Bot deck, your saved pools, a fresh deck from each cube. */
export function myDeckOptions(draft: SavedDraft | null, pools: readonly SavedPool[], cubes: readonly CubeRef[]): DeckOption[] {
  const out: DeckOption[] = [{ choice: { kind: 'engine' }, label: 'As the engine has them (the last match’s decks)' }];
  if (draft?.deck && draft.draft.done) out.push({ choice: { kind: 'draft' }, label: `Your Draft vs Bot deck${draft.title ? ` — ${draft.title}` : ''}` });
  for (const p of pools) if (p.cards.length >= 23) out.push({ choice: { kind: 'pool', id: p.id }, label: `${p.name} (best build of your pool)` });
  for (const c of cubes) out.push({ choice: { kind: 'cube', cube: c.id }, label: `A fresh ${c.title} deck` });
  return out;
}

/** What the bot can play (only with a deck of yours chosen): a fresh cube deck, its Draft vs Bot deck, your pools. */
export function botDeckOptions(draft: SavedDraft | null, pools: readonly SavedPool[], cubes: readonly CubeRef[]): DeckOption[] {
  const out: DeckOption[] = cubes.map((c) => ({ choice: { kind: 'cube', cube: c.id }, label: `A fresh ${c.title} deck (its list hidden)` }));
  if (draft?.after?.aiDeck) out.push({ choice: { kind: 'draft' }, label: 'The bot’s deck from your Draft vs Bot (its list hidden)' });
  for (const p of pools) if (p.cards.length >= 23) out.push({ choice: { kind: 'pool', id: p.id }, label: `${p.name} (your pool’s best build)` });
  return out;
}

/** The cube a deck choice is from, when it says (to start the bot on the same cube). */
export function cubeOfChoice(c: DeckChoice, draft: SavedDraft | null, pools: readonly SavedPool[]): string | null {
  if (c.kind === 'cube') return c.cube;
  if (c.kind === 'draft') return draft?.draft.cubeId ?? null;
  if (c.kind === 'pool') return pools.find((p) => p.id === c.id)?.cubeId ?? null;
  return null;
}

/** The choice as the table should use it: both sides the engine's, or both chosen (the launcher needs two decks). */
export function settleChoice(c: TableChoice, draft: SavedDraft | null, pools: readonly SavedPool[], cubes: readonly CubeRef[]): TableChoice {
  const games = c.games === 3 ? 3 : 1;
  const mineOk = myDeckOptions(draft, pools, cubes).some((o) => choiceKey(o.choice) === choiceKey(c.mine));
  if (!mineOk || c.mine.kind === 'engine') return { ...ENGINE_DECKS, games };
  const bots = botDeckOptions(draft, pools, cubes);
  if (bots.some((o) => choiceKey(o.choice) === choiceKey(c.theirs))) return { mine: c.mine, theirs: c.theirs, games };
  const cube = cubeOfChoice(c.mine, draft, pools);
  const same = bots.find((o) => o.choice.kind === 'cube' && o.choice.cube === cube) ?? bots[0];
  return same ? { mine: c.mine, theirs: same.choice, games } : { ...ENGINE_DECKS, games };
}

const KEY = 'forgecoach.play.table.v1';
type KV = Pick<Storage, 'getItem' | 'setItem'>;

function store(s?: KV | null): KV | null {
  if (s) return s;
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function readTableChoice(s?: KV | null): TableChoice {
  try {
    const raw = JSON.parse(store(s)?.getItem(KEY) ?? 'null') as { mine?: string; theirs?: string; games?: number } | null;
    const mine = raw?.mine ? choiceFromKey(raw.mine) : null;
    const theirs = raw?.theirs ? choiceFromKey(raw.theirs) : null;
    return { mine: mine ?? { kind: 'engine' }, theirs: theirs ?? { kind: 'engine' }, games: raw?.games === 3 ? 3 : 1 };
  } catch {
    return ENGINE_DECKS;
  }
}

export function writeTableChoice(c: TableChoice, s?: KV | null): void {
  try {
    store(s)?.setItem(KEY, JSON.stringify({ mine: choiceKey(c.mine), theirs: choiceKey(c.theirs), games: c.games }));
  } catch {
    /* private mode: the choice lasts this page */
  }
}

