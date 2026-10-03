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
 * `procedural` and `off` are words, anything else is a pack URL.
 */

export type SceneryMode = 'off' | 'procedural' | 'pack';
export type MotionPref = 'system' | 'reduce' | 'full';

export interface SceneryPrefs {
  mode: SceneryMode;
  packUrl: string;
  motion: MotionPref;
}

export const SCENERY_KEY = 'forgecoach.scenery';
export const DEFAULT_PREFS: SceneryPrefs = { mode: 'off', packUrl: '', motion: 'system' };

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

/** The `scenery` parameter from the page query or the hash's query, or null. */
export function sceneryParam(search: string, hash: string): string | null {
  const fromSearch = new URLSearchParams(search.replace(/^\?/, '')).get('scenery');
  if (fromSearch) return fromSearch.trim();
  const q = hash.indexOf('?');
  if (q >= 0) {
    const fromHash = new URLSearchParams(hash.slice(q + 1)).get('scenery');
    if (fromHash) return fromHash.trim();
  }
  return null;
}

/** The stored prefs with the page's `?scenery=` applied. */
export function effectivePrefs(stored: SceneryPrefs, search: string, hash: string): SceneryPrefs {
  const p = sceneryParam(search, hash);
  if (!p) return stored;
  if (p === 'off') return { ...stored, mode: 'off' };
  if (p === 'procedural' || p === 'builtin') return { ...stored, mode: 'procedural' };
  return { ...stored, mode: 'pack', packUrl: p };
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
