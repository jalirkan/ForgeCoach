/*
 * ForgeCoach — ambience/prefs.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Whether the board shows scenery, and from where: ForgeCoach's own art pack
 * (the default), off, the
 * built-in procedural scenery, or an asset pack at a URL. Kept tiny and
 * import-free so the board can ask "is it on?" without loading the scenery
 * bundle. Storage is injected for tests.
 *
 * `?scenery=<url>` (in the page query, or in the hash's query, e.g.
 * `#ambience?scenery=…`) overrides the stored choice for this page load:
 * `procedural`, `forgecoach` and `off` are words, anything else is a pack URL.
 * `?accents=off` (or `on`) does the same for the board accents (spec 1.3), a
 * sub-toggle of the scenery: on by default whenever the scenery is on.
 * `?fill=off` (or `on`) does the same for "Fill each side" (spec 1.5): the
 * scenery fills each player's whole half of the board (on by default), or,
 * off, keeps to the strip along their land row.
 * `?pairs=off` (or a URL) does the same for spec 1.9's pair bands: by default
 * they come from ForgeCoach's own pairs pack (`FORGECOACH_PAIRS_URL`), and only
 * with ForgeCoach's own scenery pack, whose pictures they were painted to meet.
 */

export type SceneryMode = 'off' | 'procedural' | 'pack';
export type MotionPref = 'system' | 'reduce' | 'full';

export interface SceneryPrefs {
  mode: SceneryMode;
  packUrl: string;
  motion: MotionPref;
  /** Board accents (corner and edge pieces in the player's area); only drawn when the scenery is on. */
  accents: boolean;
  /** Spec 1.5: the scenery fills each player's whole half (true), or only the strip along their land row. */
  fill: boolean;
  /**
   * Spec 1.9: where the pair bands come from for this page load (`?pairs=`): a
   * URL, or '' for none. Absent: {@link pairsUrlOf}'s default. Never stored.
   */
  pairsUrl?: string;
}

export const SCENERY_KEY = 'forgecoach.scenery';

/**
 * ForgeCoach's own art pack (CC BY 4.0, github.com/jalirkan/forgecoach-scenery),
 * served by jsDelivr from a fixed tag: CORS, the right MIME types and long
 * caching. A new pack version is a new tag, so this URL never changes under a
 * cached copy.
 */
export const FORGECOACH_PACK_URL = 'https://cdn.jsdelivr.net/gh/jalirkan/forgecoach-scenery@pack-v8/pack/';
/**
 * Spec 1.9: ForgeCoach's own pair bands, a second manifest (`pairs.json` at
 * this base) in a ref of its own on the same repository, since the main pack
 * fills most of jsDelivr's 50 MB per ref. `pairs-v1`: the ten pairs, three
 * stages each, desktop and phone at 1x and 2x, two to four frames per stage
 * step, about 33 MB (`pairs-v1.test.ts` is its manifest). The draft
 * `pairs-v0` (one picture per pair) stays up but nothing points at it.
 */
export const FORGECOACH_PAIRS_URL = 'https://cdn.jsdelivr.net/gh/jalirkan/forgecoach-scenery@pairs-v1/';
/** On by default with ForgeCoach's own art (Justin, 2026-10-07); Off and Built-in stay one tap away. */
export const DEFAULT_PREFS: SceneryPrefs = { mode: 'pack', packUrl: FORGECOACH_PACK_URL, motion: 'system', accents: true, fill: true };

type Store = Pick<Storage, 'getItem' | 'setItem'>;

function store(s?: Store | null): Store | null {
  if (s !== undefined) return s;
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function loadSceneryPrefs(s?: Store | null): SceneryPrefs {
  const out = { ...DEFAULT_PREFS };
  try {
    const raw = store(s)?.getItem(SCENERY_KEY);
    if (!raw) return out;
    const v = JSON.parse(raw) as Partial<SceneryPrefs>;
    if (v.mode === 'off' || v.mode === 'procedural' || v.mode === 'pack') out.mode = v.mode;
    if (typeof v.packUrl === 'string') out.packUrl = v.packUrl.slice(0, 512);
    if (v.motion === 'system' || v.motion === 'reduce' || v.motion === 'full') out.motion = v.motion;
    if (typeof v.accents === 'boolean') out.accents = v.accents;
    if (typeof v.fill === 'boolean') out.fill = v.fill;
  } catch {
    /* corrupt or blocked storage → defaults */
  }
  return out;
}

const listeners = new Set<() => void>();

export function saveSceneryPrefs(p: SceneryPrefs, s?: Store | null): void {
  try {
    store(s)?.setItem(SCENERY_KEY, JSON.stringify(p));
  } catch {
    /* storage blocked: the choice lasts this page only */
  }
  for (const l of listeners) l();
}

export function onSceneryPrefs(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** The `scenery` (or another) parameter from the page query or the hash's query, or null. */
export function sceneryParam(search: string, hash: string, name = 'scenery'): string | null {
  const fromSearch = new URLSearchParams(search.replace(/^\?/, '')).get(name);
  if (fromSearch) return fromSearch.trim();
  const q = hash.indexOf('?');
  if (q >= 0) {
    const fromHash = new URLSearchParams(hash.slice(q + 1)).get(name);
    if (fromHash) return fromHash.trim();
  }
  return null;
}

/** An on / off page parameter: true, false, or null when absent or not a switch word. */
function switchParam(search: string, hash: string, name: string): boolean | null {
  const v = sceneryParam(search, hash, name);
  return v === 'off' || v === '0' ? false : v === 'on' || v === '1' ? true : null;
}

/** The stored prefs with the page's `?scenery=`, `?accents=`, `?fill=` and `?pairs=` applied. */
export function effectivePrefs(stored: SceneryPrefs, search: string, hash: string): SceneryPrefs {
  const a = switchParam(search, hash, 'accents');
  const f = switchParam(search, hash, 'fill');
  const pr = sceneryParam(search, hash, 'pairs');
  const pairs = pr === null ? {} : { pairsUrl: pr === 'off' || pr === '0' ? '' : pr === 'forgecoach' || pr === 'on' ? FORGECOACH_PAIRS_URL : pr };
  const withAccents = a === null && f === null && pr === null ? stored : { ...stored, ...(a === null ? {} : { accents: a }), ...(f === null ? {} : { fill: f }), ...pairs };
  const p = sceneryParam(search, hash);
  if (!p) return withAccents;
  if (p === 'off') return { ...withAccents, mode: 'off' };
  if (p === 'procedural' || p === 'builtin') return { ...withAccents, mode: 'procedural' };
  if (p === 'forgecoach') return { ...withAccents, mode: 'pack', packUrl: FORGECOACH_PACK_URL };
  return { ...withAccents, mode: 'pack', packUrl: p };
}

/** Are the board accents drawn? Only with the scenery on and the sub-toggle on. */
export function accentsOn(p: SceneryPrefs): boolean {
  return p.mode !== 'off' && p.accents;
}

/** The prefs for this page, from localStorage and location. */
export function currentPrefs(): SceneryPrefs {
  const stored = loadSceneryPrefs();
  try {
    return effectivePrefs(stored, location.search, location.hash);
  } catch {
    return stored;
  }
}

/** Does the scenery fill each player's half (spec 1.5)? Only with the scenery on and "Fill each side" on. */
export function fillOn(p: SceneryPrefs): boolean {
  return p.mode !== 'off' && p.fill;
}

/** Stills only? `system` follows the OS's prefers-reduced-motion. */
export function reducedMotion(pref: MotionPref, systemReduces: boolean): boolean {
  return pref === 'reduce' || (pref === 'system' && systemReduces);
}

/**
 * Spec 1.9: the pairs manifest's base URL for these prefs, or null for none:
 * the page's `?pairs=` when given; else ForgeCoach's own pairs with
 * ForgeCoach's own pack (the bands were painted between its pictures); else
 * none (a pack of your own brings its bands with `?pairs=<url>`).
 */
export function pairsUrlOf(p: SceneryPrefs): string | null {
  if (p.mode !== 'pack') return null;
  if (p.pairsUrl !== undefined) return p.pairsUrl.trim() || null;
  return p.packUrl.trim() === FORGECOACH_PACK_URL ? FORGECOACH_PAIRS_URL : null;
}
