/*
 * ForgeCoach — play/tableBuild.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Building Play vs Bot's table decks (play/tableDecks.ts has the choice): a
 * Draft vs Bot deck as built, a saved pool's best build, or a fresh deck from
 * a seeded Grid draft between two drafting bots — the playtest's own recipe
 * (e2e/playtest/decks.mjs). Cards Forge has no script for yet (the cube's
 * `forgeMissing`) are left out of a built deck and its sideboard
 * (`forForge`). Loaded lazily (App.tsx `startPlay`); pure but for the
 * injected loaders.
 */
import type { CubeContext } from '../cube/score.ts';
import { labOnly } from '../cube/score.ts';
import { buildDecks } from '../cube/builder.ts';
import type { SavedPool } from '../cube/pools.ts';
import type { SavedDraft } from '../draft/store.ts';
import { labCards } from '../draft/cards.ts';
import { newDraft, selfPlay } from '../draft/draft.ts';
import { forForge, matchDeck, toMatchDeck } from '../draft/deck.ts';
import { deckSize, safeDeckName, type MatchDeck } from '../draft/launch.ts';
import type { DeckChoice, TableChoice } from './tableDecks.ts';

export interface DeckDeps {
  /** The cube's context (document, card data, meta). */
  loadCtx(cubeId: string): Promise<CubeContext>;
  draft: SavedDraft | null;
  pools: readonly SavedPool[];
  /** The fresh-deck draft's seed. */
  seed: number;
  cubeTitle(cubeId: string): string;
}

const BASIC_OF: Record<string, string> = { W: 'Plains', U: 'Island', B: 'Swamp', R: 'Mountain', G: 'Forest' };

/** A 40 at least: an early pool short of playables gets basics of its colours, as the deck editor would. */
function fill40(d: MatchDeck, colors: string): MatchDeck {
  const n = deckSize(d);
  if (n >= 40) return d;
  const basic = BASIC_OF[[...colors].find((c) => BASIC_OF[c]) ?? 'R']!;
  const main = d.main.map(([k, name]) => [k, name] as [number, string]);
  const at = main.findIndex(([, name]) => name === basic);
  if (at >= 0) main[at] = [main[at]![0] + 40 - n, basic];
  else main.push([40 - n, basic]);
  return { ...d, main };
}

function bestOf(ctx: CubeContext, pool: string[], name: string): MatchDeck {
  const noScript = new Set(ctx.cube.forgeMissing ?? []);
  const cards = pool.filter((n) => !noScript.has(n));
  const builds = buildDecks(ctx, cards, {}, 1);
  const b = builds.find((x) => x.missing === 0) ?? builds[0];
  if (!b) throw new Error(`No 40-card build from ${name}: too few playable cards.`);
  return fill40(forForge(matchDeck(name, b, cards), noScript).deck, b.colors);
}

/**
 * The launcher deck for one side. `side` matters for a draft (your deck or the
 * bot's) and a fresh cube deck (the two drafters' decks differ). The bot's
 * name never comes from its list.
 */
export async function resolveDeck(choice: DeckChoice, side: 'you' | 'bot', deps: DeckDeps): Promise<MatchDeck> {
  switch (choice.kind) {
    case 'engine':
      throw new Error('The engine’s own decks are not sent: wake the engine instead.');
    case 'draft': {
      const d = deps.draft;
      if (!d) throw new Error('No Draft vs Bot draft is saved in this browser.');
      const ctx = await deps.loadCtx(d.draft.cubeId);
      if (side === 'bot') {
        if (!d.after?.aiDeck) throw new Error('That draft has no bot deck yet: finish it first.');
        return forForge(d.after.aiDeck, ctx.cube.forgeMissing).deck;
      }
      if (!d.deck) throw new Error('That draft has no deck yet: build it first.');
      const { deck, blocked } = forForge(toMatchDeck(d.title || 'Draft deck', d.deck), ctx.cube.forgeMissing);
      if (blocked.length) throw new Error(`Forge has no card script yet for ${blocked.join(', ')}: move ${blocked.length === 1 ? 'it' : 'them'} to your sideboard in Draft vs Bot.`);
      return deck;
    }
    case 'pool': {
      const p = deps.pools.find((x) => x.id === choice.id);
      if (!p) throw new Error('That saved pool is gone from this browser.');
      const ctx = await deps.loadCtx(p.cubeId);
      return bestOf(ctx, p.cards, side === 'bot' ? `${deps.cubeTitle(p.cubeId)} pool` : p.name);
    }
    case 'cube': {
      const ctx = labOnly(await deps.loadCtx(choice.cube));
      const d0 = newDraft({ cubeId: choice.cube, format: 'grid', cube: ctx.cube.cards.map((c) => c.name), seed: deps.seed, youFirst: deps.seed % 2 === 0, now: 1_700_000_000_000 });
      const done = selfPlay(d0, labCards(ctx));
      const pool = side === 'you' ? done.picks.you : done.picks.ai;
      return bestOf(ctx, [...pool], safeDeckName(`${deps.cubeTitle(choice.cube)} ${side === 'you' ? 'deck' : 'bot deck'}`, 'Cube deck'));
    }
  }
}

/** Both decks for the table, or a reason in the player's words. */
export async function resolveTable(c: TableChoice, deps: DeckDeps): Promise<{ deck: MatchDeck; aiDeck: MatchDeck } | { error: string }> {
  if (c.mine.kind === 'engine' || c.theirs.kind === 'engine') return { error: 'Choose both decks, or leave both as the engine has them.' };
  try {
    const deck = await resolveDeck(c.mine, 'you', deps);
    // a fresh deck for the bot from the same cube as yours: the other drafter's deck, a different seed's draft otherwise
    const aiDeck = await resolveDeck(c.theirs, 'bot', { ...deps, seed: c.mine.kind === 'cube' && c.theirs.kind === 'cube' && c.mine.cube === c.theirs.cube ? deps.seed : deps.seed + 1 });
    return { deck, aiDeck };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}
