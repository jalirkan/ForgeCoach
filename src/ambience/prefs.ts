/*
 * ForgeCoach — ambience/prefs.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Whether the board shows scenery, and from where: off (the default), the
 * built-in procedural scenery, or an asset pack at a URL. Kept tiny and
 * import-free so the board can ask "is it on?" without loading the scenery
 * bundle. Storage is injected for tests.
 *
 * `?scenery=<url>` (in the page query, or in the hash's query, e.g.
 * `#ambience?scenery=…`) overrides the stored choice for this page load:
 * `procedural`, `forgecoach` and `off` are words, anything else is a pack URL.
 * `?accents=off` (or `on`) does the same for the board accents (spec 1.3), a
 * sub-toggle of the scenery: on by default whenever the scenery is on.
 */

export type SceneryMode = 'off' | 'procedural' | 'pack';
export type MotionPref = 'system' | 'reduce' | 'full';

export interface SceneryPrefs {
  mode: SceneryMode;
  packUrl: string;
  motion: MotionPref;
  /** Board accents (corner and edge pieces in the player's area); only drawn when the scenery is on. */
  accents: boolean;
}

export const SCENERY_KEY = 'forgecoach.scenery';

/**
 * ForgeCoach's own art pack (CC BY 4.0, github.com/jalirkan/forgecoach-scenery),
 * served by jsDelivr from a fixed tag: CORS, the right MIME types and long
 * caching. A new pack version is a new tag, so this URL never changes under a
 * cached copy.
 */
export const FORGECOACH_PACK_URL = 'https://cdn.jsdelivr.net/gh/jalirkan/forgecoach-scenery@pack-v1/pack/';
export const DEFAULT_PREFS: SceneryPrefs = { mode: 'off', packUrl: '', motion: 'system', accents: true };

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

/** The stored prefs with the page's `?scenery=` and `?accents=` applied. */
export function effectivePrefs(stored: SceneryPrefs, search: string, hash: string): SceneryPrefs {
  const a = sceneryParam(search, hash, 'accents');
  const withAccents = a === 'off' || a === '0' ? { ...stored, accents: false } : a === 'on' || a === '1' ? { ...stored, accents: true } : stored;
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

/** Stills only? `system` follows the OS's prefers-reduced-motion. */
export function reducedMotion(pref: MotionPref, systemReduces: boolean): boolean {
  return pref === 'reduce' || (pref === 'system' && systemReduces);
}
