/*
 * ForgeCoach — cube/metaView.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The Cube metagame page's data, DOM-free: archetype names ("WU-ETB" →
 * "Azorius ETB"), meta shares, sorting and search, the per-card table, the
 * win-rate interval strip's geometry, a sample decklist grouped by type, and
 * the card pairs that belong to an archetype's colours. Everything reads the
 * cube lab's meta.json (schema 1, see meta.ts) and nothing else.
 */
import { colourLabel, wubrg } from './colors.ts';
import type { CubeMeta, MetaArchetype, MetaCubeCard, MetaPair } from './meta.ts';

/** Short display names for the cube lab's theme codes. */
export const THEME_NAME: Record<string, string> = {
  ETB: 'ETB',
  FLK: 'Blink',
  ART: 'Artifacts',
  SPL: 'Spells',
  SAC: 'Sacrifice',
  GY: 'Graveyard',
  LND: 'Lands',
  TOK: 'Tokens',
  CTR: 'Counters',
  LIFE: 'Lifegain',
  RMP: 'Ramp',
  RAMP: 'Ramp',
  REAN: 'Reanimator',
  AGG: 'Aggro',
  CTRL: 'Control',
  EVA: 'Tempo',
  FAT: 'Big Threats',
};

/** "Sacrifice (\"aristocrats\")" → "Sacrifice"; "Tokens / go wide" → "Tokens". */
function shortTheme(name: string): string {
  return name.split(/\s+[/(]|\s+—\s+/)[0]?.trim() || name;
}

/**
 * An archetype's display name: the colours' guild/shard name plus the theme.
 * `docThemes` (code → name from the cube document's theme table) names codes
 * this module doesn't know.
 */
export function archetypeName(a: Pick<MetaArchetype, 'id' | 'colors' | 'primaryTheme'>, docThemes?: Record<string, string>): string {
  const colors = wubrg(a.colors || a.id.split('-')[0] || '');
  const theme = a.primaryTheme && a.primaryTheme !== 'none' ? a.primaryTheme : a.id.includes('-') ? a.id.split('-').slice(1).join('-') : '';
  const label = colourLabel(colors);
  if (!theme) return label;
  const t = THEME_NAME[theme] ?? (docThemes?.[theme] ? shortTheme(docThemes[theme]!) : theme);
  return `${label} ${t}`;
}

export interface ArchetypeRow {
  id: string;
  name: string;
  colors: string;
  theme: string | null;
  decks: number;
  /** decks / all archetype decks (0–1). */
  share: number;
  games: number;
  /**
   * The win rate shown: the data's shrunk rate when it has one, else the raw
   * rate shrunk here with the same prior (sample.shrinkage), else the raw rate.
   */
  win: number | null;
  /** The raw win rate (wins / games). */
  winRaw: number | null;
  shrunk: boolean;
  ci: [number, number] | null;
  keyCards: string[];
  avgLands: number | null;
  avgCurve: Array<{ mv: string; n: number }>;
  sampleDeck: string[] | null;
}

const num = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null);

function ciOf(x: unknown): [number, number] | null {
  return Array.isArray(x) && x.length === 2 && typeof x[0] === 'number' && typeof x[1] === 'number' ? [x[0], x[1]] : null;
}

const CURVE_ORDER = ['0', '1', '2', '3', '4', '5', '6', '6+', '7', '7+'];

/** The average curve as ordered bars ("1" … "6+"). */
export function curveBars(curve: Record<string, number> | undefined): Array<{ mv: string; n: number }> {
  if (!curve) return [];
  const keys = Object.keys(curve).sort((a, b) => {
    const ia = CURVE_ORDER.indexOf(a);
    const ib = CURVE_ORDER.indexOf(b);
    if (ia >= 0 && ib >= 0) return ia - ib;
    return parseFloat(a) - parseFloat(b);
  });
  return keys.map((mv) => ({ mv, n: num(curve[mv]) ?? 0 })).filter((b) => b.mv !== '0' || b.n > 0);
}

/** (wins + k·mean) / (games + k): the lab's shrinkage, for rows that only carry a raw rate. */
export function shrinkRate(winRate: number, games: number, strength: number, mean: number): number {
  return (winRate * games + strength * mean) / (games + strength);
}

export function archetypeRows(meta: CubeMeta, docThemes?: Record<string, string>): ArchetypeRow[] {
  const prior = shrinkage(meta);
  const total = meta.archetypes.reduce((s, a) => s + (num(a.decks) ?? 0), 0);
  return meta.archetypes.map((a) => {
    const raw = a as MetaArchetype & { winRateShrunk?: number };
    const shrunk = num(raw.winRateShrunk);
    const theme = a.primaryTheme && a.primaryTheme !== 'none' ? a.primaryTheme : null;
    const decks = num(a.decks) ?? 0;
    const games = num(a.games) ?? 0;
    const winRaw = num(a.winRate);
    const win = shrunk ?? (winRaw !== null && games > 0 ? shrinkRate(winRaw, games, prior.strength, prior.mean ?? 0.5) : winRaw);
    return {
      id: a.id,
      name: archetypeName(a, docThemes),
      colors: a.colors,
      theme,
      decks,
      share: total > 0 ? decks / total : 0,
      games,
      win,
      winRaw,
      shrunk: win !== winRaw,
      ci: ciOf(a.ci),
      keyCards: Array.isArray(a.keyCards) ? a.keyCards.filter((k) => typeof k === 'string') : [],
      avgLands: num(a.avgLands),
      avgCurve: curveBars(a.avgCurve),
      sampleDeck: Array.isArray(a.sampleDecks) && Array.isArray(a.sampleDecks[0]) ? a.sampleDecks[0] : null,
    };
  });
}

export type ArchetypeSort = 'share' | 'win' | 'games' | 'name';

export function sortArchetypes(rows: ArchetypeRow[], key: ArchetypeSort, desc = true): ArchetypeRow[] {
  const val = (r: ArchetypeRow): number | string => (key === 'share' ? r.decks : key === 'win' ? (r.win ?? -1) : key === 'games' ? r.games : r.name);
  const out = [...rows].sort((a, b) => {
    const va = val(a);
    const vb = val(b);
    const c = typeof va === 'string' ? va.localeCompare(vb as string) : va - (vb as number);
    // Ties: more games first, then name — stable whatever the direction.
    return c !== 0 ? (desc ? -c : c) : b.games - a.games || a.name.localeCompare(b.name);
  });
  return out;
}

/** Matches the archetype name, id, colours' name, or any key card (case-insensitive). */
export function searchArchetypes(rows: ArchetypeRow[], query: string): ArchetypeRow[] {
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((r) => r.name.toLowerCase().includes(q) || r.id.toLowerCase().includes(q) || r.keyCards.some((k) => k.toLowerCase().includes(q)));
}

/** The page's subtitle: "AI-vs-AI cube lab · 40 drafts · 95 games". */
export function metaSubtitle(meta: CubeMeta): string {
  const parts = ['AI-vs-AI cube lab'];
  const s = meta.sample;
  const fmt = (n: number, w: string) => `${n.toLocaleString('en-US')} ${w}${n === 1 ? '' : 's'}`;
  if (typeof s?.drafts === 'number') parts.push(fmt(s.drafts, 'draft'));
  if (typeof s?.games === 'number') parts.push(fmt(s.games, 'game'));
  const decks = meta.archetypes.reduce((t, a) => t + (num(a.decks) ?? 0), 0);
  if (decks) parts.push(fmt(decks, 'deck'));
  return parts.join(' · ');
}

/** The shrinkage prior's strength and mean, from sample.shrinkage (defaults: 20 games). */
export function shrinkage(meta: CubeMeta): { strength: number; mean: number | null } {
  const sh = (meta.sample as { shrinkage?: { strength?: unknown; mean?: unknown } } | undefined)?.shrinkage;
  return { strength: num(sh?.strength) ?? 20, mean: num(sh?.mean) };
}

// ---------------------------------------------------------------------------
// The interval strip

export interface StripGeometry {
  /** Positions in per cent of the strip's width (0–100 on a 0–100 % scale). */
  dot: number;
  lo: number | null;
  hi: number | null;
  /** The 50 % tick. */
  mid: number;
}

const clampPct = (x: number) => Math.round(Math.max(0, Math.min(100, x * 100)) * 100) / 100;

/** Where the strip draws a win rate and its interval (fractions in, per cent of width out). */
export function stripGeometry(win: number, ci: [number, number] | null): StripGeometry {
  const lo = ci ? clampPct(Math.min(ci[0], ci[1])) : null;
  const hi = ci ? clampPct(Math.max(ci[0], ci[1])) : null;
  return { dot: clampPct(win), lo, hi, mid: 50 };
}

/** A zoomed scale for a chart of several intervals: [min, max] fractions padded and rounded to 10 %. */
export function intervalDomain(items: Array<{ win: number | null; ci: [number, number] | null }>): [number, number] {
  let lo = 0.5;
  let hi = 0.5;
  for (const i of items) {
    for (const v of [i.win, i.ci?.[0], i.ci?.[1]]) {
      if (typeof v === 'number') {
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
      }
    }
  }
  return [Math.max(0, Math.floor(lo * 10) / 10), Math.min(1, Math.ceil(hi * 10) / 10)];
}

/** Axis ticks for a domain: every 10 % on a narrow one, every 20 % on a wide one. */
export function axisTicks([lo, hi]: [number, number]): number[] {
  const step = hi - lo > 0.5 ? 2 : 1;
  const out: number[] = [];
  for (let t = Math.ceil((lo * 10) / step) * step; t <= Math.round(hi * 10); t += step) out.push(t / 10);
  return out;
}

// ---------------------------------------------------------------------------
// Cards

export interface CardRow {
  name: string;
  colors: string;
  mv: number | null;
  types: string[];
  picked: number;
  seen: number;
  pickRate: number | null;
  avgPickIndex: number | null;
  inclusionRate: number | null;
  games: number;
  winRate: number | null;
  shrunk: number | null;
  ci: [number, number] | null;
  /** The data flags this card as one the Forge AI plays poorly. */
  aiLimited: boolean;
}

const asList = (x: unknown): string[] => (Array.isArray(x) ? x.map(String) : typeof x === 'string' && x ? [x] : []);

/** True when a card's stats (or its cube entry) carry Forge's AI:RemAIDeck ("its AI plays this poorly") flag, under any name the lab might use. */
function aiFlag(...objs: Array<Record<string, unknown> | undefined>): boolean {
  for (const o of objs) {
    if (!o) continue;
    if (o.remAIDeck === true || o.aiLimited === true || o.ai_limited === true || o.aiWeak === true || o.aiPlayable === false || o.forgeAiLimited === true) return true;
    if (Array.isArray(o.flags) && o.flags.some((f) => /ai.?limited|ai.?weak/i.test(String(f)))) return true;
  }
  return false;
}

export function cubeCardIndex(meta: CubeMeta): Map<string, MetaCubeCard> {
  return new Map((meta.cube.cards ?? []).map((c) => [c.name, c]));
}

export function cardRows(meta: CubeMeta): CardRow[] {
  const cube = cubeCardIndex(meta);
  const names = new Set([...Object.keys(meta.cards), ...cube.keys()]);
  const out: CardRow[] = [];
  for (const name of names) {
    const s = meta.cards[name] ?? {};
    const c = cube.get(name);
    out.push({
      name,
      colors: wubrg(asList(c?.colors).join('')),
      mv: num(c?.mv),
      types: asList(c?.types),
      picked: num(s.picked) ?? 0,
      seen: num(s.seen) ?? 0,
      pickRate: num(s.pickRate),
      avgPickIndex: num(s.avgPickIndex),
      inclusionRate: num(s.inclusionRate),
      games: num(s.games) ?? 0,
      winRate: num(s.games) ? num(s.winRate) : null,
      shrunk: num(s.winRateShrunk),
      ci: ciOf(s.ci),
      aiLimited: aiFlag(s as Record<string, unknown>, c as Record<string, unknown> | undefined),
    });
  }
  return out;
}

export type CardSort = 'shrunk' | 'games' | 'pickRate' | 'inclusion' | 'name';

export function sortCards(rows: CardRow[], key: CardSort, desc = true): CardRow[] {
  const val = (r: CardRow): number | string =>
    key === 'shrunk' ? (r.shrunk ?? -1) : key === 'games' ? r.games : key === 'pickRate' ? (r.pickRate ?? -1) : key === 'inclusion' ? (r.inclusionRate ?? -1) : r.name;
  return [...rows].sort((a, b) => {
    const va = val(a);
    const vb = val(b);
    const c = typeof va === 'string' ? va.localeCompare(vb as string) : va - (vb as number);
    return c !== 0 ? (desc ? -c : c) : b.games - a.games || a.name.localeCompare(b.name);
  });
}

export function searchCards(rows: CardRow[], query: string): CardRow[] {
  const q = query.trim().toLowerCase();
  return q ? rows.filter((r) => r.name.toLowerCase().includes(q)) : rows;
}

// ---------------------------------------------------------------------------
// Archetype detail

export interface DeckGroup {
  label: string;
  entries: Array<{ name: string; count: number }>;
  count: number;
}

const GROUP_ORDER = ['Creatures', 'Planeswalkers', 'Instants & sorceries', 'Artifacts & enchantments', 'Other', 'Lands'];

/** A decklist grouped by type, duplicates (basic lands) collapsed to counts. */
export function groupDeck(deck: string[], cube: Map<string, MetaCubeCard>): DeckGroup[] {
  const groups = new Map<string, Map<string, number>>();
  for (const name of deck) {
    const types = asList(cube.get(name)?.types).join(' ');
    const basic = /^(Plains|Island|Swamp|Mountain|Forest|Wastes)$/.test(name);
    const label = basic || /\bLand\b/.test(types)
      ? 'Lands'
      : /Creature/.test(types)
        ? 'Creatures'
        : /Planeswalker/.test(types)
          ? 'Planeswalkers'
          : /Instant|Sorcery/.test(types)
            ? 'Instants & sorceries'
            : /Artifact|Enchantment|Battle/.test(types)
              ? 'Artifacts & enchantments'
              : 'Other';
    const g = groups.get(label) ?? new Map<string, number>();
    g.set(name, (g.get(name) ?? 0) + 1);
    groups.set(label, g);
  }
  return GROUP_ORDER.filter((l) => groups.has(l)).map((label) => {
    const entries = [...groups.get(label)!.entries()].map(([name, count]) => ({ name, count }));
    if (label === 'Lands') entries.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    else entries.sort((a, b) => (num(cube.get(a.name)?.mv) ?? 99) - (num(cube.get(b.name)?.mv) ?? 99) || a.name.localeCompare(b.name));
    return { label, entries, count: entries.reduce((s, e) => s + e.count, 0) };
  });
}

/**
 * The strongest card pairs for an archetype: both cards castable in its colours
 * (colourless cards fit any), at least one of them coloured, ordered by lift.
 */
export function pairsFor(meta: CubeMeta, colors: string, limit = 6, minGames = 4): Array<MetaPair & { gainPct: number }> {
  const cube = cubeCardIndex(meta);
  const own = new Set(wubrg(colors));
  const cardColours = (n: string) => wubrg(asList(cube.get(n)?.colors).join(''));
  const fits = (n: string) => cube.has(n) && [...cardColours(n)].every((c) => own.has(c));
  return meta.pairs
    .filter((p) => fits(p.a) && fits(p.b) && (cardColours(p.a) || cardColours(p.b)) && (p.games ?? minGames) >= minGames && p.gain > 0)
    .sort((x, y) => y.gain - x.gain || (y.games ?? 0) - (x.games ?? 0))
    .slice(0, limit)
    .map((p) => ({ ...p, gainPct: Math.round(p.gain * 1000) / 10 }));
}

// ---------------------------------------------------------------------------
// Formatting

export const pct = (x: number | null | undefined, digits = 1): string => (typeof x === 'number' && Number.isFinite(x) ? `${(x * 100).toFixed(digits)}%` : '—');

/** "+6.2%" / "−3.0%". */
export const signedPct = (x: number, digits = 1): string => `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(digits)}%`;
