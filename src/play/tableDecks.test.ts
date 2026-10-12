/*
 * ForgeCoach — play/tableDecks.test.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Play vs Bot's table (common-sense pass item 8): the deck options, the choice
 * kept in this browser and settled against what is still saved, and the
 * decks built for the match launcher — legal 40s, Forge-scriptable, the
 * bot's named without a card from its list.
 */
import { describe, expect, it } from 'vitest';
import { context, loadRealMeta, type CubeId } from '../cube/testdata/load.ts';
import type { SavedPool } from '../cube/pools.ts';
import type { SavedDraft } from '../draft/store.ts';
import { checkRequest, deckSize } from '../draft/launch.ts';
import { botDeckOptions, choiceKey, ENGINE_DECKS, myDeckOptions, readTableChoice, settleChoice, writeTableChoice, type CubeRef } from './tableDecks.ts';
import { resolveDeck, resolveTable, type DeckDeps } from './tableBuild.ts';

const cubes: CubeRef[] = [
  { id: 'pauper', title: 'Pauper Cube' },
  { id: 'vintage', title: 'Vintage Cube' },
];
const pool = (id: string, cubeId: string, cards: string[]): SavedPool => ({ id, cubeId, name: `Pool ${id}`, cards, opp: [], format: 'grid', updatedAt: 1 });

function mem(): Pick<Storage, 'getItem' | 'setItem'> {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) };
}

describe('the choice', () => {
  it('your deck: the engine’s, then what this browser has, then a fresh deck from each cube', () => {
    const opts = myDeckOptions(null, [pool('a', 'pauper', Array(45).fill('Island'))], cubes);
    expect(opts.map((o) => choiceKey(o.choice))).toEqual(['engine', 'pool:a', 'cube:pauper', 'cube:vintage']);
    expect(opts[0]!.label).toMatch(/As the engine has them/);
  });

  it('the bot’s deck never offers the engine’s alone: the launcher takes two decks', () => {
    expect(botDeckOptions(null, [], cubes).map((o) => choiceKey(o.choice))).toEqual(['cube:pauper', 'cube:vintage']);
  });

  it('settled: your deck chosen gives the bot a fresh deck from the same cube; a deck gone falls back to the engine’s', () => {
    const pools = [pool('a', 'vintage', Array(45).fill('Island'))];
    expect(settleChoice({ mine: { kind: 'pool', id: 'a' }, theirs: { kind: 'engine' }, games: 1 }, null, pools, cubes)).toEqual({ mine: { kind: 'pool', id: 'a' }, theirs: { kind: 'cube', cube: 'vintage' }, games: 1 });
    expect(settleChoice({ mine: { kind: 'pool', id: 'gone' }, theirs: { kind: 'cube', cube: 'pauper' }, games: 3 }, null, pools, cubes)).toEqual({ ...ENGINE_DECKS, games: 3 });
    expect(settleChoice({ mine: { kind: 'draft' }, theirs: { kind: 'draft' }, games: 1 }, null, pools, cubes).mine.kind).toBe('engine');
  });

  it('kept in this browser; nothing kept is the engine’s decks', () => {
    const s = mem();
    expect(readTableChoice(s)).toEqual(ENGINE_DECKS);
    writeTableChoice({ mine: { kind: 'cube', cube: 'pauper' }, theirs: { kind: 'pool', id: 'x' }, games: 3 }, s);
    expect(readTableChoice(s)).toEqual({ mine: { kind: 'cube', cube: 'pauper' }, theirs: { kind: 'pool', id: 'x' }, games: 3 });
  });
});

describe('building the decks', () => {
  const ctxs = new Map<string, ReturnType<typeof context>>();
  const deps = (over: Partial<DeckDeps> = {}): DeckDeps => ({
    loadCtx: async (id) => {
      if (!ctxs.has(id)) ctxs.set(id, context(id as CubeId, loadRealMeta(id as CubeId)));
      return ctxs.get(id)!;
    },
    draft: null,
    pools: [],
    seed: 42,
    cubeTitle: (id) => (id === 'pauper' ? 'Pauper Cube' : id),
    ...over,
  });

  it('a fresh cube deck for each side: two different legal 40s from one draft, the launcher’s checks pass', async () => {
    const t = await resolveTable({ mine: { kind: 'cube', cube: 'pauper' }, theirs: { kind: 'cube', cube: 'pauper' }, games: 1 }, deps());
    if ('error' in t) throw new Error(t.error);
    expect(deckSize(t.deck)).toBeGreaterThanOrEqual(40);
    expect(deckSize(t.aiDeck)).toBeGreaterThanOrEqual(40);
    expect(t.deck.main).not.toEqual(t.aiDeck.main);
    expect(checkRequest({ deck: t.deck, aiDeck: t.aiDeck })).toBeNull();
    // the bot's deck is named by where it came from, never by a card in it
    expect(t.aiDeck.name).toBe('Pauper Cube bot deck');
    expect((t.aiDeck.sideboard ?? []).reduce((s, [n]) => s + n, 0)).toBeLessThanOrEqual(15);
  }, 60_000);

  it('a saved pool: its best build; cards Forge cannot play stay out', async () => {
    const ctx = await deps().loadCtx('pauper');
    const cards = ctx.cube.cards.filter((c) => !c.land).slice(0, 60).map((c) => c.name);
    const d = await resolveDeck({ kind: 'pool', id: 'p' }, 'you', deps({ pools: [pool('p', 'pauper', cards)] }));
    expect(deckSize(d)).toBeGreaterThanOrEqual(40);
    const missing = new Set(ctx.cube.forgeMissing ?? []);
    expect([...d.main, ...(d.sideboard ?? [])].filter(([, n]) => missing.has(n))).toEqual([]);
  }, 60_000);

  it('a Draft vs Bot choice without a saved draft says so', async () => {
    const t = await resolveTable({ mine: { kind: 'draft' }, theirs: { kind: 'cube', cube: 'pauper' }, games: 1 }, deps({ draft: null as SavedDraft | null }));
    expect(t).toEqual({ error: 'No Draft vs Bot draft is saved in this browser.' });
  });
});
