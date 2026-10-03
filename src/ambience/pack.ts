/*
 * ForgeCoach — ambience/pack.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Loading a scenery pack: fetch its manifest from a URL (Settings, or the
 * page's `?scenery=`), validate it (manifest.ts), and preload its stage-1
 * assets. Any failure falls back to the built-in procedural scenery, with a
 * short note saying why (shown on the preview page and as a dev note on the
 * board). `fetch` and the asset loader are injected for tests.
 *
 * Packs are served from the user's own machine (e.g. http://127.0.0.1:8650/,
 * see docs/scenery-pack-spec.md); nothing from a pack is ever stored here.
 */
import type { Biome } from './model.ts';
import { BIOMES } from './model.ts';
import { MANIFEST_FILE, MAX_MANIFEST_BYTES, packUrls, validateManifest, type LayerKind, type ScenePack } from './manifest.ts';
import type { SceneryPrefs } from './prefs.ts';

export interface SceneryLoad {
  /** `procedural`: no pack (chosen, or fallen back to); `pack`: every biome the pack covers loaded. */
  source: 'procedural' | 'pack';
  pack: ScenePack | null;
  /** A one-line note for the user when something fell back, else null. */
  note: string | null;
  errors: string[];
  warnings: string[];
  /** Biomes the pack covers that failed to load and use the procedural scene. */
  failed: Biome[];
  manifestUrl: string | null;
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Pick<Response, 'ok' | 'status' | 'text'>>;
export type AssetLoader = (url: string, kind: LayerKind) => Promise<void>;

/** The manifest URL for what the user typed: a `.json` URL as is, else `<folder>/scenery.json`. */
export function manifestUrlFor(input: string): string | null {
  const s = input.trim();
  if (!s) return null;
  try {
    const u = new URL(s);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (u.username || u.password) return null;
    u.hash = '';
    if (!/\.json$/i.test(u.pathname)) u.pathname = `${u.pathname.replace(/\/?$/, '/')}${MANIFEST_FILE}`;
    return u.href;
  } catch {
    return null;
  }
}

/** Fetch and validate a pack's manifest. Never throws: problems come back as `errors`. */
export async function fetchManifest(input: string, deps: { fetch: FetchLike; signal?: AbortSignal }) {
  const manifestUrl = manifestUrlFor(input);
  if (!manifestUrl) {
    return { manifestUrl: null, pack: null, errors: ['The pack URL must start with http:// or https:// (no user name or password).'], warnings: [] as string[] };
  }
  let text: string;
  try {
    const res = await deps.fetch(manifestUrl, { cache: 'no-cache', signal: deps.signal, credentials: 'omit' });
    if (!res.ok) return { manifestUrl, pack: null, errors: [`${manifestUrl} answered HTTP ${res.status}.`], warnings: [] as string[] };
    text = await res.text();
  } catch (e) {
    const why = e instanceof Error && e.name === 'AbortError' ? 'cancelled' : 'unreachable (is the server running, with CORS on?)';
    return { manifestUrl, pack: null, errors: [`${manifestUrl} is ${why}.`], warnings: [] as string[] };
  }
  if (text.length > MAX_MANIFEST_BYTES) return { manifestUrl, pack: null, errors: [`The manifest is over ${MAX_MANIFEST_BYTES / 1024} KB.`], warnings: [] as string[] };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { manifestUrl, pack: null, errors: ['The manifest is not valid JSON.'], warnings: [] as string[] };
  }
  return { manifestUrl, ...validateManifest(raw, manifestUrl) };
}

/** A pack without some biomes (they fall back to the procedural scene). */
export function withoutBiomes(pack: ScenePack, drop: Biome[]): ScenePack {
  const biomes = { ...pack.biomes };
  for (const b of drop) delete biomes[b];
  return { ...pack, biomes };
}

/**
 * Preload a pack's assets up to `maxStage` (stage 1 by default: what a first
 * land shows), a few at a time. Returns the biomes with a failed asset.
 */
export async function preloadPack(pack: ScenePack, load: AssetLoader, opts: { maxStage?: number; concurrency?: number; timeoutMs?: number } = {}): Promise<{ failed: Biome[]; reasons: string[] }> {
  const items = packUrls(pack).filter((x) => x.stage <= (opts.maxStage ?? 1));
  const failed = new Set<Biome>();
  const reasons: string[] = [];
  let next = 0;
  const timeoutMs = opts.timeoutMs ?? 15000;
  const worker = async () => {
    while (next < items.length) {
      const it = items[next++]!;
      try {
        await withTimeout(load(it.url, it.kind), timeoutMs);
      } catch (e) {
        failed.add(it.biome);
        reasons.push(`${it.biome}: ${shortUrl(it.url)} ${e instanceof Error && e.message === 'timeout' ? 'timed out' : 'did not load'}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(opts.concurrency ?? 4, items.length) }, worker));
  return { failed: BIOMES.filter((b) => failed.has(b)), reasons };
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

function shortUrl(u: string): string {
  try {
    return new URL(u).pathname.split('/').slice(-2).join('/');
  } catch {
    return u;
  }
}

const PROCEDURAL: SceneryLoad = { source: 'procedural', pack: null, note: null, errors: [], warnings: [], failed: [], manifestUrl: null };

/** The whole pipeline for a set of prefs: null when scenery is off. */
export async function resolveScenery(prefs: SceneryPrefs, deps: { fetch: FetchLike; load: AssetLoader; signal?: AbortSignal }): Promise<SceneryLoad | null> {
  if (prefs.mode === 'off') return null;
  if (prefs.mode === 'procedural' || !prefs.packUrl.trim()) return PROCEDURAL;
  const m = await fetchManifest(prefs.packUrl, deps);
  if (!m.pack) {
    return { ...PROCEDURAL, note: `Scenery pack not loaded: ${m.errors[0] ?? 'unknown problem'} Showing the built-in scenery.`, errors: m.errors, warnings: m.warnings, manifestUrl: m.manifestUrl };
  }
  const pre = await preloadPack(m.pack, deps.load);
  const covered = BIOMES.filter((b) => m.pack!.biomes[b]);
  if (pre.failed.length && pre.failed.length === covered.length) {
    return { ...PROCEDURAL, note: `Scenery pack assets did not load (${pre.reasons[0]}). Showing the built-in scenery.`, warnings: [...m.warnings, ...pre.reasons], failed: pre.failed, manifestUrl: m.manifestUrl };
  }
  return {
    source: 'pack',
    pack: pre.failed.length ? withoutBiomes(m.pack, pre.failed) : m.pack,
    note: pre.failed.length ? `Some scenery did not load (${pre.failed.join(', ')}); those biomes use the built-in scenery.` : null,
    errors: [],
    warnings: [...m.warnings, ...pre.reasons],
    failed: pre.failed,
    manifestUrl: m.manifestUrl,
  };
}

/** One load per prefs at a time, shared by every strip on the page. */
const cache = new Map<string, Promise<SceneryLoad | null>>();
export function resolveSceneryCached(prefs: SceneryPrefs, deps: { fetch: FetchLike; load: AssetLoader }): Promise<SceneryLoad | null> {
  const key = `${prefs.mode}|${prefs.mode === 'pack' ? prefs.packUrl.trim() : ''}`;
  let p = cache.get(key);
  if (!p) {
    p = resolveScenery(prefs, deps);
    cache.set(key, p);
  }
  return p;
}
export function clearSceneryCache(): void {
  cache.clear();
}

/** The browser's loader: decode an image, or wait for a video's first frame. */
export function browserLoader(): AssetLoader {
  return (url, kind) =>
    new Promise<void>((resolve, reject) => {
      if (kind === 'video') {
        const v = document.createElement('video');
        v.muted = true;
        v.preload = 'auto';
        v.onloadeddata = () => resolve();
        v.onerror = () => reject(new Error('error'));
        v.src = url;
        return;
      }
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('error'));
      img.src = url;
    });
}
