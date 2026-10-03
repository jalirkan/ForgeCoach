/*
 * ForgeCoach — draft/poolView.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * A collection of cards laid out for the eye (a pool, a deck, a cube): groups
 * by mana value (lands last), type, colour, rarity or none; each group sorted
 * by colour, then mana value, then name; duplicates stacked as one entry with
 * a count. Also the curve, colour counts and the one-line type summary
 * ("9 creatures · 4 instants · 2 lands"). Pure: what a card is comes from a
 * lookup the caller provides (cube facts, Scryfall data).
 */
import { BASIC_NAMES } from '../cube/colors.ts';
import type { CubeContext } from '../cube/score.ts';

export type GroupBy = 'cmc' | 'type' | 'color' | 'rarity' | 'none';
export type Layout = 'stacks' | 'gallery' | 'list';

export interface CardMeta {
  mv: number;
  /** WUBRG letters; '' for colourless and lands. */
  colors: string;
  land: boolean;
  typeLine: string;
  rarity?: string;
}

export type MetaOf = (name: string) => CardMeta;

/** What a card is, from the cube's facts (and Scryfall's rarity when known). */
export function metaFromCube(ctx: CubeContext, rarityOf?: (name: string) => string | undefined): MetaOf {
  return (name) => {
    const f = ctx.facts.get(name);
    const basic = BASIC_NAMES.has(name);
    return {
      mv: f?.mv ?? 0,
      colors: f?.colors ?? ctx.byName.get(name)?.colorHint ?? '',
      land: basic || (f?.land ?? ctx.byName.get(name)?.land ?? false),
      typeLine: f?.typeLine || (basic ? 'Basic Land' : f?.land ? 'Land' : ''),
      rarity: basic ? 'basic' : rarityOf?.(name),
    };
  };
}

export interface Entry {
  name: string;
  count: number;
}

export interface Group {
  key: string;
  label: string;
  entries: Entry[];
  /** Cards in the group, duplicates counted. */
  size: number;
}

const COLOUR_KEYS = ['W', 'U', 'B', 'R', 'G', 'M', 'C', 'L'];
const COLOUR_LABEL: Record<string, string> = { W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green', M: 'Multicolour', C: 'Colourless', L: 'Land' };
const TYPE_KEYS: Array<[string, string, RegExp]> = [
  ['creature', 'Creature', /\bCreature\b/],
  ['planeswalker', 'Planeswalker', /\bPlaneswalker\b/],
  ['instant', 'Instant', /\bInstant\b/],
  ['sorcery', 'Sorcery', /\bSorcery\b/],
  ['artifact', 'Artifact', /\bArtifact\b/],
  ['enchantment', 'Enchantment', /\bEnchantment\b/],
  ['battle', 'Battle', /\bBattle\b/],
  ['land', 'Land', /\bLand\b/],
];
const RARITY_KEYS: Array<[string, string]> = [
  ['mythic', 'Mythic'],
  ['rare', 'Rare'],
  ['uncommon', 'Uncommon'],
  ['common', 'Common'],
  ['special', 'Special'],
  ['basic', 'Basic'],
  ['unknown', 'Unknown'],
];

/** W, U, B, R, G; M for multicolour; C for colourless; L for lands. */
export function colourKeyOf(m: CardMeta): string {
  if (m.land) return 'L';
  if (m.colors.length > 1) return 'M';
  return m.colors || 'C';
}

export function typeKeyOf(m: CardMeta): string {
  const first = (m.typeLine.split(' // ')[0] ?? '') || (m.land ? 'Land' : '');
  return TYPE_KEYS.find(([, , re]) => re.test(first))?.[0] ?? 'other';
}

function stack(names: string[]): Entry[] {
  const out: Entry[] = [];
  const at = new Map<string, Entry>();
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

/** Colour, then mana value, then name. */
export function sortCards(names: string[], meta: MetaOf): string[] {
  return [...names].sort((a, b) => {
    const ma = meta(a);
    const mb = meta(b);
    return COLOUR_KEYS.indexOf(colourKeyOf(ma)) - COLOUR_KEYS.indexOf(colourKeyOf(mb)) || ma.mv - mb.mv || (a < b ? -1 : a > b ? 1 : 0);
  });
}

/**
 * The groups of a collection. `cmc`: 0 … 5+ for spells, then LAND; `type`,
 * `color`, `rarity`: the usual order; `none`: one group. Empty groups are left
 * out unless `keepEmpty` (stacks keep their columns steady while drafting).
 */
export function groupCards(names: string[], meta: MetaOf, by: GroupBy, keepEmpty = false): Group[] {
  const sorted = sortCards(names, meta);
  const out: Group[] = [];
  const add = (key: string, label: string, list: string[]) => {
    if (list.length || keepEmpty) out.push({ key, label, entries: stack(list), size: list.length });
  };
  if (by === 'none') {
    add('all', 'All', sorted);
    return out;
  }
  if (by === 'cmc') {
    const spells = sorted.filter((n) => !meta(n).land);
    for (let mv = 0; mv <= 5; mv++) add(`mv${mv}`, mv === 5 ? '5+' : String(mv), spells.filter((n) => (mv === 5 ? meta(n).mv >= 5 : meta(n).mv === mv)));
    add('land', 'Land', sorted.filter((n) => meta(n).land));
    return out;
  }
  if (by === 'color') {
    for (const k of COLOUR_KEYS) add(k, COLOUR_LABEL[k] ?? k, sorted.filter((n) => colourKeyOf(meta(n)) === k));
    return out;
  }
  if (by === 'type') {
    for (const [k, label] of [...TYPE_KEYS.map(([k, l]) => [k, l] as [string, string]), ['other', 'Other'] as [string, string]]) add(k, label, sorted.filter((n) => typeKeyOf(meta(n)) === k));
    return out;
  }
  for (const [k, label] of RARITY_KEYS) {
    add(
      k,
      label,
      sorted.filter((n) => {
        const r = meta(n).rarity ?? 'unknown';
        return (RARITY_KEYS.some(([x]) => x === r) ? r : 'special') === k;
      }),
    );
  }
  return out;
}

/** Spells by mana value 0, 1, … 5, 6+ (seven buckets). */
export function curveOf(names: string[], meta: MetaOf): number[] {
  const c = [0, 0, 0, 0, 0, 0, 0];
  for (const n of names) {
    const m = meta(n);
    if (m.land) continue;
    const i = Math.min(6, Math.max(0, m.mv));
    c[i] = (c[i] ?? 0) + 1;
  }
  return c;
}

/** Cards of each colour (a gold card counts for each of its colours). */
export function colourCounts(names: string[], meta: MetaOf): Record<string, number> {
  const out: Record<string, number> = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  for (const n of names) {
    const m = meta(n);
    if (m.land) continue;
    for (const c of m.colors) if (c in out) out[c] = (out[c] ?? 0) + 1;
  }
  return out;
}

/** Creatures, other spells and lands: the stat bar's three numbers. */
export function kindCounts(names: string[], meta: MetaOf): { creatures: number; spells: number; lands: number } {
  let creatures = 0;
  let spells = 0;
  let lands = 0;
  for (const n of names) {
    const m = meta(n);
    if (m.land) lands++;
    else if (/\bCreature\b/.test(m.typeLine.split(' // ')[0] ?? '')) creatures++;
    else spells++;
  }
  return { creatures, spells, lands };
}

/** "9 creatures · 4 instants · 2 lands" — each card counted once, by its first matching type. */
export function typeSummary(names: string[], meta: MetaOf): string {
  const counts = new Map<string, number>();
  for (const n of names) {
    const k = typeKeyOf(meta(n));
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const plural: Record<string, string> = { sorcery: 'sorceries', other: 'other' };
  const parts: string[] = [];
  for (const [k] of [...TYPE_KEYS, ['other'] as unknown as [string, string, RegExp]]) {
    const c = counts.get(k);
    if (c) parts.push(`${c} ${c === 1 ? k : (plural[k] ?? `${k}s`)}`);
  }
  return parts.join(' · ');
}
