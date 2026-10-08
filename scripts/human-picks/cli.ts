/*
 * ForgeCoach — scripts/human-picks/cli.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The TypeScript half of docs/human-picks.md (launched by run.mjs; the
 * fitting is fit.py). It gives the Python side what only the app's own code
 * can say, so the baselines are exactly what ForgeCoach computes:
 *
 *   npm run human-picks -- facts SCRYFALL.json NAMES.json OUT.json
 *     NAMES: the 17Lands card columns (extract.py's `names`). Writes, for every
 *     column, the card facts fit.py's features read (cube/facts.ts `cardFacts`:
 *     colours, mana value, land, colours it makes), and for every cube the
 *     match of its cards to columns (cube/human.ts `normName`) with the
 *     baselines: `cardValue`, the Draft vs AI rating (`ratingOf`) and the
 *     cube's 17Lands GIH WR (its shipped .human.json), plus each column's
 *     facts as that cube sees them.
 *
 *   npm run human-picks -- pickvalue SCRYFALL.json NAMES.json ITEMS.jsonl OUT.jsonl
 *     ITEMS: one JSON object per line, {"cube": id, "pool": [col…], "pack": [col…]}.
 *     Writes, per line, the pick advice's value (cube/pick.ts `pickValue`, the
 *     number grid / Winston advice ranks by) of each pack card for that pool.
 *     Pool cards outside the cube are given their Scryfall facts and the
 *     no-meta value, so the advice sees the drafter's colours as fully as it can.
 */
import { createReadStream, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mapScryfallCard, type ScryfallCard } from '../../src/cards.ts';
import { CUBES, type CubeInfo } from '../../src/cube/cubes.ts';
import { cardFacts, type CardFacts } from '../../src/cube/facts.ts';
import { normName, parseHumanCards } from '../../src/cube/human.ts';
import { cardValue, type CubeContext } from '../../src/cube/score.ts';
import { pickValue, poolProfile } from '../../src/cube/pick.ts';
import { ratingOf } from '../../src/draft/cards.ts';
import type { CubeCard } from '../../src/cube/parseCube.ts';
import { cubeContext } from '../human-cards/part2Cli.ts';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

function arenaFacts(scryfallPath: string, names: string[]): Map<string, CardFacts | null> {
  const raw = JSON.parse(readFileSync(scryfallPath, 'utf8')) as ScryfallCard[];
  const idx = new Map<string, ScryfallCard>();
  for (const c of raw) {
    if (c.name) idx.set(normName(c.name), c);
    for (const f of c.card_faces ?? []) if (f.name && !idx.has(normName(f.name))) idx.set(normName(f.name), c);
  }
  const out = new Map<string, CardFacts | null>();
  for (const n of names) {
    const c = idx.get(normName(n));
    if (!c) {
      out.set(n, null);
      continue;
    }
    const info = mapScryfallCard(n, c);
    const stub: CubeCard = { name: n, section: '', sectionKind: 'colorless', colorHint: '', land: false, themes: [], tags: [] };
    out.set(n, cardFacts(stub, info, null));
  }
  return out;
}

const factRow = (f: CardFacts | null | undefined) => (f ? { colors: f.colors, mv: f.mv, land: f.land, produces: f.produces, creature: f.creature } : null);

function humanOf(info: CubeInfo) {
  const p = join(ROOT, 'public/cubes', `${info.file}.human.json`);
  return info.humanData && existsSync(p) ? parseHumanCards(JSON.parse(readFileSync(p, 'utf8'))) : null;
}

/** Cube card name → 17Lands column, by normName. */
function matchCube(ctx: CubeContext, names: string[]): Map<string, string> {
  const byNorm = new Map(names.map((n) => [normName(n), n]));
  const m = new Map<string, string>();
  for (const c of ctx.cube.cards) {
    const col = byNorm.get(normName(c.name));
    if (col) m.set(c.name, col);
  }
  return m;
}

function facts(argv: string[]): number {
  const [sf, namesPath, out] = argv;
  if (!sf || !namesPath || !out) return usage();
  const names = JSON.parse(readFileSync(namesPath, 'utf8')) as string[];
  const arena = arenaFacts(sf, names);
  const cubes = CUBES.map((info) => {
    const human = humanOf(info);
    const ctx = cubeContext(info, human);
    const match = matchCube(ctx, names);
    const cards = [...match].map(([name, col]) => {
      const h = human?.cards[name];
      return { name, col, value: cardValue(name, ctx), rating: ratingOf(name, ctx), gih: h && h.gih > 0 ? h.gihW / h.gih : null, facts: factRow(ctx.facts.get(name)) };
    });
    return { id: info.id, file: info.file, size: ctx.cube.cards.length, gihAvg: human ? human.gih.wins / human.gih.games : null, cards };
  });
  writeFileSync(out, JSON.stringify({ arena: Object.fromEntries(names.map((n) => [n, factRow(arena.get(n))])), cubes }));
  console.error(`facts: ${[...arena.values()].filter(Boolean).length}/${names.length} columns with Scryfall facts; ${cubes.map((c) => `${c.id} ${c.cards.length}`).join(', ')}`);
  return 0;
}

async function pickvalues(argv: string[]): Promise<number> {
  const [sf, namesPath, items, out] = argv;
  if (!sf || !namesPath || !items || !out) return usage();
  const names = JSON.parse(readFileSync(namesPath, 'utf8')) as string[];
  const arena = arenaFacts(sf, names);
  const ctxs = new Map<string, { ctx: CubeContext; toCube: Map<string, string> }>();
  const get = (id: string) => {
    let hit = ctxs.get(id);
    if (!hit) {
      const info = CUBES.find((c) => c.id === id);
      if (!info) throw new Error(`unknown cube ${id}`);
      const base = cubeContext(info, humanOf(info));
      const match = matchCube(base, names);
      const toCube = new Map([...match].map(([cube, col]) => [col, cube]));
      // The same context, with facts for the Arena cards outside the cube (their value is the no-meta 40).
      const facts = new Map(base.facts);
      for (const n of names) if (!toCube.has(n) && !facts.has(n)) { const f = arena.get(n); if (f) facts.set(n, f); }
      hit = { ctx: { ...base, facts }, toCube };
      ctxs.set(id, hit);
    }
    return hit;
  };
  const lines = createInterface({ input: createReadStream(items), crlfDelay: Infinity });
  const outLines: string[] = [];
  for await (const line of lines) {
    if (!line) continue;
    const it = JSON.parse(line) as { cube: string; pool: number[]; pack: number[] };
    const { ctx, toCube } = get(it.cube);
    const nameOf = (i: number) => { const n = names[i]!; return toCube.get(n) ?? n; };
    const pool = it.pool.map(nameOf);
    const prof = poolProfile(pool, ctx);
    outLines.push(JSON.stringify(it.pack.map((i) => pickValue(nameOf(i), pool, ctx, prof).total)));
  }
  writeFileSync(out, outLines.join('\n') + '\n');
  console.error(`pickvalue: ${outLines.length} items`);
  return 0;
}

function usage(): number {
  console.error('usage: npm run human-picks -- facts SCRYFALL.json NAMES.json OUT.json\n       npm run human-picks -- pickvalue SCRYFALL.json NAMES.json ITEMS.jsonl OUT.jsonl');
  return 2;
}

export async function main(argv: string[]): Promise<number> {
  if (argv[0] === 'facts') return facts(argv.slice(1));
  if (argv[0] === 'pickvalue') return pickvalues(argv.slice(1));
  return usage();
}
