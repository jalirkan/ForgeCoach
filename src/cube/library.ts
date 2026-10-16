/*
 * ForgeCoach — cube/library.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The library: every card ForgeCoach knows, the union of the cube documents
 * (public/cubes/*.md) and the two big proxy lists (docs/proxies/), as
 * scripts/library/build.ts writes it to public/cubes/library.json (schema 1).
 * The cube builder (#cube/new) browses it and draws custom cubes from it.
 *
 *   {"schema":1, "note", "sources":[{"id","path","cards","sha256"}], "engineFacts":{"path","sha256"}|null,
 *    "cards":[{"name","colors","type","mv","sources":[…], "produces"?, "tags"?, "forge"?: false|null,
 *              "ai"?: "All"|"Random", "lab"?: {"games","winRate","cubes"}, "noFacts"?: true}]}
 *
 * `forge` absent: Forge has the card (a cube document lists it, or the
 * engine's facts say so); false: it does not (a "## Not in Forge" section or
 * the engine's facts); null: nobody said (a proxy-list card, without the
 * engine's facts). `lab.winRate` is the games-weighted winRateShrunk over
 * every shipped meta that played it. Strict parser: bad rows are dropped and
 * counted. DOM-free; `fetch` is injected.
 */
import { wubrg } from './colors.ts';

/** The proxy lists that join the documents in the library (docs/proxies/<file>.txt). */
export const LIBRARY_LISTS = [
  { id: 'mtgo-vintage', file: 'mtgo-vintage-cube-540', title: 'MTGO Vintage Cube (540)' },
  { id: 'old-school', file: 'old-school-93-94-360', title: 'Old School 93/94 (360)' },
] as const;

export interface LibraryCard {
  name: string;
  /** Printed colours, WUBRG order; '' for colourless cards and lands. */
  colors: string;
  /** Scryfall's type line (both faces). */
  type: string;
  /** Mana value of the first face; 0 for lands. */
  mv: number;
  /** The cube ids and list ids it comes from. */
  sources: string[];
  /** A land's colours (what it makes or fetches). */
  produces?: string;
  tags?: string[];
  forge?: false | null;
  ai?: 'All' | 'Random';
  lab?: { games: number; winRate: number; cubes: string[] };
  /** No Scryfall snapshot had it: colours, type and mana value are unknown. */
  noFacts?: true;
}

export interface LibraryFile {
  schema: 1;
  note: string;
  sources: Array<{ id: string; path: string; cards: number; sha256: string }>;
  engineFacts: { path: string; sha256: string } | null;
  cards: LibraryCard[];
}

export interface Library {
  cards: LibraryCard[];
  byName: Map<string, LibraryCard>;
  sources: LibraryFile['sources'];
  engineFacts: boolean;
  dropped: number;
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const isStr = (x: unknown, max = 200): x is string => typeof x === 'string' && x.length <= max && !/[\u0000-\u001f]/.test(x);

function card(x: unknown): LibraryCard | null {
  if (!isObj(x) || !isStr(x.name, 150) || !x.name.trim()) return null;
  if (!isStr(x.colors, 5) || wubrg(x.colors) !== x.colors) return null;
  if (!isStr(x.type, 200) || typeof x.mv !== 'number' || !(x.mv >= 0 && x.mv <= 20)) return null;
  if (!Array.isArray(x.sources) || !x.sources.every((s) => isStr(s, 40))) return null;
  const c: LibraryCard = { name: x.name, colors: x.colors, type: x.type, mv: Math.round(x.mv), sources: [...(x.sources as string[])] };
  if (isStr(x.produces, 5)) c.produces = wubrg(x.produces);
  if (Array.isArray(x.tags)) c.tags = x.tags.filter((t): t is string => isStr(t, 30) && /^[a-z][a-z-]*$/.test(t));
  if (x.forge === false || x.forge === null) c.forge = x.forge;
  if (x.ai === 'All' || x.ai === 'Random') c.ai = x.ai;
  const l = x.lab;
  if (isObj(l) && Number.isInteger(l.games) && (l.games as number) > 0 && typeof l.winRate === 'number' && l.winRate >= 0 && l.winRate <= 1) {
    c.lab = { games: l.games as number, winRate: l.winRate, cubes: Array.isArray(l.cubes) ? l.cubes.filter((s): s is string => isStr(s, 40)) : [] };
  }
  if (x.noFacts === true) c.noFacts = true;
  return c;
}

export function parseLibrary(json: unknown): Library {
  if (!isObj(json) || json.schema !== 1 || !Array.isArray(json.cards)) throw new Error('library.json: not a schema-1 library.');
  const cards: LibraryCard[] = [];
  const byName = new Map<string, LibraryCard>();
  let dropped = 0;
  for (const x of json.cards) {
    const c = card(x);
    if (!c || byName.has(c.name)) {
      dropped++;
      continue;
    }
    cards.push(c);
    byName.set(c.name, c);
  }
  const sources = Array.isArray(json.sources)
    ? json.sources.filter((s): s is LibraryFile['sources'][number] => isObj(s) && isStr(s.id, 40) && isStr(s.path, 200) && Number.isInteger(s.cards) && isStr(s.sha256, 64))
    : [];
  return { cards, byName, sources, engineFacts: isObj(json.engineFacts), dropped };
}

type Fetch = (url: string) => Promise<Pick<Response, 'ok' | 'status' | 'json'>>;

let cached: Promise<Library> | null = null;

/** The shipped library (fetched once a page). */
export function loadLibrary(base: string, fetcher: Fetch = (u) => fetch(u)): Promise<Library> {
  if (!cached) {
    cached = (async () => {
      const res = await fetcher(`${base}cubes/library.json`);
      if (!res.ok) throw new Error(`The card library couldn’t be downloaded (HTTP ${res.status}).`);
      return parseLibrary(await res.json());
    })();
    cached.catch(() => (cached = null));
  }
  return cached;
}

// ---------------------------------------------------------------------------
// What a card is, for the builder's filters and summary

export type CardKind = 'creature' | 'planeswalker' | 'instant' | 'sorcery' | 'artifact' | 'enchantment' | 'battle' | 'land';
export const KIND_ORDER: CardKind[] = ['creature', 'planeswalker', 'instant', 'sorcery', 'artifact', 'enchantment', 'battle', 'land'];
export const KIND_LABEL: Record<CardKind, string> = {
  creature: 'Creatures',
  planeswalker: 'Planeswalkers',
  instant: 'Instants',
  sorcery: 'Sorceries',
  artifact: 'Artifacts',
  enchantment: 'Enchantments',
  battle: 'Battles',
  land: 'Lands',
};

const front = (c: Pick<LibraryCard, 'type'>) => c.type.split(' // ')[0] ?? c.type;

export const isLand = (c: Pick<LibraryCard, 'type'>): boolean => /\bLand\b/.test(front(c)) && !/\bCreature\b/.test(front(c));
export const isBasic = (c: Pick<LibraryCard, 'type'>): boolean => /\bBasic\b/.test(front(c)) && isLand(c);

/** The card's one kind for the type mix: the first that applies, creature first (an artifact creature is a creature). */
export function kindOf(c: Pick<LibraryCard, 'type'>): CardKind {
  const t = front(c);
  if (isLand(c)) return 'land';
  for (const k of KIND_ORDER) if (k !== 'land' && new RegExp(`\\b${k}\\b`, 'i').test(t)) return k;
  return 'artifact';
}

/** Where a card goes in a cube document: a colour, Gold, Colorless or Lands. */
export type Bucket = 'W' | 'U' | 'B' | 'R' | 'G' | 'gold' | 'colorless' | 'land';
export const BUCKETS: Bucket[] = ['W', 'U', 'B', 'R', 'G', 'gold', 'colorless', 'land'];
export const BUCKET_LABEL: Record<Bucket, string> = { W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green', gold: 'Gold', colorless: 'Colorless', land: 'Lands' };

export function bucketOf(c: Pick<LibraryCard, 'type' | 'colors'>): Bucket {
  if (isLand(c)) return 'land';
  if (c.colors.length === 0) return 'colorless';
  if (c.colors.length === 1) return c.colors as Bucket;
  return 'gold';
}

/** The curve's bins: 0…6 and 7+. */
export const MV_BINS = ['0', '1', '2', '3', '4', '5', '6', '7+'] as const;
export const mvBin = (mv: number): number => Math.min(7, Math.max(0, Math.round(mv)));

/** The lab's rating as a percentage, when the lab played the card. */
export const labPct = (c: LibraryCard): number | null => (c.lab ? Math.round(c.lab.winRate * 1000) / 10 : null);

// ---------------------------------------------------------------------------
// Browsing

export interface LibraryFilter {
  q?: string;
  /** Colours to show: W U B R G, 'C' colourless (lands included), 'M' multicolour. Empty: all. */
  colors?: string[];
  kind?: CardKind | null;
  /** A curve bin (0–7, 7 = 7+), or null. */
  mv?: number | null;
  /** A source id (a cube's or a list's), or null. */
  source?: string | null;
  /** Lab win rate at least this (0–1); cards with no lab numbers are left out when set. */
  minLab?: number | null;
  /** Hide the cards Forge lacks or nobody vouched for. */
  forgeOnly?: boolean;
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[’']/g, "'");

export function matchesFilter(c: LibraryCard, f: LibraryFilter): boolean {
  const q = f.q?.trim();
  if (q) {
    const nq = norm(q);
    if (!norm(c.name).includes(nq) && !norm(c.type).includes(nq)) return false;
  }
  if (f.colors?.length) {
    const ok = f.colors.some((x) => (x === 'C' ? c.colors === '' : x === 'M' ? c.colors.length > 1 : c.colors.includes(x)));
    if (!ok) return false;
  }
  if (f.kind && kindOf(c) !== f.kind) return false;
  if (f.mv !== null && f.mv !== undefined && (isLand(c) || mvBin(c.mv) !== f.mv)) return false;
  if (f.source && !c.sources.includes(f.source)) return false;
  if (f.minLab !== null && f.minLab !== undefined && (!c.lab || c.lab.winRate < f.minLab)) return false;
  if (f.forgeOnly && c.forge !== undefined) return false;
  return true;
}

export type LibrarySort = 'name' | 'lab' | 'mv';

export function browse(lib: Library, f: LibraryFilter, sort: LibrarySort = 'name'): LibraryCard[] {
  const out = lib.cards.filter((c) => matchesFilter(c, f));
  if (sort === 'lab') out.sort((a, b) => (b.lab?.winRate ?? -1) - (a.lab?.winRate ?? -1) || (b.lab?.games ?? 0) - (a.lab?.games ?? 0) || a.name.localeCompare(b.name));
  else if (sort === 'mv') out.sort((a, b) => a.mv - b.mv || a.name.localeCompare(b.name));
  return out;
}

/** A name as typed or pasted, matched to the library's spelling (case, accents, quotes, a DFC's front face). */
export function libraryName(lib: Library, raw: string): string | null {
  const t = raw.trim();
  if (lib.byName.has(t)) return t;
  const n = norm(t);
  for (const c of lib.cards) {
    if (norm(c.name) === n) return c.name;
    const first = c.name.split(' // ')[0];
    if (first && norm(first) === n) return c.name;
  }
  return null;
}

