/*
 * ForgeCoach — cube/custom.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Your own cubes, made in the cube builder (#cube/new) from the library
 * (cube/library.ts): kept in this browser (localStorage), written as a cube
 * document in the shape parseCube.ts reads (so an exported file opens again
 * here, and in mtg-table's cube lab), and read back from a .md document or a
 * plain list. cubes.ts registers them beside the shipped cubes, marked yours,
 * with no lab data.
 *
 * The document keeps what the engine needs to know: a "## Not in Forge"
 * section for the cards Forge lacks (so a deck built from the cube leaves them
 * out of what the engine is handed, as for the shipped cubes) and a "Forge AI
 * flags" line (draft/aiFlags.ts reads it). DOM-free; storage is injected.
 */
import { colourPairs, wubrg } from './colors.ts';
import { BUCKETS, BUCKET_LABEL, bucketOf, libraryName, type Library, type LibraryCard } from './library.ts';
import { parseCube } from './parseCube.ts';
import { parsePaste } from './pools.ts';

export interface CustomCube {
  /** `my-<slug>`: lowercase letters, digits, dashes (the draft room's cube id rule). */
  id: string;
  title: string;
  blurb: string;
  /** The size it is aimed at (180, 360) or null for any. */
  target: number | null;
  /** The cards, one of each, in the order added. */
  cards: string[];
  /** The cube document, written at save (cubeMarkdown). */
  doc: string;
  /** Its two main colours, for the tile (accentOf). */
  accent?: string;
  createdAt: number;
  updatedAt: number;
}

export const CUSTOM_KEY = 'forgecoach.customCubes.v1';
export const CUSTOM_PREFIX = 'my-';
export const MAX_CUSTOM_CARDS = 1000;

type KV = Pick<Storage, 'getItem' | 'setItem'>;

function store(s?: KV | null): KV | null {
  if (s) return s;
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

const isStr = (x: unknown): x is string => typeof x === 'string';

function valid(x: unknown): x is CustomCube {
  if (!x || typeof x !== 'object') return false;
  const c = x as Record<string, unknown>;
  return (
    isStr(c.id) &&
    /^my-[a-z0-9][a-z0-9-]{0,60}$/.test(c.id) &&
    isStr(c.title) &&
    isStr(c.blurb) &&
    isStr(c.doc) &&
    Array.isArray(c.cards) &&
    c.cards.length <= MAX_CUSTOM_CARDS &&
    c.cards.every(isStr) &&
    (c.target === null || Number.isInteger(c.target)) &&
    typeof c.updatedAt === 'number'
  );
}

export function listCustomCubes(s?: KV | null): CustomCube[] {
  const st = store(s);
  if (!st) return [];
  try {
    const raw = JSON.parse(st.getItem(CUSTOM_KEY) ?? '[]') as unknown;
    return Array.isArray(raw) ? raw.filter(valid).map((c) => ({ ...c, createdAt: typeof c.createdAt === 'number' ? c.createdAt : c.updatedAt })) : [];
  } catch {
    return [];
  }
}

function writeAll(all: CustomCube[], s?: KV | null): boolean {
  const st = store(s);
  if (!st) return false;
  try {
    st.setItem(CUSTOM_KEY, JSON.stringify(all));
    return true;
  } catch {
    return false;
  }
}

export function getCustomCube(id: string, s?: KV | null): CustomCube | undefined {
  return listCustomCubes(s).find((c) => c.id === id);
}

/** Saves (adds or replaces) a cube; false when this browser would not keep it (private mode, full storage). */
export function saveCustomCube(c: CustomCube, s?: KV | null): boolean {
  const all = listCustomCubes(s).filter((x) => x.id !== c.id);
  return writeAll([...all, c], s);
}

export function deleteCustomCube(id: string, s?: KV | null): void {
  writeAll(
    listCustomCubes(s).filter((x) => x.id !== id),
    s,
  );
}

export function slugOf(title: string): string {
  return (
    title
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40)
      .replace(/-+$/, '') || 'cube'
  );
}

/** A fresh id for a title, unlike any in `taken`: my-<slug>, then my-<slug>-2, … */
export function customId(title: string, taken: Iterable<string>): string {
  const t = new Set(taken);
  const base = `${CUSTOM_PREFIX}${slugOf(title)}`;
  if (!t.has(base)) return base;
  for (let i = 2; ; i++) if (!t.has(`${base}-${i}`)) return `${base}-${i}`;
}

/** The cube's main colours for its tile: the two with the most cards, else WUBRG for a cube with no colour. */
export function accentOf(cards: Array<Pick<LibraryCard, 'colors'>>): string {
  const n: Record<string, number> = {};
  for (const c of cards) for (const x of c.colors) n[x] = (n[x] ?? 0) + 1;
  const top = Object.entries(n)
    .sort((a, b) => b[1] - a[1] || 'WUBRG'.indexOf(a[0]) - 'WUBRG'.indexOf(b[0]))
    .slice(0, 2)
    .map(([k]) => k);
  return top.length ? wubrg(top) : 'WUBRG';
}

// ---------------------------------------------------------------------------
// The document

/** What a custom cube's document needs to know of each card. */
export type DocCard = Pick<LibraryCard, 'name' | 'colors' | 'type' | 'mv' | 'forge' | 'ai' | 'tags'>;

const items = (cards: DocCard[]) => cards.map((c) => (c.tags?.length ? `${c.name} — ${c.tags.join(' ')}` : c.name)).join(' · ');

/**
 * The cube document, in parseCube.ts's shape: "# title", the blurb, "## The
 * list" with "### White (n)" … "### Lands (n)" sections (gold cards by pair,
 * "WU: …"; three colours and more on their own line), then "## Not in Forge"
 * and the AI flags when any card needs them.
 */
export function cubeMarkdown(o: { title: string; blurb: string; cards: DocCard[]; date?: string }): string {
  const title = o.title.replace(/\s+/g, ' ').trim() || 'My cube';
  const out: string[] = [`# ${title}`, ''];
  if (o.blurb.trim()) out.push(o.blurb.replace(/\s+/g, ' ').trim(), '');
  out.push(`*Made in ForgeCoach’s cube builder${o.date ? ` on ${o.date}` : ''} from the card library: ${o.cards.length} cards, one of each.*`, '');
  out.push('## The list (name — tags)', '');
  for (const b of BUCKETS) {
    const inB = o.cards.filter((c) => bucketOf(c) === b).sort((x, y) => x.mv - y.mv || x.name.localeCompare(y.name));
    if (!inB.length) continue;
    out.push(`### ${BUCKET_LABEL[b]} (${inB.length})`);
    if (b === 'gold') {
      for (const p of colourPairs()) {
        const pc = inB.filter((c) => wubrg(c.colors) === p);
        if (pc.length) out.push(`${p}: ${items(pc)}`);
      }
      const more = inB.filter((c) => c.colors.length > 2);
      if (more.length) out.push(items(more));
    } else out.push(items(inB));
    out.push('');
  }
  const missing = o.cards.filter((c) => c.forge === false);
  if (missing.length) {
    out.push('## Not in Forge', '', 'Forge has no card script for these cards. They draft as normal; the engine refuses a deck that holds one, so ForgeCoach leaves them out of the bot’s deck and asks you to take them out of yours.', '');
    for (const c of missing) out.push(`- ${c.name}`);
    out.push('');
  }
  const all = o.cards.filter((c) => c.ai === 'All').map((c) => c.name);
  const random = o.cards.filter((c) => c.ai === 'Random').map((c) => c.name);
  if (all.length || random.length) {
    out.push('## Forge AI flags', '');
    const parts = ['Forge’s AI plays some of these cards badly, or leaves them out of its decks: their scripts carry `AI:RemoveDeck`.'];
    if (all.length) parts.push(`Rated \`All\`: ${all.join(', ')}.`);
    if (random.length) parts.push(`Rated \`Random\`: ${random.join(', ')}.`);
    out.push(parts.join(' '), '');
  }
  return out.join('\n');
}

// ---------------------------------------------------------------------------
// Reading a list or a document back

export interface ImportResult {
  title: string | null;
  /** Library cards, one of each, in the file's order. */
  cards: string[];
  /** Lines or names the library does not have. */
  unknown: string[];
  /** Names listed more than once (kept once). */
  repeats: string[];
  basics: number;
}

/** A cube document (it has "## The list") or a plain list ("1 Opt", "Opt", "1x Opt (M21) 59", .dck), matched to the library. */
export function importCubeText(text: string, lib: Library): ImportResult {
  let names: string[];
  let unknown: string[] = [];
  let basics = 0;
  let title: string | null = null;
  if (/^##\s+the list/im.test(text)) {
    const cube = parseCube(text);
    title = cube.title || null;
    names = [];
    for (const c of cube.cards) {
      const n = libraryName(lib, c.name);
      if (n) names.push(n);
      else unknown.push(c.name);
    }
  } else {
    const r = parsePaste(
      text,
      lib.cards.map((c) => c.name),
    );
    names = r.cards;
    unknown = r.unknown;
    basics = r.basics;
  }
  const seen = new Set<string>();
  const repeats = new Set<string>();
  const cards: string[] = [];
  for (const n of names) {
    if (seen.has(n)) repeats.add(n);
    else cards.push(n);
    seen.add(n);
  }
  return { title, cards, unknown, repeats: [...repeats], basics };
}
