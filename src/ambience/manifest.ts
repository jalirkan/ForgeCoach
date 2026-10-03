/*
 * ForgeCoach — ambience/manifest.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The scenery asset pack's manifest (`scenery.json`, schema 1; the contract
 * is docs/scenery-pack-spec.md) and its strict validator. DOM-free.
 *
 * A pack is untrusted input, served from wherever the user pointed the page:
 * every string is cleaned and clipped, every number range-checked, every URL
 * must be http(s) or relative (resolved against the pack's base, never
 * `javascript:`, `data:`, credentials or protocol-relative), and unknown
 * fields are ignored. One bad layer drops that layer (a warning); a biome left
 * with nothing to draw drops that biome (it falls back to the procedural
 * scene); only a manifest that is not a schema-1 pack at all is an error.
 */
import { cleanText, int, num } from '../lab/status.ts';
import { BIOMES, MAX_STAGES, type Biome } from './model.ts';

export const MANIFEST_SCHEMA = 1;
/** The manifest file's name when the pack URL names a folder. */
export const MANIFEST_FILE = 'scenery.json';
/** Larger than any sensible manifest; refuse bigger bodies. */
export const MAX_MANIFEST_BYTES = 256 * 1024;
/** Per stage. More layers than this cost frames on a phone; extras are dropped. */
export const MAX_LAYERS = 8;
export const MAX_SPRITE_FRAMES = 120;
const MAX_URL = 512;

export const BLEND_MODES = ['normal', 'screen', 'multiply', 'overlay', 'lighten', 'darken', 'soft-light', 'color-dodge', 'plus-lighter'] as const;
export type BlendMode = (typeof BLEND_MODES)[number];
export const LAYER_KINDS = ['image', 'sprite', 'video'] as const;
export type LayerKind = (typeof LAYER_KINDS)[number];
export const BLOOM_KINDS = ['rise', 'fade', 'grow', 'wipe', 'none'] as const;
export type BloomKind = (typeof BLOOM_KINDS)[number];
export const IDLE_KINDS = ['sway', 'drift', 'breathe', 'none'] as const;
export type IdleKind = (typeof IDLE_KINDS)[number];
export const SLOT_PREFS = ['any', 'left', 'right'] as const;
export type SlotPref = (typeof SLOT_PREFS)[number];
export const FITS = ['cover', 'contain', 'fill'] as const;
export type Fit = (typeof FITS)[number];

const IMAGE_EXT = /\.(webp|avif|png|jpe?g|svg)$/i;
const VIDEO_EXT = /\.(webm|mp4)$/i;
const MP4_EXT = /\.mp4$/i;

export interface PackLayer {
  /** Stable within the biome: a layer with the same id in the next stage stays put instead of blooming again. */
  id: string;
  kind: LayerKind;
  /** Resolved absolute URL. */
  src: string;
  /** image / sprite: the 2x file, or null. */
  src2x: string | null;
  /** video: the mp4 fallback for browsers without webm alpha, or null. */
  fallback: string | null;
  /** video / sprite: the still shown with reduced motion (else frame 0 / the first video frame). */
  poster: string | null;
  /** sprite: grid and timing (frames = cols × rows). 1 for other kinds. */
  frames: number;
  cols: number;
  rows: number;
  fps: number;
  /** 0 = far (barely moves) … 1 = near (moves most). Scales idle motion and the bloom's travel. */
  depth: number;
  blend: BlendMode;
  /** Stacking within the slot, −100..100; higher is nearer. */
  z: number;
  opacity: number;
  /** Placement as fractions: x/w of the slot's width, y/h of the strip's height, y from the bottom. */
  x: number;
  y: number;
  w: number;
  h: number;
  fit: Fit;
  /** Takes part in the biome's idle loop. */
  idle: boolean;
}

export interface PackStage {
  layers: PackLayer[];
}

export interface PackBiome {
  label: string | null;
  slot: { prefer: SlotPref; weight: number };
  /** stages[0] is stage 1. A slot past the last stage shows the last. */
  stages: PackStage[];
  bloom: { kind: BloomKind; durationMs: number; staggerMs: number };
  idle: { kind: IdleKind; periodMs: number; amplitude: number };
}

export interface PackStrip {
  /** The strip's height as a fraction of the battlefield's. */
  heightRatio: number;
  minHeightPx: number;
  maxHeightPx: number;
  /** Width of the gradient mask where two biomes meet. */
  seamPx: number;
  /** How much of the strip (from its inner edge) fades into the board. */
  fadeRatio: number;
  /** `arrival`: slots left to right by first land; `preference`: biomes that prefer left/right go there. */
  order: 'arrival' | 'preference';
}

export interface ScenePack {
  schema: 1;
  name: string;
  author: string | null;
  license: string | null;
  /** The base URL every relative asset was resolved against. */
  base: string;
  strip: PackStrip;
  /** Growth thresholds (weights where stage 1, 2, … begin), or null for the default. */
  stageThresholds: number[] | null;
  biomes: Partial<Record<Biome, PackBiome>>;
}

export interface ManifestResult {
  pack: ScenePack | null;
  /** Why there is no pack. */
  errors: string[];
  /** What was dropped or corrected; the pack still works. */
  warnings: string[];
}

export const DEFAULT_STRIP: PackStrip = { heightRatio: 0.46, minHeightPx: 64, maxHeightPx: 280, seamPx: 120, fadeRatio: 0.38, order: 'arrival' };

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

function oneOf<T extends string>(v: unknown, allowed: readonly T[], dflt: T, path: string, warn: string[]): T {
  if (v === undefined || v === null) return dflt;
  if (typeof v === 'string' && (allowed as readonly string[]).includes(v)) return v as T;
  warn.push(`${path}: "${cleanText(v, 40) ?? typeof v}" is not one of ${allowed.join(', ')}; using ${dflt}`);
  return dflt;
}

function ranged(v: unknown, min: number, max: number, dflt: number, path: string, warn: string[], whole = false): number {
  if (v === undefined || v === null) return dflt;
  const n = whole ? int(v, min, max) : num(v, min, max);
  if (n === null) {
    warn.push(`${path}: ${cleanText(v, 40) ?? typeof v} is out of range ${min}–${max}; using ${dflt}`);
    return dflt;
  }
  return n;
}

/** Is `base` a usable pack base (http(s), no credentials)? Returns it normalised to end in "/". */
export function packBase(base: string): string | null {
  try {
    const u = new URL(base);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (u.username || u.password) return null;
    u.hash = '';
    u.search = '';
    if (!u.pathname.endsWith('/')) u.pathname = u.pathname.replace(/[^/]*$/, '');
    return u.href;
  } catch {
    return null;
  }
}

/**
 * An asset URL from the manifest, resolved against `base`, or a reason it is
 * refused. Allowed: `http(s)://…` (no credentials) and plain relative paths.
 * Refused: other schemes, protocol-relative `//host`, quotes, brackets,
 * backslashes, whitespace or control characters, and anything over 512 chars.
 */
export function assetUrl(v: unknown, base: string): { url: string } | { error: string } {
  if (typeof v !== 'string' || !v) return { error: 'missing' };
  if (v.length > MAX_URL) return { error: 'longer than 512 characters' };
  // eslint-disable-next-line no-control-regex
  if (/[\s\u0000-\u001f\u007f"'`()<>\\{}]/.test(v)) return { error: 'contains spaces, quotes, brackets or control characters' };
  if (v.startsWith('//')) return { error: 'protocol-relative URLs are not allowed' };
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(v);
  if (scheme && !/^https?$/i.test(scheme[1]!)) return { error: `the ${scheme[1]!.toLowerCase()}: scheme is not allowed (http, https or relative only)` };
  try {
    const u = new URL(v, base);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return { error: 'not an http(s) URL' };
    if (u.username || u.password) return { error: 'URLs with credentials are not allowed' };
    return { url: u.href };
  } catch {
    return { error: 'not a URL' };
  }
}

function layerUrl(v: unknown, base: string, ext: RegExp, extName: string, path: string, problems: string[], optional: boolean): string | null {
  if (optional && (v === undefined || v === null || v === '')) return null;
  const r = assetUrl(v, base);
  if ('error' in r) {
    problems.push(`${path}: ${r.error}`);
    return null;
  }
  if (!ext.test(new URL(r.url).pathname)) {
    problems.push(`${path}: expected ${extName}`);
    return null;
  }
  return r.url;
}

function parseLayer(v: unknown, base: string, path: string, warn: string[]): PackLayer | null {
  if (!isObj(v)) {
    warn.push(`${path}: not an object; layer dropped`);
    return null;
  }
  const problems: string[] = [];
  const id = cleanText(v.id, 40);
  if (!id || !/^[A-Za-z0-9][\w.-]*$/.test(id)) problems.push(`${path}.id: missing, or not letters, digits, - _ .`);
  const kind = typeof v.kind === 'string' && (LAYER_KINDS as readonly string[]).includes(v.kind) ? (v.kind as LayerKind) : null;
  if (!kind) problems.push(`${path}.kind: must be image, sprite or video`);
  const isVideo = kind === 'video';
  const ext = isVideo ? VIDEO_EXT : IMAGE_EXT;
  const extName = isVideo ? '.webm or .mp4' : '.webp, .avif, .png, .jpg or .svg';
  const src = kind ? layerUrl(v.src, base, ext, extName, `${path}.src`, problems, false) : null;
  const opt: string[] = [];
  const src2x = !isVideo ? layerUrl(v.src2x, base, IMAGE_EXT, '.webp, .avif, .png, .jpg or .svg', `${path}.src2x`, opt, true) : null;
  const fallback = isVideo ? layerUrl(v.fallback, base, MP4_EXT, '.mp4', `${path}.fallback`, opt, true) : null;
  const poster = kind !== 'image' ? layerUrl(v.poster, base, IMAGE_EXT, 'an image', `${path}.poster`, opt, true) : null;
  for (const o of opt) warn.push(`${o}; ignored`);

  let frames = 1;
  let cols = 1;
  let rows = 1;
  let fps = 0;
  if (kind === 'sprite') {
    frames = int(v.frames, 1, MAX_SPRITE_FRAMES) ?? 0;
    cols = int(v.cols, 1, 32) ?? 0;
    rows = v.rows === undefined ? (cols ? Math.ceil(frames / cols) : 0) : int(v.rows, 1, 32) ?? 0;
    fps = num(v.fps, 1, 60) ?? 0;
    if (!frames) problems.push(`${path}.frames: a whole number 1–${MAX_SPRITE_FRAMES}`);
    if (!cols) problems.push(`${path}.cols: a whole number 1–32`);
    if (!rows) problems.push(`${path}.rows: a whole number 1–32`);
    if (!fps) problems.push(`${path}.fps: 1–60`);
    if (frames && cols && rows && frames !== cols * rows) problems.push(`${path}: frames (${frames}) must fill the grid (cols × rows = ${cols * rows})`);
  }
  if (problems.length) {
    warn.push(...problems.map((p) => `${p}; layer dropped`));
    return null;
  }
  return {
    id: id!,
    kind: kind!,
    src: src!,
    src2x,
    fallback,
    poster,
    frames,
    cols,
    rows,
    fps,
    depth: ranged(v.depth, 0, 1, 0.5, `${path}.depth`, warn),
    blend: oneOf(v.blend, BLEND_MODES, 'normal', `${path}.blend`, warn),
    z: ranged(v.z, -100, 100, 0, `${path}.z`, warn, true),
    opacity: ranged(v.opacity, 0, 1, 1, `${path}.opacity`, warn),
    x: ranged(v.x, -1, 1, 0, `${path}.x`, warn),
    y: ranged(v.y, -1, 1, 0, `${path}.y`, warn),
    w: ranged(v.w, 0.01, 2, 1, `${path}.w`, warn),
    h: ranged(v.h, 0.01, 2, 1, `${path}.h`, warn),
    fit: oneOf(v.fit, FITS, 'cover', `${path}.fit`, warn),
    idle: v.idle === undefined ? true : v.idle === true,
  };
}

function parseBiome(v: unknown, base: string, path: string, warn: string[]): PackBiome | null {
  if (!isObj(v)) {
    warn.push(`${path}: not an object; biome uses the built-in scene`);
    return null;
  }
  const rawStages = Array.isArray(v.stages) ? v.stages : [];
  if (rawStages.length > MAX_STAGES) warn.push(`${path}.stages: more than ${MAX_STAGES}; the rest ignored`);
  const stages: PackStage[] = [];
  rawStages.slice(0, MAX_STAGES).forEach((st, i) => {
    const sp = `${path}.stages[${i}]`;
    const rawLayers = isObj(st) && Array.isArray(st.layers) ? st.layers : Array.isArray(st) ? st : null;
    if (!rawLayers) {
      warn.push(`${sp}: needs a "layers" list; stage dropped`);
      return;
    }
    if (rawLayers.length > MAX_LAYERS) warn.push(`${sp}.layers: more than ${MAX_LAYERS}; the rest ignored`);
    const layers: PackLayer[] = [];
    const ids = new Set<string>();
    rawLayers.slice(0, MAX_LAYERS).forEach((l, j) => {
      const layer = parseLayer(l, base, `${sp}.layers[${j}]`, warn);
      if (!layer) return;
      if (ids.has(layer.id)) {
        warn.push(`${sp}.layers[${j}].id: "${layer.id}" repeats in this stage; layer dropped`);
        return;
      }
      ids.add(layer.id);
      layers.push(layer);
    });
    if (layers.length) stages.push({ layers });
    else warn.push(`${sp}: no usable layers; stage dropped`);
  });
  if (!stages.length) {
    warn.push(`${path}: no usable stages; biome uses the built-in scene`);
    return null;
  }
  const slot = isObj(v.slot) ? v.slot : {};
  const bloom = isObj(v.bloom) ? v.bloom : {};
  const idle = isObj(v.idle) ? v.idle : {};
  return {
    label: cleanText(v.label, 60),
    slot: {
      prefer: oneOf(slot.prefer, SLOT_PREFS, 'any', `${path}.slot.prefer`, warn),
      weight: ranged(slot.weight, 0.5, 3, 1, `${path}.slot.weight`, warn),
    },
    stages,
    bloom: {
      kind: oneOf(bloom.kind, BLOOM_KINDS, 'rise', `${path}.bloom.kind`, warn),
      durationMs: ranged(bloom.durationMs, 0, 5000, 1400, `${path}.bloom.durationMs`, warn, true),
      staggerMs: ranged(bloom.staggerMs, 0, 1000, 120, `${path}.bloom.staggerMs`, warn, true),
    },
    idle: {
      kind: oneOf(idle.kind, IDLE_KINDS, 'drift', `${path}.idle.kind`, warn),
      periodMs: ranged(idle.periodMs, 1000, 60000, 9000, `${path}.idle.periodMs`, warn, true),
      amplitude: ranged(idle.amplitude, 0, 1, 0.3, `${path}.idle.amplitude`, warn),
    },
  };
}

function parseStrip(v: unknown, warn: string[]): PackStrip {
  if (v !== undefined && !isObj(v)) warn.push('strip: not an object; defaults used');
  const s = isObj(v) ? v : {};
  const strip: PackStrip = {
    heightRatio: ranged(s.heightRatio, 0.08, 0.6, DEFAULT_STRIP.heightRatio, 'strip.heightRatio', warn),
    minHeightPx: ranged(s.minHeightPx, 24, 400, DEFAULT_STRIP.minHeightPx, 'strip.minHeightPx', warn, true),
    maxHeightPx: ranged(s.maxHeightPx, 24, 600, DEFAULT_STRIP.maxHeightPx, 'strip.maxHeightPx', warn, true),
    seamPx: ranged(s.seamPx, 0, 256, DEFAULT_STRIP.seamPx, 'strip.seamPx', warn, true),
    fadeRatio: ranged(s.fadeRatio, 0, 1, DEFAULT_STRIP.fadeRatio, 'strip.fadeRatio', warn),
    order: oneOf(s.order, ['arrival', 'preference'] as const, 'arrival', 'strip.order', warn),
  };
  if (strip.maxHeightPx < strip.minHeightPx) {
    warn.push('strip.maxHeightPx is below minHeightPx; swapped');
    [strip.minHeightPx, strip.maxHeightPx] = [strip.maxHeightPx, strip.minHeightPx];
  }
  return strip;
}

function parseThresholds(v: unknown, warn: string[]): number[] | null {
  if (v === undefined || v === null) return null;
  const ok =
    Array.isArray(v) &&
    v.length >= 1 &&
    v.length <= MAX_STAGES &&
    v.every((x, i) => num(x, 0.5, 40) !== null && (i === 0 || (x as number) > (v[i - 1] as number)));
  if (!ok) {
    warn.push(`stageThresholds: 1–${MAX_STAGES} increasing numbers 0.5–40; default used`);
    return null;
  }
  return (v as number[]).map(Number);
}

/**
 * Validate a parsed manifest. `base` is the pack's base URL (see {@link packBase});
 * relative asset paths resolve against it.
 */
export function validateManifest(raw: unknown, base: string): ManifestResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const b = packBase(base);
  if (!b) return { pack: null, errors: ['The pack URL must be http:// or https:// (no user name or password).'], warnings };
  if (!isObj(raw)) return { pack: null, errors: ['The manifest is not a JSON object.'], warnings };
  if (raw.schema !== MANIFEST_SCHEMA) {
    errors.push(`schema: expected ${MANIFEST_SCHEMA}, found ${cleanText(raw.schema, 20) ?? 'nothing'}.`);
    return { pack: null, errors, warnings };
  }
  const biomes: Partial<Record<Biome, PackBiome>> = {};
  if (!isObj(raw.biomes)) {
    errors.push('biomes: missing (an object keyed by island, swamp, mountain, forest, plains, wastes).');
    return { pack: null, errors, warnings };
  }
  for (const key of Object.keys(raw.biomes)) {
    if (!(BIOMES as readonly string[]).includes(key)) warnings.push(`biomes.${cleanText(key, 30)}: not a biome; ignored`);
  }
  for (const biome of BIOMES) {
    if (!(biome in raw.biomes)) continue;
    const parsed = parseBiome(raw.biomes[biome], b, `biomes.${biome}`, warnings);
    if (parsed) biomes[biome] = parsed;
  }
  if (Object.keys(biomes).length === 0) {
    errors.push('No biome has a usable layer.');
    return { pack: null, errors, warnings };
  }
  return {
    pack: {
      schema: 1,
      name: cleanText(raw.name, 80) ?? 'Untitled pack',
      author: cleanText(raw.author, 80),
      license: cleanText(raw.license, 80),
      base: b,
      strip: parseStrip(raw.strip, warnings),
      stageThresholds: parseThresholds(raw.stageThresholds, warnings),
      biomes,
    },
    errors,
    warnings,
  };
}

/** The layers a biome shows at a stage (the last defined stage when the slot has grown past it). */
export function layersAt(biome: PackBiome | undefined, stage: number): PackLayer[] {
  if (!biome || stage <= 0) return [];
  return biome.stages[Math.min(stage, biome.stages.length) - 1]?.layers ?? [];
}

/** Every asset URL a pack would load, stage 1 first (preload order). */
export function packUrls(pack: ScenePack): { biome: Biome; stage: number; url: string; kind: LayerKind }[] {
  const out: { biome: Biome; stage: number; url: string; kind: LayerKind }[] = [];
  const seen = new Set<string>();
  for (let stage = 1; stage <= MAX_STAGES; stage++) {
    for (const biome of BIOMES) {
      for (const l of pack.biomes[biome]?.stages[stage - 1]?.layers ?? []) {
        if (seen.has(l.src)) continue;
        seen.add(l.src);
        out.push({ biome, stage, url: l.src, kind: l.kind });
      }
    }
  }
  return out;
}
