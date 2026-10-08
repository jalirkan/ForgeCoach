/*
 * ForgeCoach — scripts/human-cards/part3Cli.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * docs/human-blend.md part 3, launched by blendCli.ts:
 *   `npm run human-blend -- colour`  the pre-registered test of the lab's per-colour correction
 * Uses the shipped cube documents, metas and human files and the tests' Scryfall snapshots.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cubeInfo } from '../../src/cube/cubes.ts';
import { parseHumanCards, type HumanCards } from '../../src/cube/human.ts';
import { labValue, metaValue, type CubeContext } from '../../src/cube/score.ts';
import { adjustedLabValue, colourOffset, colourOffsetsOf } from './colourOffsets.ts';
import { pairedBootstrap, spearman } from './blendTest.ts';
import { cubeContext } from './part2Cli.ts';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const f3 = (x: number) => (x >= 0 ? '+' : '') + x.toFixed(3);
const nonland = (ctx: CubeContext, n: string) => !ctx.facts.get(n)?.land && !ctx.byName.get(n)?.land;

function humanFile(file: string): HumanCards {
  return parseHumanCards(JSON.parse(readFileSync(join(ROOT, 'public/cubes', `${file}.human.json`), 'utf8')));
}

/** The test set: nonland cube cards with a usable (0 < p < 1) row in the human file. */
function targets(ctx: CubeContext, human: HumanCards): string[] {
  return ctx.cube.cards
    .map((c) => c.name)
    .filter((n) => {
      const r = human.cards[n];
      if (!r || r.gih <= 0 || !nonland(ctx, n)) return false;
      const p = r.gihW / r.gih;
      return p > 0 && p < 1;
    });
}

/** Alternative estimator (reported only): mono-coloured nonland cards' pooled lab rate minus all nonland cards'. */
function cardPoolOffsets(ctx: CubeContext): Map<string, number> {
  let G = 0;
  let W = 0;
  const per = new Map<string, { g: number; w: number }>();
  for (const c of ctx.cube.cards) {
    if (!nonland(ctx, c.name)) continue;
    const s = ctx.meta?.meta.cards[c.name];
    if (!s || typeof s.games !== 'number' || s.games <= 0 || typeof s.wins !== 'number') continue;
    G += s.games;
    W += s.wins;
    const cols = ctx.facts.get(c.name)?.colors ?? '';
    if (cols.length !== 1) continue;
    const a = per.get(cols) ?? { g: 0, w: 0 };
    a.g += s.games;
    a.w += s.wins;
    per.set(cols, a);
  }
  return new Map([...per].map(([c, s]) => [c, s.w / s.g - W / G]));
}

const offText = (m: Map<string, number> | null) => (m ? ['W', 'U', 'B', 'R', 'G'].map((c) => `${c} ${m.has(c) ? f3(m.get(c)!) : '—'}`).join('  ') : 'none');

export async function colourTest(): Promise<number> {
  console.log('Offsets δ_c (pre-registered estimator: colour deck win rate − pooled):');
  for (const id of ['vintage', 'synergy', 'modern-era', 'pauper']) {
    const ctx = cubeContext(cubeInfo(id)!, null);
    console.log(`  ${id.padEnd(11)} ${offText(ctx.meta ? colourOffsetsOf(ctx.meta.meta) : null)}`);
    console.log(`  ${''.padEnd(11)} info, mono-coloured card pool: ${offText(cardPoolOffsets(ctx))}`);
  }
  const verdict: Record<string, { diff: number; lo: number }> = {};
  for (const id of ['vintage', 'synergy']) {
    const info = cubeInfo(id)!;
    const human = humanFile(info.file);
    const ctx = cubeContext(info, null);
    const names = targets(ctx, human);
    const target = names.map((n) => human.cards[n]!.gihW / human.cards[n]!.gih);
    const base = names.map((n) => labValue(n, ctx));
    const adj = names.map((n) => adjustedLabValue(n, ctx));
    const res = pairedBootstrap(target, adj, base);
    verdict[id] = res;
    console.log(`\n${info.title}: ${res.n} nonland cards with a human row`);
    console.log(`  rho(uncorrected) = ${res.rhoBase.toFixed(3)}   rho(corrected) = ${res.rhoScore.toFixed(3)}`);
    console.log(`  difference ${f3(res.diff)}  95% [${f3(res.lo)}, ${f3(res.hi)}]`);
    const withLab = names.filter((n) => metaValue(n, ctx));
    const t2 = withLab.map((n) => human.cards[n]!.gihW / human.cards[n]!.gih);
    const raw = withLab.map((n) => metaValue(n, ctx)!.rawRate);
    const rawAdj = withLab.map((n) => metaValue(n, ctx)!.rawRate - colourOffset(n, ctx));
    console.log(`  info: raw lab rate, n=${withLab.length}: rho ${spearman(raw, t2).toFixed(3)} → corrected ${spearman(rawAdj, t2).toFixed(3)}`);
    const alt = cardPoolOffsets(ctx);
    const altOff = (n: string) => {
      const cs = (ctx.facts.get(n)?.colors ?? '').split('').filter((c) => alt.has(c));
      return cs.length ? cs.reduce((s, c) => s + alt.get(c)!, 0) / cs.length : 0;
    };
    console.log(`  info: raw lab rate with the card-pool offsets: rho ${spearman(withLab.map((n) => metaValue(n, ctx)!.rawRate - altOff(n)), t2).toFixed(3)}`);
    const mono = new Map<string, { g: number; w: number; k: number }>();
    for (const n of names) {
      const cs = ctx.facts.get(n)?.colors ?? '';
      const key = cs.length === 0 ? 'C' : cs.length === 1 ? cs : 'M';
      const a = mono.get(key) ?? { g: 0, w: 0, k: 0 };
      a.g += human.cards[n]!.gih;
      a.w += human.cards[n]!.gihW;
      a.k++;
      mono.set(key, a);
    }
    console.log(`  info: human pooled GIH WR by colour: ${['W', 'U', 'B', 'R', 'G', 'M', 'C'].filter((c) => mono.has(c)).map((c) => `${c} ${(mono.get(c)!.w / mono.get(c)!.g).toFixed(3)} (${mono.get(c)!.k})`).join('  ')}; all ${(human.gih.wins / human.gih.games).toFixed(3)}`);
  }
  const pass = verdict.vintage!.lo > 0 && verdict.synergy!.diff >= 0;
  console.log(`\nDecision (pre-registered: Vintage lower end > 0 and Synergy difference ≥ 0): ${pass ? 'SHIP the correction' : 'SHIP NOTHING'}`);
  return 0;
}
