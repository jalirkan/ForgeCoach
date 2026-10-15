/*
 * ForgeCoach — ambience/pack.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Loading a scenery pack: fetch its manifest from a URL (Settings, or the
 * page's `?scenery=`), validate it (manifest.ts), and preload its stage-1
 * assets; then, as slots grow, warm each slot's current and next stage's
 * pictures ({@link growthPictures}, spec 1.6: the next stage fades in land by
 * land, so it must be there before the first land toward it). Any failure falls back to the built-in procedural scenery, with a
 * short note saying why (shown on the preview page and as a dev note on the
 * board). `fetch` and the asset loader are injected for tests.
 *
 * Packs are served from the user's own machine (e.g. http://127.0.0.1:8650/,
 * see docs/scenery-pack-spec.md); nothing from a pack is ever stored here.
 */
import type { Biome } from './model.ts';
import { BIOMES } from './model.ts';
import { effectUrls, halfAt, layersAt, overlayUrls, MANIFEST_FILE, MAX_EFFECT_BYTES, MAX_MANIFEST_BYTES, packUrls, validateManifest, type EffectEvent, type LayerKind, type ScenePack } from './manifest.ts';
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

/**
 * Is this host on the user's own machine or local network (loopback, private
 * IPv4 / IPv6 ranges, `localhost`, `.local`)? Chromium's Local Network Access
 * asks the user's permission before a public page (the github.io site) may
 * fetch from these; a dismissed prompt looks like a plain network failure.
 */
export function isLocalNetworkHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local')) return true;
  if (h === '::1' || /^f[cd][0-9a-f]{2}:/.test(h) || /^fe[89ab][0-9a-f]:/.test(h)) return true;
  const m = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(h);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || a === 0;
}

/** What to tell a user whose local-network fetch failed: the Local Network Access permission. */
export const LOCAL_NETWORK_HINT =
  'If the browser asked to allow local network access and the prompt was dismissed or blocked, allow local network access for this site in the browser\'s site settings, or reload and accept the prompt.';

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
    if (e instanceof Error && e.name === 'AbortError') return { manifestUrl, pack: null, errors: [`${manifestUrl} is cancelled.`], warnings: [] as string[] };
    const lna = isLocalNetworkHost(new URL(manifestUrl).hostname) ? ` ${LOCAL_NETWORK_HINT}` : '';
    return { manifestUrl, pack: null, errors: [`${manifestUrl} is unreachable (is the server running, with CORS on?).${lna}`], warnings: [] as string[] };
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

/** A still picture to warm: its 1x file and its 2x (warmed through `srcset`, so the browser fetches the one it will draw). */
export interface WarmPicture {
  biome: Biome;
  stage: number;
  src: string;
  src2x: string | null;
}

/**
 * The still pictures each slot shows at its stage and fades toward at the
 * next (spec 1.6: "current and next"), to warm when a slot enters a stage:
 * the stage's `half` picture on the half board (the phone one on a phone),
 * else its image layers. Moving layers are not warmed (the next stage's are
 * not drawn until it is reached). Each file once; slots with no pack art, and
 * withered ones, give none.
 */
export function growthPictures(pack: ScenePack, slots: readonly { biome: Biome; stage: number }[], opts: { half: boolean; phone: boolean }): WarmPicture[] {
  const out: WarmPicture[] = [];
  const seen = new Set<string>();
  const add = (p: WarmPicture) => {
    if (seen.has(p.src)) return;
    seen.add(p.src);
    out.push(p);
  };
  for (const slot of slots) {
    const b = pack.biomes[slot.biome];
    if (!b || slot.stage <= 0) continue;
    for (const stage of [slot.stage, slot.stage + 1]) {
      if (stage > b.stages.length && stage !== slot.stage) continue;
      const h = opts.half ? halfAt(b, stage) : null;
      if (h) {
        const pic = opts.phone && h.phone ? h.phone : h;
        add({ biome: slot.biome, stage, src: pic.src, src2x: pic.src2x });
        continue;
      }
      for (const l of layersAt(b, stage)) if (l.kind === 'image') add({ biome: slot.biome, stage, src: l.src, src2x: l.src2x });
    }
  }
  return out;
}

/** Pictures being warmed, held until they load (an unreferenced Image may be dropped mid-fetch). */
const warming = new Set<HTMLImageElement>();
/** Pictures warmed (or warming) this page load: each once. */
const warmedSrcs = new Set<string>();
/** Pictures warmed that have loaded and decoded: a transition (spec 1.7) only cuts to pictures that are here. */
const readySrcs = new Set<string>();

/** Has this picture been warmed, loaded and decoded this page load? */
export function pictureReady(src: string): boolean {
  return readySrcs.has(src);
}

/**
 * Warm a still picture in the browser's cache, through the same `srcset` the
 * renderer draws it with, so the file fetched is the one it will show. Each
 * picture once per page load; never waits, never throws.
 */
export function warmPicture(p: { src: string; src2x: string | null }): void {
  if (warmedSrcs.has(p.src) || typeof Image === 'undefined') return;
  warmedSrcs.add(p.src);
  const img = new Image();
  img.decoding = 'async';
  const done = () => warming.delete(img);
  img.onload = () => {
    // Decoded ahead too, so a hard cut to it (spec 1.7) never shows a blank frame.
    const ok = () => {
      readySrcs.add(p.src);
      done();
    };
    if (typeof img.decode === 'function') img.decode().then(ok, ok);
    else ok();
  };
  img.onerror = done;
  warming.add(img);
  if (p.src2x) img.srcset = `${p.src} 1x, ${p.src2x} 2x`;
  img.src = p.src;
}

/** One effect file, fetched: did it load, and how big is it. */
export interface EffectFileCheck {
  biome: Biome | null;
  event: EffectEvent;
  url: string;
  ok: boolean;
  bytes: number | null;
  error: string | null;
}

/** Effect files per group (a biome, or null for the global effects) against the 4 MB budget. */
export interface EffectBudget {
  biome: Biome | null;
  bytes: number;
  over: boolean;
}

/**
 * Fetch every effect file a pack names (the preview page's "pack effects"
 * status): whether it loads and its real size, then each group's total
 * against the budget. A few at a time; never throws.
 */
export async function checkEffectFiles(pack: ScenePack, deps: { fetch: (url: string, init?: RequestInit) => Promise<Pick<Response, 'ok' | 'status' | 'arrayBuffer'>> }, concurrency = 3): Promise<{ files: EffectFileCheck[]; budgets: EffectBudget[] }> {
  const items = effectUrls(pack);
  const files: EffectFileCheck[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      const it = items[i]!;
      try {
        const res = await deps.fetch(it.url, { cache: 'no-cache', credentials: 'omit' });
        if (!res.ok) files[i] = { ...it, ok: false, bytes: null, error: `HTTP ${res.status}` };
        else files[i] = { ...it, ok: true, bytes: (await res.arrayBuffer()).byteLength, error: null };
      } catch {
        files[i] = { ...it, ok: false, bytes: null, error: 'unreachable' };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  const totals = new Map<Biome | null, number>();
  for (const f of files) totals.set(f.biome, (totals.get(f.biome) ?? 0) + (f.bytes ?? 0));
  const budgets = [...totals].map(([biome, bytes]) => ({ biome, bytes, over: bytes > MAX_EFFECT_BYTES }));
  return { files: files.map(({ biome, event, url, ok, bytes, error }) => ({ biome, event, url, ok, bytes, error })), budgets };
}

/** Warm the cache with a pack's effect files, in the background (the board does not wait for them). */
export function preloadEffects(pack: ScenePack, load: AssetLoader): Promise<string[]> {
  const failed: string[] = [];
  const items = effectUrls(pack);
  return Promise.all(items.map((it) => load(it.url, it.kind).catch(() => void failed.push(it.url)))).then(() => failed);
}

/**
 * Warm the cache with a pack's accent files (spec 1.3), stage 1 first, a few
 * at a time, in the background (the board does not wait; a piece whose file
 * fails is simply not drawn). Returns the URLs that failed.
 */
export async function preloadOverlays(pack: ScenePack, load: AssetLoader, concurrency = 3): Promise<string[]> {
  const items = overlayUrls(pack);
  const failed: string[] = [];
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const it = items[next++]!;
      await load(it.url, 'image').catch(() => void failed.push(it.url));
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return failed;
}
