/*
 * ForgeCoach — scripts/card-model/export.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * docs/card-model.md: the one place the TypeScript side hands the card model
 * its inputs. For every cube with a shipped lab meta, every card: what kind
 * of card it is (the tests' Scryfall snapshot through cube/facts.ts), its
 * no-meta prior (score.ts `cardPrior`), its lab games and wins, today's
 * `labValue` and `cardValue`, and its 17Lands counts in the shipped human file
 * and (with HALVES_DIR, the generator's `--half 0|1 --out DIR` files) in each
 * half, plus `cardValue` as it would be with only that half's file. fit.py
 * reads this file; nothing here fits anything.
 *
 *   npm run card-model -- export OUT.json [HALVES_DIR]
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CUBES } from '../../src/cube/cubes.ts';
import { parseHumanCards, type HumanCards } from '../../src/cube/human.ts';
import { cardPrior, cardValue, labValue, metaValue } from '../../src/cube/score.ts';
import { cubeContext } from '../human-cards/part2Cli.ts';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

const loadHuman = (p: string): HumanCards | null => (existsSync(p) ? parseHumanCards(JSON.parse(readFileSync(p, 'utf8'))) : null);

export async function main(argv: string[]): Promise<number> {
  if (argv[0] !== 'export' || !argv[1]) {
    console.error('usage: npm run card-model -- export OUT.json [HALVES_DIR]');
    return 2;
  }
  const out = argv[1];
  const halves = argv[2] ?? null;
  const cubes = [];
  for (const info of CUBES) {
    if (!existsSync(join(ROOT, 'public/cubes', `${info.file}.meta.json`))) continue;
    const full = info.humanData ? loadHuman(join(ROOT, 'public/cubes', `${info.file}.human.json`)) : null;
    const half = [0, 1].map((h) => (info.humanData && halves ? loadHuman(join(halves, `${info.file}.human.half${h}.json`)) : null));
    const ctx = cubeContext(info, full);
    const halfCtx = half.map((d) => (d ? cubeContext(info, d) : null));
    const files = { full, half0: half[0], half1: half[1] };
    const cards = ctx.cube.cards.map((c) => {
      const f = ctx.facts.get(c.name)!;
      const m = metaValue(c.name, ctx);
      const human: Record<string, [number, number]> = {};
      for (const [k, d] of Object.entries(files)) {
        const r = d?.cards[c.name];
        if (r) human[k] = [r.gih, r.gihW];
      }
      return {
        name: c.name,
        land: !!(f.land || c.land),
        colors: f.colors,
        creature: f.creature,
        mv: f.mv,
        factsSource: f.source,
        prior: cardPrior(c.name, ctx),
        labGames: m ? m.games : 0,
        labRate: m ? m.rawRate : null,
        labValue: labValue(c.name, ctx),
        cardValue: cardValue(c.name, ctx),
        cardValueHalf0: halfCtx[0] ? cardValue(c.name, halfCtx[0]) : null,
        cardValueHalf1: halfCtx[1] ? cardValue(c.name, halfCtx[1]) : null,
        human,
      };
    });
    const avg = Object.fromEntries(Object.entries(files).filter(([, d]) => d).map(([k, d]) => [k, d!.gih.wins / d!.gih.games]));
    cubes.push({ id: info.id, file: info.file, anchor: full?.anchor ?? null, humanAvg: avg, cards });
    console.log(`${info.id}: ${cards.length} cards, ${cards.filter((c) => !c.land && c.labGames > 0).length} nonland with lab games, ${cards.filter((c) => !c.land && c.human.full).length} nonland with a human row`);
  }
  writeFileSync(out, JSON.stringify({ schema: 1, cubes }) + '\n');
  return 0;
}
