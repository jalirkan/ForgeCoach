/*
 * ForgeCoach — ambience/manifest.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The scenery asset pack's manifest (`scenery.json`, schema 1, spec 1.3; the
 * contract is docs/scenery-pack-spec.md) and its strict validator. DOM-free.
 * Spec 1.2 adds optional one-shot `effects` (creature enters, attack, damage,
 * landfall, stage up), globally and per biome; spec 1.3 adds optional board
 * accents (`overlay` per stage: corner and edge pieces in the player's area,
 * outside the strip). A 1.1 or 1.2 pack reads as before.
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
/** The spec minor version this engine reads (docs/scenery-pack-spec.md). */
export const SPEC_VERSION = '1.3';
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
/** Where a `contain` (or `cover`) picture sits in its box: CSS object-position, by name. */
export const ANCHORS = ['center', 'top', 'bottom', 'left', 'right', 'top-left', 'top-right', 'bottom-left', 'bottom-right'] as const;
export type Anchor = (typeof ANCHORS)[number];
/** Per stage: more sprites and videos than this is over the spec's budget (a warning; the layers are kept). */
export const MAX_MOVING_LAYERS = 2;

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
  /** Where the picture sits in its box with `contain` / `cover` (ignored with `fill`). Default `center`. */
  anchor: Anchor;
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

// ---------------------------------------------------------------------------
// Effects (spec 1.2)

/** What an effect answers to. `damagePlayer` hits a player; `damageCreature` a card on the battlefield. */
export const EFFECT_EVENTS = ['creatureEnter', 'attack', 'damagePlayer', 'damageCreature', 'landfall', 'stageUp'] as const;
export type EffectEvent = (typeof EFFECT_EVENTS)[number];
export const EFFECT_KINDS = ['sprite', 'video', 'particles'] as const;
export type EffectKind = (typeof EFFECT_KINDS)[number];
/** Built-in particle effects a pack may name instead of shipping files (drawn in the biome's colour, or `color`). */
export const PARTICLE_PRESETS = ['shimmer', 'sweep', 'flash', 'crack', 'motes', 'ripple'] as const;
export type ParticlePreset = (typeof PARTICLE_PRESETS)[number];
/** Where an effect plays: the slot of its biome, the card's position (falls back to the slot), or the strip's middle. */
export const EFFECT_AT = ['slot', 'card', 'strip'] as const;
export type EffectAt = (typeof EFFECT_AT)[number];
/** With reduced motion: skip it, show a still glow, or show the effect's `poster`. */
export const EFFECT_REDUCED = ['skip', 'glow', 'poster'] as const;
export type EffectReduced = (typeof EFFECT_REDUCED)[number];
/** Every effect is a short one-shot: longer sheets and clips are cut here. */
export const MAX_EFFECT_MS = 2500;
/** The declared `bytes` of one biome's effects (and of the global ones) should stay under this. */
export const MAX_EFFECT_BYTES = 4 * 1024 * 1024;
export const MAX_CONCURRENT_EFFECTS = 6;
export const DEFAULT_CONCURRENT_EFFECTS = 3;
/** Each preset's own length when the pack gives no `durationMs` (all under 600 ms). */
export const PRESET_MS: Record<ParticlePreset, number> = { shimmer: 560, sweep: 520, flash: 480, crack: 560, motes: 580, ripple: 580 };

export interface PackEffect {
  kind: EffectKind;
  /** sprite / video: resolved URLs. */
  src: string | null;
  src2x: string | null;
  fallback: string | null;
  poster: string | null;
  frames: number;
  cols: number;
  rows: number;
  fps: number;
  /** particles: the preset, and its colour (#rgb / #rrggbb) or null for the biome's. */
  preset: ParticlePreset | null;
  color: string | null;
  /** How long it plays, ≤ 2500 ms. */
  durationMs: number;
  blend: BlendMode;
  /** The effect box's height as a fraction of the strip's height. */
  scale: number;
  /** The box's width ÷ height. */
  aspect: number;
  /** The box's bottom edge, as a fraction of the strip's height. */
  y: number;
  at: EffectAt;
  /** Flip vertically on the opponent's (top) strip, so art drawn pointing up points at the other player. */
  mirror: boolean;
  reduced: EffectReduced;
  /** Declared size of its files in bytes (for the budget), or null. */
  bytes: number | null;
}

export type PackEffects = Partial<Record<EffectEvent, PackEffect>>;

export interface PackEffectSet {
  maxConcurrent: number;
  /** Used for any biome without its own effect for the event. */
  global: PackEffects;
  /** Per-biome effects (a biome may have effects and still use the built-in scene). */
  biomes: Partial<Record<Biome, PackEffects>>;
}

const EFFECT_AT_DEFAULT: Record<EffectEvent, EffectAt> = { creatureEnter: 'card', attack: 'slot', damagePlayer: 'strip', damageCreature: 'card', landfall: 'slot', stageUp: 'slot' };

function parseEffect(v: unknown, event: EffectEvent, base: string, path: string, warn: string[]): PackEffect | null {
  if (!isObj(v)) {
    warn.push(`${path}: not an object; effect dropped`);
    return null;
  }
  const problems: string[] = [];
  const kind = typeof v.kind === 'string' && (EFFECT_KINDS as readonly string[]).includes(v.kind) ? (v.kind as EffectKind) : null;
  if (!kind) problems.push(`${path}.kind: must be sprite, video or particles`);
  let src: string | null = null;
  let preset: ParticlePreset | null = null;
  if (kind === 'sprite') src = layerUrl(v.src, base, IMAGE_EXT, '.webp, .avif, .png, .jpg or .svg', `${path}.src`, problems, false);
  else if (kind === 'video') src = layerUrl(v.src, base, VIDEO_EXT, '.webm or .mp4', `${path}.src`, problems, false);
  else if (kind === 'particles') {
    if (typeof v.preset === 'string' && (PARTICLE_PRESETS as readonly string[]).includes(v.preset)) preset = v.preset as ParticlePreset;
    else problems.push(`${path}.preset: must be one of ${PARTICLE_PRESETS.join(', ')}`);
  }
  const opt: string[] = [];
  const src2x = kind === 'sprite' ? layerUrl(v.src2x, base, IMAGE_EXT, '.webp, .avif, .png, .jpg or .svg', `${path}.src2x`, opt, true) : null;
  const fallback = kind === 'video' ? layerUrl(v.fallback, base, MP4_EXT, '.mp4', `${path}.fallback`, opt, true) : null;
  const poster = layerUrl(v.poster, base, IMAGE_EXT, 'an image', `${path}.poster`, opt, true);
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
    warn.push(...problems.map((p) => `${p}; effect dropped`));
    return null;
  }
  if (v.loop !== undefined && v.loop !== false) warn.push(`${path}.loop: effects play once; loop ignored`);

  // Its natural length (a sheet's frames at its fps, a preset's own, 2 s for a clip), then the pack's durationMs, then the cap.
  const natural = kind === 'sprite' ? Math.round((frames / fps) * 1000) : kind === 'particles' ? PRESET_MS[preset!] : 2000;
  let durationMs = natural;
  if (v.durationMs !== undefined && v.durationMs !== null) {
    const d = int(v.durationMs, 100, MAX_EFFECT_MS);
    if (d === null) warn.push(`${path}.durationMs: ${cleanText(v.durationMs, 40) ?? typeof v.durationMs} is out of range 100–${MAX_EFFECT_MS}; using ${Math.min(natural, MAX_EFFECT_MS)}`);
    else durationMs = d;
  }
  if (durationMs > MAX_EFFECT_MS) {
    warn.push(`${path}: the sheet runs ${durationMs} ms (${frames} frames at ${fps} fps); cut at ${MAX_EFFECT_MS}`);
    durationMs = MAX_EFFECT_MS;
  }
  let color: string | null = null;
  if (v.color !== undefined && v.color !== null) {
    if (typeof v.color === 'string' && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v.color)) color = v.color.toLowerCase();
    else warn.push(`${path}.color: not #rgb or #rrggbb; using the biome's colour`);
  }
  let reduced = oneOf(v.reduced, EFFECT_REDUCED, 'glow', `${path}.reduced`, warn);
  if (reduced === 'poster' && !poster) {
    warn.push(`${path}.reduced: "poster" needs a poster; using glow`);
    reduced = 'glow';
  }
  let bytes: number | null = null;
  if (v.bytes !== undefined && v.bytes !== null) {
    bytes = int(v.bytes, 0, 1e9);
    if (bytes === null) warn.push(`${path}.bytes: a whole number of bytes; ignored`);
  }
  return {
    kind: kind!,
    src,
    src2x,
    fallback,
    poster,
    frames,
    cols,
    rows,
    fps,
    preset,
    color,
    durationMs,
    blend: oneOf(v.blend, BLEND_MODES, 'screen', `${path}.blend`, warn),
    scale: ranged(v.scale, 0.1, 3, 1, `${path}.scale`, warn),
    aspect: ranged(v.aspect, 0.2, 8, 1, `${path}.aspect`, warn),
    y: ranged(v.y, -1, 1, 0, `${path}.y`, warn),
    at: oneOf(v.at, EFFECT_AT, EFFECT_AT_DEFAULT[event], `${path}.at`, warn),
    mirror: v.mirror === undefined ? event === 'attack' : v.mirror === true,
    reduced,
    bytes,
  };
}

/** The declared bytes of a set of effects. */
export function effectBytes(set: PackEffects | undefined): number {
  return Object.values(set ?? {}).reduce((n, e) => n + (e?.bytes ?? 0), 0);
}

/** One `effects` object: event name → effect. `top` allows `maxConcurrent`. */
function parseEffects(v: unknown, base: string, path: string, warn: string[], top: boolean): PackEffects {
  const out: PackEffects = {};
  if (v === undefined || v === null) return out;
  if (!isObj(v)) {
    warn.push(`${path}: not an object; ignored`);
    return out;
  }
  for (const key of Object.keys(v)) {
    if (key === 'maxConcurrent') {
      if (!top) warn.push(`${path}.maxConcurrent: only at the top level (effects.maxConcurrent); ignored`);
      continue;
    }
    if (!(EFFECT_EVENTS as readonly string[]).includes(key)) {
      warn.push(`${path}.${cleanText(key, 30)}: not an effect event (${EFFECT_EVENTS.join(', ')}); ignored`);
      continue;
    }
    const e = parseEffect(v[key], key as EffectEvent, base, `${path}.${key}`, warn);
    if (e) out[key as EffectEvent] = e;
  }
  const bytes = effectBytes(out);
  if (bytes > MAX_EFFECT_BYTES) warn.push(`${path}: ${(bytes / 1048576).toFixed(1)} MB of effects declared; the budget is ${MAX_EFFECT_BYTES / 1048576} MB (effects kept)`);
  return out;
}

function parseEffectSet(raw: Obj, base: string, warn: string[]): PackEffectSet | null {
  const top = isObj(raw.effects) ? raw.effects : {};
  const global = parseEffects(raw.effects, base, 'effects', warn, true);
  const biomes: Partial<Record<Biome, PackEffects>> = {};
  if (isObj(raw.biomes)) {
    for (const b of BIOMES) {
      const bv = raw.biomes[b];
      if (!isObj(bv) || bv.effects === undefined) continue;
      const e = parseEffects(bv.effects, base, `biomes.${b}.effects`, warn, false);
      if (Object.keys(e).length) biomes[b] = e;
    }
  }
  const maxConcurrent = ranged(top.maxConcurrent, 1, MAX_CONCURRENT_EFFECTS, DEFAULT_CONCURRENT_EFFECTS, 'effects.maxConcurrent', warn, true);
  const any = Object.keys(global).length > 0 || Object.keys(biomes).length > 0;
  return any ? { maxConcurrent, global, biomes } : null;
}

/** The pack's effect for an event in a biome (the biome's own, else the global one), or null. */
export function packEffect(pack: ScenePack | null | undefined, event: EffectEvent, biome: Biome | null): PackEffect | null {
  const fx = pack?.effects;
  if (!fx) return null;
  return (biome ? fx.biomes[biome]?.[event] : undefined) ?? fx.global[event] ?? null;
}

/** Every effect file a pack names (src, poster), for preloading and the preview's status. */
export function effectUrls(pack: ScenePack): { biome: Biome | null; event: EffectEvent; url: string; kind: 'image' | 'video' }[] {
  const out: { biome: Biome | null; event: EffectEvent; url: string; kind: 'image' | 'video' }[] = [];
  const seen = new Set<string>();
  const add = (biome: Biome | null, event: EffectEvent, url: string | null, kind: 'image' | 'video') => {
    if (!url || seen.has(url)) return;
    seen.add(url);
    out.push({ biome, event, url, kind });
  };
  const group = (biome: Biome | null, set: PackEffects) => {
    for (const event of EFFECT_EVENTS) {
      const e = set[event];
      if (!e) continue;
      add(biome, event, e.src, e.kind === 'video' ? 'video' : 'image');
      add(biome, event, e.poster, 'image');
    }
  };
  if (!pack.effects) return out;
  group(null, pack.effects.global);
  for (const b of BIOMES) if (pack.effects.biomes[b]) group(b, pack.effects.biomes[b]!);
  return out;
}

// ---------------------------------------------------------------------------
// Board accents (spec 1.3)

/** Where an accent piece hugs the player's area. Corners take a picture; edges take a band. */
export const OVERLAY_ANCHORS = ['top-left', 'top-right', 'bottom-left', 'bottom-right', 'top-edge', 'bottom-edge', 'left-edge', 'right-edge'] as const;
export type OverlayAnchor = (typeof OVERLAY_ANCHORS)[number];
export const isOverlayCorner = (a: OverlayAnchor) => !a.endsWith('-edge');
/** An edge band: the picture repeats along the edge (seamless art), or is stretched to it. */
export const OVERLAY_TILES = ['repeat', 'stretch'] as const;
export type OverlayTile = (typeof OVERLAY_TILES)[number];
/** CSS-only motion on a still picture. */
export const OVERLAY_MOTIONS = ['none', 'sway', 'drift', 'breathe'] as const;
export type OverlayMotion = (typeof OVERLAY_MOTIONS)[number];
/** How a stage's `overlay` list combines with the previous stage's pieces. */
export const OVERLAY_MODES = ['replace', 'add'] as const;
export type OverlayMode = (typeof OVERLAY_MODES)[number];
/** The procedural placeholders ForgeCoach draws itself (no files); a pack names a `src` instead. */
export const BUILTIN_OVERLAYS = ['vine', 'leaves', 'frost', 'spray', 'ash', 'embers', 'moss', 'mist', 'petals', 'motes', 'dust'] as const;
export type BuiltinOverlay = (typeof BUILTIN_OVERLAYS)[number];

/** At most this many accent pieces show in one player's area (more are dropped). */
export const MAX_OVERLAY_PIECES = 6;
/** At most this many accent pieces per stage may move (CSS sway / drift / breathe); the rest are drawn still. */
export const MAX_OVERLAY_ANIMATED = 3;
/** The declared `bytes` of one biome's accent files should stay under this (a warning). */
export const MAX_OVERLAY_BYTES = 2 * 1024 * 1024;
/** Defaults by kind of anchor: a corner's width, or an edge band's thickness, as a fraction of the area's width, and its pixel cap. */
export const OVERLAY_DEFAULTS = { corner: { size: 0.18, maxPx: 280 }, edge: { size: 0.05, maxPx: 72 } } as const;

const OVERLAY_EXT = /\.(webp|avif)$/i;

export interface OverlayPiece {
  /** Unique within a stage; with `overlayMode: "add"` a piece with an earlier id replaces it. */
  id: string;
  anchor: OverlayAnchor;
  /** Resolved URL (a pack's), or null for a built-in placeholder (`builtin`). */
  src: string | null;
  src2x: string | null;
  /** A procedural placeholder drawn by ForgeCoach (built-in accents only). */
  builtin: BuiltinOverlay | null;
  /** Corner: the picture's width; edge: the band's thickness; as a fraction of the area's width. */
  size: number;
  /** A pixel cap on that width or thickness. */
  maxPx: number;
  /** Edges only. */
  tile: OverlayTile;
  opacity: number;
  blend: BlendMode;
  motion: OverlayMotion;
  periodMs: number;
  /** On the opponent's side, flip vertically so the piece hugs their (top) edge. */
  mirror: boolean;
  bytes: number | null;
}

/** One biome's accents, per stage (`stages[0]` is stage 1), already combined across stages (replace / add). */
export interface PackOverlayBiome {
  stages: OverlayPiece[][];
}

export type PackOverlays = Partial<Record<Biome, PackOverlayBiome>>;

function parseOverlayPiece(v: unknown, base: string, path: string, warn: string[]): OverlayPiece | null {
  if (!isObj(v)) {
    warn.push(`${path}: not an object; piece dropped`);
    return null;
  }
  const problems: string[] = [];
  const id = cleanText(v.id, 40);
  if (!id || !/^[A-Za-z0-9][\w.-]*$/.test(id)) problems.push(`${path}.id: missing, or not letters, digits, - _ .`);
  let anchor: OverlayAnchor | null = null;
  if (typeof v.anchor === 'string' && (OVERLAY_ANCHORS as readonly string[]).includes(v.anchor)) anchor = v.anchor as OverlayAnchor;
  else problems.push(`${path}.anchor: "${cleanText(v.anchor, 40) ?? typeof v.anchor}" is not one of ${OVERLAY_ANCHORS.join(', ')}`);
  const src = layerUrl(v.src, base, OVERLAY_EXT, '.webp or .avif (a transparent still)', `${path}.src`, problems, false);
  if (problems.length) {
    warn.push(...problems.map((p) => `${p}; piece dropped`));
    return null;
  }
  const opt: string[] = [];
  const src2x = layerUrl(v.src2x, base, OVERLAY_EXT, '.webp or .avif', `${path}.src2x`, opt, true);
  for (const o of opt) warn.push(`${o}; ignored`);
  const corner = isOverlayCorner(anchor!);
  const d = corner ? OVERLAY_DEFAULTS.corner : OVERLAY_DEFAULTS.edge;
  let tile: OverlayTile = 'repeat';
  if (v.tile !== undefined && v.tile !== null) {
    if (corner) warn.push(`${path}.tile: only for edges; ignored`);
    else tile = oneOf(v.tile, OVERLAY_TILES, 'repeat', `${path}.tile`, warn);
  }
  let mirror = true;
  if (v.mirror !== undefined && v.mirror !== null) {
    if (typeof v.mirror === 'boolean') mirror = v.mirror;
    else warn.push(`${path}.mirror: not true or false; using true`);
  }
  let bytes: number | null = null;
  if (v.bytes !== undefined && v.bytes !== null) {
    bytes = int(v.bytes, 0, 1e9);
    if (bytes === null) warn.push(`${path}.bytes: a whole number of bytes; ignored`);
  }
  return {
    id: id!,
    anchor: anchor!,
    src,
    src2x,
    builtin: null,
    size: ranged(v.size, 0.02, 1, d.size, `${path}.size`, warn),
    maxPx: ranged(v.maxPx, 16, 1024, d.maxPx, `${path}.maxPx`, warn, true),
    tile,
    opacity: ranged(v.opacity, 0, 1, 1, `${path}.opacity`, warn),
    blend: oneOf(v.blend, BLEND_MODES, 'normal', `${path}.blend`, warn),
    motion: oneOf(v.motion, OVERLAY_MOTIONS, 'none', `${path}.motion`, warn),
    periodMs: ranged(v.periodMs, 2000, 60000, 9000, `${path}.periodMs`, warn, true),
    mirror,
    bytes,
  };
}

/**
 * Combine per-stage lists across stages. A stage without `overlay` (null here)
 * keeps the previous stage's pieces; `replace` (the default) lists the
 * stage's complete set; `add` adds to the previous stage's (a repeated id
 * replaces that piece, in its place). Then the caps: at most
 * {@link MAX_OVERLAY_PIECES} pieces (the first kept) and
 * {@link MAX_OVERLAY_ANIMATED} moving ones (the rest drawn still). Pure;
 * `warn` gets one line per cap hit, `path` naming the biome.
 */
export function combineOverlayStages(lists: ({ mode: OverlayMode; pieces: OverlayPiece[] } | null)[], path = 'overlay', warn: string[] = []): OverlayPiece[][] {
  const out: OverlayPiece[][] = [];
  let prev: OverlayPiece[] = [];
  lists.forEach((l, i) => {
    let cur: OverlayPiece[];
    if (!l) cur = prev;
    else if (l.mode === 'replace') cur = l.pieces;
    else {
      cur = [...prev];
      for (const p of l.pieces) {
        const at = cur.findIndex((x) => x.id === p.id);
        if (at >= 0) cur[at] = p;
        else cur.push(p);
      }
    }
    const sp = `${path}.stages[${i}].overlay`;
    if (cur.length > MAX_OVERLAY_PIECES) {
      if (l) warn.push(`${sp}: ${cur.length} pieces in this stage; at most ${MAX_OVERLAY_PIECES} show, the rest dropped`);
      cur = cur.slice(0, MAX_OVERLAY_PIECES);
    }
    let moving = 0;
    const capped = cur.map((p) => {
      if (p.motion === 'none') return p;
      moving++;
      return moving > MAX_OVERLAY_ANIMATED ? { ...p, motion: 'none' as const } : p;
    });
    if (moving > MAX_OVERLAY_ANIMATED && l) warn.push(`${sp}: ${moving} moving pieces; at most ${MAX_OVERLAY_ANIMATED} per stage move, the rest are drawn still`);
    out.push(capped);
    prev = capped;
  });
  return out;
}

/** The declared bytes of a biome's accent files (each file once). */
export function overlayBytes(b: PackOverlayBiome | undefined): number {
  const seen = new Map<string, number>();
  for (const st of b?.stages ?? []) for (const p of st) if (p.src && p.bytes !== null) seen.set(p.src, p.bytes);
  return [...seen.values()].reduce((n, x) => n + x, 0);
}

function parseOverlayBiome(v: Obj, base: string, path: string, warn: string[]): PackOverlayBiome | null {
  const rawStages = Array.isArray(v.stages) ? v.stages.slice(0, MAX_STAGES) : [];
  if (!rawStages.some((st) => isObj(st) && st.overlay !== undefined)) return null;
  const lists = rawStages.map((st, i) => {
    if (!isObj(st) || st.overlay === undefined) return null;
    const sp = `${path}.stages[${i}]`;
    const mode = oneOf(st.overlayMode, OVERLAY_MODES, 'replace', `${sp}.overlayMode`, warn);
    if (!Array.isArray(st.overlay)) {
      warn.push(`${sp}.overlay: not a list; ignored`);
      return null;
    }
    const pieces: OverlayPiece[] = [];
    const ids = new Set<string>();
    st.overlay.forEach((raw, j) => {
      const p = parseOverlayPiece(raw, base, `${sp}.overlay[${j}]`, warn);
      if (!p) return;
      if (ids.has(p.id)) {
        warn.push(`${sp}.overlay[${j}].id: "${p.id}" repeats in this stage; piece dropped`);
        return;
      }
      ids.add(p.id);
      pieces.push(p);
    });
    return { mode, pieces };
  });
  const stages = combineOverlayStages(lists, path, warn);
  if (!stages.some((s) => s.length)) {
    warn.push(`${path}: no usable accent pieces; the biome has no accents`);
    return { stages };
  }
  const out = { stages };
  const bytes = overlayBytes(out);
  if (bytes > MAX_OVERLAY_BYTES) warn.push(`${path}: ${(bytes / 1048576).toFixed(1)} MB of accents declared; the budget is ${MAX_OVERLAY_BYTES / 1048576} MB per biome (pieces kept)`);
  return out;
}

function parseOverlays(raw: Obj, base: string, warn: string[]): PackOverlays | null {
  if (!isObj(raw.biomes)) return null;
  const out: PackOverlays = {};
  for (const b of BIOMES) {
    const bv = raw.biomes[b];
    if (!isObj(bv)) continue;
    const o = parseOverlayBiome(bv, base, `biomes.${b}`, warn);
    if (o) out[b] = o;
  }
  return Object.keys(out).length ? out : null;
}

/** Does any biome of the pack have an accent piece? */
export function hasOverlays(pack: ScenePack | null | undefined): boolean {
  return Object.values(pack?.overlays ?? {}).some((b) => b?.stages.some((s) => s.length));
}

/**
 * A biome's accent pieces at a stage (the last given stage past the end), or
 * null when the pack gives that biome no accents. A pack that lists accents
 * for a biome, even all empty, owns them: an empty list means none.
 */
export function overlayAt(b: PackOverlayBiome | undefined, stage: number): OverlayPiece[] | null {
  if (!b || !b.stages.length) return null;
  if (stage <= 0) return [];
  return b.stages[Math.min(stage, b.stages.length) - 1] ?? [];
}

/** Every accent file a pack names, stage 1 first (preload order). */
export function overlayUrls(pack: ScenePack): { biome: Biome; stage: number; url: string }[] {
  const out: { biome: Biome; stage: number; url: string }[] = [];
  const seen = new Set<string>();
  for (let stage = 1; stage <= MAX_STAGES; stage++) {
    for (const biome of BIOMES) {
      for (const p of pack.overlays?.[biome]?.stages[stage - 1] ?? []) {
        if (!p.src || seen.has(p.src)) continue;
        seen.add(p.src);
        out.push({ biome, stage, url: p.src });
      }
    }
  }
  return out;
}

export interface ScenePack {
  schema: 1;
  /** The spec version the pack says it was written for ("1.3"), or null. Informational. */
  spec?: string | null;
  name: string;
  author: string | null;
  license: string | null;
  /** The base URL every relative asset was resolved against. */
  base: string;
  strip: PackStrip;
  /** Growth thresholds (weights where stage 1, 2, … begin), or null for the default. */
  stageThresholds: number[] | null;
  biomes: Partial<Record<Biome, PackBiome>>;
  /** Spec 1.2: one-shot effects, or undefined / null when the pack has none (the built-in placeholders play). */
  effects?: PackEffectSet | null;
  /** Spec 1.3: board accents per biome, or undefined / null when the pack has none. */
  overlays?: PackOverlays | null;
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
    anchor: oneOf(v.anchor, ANCHORS, 'center', `${path}.anchor`, warn),
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
  // Accents only (spec 1.3): every stage has an `overlay` and no `layers`; the strip keeps the built-in scene, no warning.
  const accentsOnly = rawStages.length > 0 && rawStages.every((st) => isObj(st) && st.layers === undefined && st.overlay !== undefined);
  if (accentsOnly) return null;
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
    const moving = layers.filter((l) => l.kind !== 'image').length;
    if (moving > MAX_MOVING_LAYERS) warn.push(`${sp}: ${moving} moving layers (sprite or video); the budget is ${MAX_MOVING_LAYERS} per stage, so a phone may stutter (layers kept)`);
    if (layers.length) stages.push({ layers });
    else warn.push(`${sp}: no usable layers; stage dropped`);
  });
  if (!stages.length) {
    // Effects only: the built-in scene with the pack's effects, no warning.
    if (v.stages === undefined && v.effects !== undefined) return null;
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
  const effects = parseEffectSet(raw, b, warnings);
  const overlays = parseOverlays(raw, b, warnings);
  if (Object.keys(biomes).length === 0 && !effects && !overlays) {
    errors.push('No biome has a usable layer.');
    return { pack: null, errors, warnings };
  }
  let spec: string | null = null;
  if (raw.spec !== undefined) {
    spec = typeof raw.spec === 'string' && /^1\.\d{1,2}$/.test(raw.spec) ? raw.spec : null;
    if (!spec) warnings.push(`spec: "${cleanText(raw.spec, 20) ?? typeof raw.spec}" is not a 1.x version; ignored`);
    else if (Number(spec.split('.')[1]) > Number(SPEC_VERSION.split('.')[1])) warnings.push(`spec: the pack is written for ${spec}; this ForgeCoach reads ${SPEC_VERSION}, so newer fields are ignored`);
  }
  return {
    pack: {
      schema: 1,
      spec,
      name: cleanText(raw.name, 80) ?? 'Untitled pack',
      author: cleanText(raw.author, 80),
      license: cleanText(raw.license, 80),
      base: b,
      strip: parseStrip(raw.strip, warnings),
      stageThresholds: parseThresholds(raw.stageThresholds, warnings),
      biomes,
      effects,
      overlays,
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
