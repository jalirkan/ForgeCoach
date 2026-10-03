// SPDX-License-Identifier: GPL-3.0-or-later
// Test helpers: the shipped cube documents plus Scryfall snapshots of their cards
// (scryfall-<cube>.json, trimmed to the fields cards.ts maps), so tests run offline.
import { readFileSync } from 'node:fs';
import { mapScryfallCard, type CardInfo, type ScryfallCard } from '../../cards.ts';
import { parseCube, type Cube } from '../parseCube.ts';
import { parseMeta, type CubeMeta } from '../meta.ts';
import { makeContext, type CubeContext } from '../score.ts';

export type CubeId = 'synergy' | 'modern-era' | 'vintage' | 'pauper' | 'omega';

export function loadCube(id: CubeId): Cube {
  return parseCube(readFileSync(new URL(`../../../public/cubes/${id}-cube-180.md`, import.meta.url), 'utf8'));
}

export function loadInfos(id: CubeId, cube: Cube): Map<string, CardInfo> {
  const raw = JSON.parse(readFileSync(new URL(`./scryfall-${id}.json`, import.meta.url), 'utf8')) as ScryfallCard[];
  const idx = new Map<string, ScryfallCard>();
  for (const c of raw) {
    if (c.name) idx.set(c.name, c);
    for (const f of c.card_faces ?? []) if (f.name && !idx.has(f.name)) idx.set(f.name, c);
  }
  const out = new Map<string, CardInfo>();
  for (const card of cube.cards) {
    const c = idx.get(card.name);
    if (c) out.set(card.name, mapScryfallCard(card.name, c));
  }
  return out;
}

export function loadMeta(): CubeMeta {
  return parseMeta(JSON.parse(readFileSync(new URL('./synergy.meta.json', import.meta.url), 'utf8')));
}

/** The cube lab's real meta for a cube, as shipped in public/cubes/. */
export function loadRealMeta(id: CubeId): CubeMeta {
  return parseMeta(JSON.parse(readFileSync(new URL(`../../../public/cubes/${id}-cube-180.meta.json`, import.meta.url), 'utf8')));
}

export function context(id: CubeId, meta: CubeMeta | null = null, withInfos = true): CubeContext {
  const cube = loadCube(id);
  return makeContext(cube, withInfos ? loadInfos(id, cube) : null, meta);
}

/** A deterministic pseudo-random generator (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A plausible drafted pool: `n` cards, mostly from two colours plus colourless, gold and lands. */
export function samplePool(cube: Cube, colors: string, n: number, seed: number): string[] {
  const r = rng(seed);
  const fits = cube.cards.filter((c) => (c.colorHint && [...c.colorHint].every((x) => colors.includes(x))) || c.sectionKind === 'colorless');
  const lands = cube.cards.filter((c) => c.land);
  const other = cube.cards.filter((c) => !fits.includes(c) && !c.land);
  const shuffle = <T,>(a: T[]) => {
    const b = [...a];
    for (let i = b.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      [b[i], b[j]] = [b[j] as T, b[i] as T];
    }
    return b;
  };
  const main = shuffle(fits).slice(0, Math.round(n * 0.62));
  const l = shuffle(lands).slice(0, Math.round(n * 0.12));
  const rest = shuffle(other).slice(0, n - main.length - l.length);
  return [...main, ...l, ...rest].map((c) => c.name);
}
