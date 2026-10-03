/*
 * ForgeCoach — cube/cubes.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The cubes this page knows (public/cubes/<file>.md, with an optional
 * <file>.meta.json from mtg-table's cube lab beside it), and loading them.
 * `fetch` is injected so tests run in node.
 */
import { parseCube, type Cube } from './parseCube.ts';
import { parseMeta, type CubeMeta } from './meta.ts';

export interface CubeInfo {
  id: string;
  /** File stem under public/cubes/. */
  file: string;
  title: string;
  blurb: string;
  /** Mana colours for the tile art. */
  accent: string;
  /** False when no cube lab meta.json ships beside the document (yet). */
  labData?: boolean;
}

export const CUBES: CubeInfo[] = [
  { id: 'synergy', file: 'synergy-cube-180', title: 'Synergy Cube', blurb: 'Nine overlapping themes, tight power band, no combos.', accent: 'BR' },
  { id: 'modern-era', file: 'modern-era-cube-180', title: 'Modern-Era Cube', blurb: 'Ten guild archetypes with a few famous bombs.', accent: 'UG' },
  { id: 'vintage', file: 'vintage-cube-180', title: 'Vintage Cube', blurb: 'Power, Moxen and cheat decks, cut to 180 for two.', accent: 'UR' },
  { id: 'pauper', file: 'pauper-cube-180', title: 'Pauper Cube', blurb: 'All commons: blink, ninjas, tokens, sacrifice.', accent: 'WG' },
  { id: 'omega', file: 'omega-cube-180', title: 'Omega Cube', blurb: 'The greatest hits at one fair power level: no Power, no cheats.', accent: 'WB', labData: false },
  { id: 'fair-fight', file: 'fair-fight-cube-180', title: 'Fair Fight Cube', blurb: 'Every rarity at a Pauper power level: no bombs, answers for everything.', accent: 'RW', labData: false },
  { id: 'peasant', file: 'peasant-cube-180', title: 'Peasant Cube', blurb: 'Commons and uncommons: ten guild decks from the most-followed peasant cube.', accent: 'BG', labData: false },
];

export function cubeInfo(id: string): CubeInfo | undefined {
  return CUBES.find((c) => c.id === id);
}

type Fetch = (url: string) => Promise<Pick<Response, 'ok' | 'status' | 'text' | 'json'>>;

export async function loadCubeDoc(info: CubeInfo, base: string, fetcher: Fetch = (u) => fetch(u)): Promise<Cube> {
  const res = await fetcher(`${base}cubes/${info.file}.md`);
  if (!res.ok) throw new Error(`The cube list couldn’t be downloaded (HTTP ${res.status}).`);
  return parseCube(await res.text());
}

/** The shipped meta for a cube, or null when there is none (or it is unreadable). */
export async function loadShippedMeta(info: CubeInfo, base: string, fetcher: Fetch = (u) => fetch(u)): Promise<CubeMeta | null> {
  try {
    const res = await fetcher(`${base}cubes/${info.file}.meta.json`);
    if (!res.ok) return null;
    return parseMeta(await res.json());
  } catch {
    return null;
  }
}

/**
 * Which of the cubes a lab meta.json is for: by its file name, else its title.
 * A meta that names neither belongs to `fallback` (the cube being looked at).
 */
export function cubeForMeta(meta: { cube: { file?: string; name?: string } }, fallback?: string): CubeInfo | undefined {
  const f = meta.cube.file?.split('/').pop();
  const n = meta.cube.name?.trim();
  const hit = CUBES.find((c) => (f && f === `${c.file}.md`) || (n && n === c.title));
  if (hit) return hit;
  return !f && !n && fallback ? cubeInfo(fallback) : undefined;
}
