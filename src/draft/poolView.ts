/*
 * ForgeCoach — draft/poolView.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * A drafted pool laid out for the eye: columns by mana value (lands last) or
 * by colour, each sorted by colour then mana value then name, with duplicates
 * stacked as one entry and a count. Also the curve, the colour pip counts and
 * the one-line type summary ("9 creatures · 4 instants · 2 lands").
 */
import { BASIC_NAMES } from '../cube/colors.ts';
import type { CubeContext } from '../cube/score.ts';

export type PoolSort = 'curve' | 'colour' | 'picks';

export interface PoolEntry {
  name: string;
  count: number;
}

export interface PoolColumn {
  key: string;
  label: string;
  entries: PoolEntry[];
  /** Cards in the column, duplicates counted. */
  size: number;
}

const COLOUR_ORDER = ['W', 'U', 'B', 'R', 'G', 'M', 'C', 'L'];
const COLOUR_LABEL: Record<string, string> = { W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green', M: 'Gold', C: 'Colourless', L: 'Lands' };

/** W, U, B, R, G; M for gold; C for colourless; L for lands. */
export function colourKey(name: string, ctx: CubeContext): string {
  const f = ctx.facts.get(name);
  if (f?.land || BASIC_NAMES.has(name)) return 'L';
  const c = f?.colors ?? ctx.byName.get(name)?.colorHint ?? '';
  if (c.length > 1) return 'M';
  return c || 'C';
}

const mvOf = (n: string, ctx: CubeContext) => ctx.facts.get(n)?.mv ?? 0;

function stack(names: string[]): PoolEntry[] {
  const out: PoolEntry[] = [];
  const at = new Map<string, PoolEntry>();
  for (const n of names) {
    const e = at.get(n);
    if (e) e.count++;
    else {
      const ne = { name: n, count: 1 };
      at.set(n, ne);
      out.push(ne);
    }
  }
  return out;
}

function byColourThenMv(ctx: CubeContext) {
  return (a: string, b: string) =>
    COLOUR_ORDER.indexOf(colourKey(a, ctx)) - COLOUR_ORDER.indexOf(colourKey(b, ctx)) || mvOf(a, ctx) - mvOf(b, ctx) || (a < b ? -1 : a > b ? 1 : 0);
}

export function poolColumns(pool: string[], ctx: CubeContext, sort: PoolSort): PoolColumn[] {
  const cols: PoolColumn[] = [];
  const add = (key: string, label: string, names: string[]) => {
    if (names.length) cols.push({ key, label, entries: stack(names), size: names.length });
  };
  if (sort === 'picks') {
    // Pick order, in rows of eight.
    for (let i = 0; i < pool.length; i += 8) add(`p${i}`, `Picks ${i + 1}–${Math.min(pool.length, i + 8)}`, pool.slice(i, i + 8));
    return cols;
  }
  const sorted = [...pool].sort(byColourThenMv(ctx));
  if (sort === 'colour') {
    for (const k of COLOUR_ORDER) add(k, COLOUR_LABEL[k] ?? k, sorted.filter((n) => colourKey(n, ctx) === k));
    return cols;
  }
  const spells = sorted.filter((n) => colourKey(n, ctx) !== 'L');
  for (let mv = 0; mv <= 6; mv++) {
    const names = spells.filter((n) => (mv === 6 ? mvOf(n, ctx) >= 6 : mvOf(n, ctx) === mv));
    add(`mv${mv}`, mv === 6 ? '6+' : String(mv), names);
  }
  add('L', 'Lands', sorted.filter((n) => colourKey(n, ctx) === 'L'));
  return cols;
}

/** Spells by mana value buckets 1, 2, 3, 4, 5, 6+ (0 counts as 1). */
export function curveOf(pool: string[], ctx: CubeContext): number[] {
  const c = [0, 0, 0, 0, 0, 0];
  for (const n of pool) {
    if (colourKey(n, ctx) === 'L') continue;
    const i = Math.min(5, Math.max(0, mvOf(n, ctx) - 1));
    c[i] = (c[i] ?? 0) + 1;
  }
  return c;
}

/** Cards of each colour (a gold card counts for each of its colours). */
export function colourCounts(pool: string[], ctx: CubeContext): Record<string, number> {
  const out: Record<string, number> = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  for (const n of pool) {
    const f = ctx.facts.get(n);
    if (!f || f.land) continue;
    for (const c of f.colors) if (c in out) out[c] = (out[c] ?? 0) + 1;
  }
  return out;
}

const TYPES: Array<[string, string, (t: string) => boolean]> = [
  ['creature', 'creatures', (t) => /\bCreature\b/.test(t)],
  ['planeswalker', 'planeswalkers', (t) => /\bPlaneswalker\b/.test(t)],
  ['instant', 'instants', (t) => /\bInstant\b/.test(t)],
  ['sorcery', 'sorceries', (t) => /\bSorcery\b/.test(t)],
  ['artifact', 'artifacts', (t) => /\bArtifact\b/.test(t)],
  ['enchantment', 'enchantments', (t) => /\bEnchantment\b/.test(t)],
  ['land', 'lands', (t) => /\bLand\b/.test(t)],
];

/** "9 creatures · 4 instants · 2 lands" — each card counted once, by its first matching type. */
export function typeSummary(pool: string[], ctx: CubeContext): string {
  const counts = new Map<string, number>();
  let other = 0;
  for (const n of pool) {
    const f = ctx.facts.get(n);
    const t = f?.typeLine ?? (f?.land ? 'Land' : '');
    const hit = TYPES.find(([, , test]) => test(t));
    if (hit) counts.set(hit[0], (counts.get(hit[0]) ?? 0) + 1);
    else other++;
  }
  const parts = TYPES.filter(([k]) => counts.get(k)).map(([k, pl]) => `${counts.get(k)} ${counts.get(k) === 1 ? k : pl}`);
  if (other) parts.push(`${other} other`);
  return parts.join(' · ');
}


