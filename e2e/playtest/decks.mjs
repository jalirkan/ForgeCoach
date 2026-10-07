/*
 * ForgeCoach — e2e/playtest/decks.mjs
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The decks the playtest plays: draft-built 40s from the four cubes (a seeded
 * Grid draft between two of ForgeCoach's own drafting AIs, src/draft, then the
 * deck assistant's best build for each side, src/cube/builder.ts) and the
 * decks in mtg-table's `decks/` (`.dck`). Each comes out as the match
 * launcher's `MatchDeck` ({name, main: [[n, card]…], sideboard}).
 *
 * The cube modules are TypeScript; Node 22.18+ strips the types on import.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

export const CUBES = ['vintage', 'modern-era', 'pauper', 'synergy'];

/** `.dck` (Forge's deck file) → MatchDeck. */
export function parseDck(text, fallbackName = 'deck') {
  let name = fallbackName;
  let section = 'main';
  const main = [];
  const sideboard = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const sec = /^\[(.+)\]$/.exec(line);
    if (sec) {
      section = sec[1].toLowerCase();
      continue;
    }
    if (section === 'metadata') {
      const m = /^Name=(.+)$/i.exec(line);
      if (m) name = m[1].trim();
      continue;
    }
    const m = /^(\d+)\s+(.+?)(?:\|.*)?$/.exec(line);
    if (!m) continue;
    const entry = [Number(m[1]), m[2].trim()];
    if (section === 'main') main.push(entry);
    else if (section === 'sideboard') sideboard.push(entry);
  }
  return { name, main, sideboard };
}

const count = (entries) => entries.reduce((s, [n]) => s + n, 0);

/** Names → [[n, name]…], grouped. */
function group(names) {
  const m = new Map();
  for (const n of names) m.set(n, (m.get(n) ?? 0) + 1);
  return [...m].map(([n, c]) => [c, n]);
}

let cubeMods = null;
async function cubeModules(root) {
  if (cubeMods) return cubeMods;
  const imp = (p) => import(path.join(root, p));
  const [load, cards, draft, builder, deck] = await Promise.all([
    imp('src/cube/testdata/load.ts'),
    imp('src/draft/cards.ts'),
    imp('src/draft/draft.ts'),
    imp('src/cube/builder.ts'),
    imp('src/draft/deck.ts'),
  ]);
  cubeMods = { load, cards, draft, builder, deck };
  return cubeMods;
}

/**
 * Two decks from one seeded Grid draft of `cube`: the two drafters' best
 * builds (a legal 40 each; the rest of the pool is the sideboard).
 */
export async function cubeDraftDecks(root, cube, seed) {
  const { load, cards, draft, builder, deck } = await cubeModules(root);
  let meta = null;
  try {
    meta = load.loadRealMeta(cube);
  } catch {
    /* a cube without a lab meta drafts on the no-meta prior */
  }
  const ctx = load.context(cube, meta);
  const lab = cards.labCards(ctx);
  const d0 = draft.newDraft({ cubeId: cube, format: 'grid', cube: ctx.cube.cards.map((c) => c.name), seed, youFirst: seed % 2 === 0, now: 1_700_000_000_000 + seed });
  const done = draft.selfPlay(d0, lab);
  const out = [];
  for (const side of ['you', 'ai']) {
    const pool = done.picks[side];
    const builds = builder.buildDecks(ctx, pool, {}, 1);
    const b = builds.find((x) => x.missing === 0) ?? builds[0];
    if (!b) throw new Error(`${cube} seed ${seed}: no build for ${side}`);
    const st = deck.deckFromBuild(b, pool);
    const names = deck.mainNames(st);
    const main = group(names);
    if (count(main) < 40) {
      // An early pool short of spells: pad with basics of its colours, as the deck editor's basics would.
      const basic = deck.BASIC_NAME[[...(b.colors || 'R')][0]] ?? 'Mountain';
      main.push([40 - count(main), basic]);
    }
    out.push({ name: `${cube} ${b.name}`.slice(0, 60), main, sideboard: group(st.side), pool, source: `cube:${cube}#${seed}:${side}` });
  }
  return out;
}

/** mtg-table's own decks that play on the pinned engine (D109: fra-rw-aggro does not; probes are not decks). */
export function mtgDecks(mtgRoot) {
  const names = ['pacho-shield', 'doom-legion', 'hulk-family', 'masters-of-evil', 'wakanda'];
  return names.map((n) => ({ ...parseDck(readFileSync(path.join(mtgRoot, 'decks', `${n}.dck`), 'utf8'), n), source: `dck:decks/${n}.dck`, file: `decks/${n}.dck` }));
}

/** Every card name in a MatchDeck (main and side). */
export function deckNames(d) {
  return new Set([...(d.main ?? []), ...(d.sideboard ?? [])].map(([, n]) => n));
}

/**
 * The deck plan: `spec` is a comma list of `cube:<id>`, `cube` (all four),
 * `dck:<name>` or `dck` (all of mtg-table's). Returns a picker that hands out
 * {mine, theirs} pairs for game `i`, seeded.
 */
export async function deckPlan({ spec, root, mtgRoot, seed, rand }) {
  const parts = (spec || 'cube,dck').split(',').map((s) => s.trim()).filter(Boolean);
  const cubes = [];
  let dcks = [];
  for (const p of parts) {
    if (p === 'cube') cubes.push(...CUBES);
    else if (p.startsWith('cube:')) cubes.push(p.slice(5));
    else if (p === 'dck' && mtgRoot) dcks = mtgDecks(mtgRoot);
    else if (p.startsWith('dck:') && mtgRoot) {
      const n = p.slice(4).replace(/\.dck$/, '');
      dcks.push({ ...parseDck(readFileSync(path.join(mtgRoot, 'decks', `${n}.dck`), 'utf8'), n), source: `dck:decks/${n}.dck` });
    }
  }
  const sources = [...cubes.map((c) => ({ kind: 'cube', cube: c })), ...(dcks.length ? [{ kind: 'dck' }] : [])];
  if (!sources.length) throw new Error(`--decks ${spec}: nothing to play`);
  return async (i) => {
    const src = sources[(i + seed) % sources.length];
    if (src.kind === 'cube') {
      const [a, b] = await cubeDraftDecks(root, src.cube, seed * 1000 + i);
      return rand() < 0.5 ? { mine: a, theirs: b } : { mine: b, theirs: a };
    }
    const a = dcks[Math.floor(rand() * dcks.length)];
    const b = dcks[Math.floor(rand() * dcks.length)];
    return { mine: a, theirs: b };
  };
}
