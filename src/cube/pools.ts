/*
 * ForgeCoach — cube/pools.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Drafted pools, saved in this browser (localStorage), several at once: the
 * cards you took, optionally the cards the opponent took (they sharpen the
 * pick helper), and the grid or Winston pile you were looking at. Also the
 * paste parser: a deck list in any of the usual shapes ("1 Opt", "Opt",
 * "1x Opt (M21) 59", Forge .dck) matched against the cube's names.
 */
import { BASIC_NAMES } from './colors.ts';

export interface SavedPool {
  id: string;
  cubeId: string;
  name: string;
  /** Your cards (a name may repeat). */
  cards: string[];
  /** Cards the opponent took, when entered. */
  opp: string[];
  format: 'grid' | 'winston' | null;
  /** The grid being looked at: nine names or nulls. */
  grid?: Array<string | null>;
  /** The Winston pile being looked at. */
  pile?: string[];
  pileIndex?: 1 | 2 | 3;
  updatedAt: number;
}

export const POOLS_KEY = 'forgecoach.pools.v1';

type KV = Pick<Storage, 'getItem' | 'setItem'>;

function store(s?: KV | null): KV | null {
  if (s) return s;
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function listPools(s?: KV | null): SavedPool[] {
  const st = store(s);
  if (!st) return [];
  try {
    const raw = JSON.parse(st.getItem(POOLS_KEY) ?? '[]') as unknown;
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((p): p is SavedPool => !!p && typeof p === 'object' && typeof (p as SavedPool).id === 'string' && Array.isArray((p as SavedPool).cards))
      .map((p) => ({ ...p, opp: Array.isArray(p.opp) ? p.opp : [], format: p.format ?? null }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

function writeAll(pools: SavedPool[], s?: KV | null): void {
  const st = store(s);
  if (!st) return;
  try {
    st.setItem(POOLS_KEY, JSON.stringify(pools));
  } catch {
    /* quota or private mode: the pool still lives in memory */
  }
}

export function savePool(p: SavedPool, s?: KV | null): SavedPool {
  const saved = { ...p, updatedAt: p.updatedAt || Date.now() };
  const all = listPools(s).filter((x) => x.id !== p.id);
  writeAll([saved, ...all], s);
  return saved;
}

export function deletePool(id: string, s?: KV | null): void {
  writeAll(
    listPools(s).filter((x) => x.id !== id),
    s,
  );
}

export function newPool(cubeId: string, name: string, now = Date.now()): SavedPool {
  return { id: `pool-${now.toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`, cubeId, name, cards: [], opp: [], format: null, updatedAt: now };
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[’‘`]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

export interface PasteResult {
  cards: string[];
  /** Lines that named no cube card. */
  unknown: string[];
  /** Basic lands in the paste (ignored: basics are free). */
  basics: number;
}

/**
 * Card names from pasted text, matched to the cube (case- and punctuation-
 * insensitive; a front face or the part before a comma matches too).
 */
export function parsePaste(text: string, cubeNames: string[]): PasteResult {
  const exact = new Map<string, string>();
  const loose = new Map<string, string>();
  for (const n of cubeNames) {
    exact.set(norm(n), n);
    const front = n.split(' // ')[0] ?? n;
    if (!loose.has(norm(front))) loose.set(norm(front), n);
  }
  const cards: string[] = [];
  const unknown: string[] = [];
  let basics = 0;
  for (const raw of text.split(/\r?\n|·|;/)) {
    let line = raw.trim();
    if (!line || /^(\[.*\]|deck|sideboard|commander|companion|name=.*|main(board)?|#.*|\/\/.*)$/i.test(line)) continue;
    line = line.replace(/^[-*•]\s*/, '');
    let count = 1;
    const m = /^(\d+)\s*x?\s+(.+)$/i.exec(line);
    if (m?.[1] && m[2]) {
      count = Math.min(10, Number(m[1]));
      line = m[2];
    }
    // "Name (SET) 123", "Name|SET", "Name — THEMES"
    line = line
      .split('|')[0]!
      .replace(/\s+\([A-Z0-9]{2,6}\)(\s+\S+)?\s*$/, '')
      .replace(/\s+—\s+.*$/, '')
      .trim();
    const hit = exact.get(norm(line)) ?? loose.get(norm(line));
    if (hit) {
      for (let i = 0; i < count; i++) cards.push(hit);
      continue;
    }
    if (BASIC_NAMES.has(line)) {
      basics += count;
      continue;
    }
    unknown.push(raw.trim());
  }
  return { cards, unknown, basics };
}
