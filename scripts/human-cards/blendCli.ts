/*
 * ForgeCoach — scripts/human-cards/blendCli.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * `npm run human-blend -- HALF0.json HALF1.json` (launched by run.mjs): runs
 * docs/human-blend.md's pre-registered split-half test on the Vintage cube from
 * the two half files the generator writes (`npm run human-cards -- --half 0|1
 * --out DIR …`). Prints both folds, the decision, and the informational
 * variants. Uses the shipped cube document and meta and the tests' Scryfall
 * snapshot, so today's value is the one the deck assistant computes.
 * Part 2 (`--cube <id> DIR`, `agree DIR`) is in part2Cli.ts, part 3 (`colour`) in part3Cli.ts.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mapScryfallCard, type CardInfo, type ScryfallCard } from '../../src/cards.ts';
import { parseCube } from '../../src/cube/parseCube.ts';
import { parseMeta } from '../../src/cube/meta.ts';
import { parseHumanCards, type HumanCards } from '../../src/cube/human.ts';
import { blendedValue, cardPrior, cardValue, HUMAN_DISCOUNT, humanValue, labValue, makeContext, metaValue, type CubeContext } from '../../src/cube/score.ts';
import { pairedBootstrap, spearman } from './blendTest.ts';
import { agree, cubeTest } from './part2Cli.ts';
import { colourTest } from './part3Cli.ts';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const MIN_TARGET = 500;

function vintage(human: HumanCards | null): CubeContext {
  const cube = parseCube(readFileSync(join(ROOT, 'public/cubes/vintage-cube-180.md'), 'utf8'));
  const raw = JSON.parse(readFileSync(join(ROOT, 'src/cube/testdata/scryfall-vintage.json'), 'utf8')) as ScryfallCard[];
  const idx = new Map<string, ScryfallCard>();
  for (const c of raw) {
    if (c.name) idx.set(c.name, c);
    for (const f of c.card_faces ?? []) if (f.name && !idx.has(f.name)) idx.set(f.name, c);
  }
  const infos = new Map<string, CardInfo>();
  for (const card of cube.cards) {
    const c = idx.get(card.name);
    if (c) infos.set(card.name, mapScryfallCard(card.name, c));
  }
  const meta = parseMeta(JSON.parse(readFileSync(join(ROOT, 'public/cubes/vintage-cube-180.meta.json'), 'utf8')));
  return makeContext(cube, infos, meta, human);
}

const f3 = (x: number) => (x >= 0 ? '+' : '') + x.toFixed(3);

export async function main(argv: string[]): Promise<number> {
  if (argv[0] === '--cube' && argv.length === 3) return cubeTest(argv[1]!, argv[2]!);
  if (argv[0] === 'agree' && argv.length === 2) return agree(argv[1]!);
  if (argv[0] === 'colour' && argv.length === 1) return colourTest();
  if (argv.length !== 2) {
    console.error('usage: npm run human-blend -- vintage-cube-180.human.half0.json vintage-cube-180.human.half1.json\n       npm run human-blend -- --cube <id> DIR   (docs/human-blend.md part 2 A)\n       npm run human-blend -- agree DIR         (part 2 B)\n       npm run human-blend -- colour            (part 3)');
    return 2;
  }
  const halves = argv.map((p) => parseHumanCards(JSON.parse(readFileSync(p, 'utf8'))));
  const today = vintage(null);
  const verdicts: boolean[] = [];
  for (const [fold, a, b] of [
    [1, 0, 1],
    [2, 1, 0],
  ] as const) {
    const A = halves[a]!;
    const B = halves[b]!;
    const ctxA = vintage(A);
    const names = today.cube.cards
      .map((c) => c.name)
      .filter((n) => !today.facts.get(n)?.land && !today.byName.get(n)?.land && (B.cards[n]?.gih ?? 0) >= MIN_TARGET);
    const target = names.map((n) => B.cards[n]!.gihW / B.cards[n]!.gih);
    const base = names.map((n) => cardValue(n, today));
    const blend = names.map((n) => cardValue(n, ctxA));
    const withA = names.filter((n) => humanValue(n, ctxA)).length;
    const res = pairedBootstrap(target, blend, base);
    const pass = res.lo > 0;
    verdicts.push(pass);
    console.log(`\nFold ${fold}: A = half ${a} (${A.games} games), B = half ${b} (${B.games} games); ${res.n} target cards, ${withA} with half-A human data`);
    console.log(`  rho(today, B) = ${res.rhoBase.toFixed(3)}   rho(blend D=${HUMAN_DISCOUNT}, B) = ${res.rhoScore.toFixed(3)}`);
    console.log(`  difference ${f3(res.diff)}  95% [${f3(res.lo)}, ${f3(res.hi)}]  → ${pass ? 'lower end above 0' : 'lower end not above 0'}`);
    // Informational variants (not used for the decision).
    const variant = (label: string, score: (n: string) => number | null) => {
      const keep = names.map((n, i) => [n, i] as const).filter(([n]) => score(n) !== null);
      const r = pairedBootstrap(
        keep.map(([, i]) => target[i]!),
        keep.map(([n]) => score(n)!),
        keep.map(([, i]) => base[i]!),
      );
      console.log(`  info: ${label.padEnd(30)} n=${String(r.n).padStart(3)} rho ${r.rhoScore.toFixed(3)} vs today ${r.rhoBase.toFixed(3)}: ${f3(r.diff)} [${f3(r.lo)}, ${f3(r.hi)}]`);
    };
    variant('blend D=0.6', (n) => blendedValue(n, ctxA, 0.6) ?? labValue(n, ctxA));
    variant('blend D=1.0', (n) => blendedValue(n, ctxA, 1.0) ?? labValue(n, ctxA));
    variant('equal weight (H = K + g), D=0.8', (n) => {
      const h = humanValue(n, ctxA);
      return h ? (labValue(n, ctxA) + h.value) / 2 : labValue(n, ctxA);
    });
    variant('human only (half A GIH WR)', (n) => humanValue(n, ctxA)?.value ?? null);
    variant('lab only (cards with lab games)', (n) => metaValue(n, ctxA)?.value ?? null);
    variant('prior only', (n) => cardPrior(n, ctxA));
    console.log(`  info: rho(half A GIH WR, half B GIH WR) on cards in both = ${spearman(
      names.filter((n) => A.cards[n]).map((n) => A.cards[n]!.gihW / A.cards[n]!.gih),
      names.filter((n) => A.cards[n]).map((n) => B.cards[n]!.gihW / B.cards[n]!.gih),
    ).toFixed(3)}`);
  }
  const adopt = verdicts.every(Boolean);
  console.log(`\nDecision (pre-registered: lower end above 0 in both folds): ${adopt ? 'ADOPT the blend' : 'KEEP display only'}`);
  return 0;
}
