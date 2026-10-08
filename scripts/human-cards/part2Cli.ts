/*
 * ForgeCoach — scripts/human-cards/part2Cli.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * docs/human-blend.md part 2, launched by blendCli.ts:
 *   `npm run human-blend -- --cube <id> DIR`  A: should this cube blend the overlap cards?
 *   `npm run human-blend -- agree DIR`         B: the lab-vs-human agreement by band (labTrust.ts's table)
 * DIR holds the generator's `--out` files: `<file>.human.json` and
 * `<file>.human.half0|1.json` (`npm run human-cards -- … [--half 0|1] --out DIR`).
 * Uses the shipped cube documents and metas and the tests' Scryfall snapshots.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mapScryfallCard, type CardInfo, type ScryfallCard } from '../../src/cards.ts';
import { cubeInfo, type CubeInfo } from '../../src/cube/cubes.ts';
import { parseCube } from '../../src/cube/parseCube.ts';
import { parseMeta } from '../../src/cube/meta.ts';
import { parseHumanCards, type HumanCards } from '../../src/cube/human.ts';
import { bandsOf, levelOf, MIN_BAND, type BandAgreement, type TrustBand } from '../../src/cube/labTrust.ts';
import { blendedValue, cardValue, HUMAN_DISCOUNT, humanValue, labValue, makeContext, metaValue, type CubeContext } from '../../src/cube/score.ts';
import { bootstrapRho, pairedBootstrap, spearman, type RhoResult } from './blendTest.ts';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const MIN_TARGET = 500;
const MIN_CARDS = 30;

export function cubeContext(info: CubeInfo, human: HumanCards | null): CubeContext {
  const cube = parseCube(readFileSync(join(ROOT, 'public/cubes', `${info.file}.md`), 'utf8'));
  const raw = JSON.parse(readFileSync(join(ROOT, `src/cube/testdata/scryfall-${info.id}.json`), 'utf8')) as ScryfallCard[];
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
  const metaPath = join(ROOT, 'public/cubes', `${info.file}.meta.json`);
  const meta = existsSync(metaPath) ? parseMeta(JSON.parse(readFileSync(metaPath, 'utf8'))) : null;
  return makeContext(cube, infos, meta, human);
}

const f3 = (x: number) => (x >= 0 ? '+' : '') + x.toFixed(3);
const rhoText = (r: RhoResult) => `n=${r.n} rho ${f3(r.rho)} [${f3(r.lo)}, ${f3(r.hi)}]`;
const load = (p: string) => parseHumanCards(JSON.parse(readFileSync(p, 'utf8')));
const nonland = (ctx: CubeContext, n: string) => !ctx.facts.get(n)?.land && !ctx.byName.get(n)?.land;
const gihRate = (d: HumanCards, n: string) => d.cards[n]!.gihW / d.cards[n]!.gih;

/** Condition 2: the lab's win rate in this cube against the full file's GIH WR, nonland overlap cards with lab games. */
export function transfer(ctx: CubeContext, full: HumanCards): RhoResult | null {
  if (!ctx.meta) return null;
  const names = ctx.cube.cards.map((c) => c.name).filter((n) => nonland(ctx, n) && (full.cards[n]?.gih ?? 0) >= MIN_TARGET && metaValue(n, ctx));
  return bootstrapRho(
    names.map((n) => metaValue(n, ctx)!.rawRate),
    names.map((n) => gihRate(full, n)),
  );
}

export async function cubeTest(id: string, dir: string): Promise<number> {
  const info = cubeInfo(id);
  if (!info) {
    console.error(`human-blend: no cube "${id}"`);
    return 2;
  }
  const at = (suffix: string) => join(dir, `${info.file}.human${suffix}.json`);
  const halves = [load(at('.half0')), load(at('.half1'))];
  const full = load(at(''));
  if (id !== 'vintage' && halves.some((h) => h.anchor !== 'cube')) {
    console.error('human-blend: these half files lack anchor "cube" (regenerate them with this generator)');
    return 2;
  }
  const today = cubeContext(info, null);
  console.log(`${info.title}: ${today.meta ? 'shipped lab meta' : 'no lab meta'}; full file ${full.games} games, ${Object.keys(full.cards).length} cube cards with ${MIN_TARGET}+ games in hand`);
  const verdicts: boolean[] = [];
  for (const [fold, a, b] of [
    [1, 0, 1],
    [2, 1, 0],
  ] as const) {
    const A = halves[a]!;
    const B = halves[b]!;
    const ctxA = cubeContext(info, A);
    const names = today.cube.cards.map((c) => c.name).filter((n) => nonland(today, n) && (B.cards[n]?.gih ?? 0) >= MIN_TARGET);
    const target = names.map((n) => gihRate(B, n));
    const base = names.map((n) => cardValue(n, today));
    const blend = names.map((n) => cardValue(n, ctxA));
    const res = pairedBootstrap(target, blend, base);
    const pass = res.n >= MIN_CARDS && res.lo > 0;
    verdicts.push(pass);
    console.log(`\nFold ${fold}: A = half ${a} (${A.games} games), B = half ${b} (${B.games} games); ${res.n} target cards, ${names.filter((n) => humanValue(n, ctxA)).length} with half-A human data`);
    console.log(`  rho(today, B) = ${res.rhoBase.toFixed(3)}   rho(blend anchored D=${HUMAN_DISCOUNT}, B) = ${res.rhoScore.toFixed(3)}`);
    console.log(`  difference ${f3(res.diff)}  95% [${f3(res.lo)}, ${f3(res.hi)}]  → ${pass ? 'condition 1 holds in this fold' : 'condition 1 fails in this fold'}`);
    const variant = (label: string, score: (n: string) => number | null) => {
      const keep = names.map((n, i) => [n, i] as const).filter(([n]) => score(n) !== null);
      const r = pairedBootstrap(
        keep.map(([, i]) => target[i]!),
        keep.map(([n]) => score(n)!),
        keep.map(([, i]) => base[i]!),
      );
      console.log(`  info: ${label.padEnd(30)} n=${String(r.n).padStart(3)} rho ${r.rhoScore.toFixed(3)} vs today ${r.rhoBase.toFixed(3)}: ${f3(r.diff)} [${f3(r.lo)}, ${f3(r.hi)}]`);
    };
    variant('blend unanchored (part 1)', (n) => blendedValue(n, ctxA, HUMAN_DISCOUNT, false) ?? labValue(n, ctxA));
    variant('human only (half A GIH WR)', (n) => (A.cards[n] && humanValue(n, ctxA) ? gihRate(A, n) : null));
    console.log(`  info: split-half rho on the targets in both halves = ${spearman(
      names.filter((n) => A.cards[n]).map((n) => gihRate(A, n)),
      names.filter((n) => A.cards[n]).map((n) => gihRate(B, n)),
    ).toFixed(3)}`);
  }
  const c1 = verdicts.every(Boolean);
  const t = transfer(today, full);
  const c2 = !!t && t.n >= MIN_CARDS && t.lo > 0;
  console.log(`\nCondition 2 (transfer: lab win rate in this cube vs full-file human GIH WR): ${t ? rhoText(t) : 'no lab meta — cannot be shown'} → ${c2 ? 'holds' : 'fails'}`);
  const ctxFull = cubeContext(info, full);
  const shift = (anchored: boolean) => {
    const ns = today.cube.cards.map((c) => c.name).filter((n) => humanValue(n, ctxFull));
    const d = ns.map((n) => (blendedValue(n, ctxFull, HUMAN_DISCOUNT, anchored) ?? 0) - labValue(n, today));
    const mean = d.reduce((s, x) => s + x, 0) / (d.length || 1);
    const abs = d.reduce((s, x) => s + Math.abs(x), 0) / (d.length || 1);
    return `${ns.length} cards, mean ${f3(mean)} points, mean |change| ${abs.toFixed(2)}, range ${f3(Math.min(...d))} to ${f3(Math.max(...d))}`;
  };
  console.log(`info: value change with the full file, anchored: ${shift(true)}`);
  console.log(`info: value change with the full file, unanchored: ${shift(false)}`);
  console.log(`\nDecision (pre-registered: condition 1 in both folds and condition 2): ${c1 && c2 ? 'ADOPT for this cube' : 'SKIP this cube (no human file)'}`);
  return 0;
}

const ALL_BANDS: TrustBand[] = ['all', 'creature', 'noncreature', 'mv2', 'mv34', 'mv5', 'colourless'];

function bandRows(ctx: CubeContext, human: HumanCards): Array<{ bands: Set<TrustBand>; lab: number; hum: number }> {
  return ctx.cube.cards
    .map((c) => c.name)
    .filter((n) => nonland(ctx, n) && human.cards[n] && metaValue(n, ctx))
    .map((n) => ({ bands: new Set<TrustBand>(['all', ...bandsOf(ctx.facts.get(n)!)]), lab: metaValue(n, ctx)!.rawRate, hum: gihRate(human, n) }));
}

export async function agree(dir: string): Promise<number> {
  const vintage = cubeInfo('vintage')!;
  const shipped = load(join(ROOT, 'public/cubes', `${vintage.file}.human.json`));
  const rows = bandRows(cubeContext(vintage, shipped), shipped);
  const table: BandAgreement[] = [];
  console.log(`Vintage: ${rows.length} nonland cards with a human row and lab games (primary; bands need ${MIN_BAND}+ cards)`);
  for (const band of ALL_BANDS) {
    const rs = rows.filter((r) => r.bands.has(band));
    if (rs.length < 3) {
      console.log(`  ${band.padEnd(12)} n=${rs.length} — too few to compute`);
      continue;
    }
    const r = bootstrapRho(
      rs.map((x) => x.lab),
      rs.map((x) => x.hum),
    );
    const used = r.n >= MIN_BAND;
    console.log(`  ${band.padEnd(12)} ${rhoText(r)} → ${levelOf(r)}${used ? '' : ' (under the minimum: no level)'}`);
    // Under-minimum bands go in the table too, so a card in one is labelled "untested", never another band's level.
    table.push({ band, n: r.n, rho: +r.rho.toFixed(3), lo: +r.lo.toFixed(3), hi: +r.hi.toFixed(3) });
  }
  // Reported, not used: the other cubes with a meta, overlap cards against their own meta, pooled by Fisher z.
  const others = ['modern-era', 'synergy', 'pauper'].map((id) => cubeInfo(id)!).filter((i) => existsSync(join(dir, `${i.file}.human.json`)));
  if (others.length) {
    console.log(`\ninfo (not used): ${others.map((o) => o.id).join(', ')} pooled (Fisher z, weights n − 3, normal 95% interval)`);
    const sets = others.map((o) => {
      const full = load(join(dir, `${o.file}.human.json`));
      return bandRows(cubeContext(o, full), full);
    });
    for (const band of ALL_BANDS) {
      let wz = 0;
      let w = 0;
      let n = 0;
      const parts: string[] = [];
      for (const [i, rs0] of sets.entries()) {
        const rs = rs0.filter((x) => x.bands.has(band));
        if (rs.length < 8) continue;
        const r = bootstrapRho(
          rs.map((x) => x.lab),
          rs.map((x) => x.hum),
          { resamples: 2000 },
        );
        const z = Math.atanh(Math.max(-0.999, Math.min(0.999, r.rho)));
        wz += (rs.length - 3) * z;
        w += rs.length - 3;
        n += rs.length;
        parts.push(`${others[i]!.id} ${rhoText(r)}`);
      }
      if (!w) continue;
      const z = wz / w;
      const se = 1 / Math.sqrt(w);
      console.log(`  ${band.padEnd(12)} pooled n=${n} rho ${f3(Math.tanh(z))} [${f3(Math.tanh(z - 1.96 * se))}, ${f3(Math.tanh(z + 1.96 * se))}]   (${parts.join('; ')})`);
    }
  }
  console.log('\nlabTrust.ts LAB_AGREEMENT:');
  for (const t of table) console.log(`  { band: '${t.band}', n: ${t.n}, rho: ${t.rho}, lo: ${t.lo}, hi: ${t.hi} },`);
  return 0;
}
