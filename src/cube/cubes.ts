/*
 * ForgeCoach — cube/cubes.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The cubes this page knows (public/cubes/<file>.md, with an optional
 * <file>.meta.json from mtg-table's cube lab beside it, and for the cube
 * 17Lands covers a <file>.human.json, cube/human.ts), and loading them.
 * `fetch` is injected so tests run in node.
 */
import { parseCube, type Cube } from './parseCube.ts';
import { parseMeta, type CubeMeta } from './meta.ts';

export interface CubeInfo {
  id: string;
  /** File stem under public/cubes/. */
  file: string;
  title: string;
  /** The name in the cube pages' crumbs, when "title minus ' Cube'" reads badly. */
  short?: string;
  /** Cards in the document (one of each). */
  size: number;
  blurb: string;
  /** Mana colours for the tile art. */
  accent: string;
  /** False when no cube lab meta.json ships beside the document (yet). */
  labData?: boolean;
  /**
   * True when 17Lands human card numbers ship beside the document (<file>.human.json, cube/human.ts):
   * Vintage (Arena's Powered Cube is a version of it) and Synergy (docs/human-blend.md part 2: the
   * shared cards only, on the cube's own scale).
   */
  humanData?: boolean;
  /** True when a 17Lands human pick model ships beside the document (<file>.picks.json, cube/humanPicks.ts; docs/human-picks.md). */
  humanPicks?: boolean;
  /**
   * 'deck': a deck the player owns (a Commander precon), not a cube: the deck assistant builds 40s
   * from the whole list and its cube page lists it; it is drafted only against the AI
   * (`AI_DRAFT_CUBES`), never with a friend (the draft room knows only mtg-table's cubes) or on the
   * lab's pages (`DRAFT_CUBES`), and has no lab data. Absent: a cube.
   */
  kind?: 'deck';
}

/** The crumb name: `short`, else the title without " Cube". */
export const cubeShortName = (c: Pick<CubeInfo, 'title' | 'short'>): string => c.short ?? c.title.replace(/ Cube$/, '');

export const CUBES: CubeInfo[] = [
  { id: 'synergy', file: 'synergy-cube-180', title: 'Synergy Cube', size: 180, blurb: 'Nine overlapping themes, tight power band, no combos.', accent: 'BR', humanData: true, humanPicks: true },
  { id: 'modern-era', file: 'modern-era-cube-180', title: 'Modern-Era Cube', size: 180, blurb: 'Ten guild archetypes with a few famous bombs.', accent: 'UG', humanPicks: true },
  { id: 'vintage', file: 'vintage-cube-180', title: 'Vintage Cube', size: 180, blurb: 'Power, Moxen and cheat decks, cut to 180 for two.', accent: 'UR', humanData: true, humanPicks: true },
  { id: 'pauper', file: 'pauper-cube-180', title: 'Pauper Cube', size: 180, blurb: 'All commons: blink, ninjas, tokens, sacrifice.', accent: 'WG' },
  { id: 'omega', file: 'omega-cube-180', title: 'Omega Cube', size: 180, blurb: 'The greatest hits at one fair power level: no Power, no cheats.', accent: 'WB', humanPicks: true },
  { id: 'fair-fight', file: 'fair-fight-cube-180', title: 'Fair Fight Cube', size: 180, blurb: 'Every rarity at a Pauper power level: no bombs, answers for everything.', accent: 'RW', humanPicks: true },
  { id: 'peasant', file: 'peasant-cube-180', title: 'Peasant Cube', size: 180, blurb: 'Commons and uncommons: ten guild decks from the most-followed peasant cube.', accent: 'BG', humanPicks: true },
  // Evan's own list, as he titled it (public/cubes/evybaby-cube-360.md): no themes, archetypes or guide.
  // Its lab meta (J110) drafted around the 13 cards Forge lacks; those have no lab numbers (meta.ts).
  { id: 'evybaby', file: 'evybaby-cube-360', title: "Evybaby's New Cube", short: 'Evybaby', size: 360, blurb: 'Evan’s cube: 360 cards, Avatar to Middle-earth to pizza, with shocks, surveil lands and fetches.', accent: 'WUBRG', humanPicks: true },
  // Claude's 180 from the Final Fantasy release (public/cubes/final-fantasy-cube-180.md), picked with 17Lands' FIN draft data.
  { id: 'final-fantasy', file: 'final-fantasy-cube-180', title: 'Final Fantasy Cube', size: 180, blurb: 'The best of the Final Fantasy set: Summons, Job select heroes, Tiered magic and ten guild decks.', accent: 'WUBRG', labData: false },
  // Justin's Final Fantasy X Commander deck (public/cubes/counter-blitz-fic.md): its 88 cards that work outside Commander, basics aside.
  { id: 'counter-blitz', file: 'counter-blitz-fic', title: 'Counter Blitz', size: 88, blurb: 'Your Final Fantasy X Commander deck: +1/+1 counters in green, white and blue. Build 40s from it.', accent: 'WUG', labData: false, kind: 'deck' },
];

/** The cubes proper (Draft with a friend, the lab's pages, the lobby's count): every entry but a deck. */
export const DRAFT_CUBES: CubeInfo[] = CUBES.filter((c) => c.kind !== 'deck');

/** What Draft vs AI offers: the cubes, then the decks the player owns (small lists: fewer grids, a shorter Winston stack). */
export const AI_DRAFT_CUBES: CubeInfo[] = [...DRAFT_CUBES, ...CUBES.filter((c) => c.kind === 'deck')];

/** The decks the player owns, to build from whole (the deck assistant). */
export const OWNED_DECKS: CubeInfo[] = CUBES.filter((c) => c.kind === 'deck');

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
  // None ships: don't ask (a 404 in the console on every page that shows this cube).
  if (info.labData === false) return null;
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
