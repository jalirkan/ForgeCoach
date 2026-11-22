/*
 * ForgeCoach — ambience/places.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Spec 1.22, places: every set of mana colours is one real place (five
 * one-colour homelands, ten pairs, ten threes, five fours and Istanbul for all
 * five), and over a game a people rise there land by land. A place is not
 * painted per combination of stages: it is ONE base picture (the bare site)
 * and, for each of its lands, six small transparent pieces (stages 1-6), each
 * painted inside that land's own region of the picture. Any state of the place
 * is the base with each live land's piece at its stage laid over it; this file
 * reads the manifest and composes a state, and SceneryStrip's `PlacePanel`
 * stacks the pictures.
 *
 * - The key ({@link placeKeyOf}): the place's lands in pairs.ts `GEOGRAPHY`'s
 *   order (island, swamp, plains, forest, mountain) joined by `+`, with NO
 *   stages: `island+swamp+plains+mountain`. A half's place is the one keyed by
 *   its live colours (scenes.ts `sceneLands`: a half with a `wastes` slot has
 *   none).
 * - The file: `places.json` beside the pack (prefs.ts `FORGECOACH_PLACES_URL`,
 *   `placesUrlOf`). A file that does not load or validate is "no places",
 *   never an error on the board; then the half is drawn by spec 1.20 / 1.21's
 *   scenes, as before.
 * - A place's `half` is a manifest.ts `PackHalf` (the same `parseHalf`) that
 *   must carry its `phone` picture. Its `layers` hold, for every land of the
 *   place, exactly six stages, each `{ half, phone }`: a piece is `{ src, x, y,
 *   w, h, width, height, bytes }`, its box in fractions of the base picture of
 *   the same shape from its top-left, drawn stretched to exactly that box; or
 *   null, "this stage adds nothing to the base at this shape" (the homelands'
 *   stage 1: their base IS stage 1).
 *
 * The plan is pairfull.ts `pairFullPlan`'s (a scene item carrying `place`,
 * before scenes and any pair logic). Pure and DOM-free.
 */
import { DEFAULT_STAGE_THRESHOLDS, MAX_STAGES, type Biome, type SlotState } from './model.ts';
import { cleanText } from '../lab/status.ts';
import { assetUrl, isObj, packBase, parseHalf } from './manifest.ts';
import { GEOGRAPHY } from './pairs.ts';
import { sceneKeyOf, sceneLands, type SceneHalf, type SceneLand } from './scenes.ts';

/** The places manifest, at the root of the places URL. */
export const PLACES_MANIFEST_FILE = 'places.json';
/** The newest spec version this reader knows (1.22 added places). */
export const PLACES_SPEC = '1.22';
/** A places manifest longer than this is refused unread (places-v1's 31 places are about 270 KB). */
export const MAX_PLACES_MANIFEST_BYTES = 2 * 1024 * 1024;
/** Declared files of one place (both bases and every piece at both shapes) past this get a warning. */
export const MAX_PLACE_BYTES = 8 * 1024 * 1024;
/** Declared files in one jsDelivr ref past this get a warning: jsDelivr serves a ref of at most 50 MB. */
export const MAX_PLACES_REF_BYTES = 45 * 1024 * 1024;
/** How far past the base picture's edge a piece's box may reach (rounding in the painter's fractions). */
export const PLACE_BOX_SLACK = 0.001;

/** One piece of a land at one stage and one shape: a transparent picture stretched to its box over the base. */
export interface PlacePiece {
  src: string;
  /** Its box, fractions (0-1) of the base picture of the same shape, from its top-left. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Its pixel size (information only), when given. */
  width: number | null;
  height: number | null;
  bytes: number | null;
}

/** One stage of a land: its piece on the desktop base and on the phone base; null adds nothing at that shape. */
export interface PlaceStage {
  half: PlacePiece | null;
  phone: PlacePiece | null;
}

export interface PackPlace {
  /** {@link placeKeyOf} of its lands: `island+swamp+plains+mountain`. */
  key: string;
  slug: string;
  /** The place's name, for the caption: "Cartagena de Indias". */
  name: string;
  /** The jsDelivr ref its files are tagged at (information). */
  ref: string | null;
  /** Its lands, in the geography's order. */
  lands: Biome[];
  /** The base picture, the bare site: a 1.5 half that always has its phone picture. */
  half: SceneHalf;
  /** Per land, its six stages (index 0 = stage 1). */
  layers: Partial<Record<Biome, PlaceStage[]>>;
}

export interface PlacesPack {
  schema: 1;
  spec: string | null;
  name: string;
  author: string | null;
  license: string | null;
  note: string | null;
  /** The base every relative file was resolved against. */
  base: string;
  /** Keyed by {@link placeKeyOf}. */
  places: Partial<Record<string, PackPlace>>;
}

export interface PlacesResult {
  places: PlacesPack | null;
  /** A file that is not a places manifest (then `places` is null), and every place refused (the rest still load). */
  errors: string[];
  /** Budgets, and fields corrected or ignored; the places still work. */
  warnings: string[];
}

const onGeography = (b: unknown): b is Biome => (GEOGRAPHY as readonly unknown[]).includes(b);
const byGeography = (a: Biome, b: Biome) => GEOGRAPHY.indexOf(a) - GEOGRAPHY.indexOf(b);

/** A place's key: its lands in the geography's order, joined by `+`; null when one is off the five, named twice, or none. */
export function placeKeyOf(lands: readonly Biome[]): string | null {
  if (!lands.length || !lands.every(onGeography) || new Set(lands).size !== lands.length) return null;
  return [...lands].sort(byGeography).join('+');
}

// ---------------------------------------------------------------------------
// Composing a state

/** One live land of a composed place: its stage and its stage's pieces. */
export interface PlaceLand {
  biome: Biome;
  stage: number;
  piece: PlaceStage;
}

/** A place composed for a state: the place, the state's scene key (`island2+swamp1`) and each live land at its stage. */
export interface PlaceComposition {
  place: PackPlace;
  /** scenes.ts `sceneKeyOf` of the state: `island2+swamp1+plains3+mountain1`. */
  key: string;
  /** The live lands in the geography's order. */
  lands: PlaceLand[];
}

/**
 * The place for a state (scenes.ts `sceneLands`: the live colours, each at its stage 1-6) composed: the place keyed by
 * its colours, each land's stage piece. Null with no state, no places, or no place for that colour set. Any number of
 * colours, one included.
 */
export function placeFor(places: PlacesPack | null | undefined, lands: readonly SceneLand[]): PlaceComposition | null {
  if (!places || !lands.length) return null;
  const key = sceneKeyOf(lands);
  const pk = placeKeyOf(lands.map((l) => l.biome));
  if (!key || !pk) return null;
  const place = places.places[pk];
  if (!place) return null;
  const sorted = [...lands].sort((a, b) => byGeography(a.biome, b.biome));
  return { place, key, lands: sorted.map((l) => ({ biome: l.biome, stage: l.stage, piece: place.layers[l.biome]![l.stage - 1]! })) };
}

/** {@link placeFor} for a half's slots (scenes.ts `sceneLands` on the pack's thresholds). */
export function placeForSlots(places: PlacesPack | null | undefined, slots: readonly Pick<SlotState, 'biome' | 'weight'>[], thresholds: readonly number[] | null = DEFAULT_STAGE_THRESHOLDS): PlaceComposition | null {
  return places ? placeFor(places, sceneLands(slots, thresholds)) : null;
}

/**
 * Does a half draw its place (spec 1.22)? It has one for its colours and neither base has failed to load (`failed`:
 * pack.ts `pictureFailed`). A half that does not -- no place for its colours (refused, or a pack without one), or a base
 * that failed -- is drawn by the rules before places, whose pictures its caller then warms.
 */
export function placeUsable(places: PlacesPack | null | undefined, slots: readonly Pick<SlotState, 'biome' | 'weight'>[], thresholds: readonly number[] | null, failed: (src: string) => boolean): boolean {
  const c = placeForSlots(places, slots, thresholds);
  return !!c && !failed(c.place.half.src) && !failed(c.place.half.phone.src);
}

/** One land's piece at the shape drawn: the desktop base's (`phone` false) or the phone base's. */
export interface PlacedPiece {
  biome: Biome;
  stage: number;
  /** Null: this stage adds nothing to the base at this shape (the land still counts as drawn). */
  piece: PlacePiece | null;
}

/** The pieces a composed place draws over its base at one shape, in the geography's order. */
export function placePieces(lands: readonly PlaceLand[], phone: boolean): PlacedPiece[] {
  return lands.map((l) => ({ biome: l.biome, stage: l.stage, piece: phone ? l.piece.phone : l.piece.half }));
}

/** The next stage's piece of every live land at one shape (warmed once the place is drawn), each once; none past stage 6. */
export function nextPlacePieces(place: PackPlace, lands: readonly Pick<PlaceLand, 'biome' | 'stage'>[], phone: boolean): PlacePiece[] {
  const out: PlacePiece[] = [];
  for (const l of lands) {
    if (l.stage >= MAX_STAGES) continue;
    const st = place.layers[l.biome]?.[l.stage];
    const p = st ? (phone ? st.phone : st.half) : null;
    if (p && !out.some((x) => x.src === p.src)) out.push(p);
  }
  return out;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The caption for a place half: "Cartagena de Indias: Island 2, Swamp 1, Plains 3, Mountain 1" (the geography's order). */
export function placeWords(c: { place: Pick<PackPlace, 'name'>; lands: readonly Pick<PlaceLand, 'biome' | 'stage'>[] }): string {
  return `${c.place.name}: ${c.lands.map((l) => `${cap(l.biome)} ${l.stage}`).join(', ')}`;
}

/**
 * A {@link placeWords} caption's land list ("Island 2, Swamp 1, Plains 3, Mountain 1"), or null when the caption is
 * not a place's. Read from the end, after the place's name: a name may hold a land word ("Hawaii, the Big Island",
 * "Cambodia's rice plains around Angkor").
 */
export function placeCaptionLands(caption: string | null | undefined): string | null {
  return (caption && PLACE_LANDS.exec(caption)?.[1]) ?? null;
}
const LAND_WORD = '(?:Island|Swamp|Plains|Forest|Mountain) [1-6]';
const PLACE_LANDS = new RegExp(`: (${LAND_WORD}(?:, ${LAND_WORD})*)$`);

// ---------------------------------------------------------------------------
// A land's piece across a stage change (the drawing's state, pure)

/**
 * One piece on screen: `cur` at full; `in` fading in over the growth time on top of the ones before it; `under` a piece
 * an `in` is replacing, kept at full beneath it until it is fully in; `out` fading out over half the growth time, then
 * removed (a higher stage does not always cover every pixel of the lower one, so the old goes only once the new is in).
 */
export type PieceRole = 'cur' | 'in' | 'under' | 'out';

export interface PieceEntry {
  key: string;
  piece: PlacePiece;
  role: PieceRole;
  /** The stage it is the piece of. */
  stage: number;
  /** The opacity on its first paint (0 for a piece fading in). */
  from: number;
}

/**
 * A piece's identity on screen: its file, its box and its stage. Places-v2's phone pieces reuse the desktop piece's
 * file at another box, so the same file at another box or stage is another entry (a new element, faded in), while the
 * picture store (loaded / failed) and the warm list stay keyed by the file alone.
 */
export function pieceKey(p: Pick<PlacePiece, 'src' | 'x' | 'y' | 'w' | 'h'>, stage: number): string {
  return `${p.src}|${p.x},${p.y},${p.w},${p.h}|${stage}`;
}

/** The most pieces one land keeps on screen at once (a second step in the middle of a fade). */
export const MAX_PIECE_ENTRIES = 3;

/**
 * The land's pieces after its wanted piece became `target` (a loaded piece, or null: the stage adds nothing). With
 * `instant` (the panel's first paint, reduced motion) exactly the target. Otherwise the target fades in on top (`in`)
 * with what was shown kept beneath (`under`); a null target fades what was shown out. The same target: unchanged.
 */
export function pieceWant(prev: readonly PieceEntry[], target: PlacePiece | null, instant: boolean, stage = 0): PieceEntry[] {
  const key = target ? pieceKey(target, stage) : '';
  if (instant) return target ? [{ key, piece: target, role: 'cur', stage, from: 1 }] : [];
  const live = prev.filter((e) => e.role !== 'out');
  if (target && live[live.length - 1]?.key === key) return [...prev];
  if (!target) return live.length ? prev.map((e) => ({ ...e, role: 'out' as const })) : [...prev];
  const was = prev.find((e) => e.key === key);
  const rest = prev.filter((e) => e.key !== key).map((e): PieceEntry => (e.role === 'out' ? e : { ...e, role: 'under' }));
  // A piece already on screen (back down a stage mid-fade) comes in from where it is, never from nothing.
  const all = [...rest, { key, piece: target, role: 'in' as const, stage, from: was && was.role !== 'out' ? 1 : 0 }];
  while (all.length > MAX_PIECE_ENTRIES) {
    const i = all.findIndex((e) => e.role === 'out');
    all.splice(i >= 0 ? i : 0, 1);
  }
  return all;
}

/** The piece fading in is fully in: it is `cur`, and every piece beneath it starts fading out. */
export function pieceSettleIn(prev: readonly PieceEntry[]): PieceEntry[] {
  if (!prev.some((e) => e.role === 'in')) return [...prev];
  return prev.map((e) => (e.role === 'in' ? { ...e, role: 'cur', from: 1 } : e.role === 'out' ? e : { ...e, role: 'out' }));
}

/** The pieces fading out are gone. */
export function pieceSettleOut(prev: readonly PieceEntry[]): PieceEntry[] {
  return prev.filter((e) => e.role !== 'out');
}

// ---------------------------------------------------------------------------
// The manifest

/** Is version `a` (1.x or 1.x.y) newer than `b`? */
function specNewer(a: string, b: string): boolean {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 1; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0);
  return false;
}

const PIECE_EXT = /\.(webp|avif|png)$/i;

/** One piece, or the reason it is unusable (the caller refuses the place). */
function parsePiece(v: unknown, base: string, path: string): PlacePiece | null | string {
  if (v === null) return null;
  if (!isObj(v)) return `${path}: not an object { src, x, y, w, h } or null`;
  const u = assetUrl(v.src, base);
  if ('error' in u) return `${path}.src: ${u.error}`;
  if (!PIECE_EXT.test(new URL(u.url).pathname)) return `${path}.src: expected .webp, .avif or .png (a picture with alpha)`;
  const frac = (k: 'x' | 'y' | 'w' | 'h') => {
    const n = v[k];
    return typeof n === 'number' && Number.isFinite(n) ? n : null;
  };
  const [x, y, w, h] = [frac('x'), frac('y'), frac('w'), frac('h')];
  if (x === null || y === null || w === null || h === null) return `${path}: x, y, w and h must be numbers (fractions of the base picture)`;
  if (x < 0 || y < 0) return `${path}: x and y must be 0 or more`;
  if (!(w > 0) || !(h > 0)) return `${path}: w and h must be above 0`;
  if (x + w > 1 + PLACE_BOX_SLACK || y + h > 1 + PLACE_BOX_SLACK) return `${path}: the box (x + w = ${+(x + w).toFixed(4)}, y + h = ${+(y + h).toFixed(4)}) reaches past the base picture`;
  const pos = (n: unknown) => (typeof n === 'number' && Number.isInteger(n) && n > 0 && n <= 16384 ? n : null);
  const bytes = typeof v.bytes === 'number' && Number.isInteger(v.bytes) && v.bytes >= 0 ? v.bytes : null;
  return { src: u.url, x, y, w, h, width: pos(v.width), height: pos(v.height), bytes };
}

const pixels = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 64 && n <= 16384;

/** One place, or null with the reason it is refused pushed to `errors`. */
function parsePlace(rawKey: string, v: unknown, base: string, errors: string[], warnings: string[]): PackPlace | null {
  const path = `places.${cleanText(rawKey, 80) ?? '?'}`;
  const refuse = (why: string) => {
    errors.push(`${path}: ${why}; place refused`);
    return null;
  };
  if (!isObj(v)) return refuse('not an object { slug, name, lands, half, layers }');
  const slug = typeof v.slug === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(v.slug) ? v.slug : null;
  if (!slug) return refuse('slug: a short lowercase name (a-z, 0-9, -)');
  const name = cleanText(v.name, 80);
  if (!name) return refuse('name: the place\'s name, for the caption');
  if (!Array.isArray(v.lands) || !v.lands.length) return refuse('lands: a list of the place\'s colours (island, swamp, plains, forest, mountain)');
  const lands: Biome[] = [];
  for (let i = 0; i < v.lands.length; i++) {
    const b: unknown = v.lands[i];
    if (!onGeography(b)) return refuse(`lands[${i}]: "${cleanText(b, 20) ?? typeof b}" is not one of the five (${GEOGRAPHY.join(', ')})`);
    if (lands.includes(b)) return refuse(`lands[${i}]: ${b} is named twice`);
    lands.push(b);
  }
  const key = placeKeyOf(lands)!;
  if (key !== rawKey) return refuse(`the key does not match its lands, which make "${key}" (the lands in the order ${GEOGRAPHY.join(', ')}, joined by +, no stages)`);
  if (!isObj(v.half)) return refuse('half: missing (the base picture, a 1.5 half with its phone picture)');
  // Every piece is placed in fractions of its base, so a base's real pixel shape is load-bearing: never the 1.5 defaults.
  const size = (o: unknown) => isObj(o) && pixels(o.width) && pixels(o.height) && o.width / o.height >= 0.25 && o.width / o.height <= 8;
  if (!size(v.half)) return refuse('half: width and height are required -- the base picture\'s pixels (64–16384, a shape between 1:4 and 8:1); every piece is placed in fractions of it');
  if (isObj(v.half.phone) && !size(v.half.phone)) return refuse('half.phone: width and height are required -- the phone base\'s pixels (64–16384, a shape between 1:4 and 8:1); every phone piece is placed in fractions of it');
  const halfWarn: string[] = [];
  const half = parseHalf(v.half, base, `${path}.half`, halfWarn);
  if (!half) {
    errors.push(`${halfWarn[0] ?? `${path}.half: unusable`}; place refused`);
    return null;
  }
  if (!half.phone) return refuse(`half.phone: missing or unusable${halfWarn.length ? ` (${halfWarn.join('; ')})` : ''} -- a place must look right on a desktop and a phone`);
  warnings.push(...halfWarn);
  // A phone base that gives no subject band: the desktop band mapped into it as a full-width outpainting up and down
  // (places-v2's 2.22:1 phone base is the desktop panorama with sky above and ground below), never manifest.ts's 4:5
  // default; its focal point and safe rect follow the band when not given either.
  if (isObj(v.half.phone) && (v.half.phone.subjectBand === undefined || v.half.phone.subjectBand === null)) {
    const ph = half.phone;
    const k = Math.min(1, (half.height / half.width) / (ph.height / ph.width));
    const map = (y: number) => +((1 - k) / 2 + y * k).toFixed(4);
    const band: [number, number] = [map(half.subjectBand[0]), map(half.subjectBand[1])];
    const raw = v.half.phone;
    half.phone = { ...ph, subjectBand: band, ...(raw.focal == null ? { focal: { x: 0.5, y: +((band[0] + band[1]) / 2).toFixed(4) } } : {}), ...(raw.safe == null ? { safe: { x: 0.25, y: band[0], w: 0.5, h: +(band[1] - band[0]).toFixed(4) } } : {}) };
  }
  if (!isObj(v.layers)) return refuse('layers: missing (six stages for each of the place\'s lands)');
  const extra = Object.keys(v.layers).filter((k) => !lands.includes(k as Biome));
  if (extra.length) return refuse(`layers: ${cleanText(extra[0], 20)} is not one of the place's lands (${lands.join(', ')})`);
  const layers: Partial<Record<Biome, PlaceStage[]>> = {};
  // Each file once (a phone piece may reuse its desktop piece's file).
  const files = new Map<string, number>([[half.src, half.bytes ?? 0]]);
  files.set(half.phone.src, Math.max(files.get(half.phone.src) ?? 0, half.phoneBytes ?? 0));
  for (const b of lands) {
    const list: unknown = v.layers[b];
    if (!Array.isArray(list) || list.length !== MAX_STAGES) return refuse(`layers.${b}: exactly ${MAX_STAGES} stages (stage 1 first), found ${Array.isArray(list) ? list.length : 'none'}`);
    const stages: PlaceStage[] = [];
    for (let i = 0; i < list.length; i++) {
      const st: unknown = list[i];
      const at = `layers.${b}[${i}]`;
      if (!isObj(st)) return refuse(`${at}: not an object { half, phone }`);
      const shapes: (PlacePiece | null)[] = [];
      for (const shape of ['half', 'phone'] as const) {
        if (st[shape] === undefined) return refuse(`${at}.${shape}: missing (a piece, or null when the stage adds nothing at this shape)`);
        const p = parsePiece(st[shape], base, `${at}.${shape}`);
        if (typeof p === 'string') return refuse(p);
        shapes.push(p);
        if (p) files.set(p.src, Math.max(files.get(p.src) ?? 0, p.bytes ?? 0));
      }
      stages.push({ half: shapes[0]!, phone: shapes[1]! });
    }
    layers[b] = stages;
  }
  const bytes = [...files.values()].reduce((n, x) => n + x, 0);
  if (bytes > MAX_PLACE_BYTES) warnings.push(`${path}: ${(bytes / 1048576).toFixed(1)} MB declared; a place's budget is ${MAX_PLACE_BYTES / 1048576} MB (both bases and every piece; kept)`);
  return { key, slug, name, ref: cleanText(v.ref, 80), lands: [...lands].sort(byGeography), half: half as SceneHalf, layers };
}

/** The jsDelivr ref a file lies in (`gh/<user>/<repo>@<ref>/`), else its origin and first folder. */
function refOf(src: string): string {
  const m = /^https:\/\/cdn\.jsdelivr\.net\/gh\/[^/]+\/[^/@]+@([^/]+)\//.exec(src);
  if (m) return m[1]!;
  try {
    const u = new URL(src);
    return `${u.origin}/${u.pathname.split('/')[1] ?? ''}`;
  } catch {
    return src;
  }
}

/** The declared bytes of every file of the places, by the ref it lies in -- each file once (a file named twice, e.g. a phone piece reusing its desktop piece's file, counts once, at the largest size declared). */
export function placesBytesByRef(places: PlacesPack | null | undefined): Map<string, number> {
  const files = new Map<string, number>();
  const add = (src: string, n: number | null | undefined) => {
    if (n) files.set(src, Math.max(files.get(src) ?? 0, n));
  };
  for (const p of Object.values(places?.places ?? {})) {
    if (!p) continue;
    add(p.half.src, p.half.bytes);
    add(p.half.phone.src, p.half.phoneBytes);
    for (const stages of Object.values(p.layers)) for (const st of stages ?? []) for (const piece of [st.half, st.phone]) if (piece) add(piece.src, piece.bytes);
  }
  const out = new Map<string, number>();
  for (const [src, n] of files) out.set(refOf(src), (out.get(refOf(src)) ?? 0) + n);
  return out;
}

/** The declared bytes of every file of the places. */
export function placesBytes(places: PlacesPack | null | undefined): number {
  return [...placesBytesByRef(places).values()].reduce((n, b) => n + b, 0);
}

/**
 * Spec 1.22: validate a `places.json`, in the style of scenes.ts `validateScenes`: every string cleaned, the base read
 * by manifest.ts `parseHalf`, every URL http(s) or relative to the manifest. A file that is not a schema-1 places
 * manifest is an error and no places; a place of the wrong shape -- a key that is not its lands in the geography's
 * order, a land off the five or named twice, a base with no phone picture, layers that are not exactly its lands with
 * six stages each, a piece with no usable src or a box outside the base -- is refused with an error naming why, and
 * the rest load. Budgets are warnings.
 */
export function validatePlaces(raw: unknown, base: string): PlacesResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const b = packBase(base);
  if (!b) return { places: null, errors: ['The places URL must be http:// or https:// (no user name or password).'], warnings };
  if (!isObj(raw)) return { places: null, errors: ['The places manifest is not a JSON object.'], warnings };
  if (raw.schema !== 1) return { places: null, errors: [`schema: expected 1, found ${cleanText(raw.schema, 20) ?? 'nothing'}.`], warnings };
  if (!isObj(raw.places)) return { places: null, errors: ['places: missing (an object keyed by the lands, "island+swamp+plains").'], warnings };
  const places: Partial<Record<string, PackPlace>> = {};
  for (const rawKey of Object.keys(raw.places)) {
    const p = parsePlace(rawKey, raw.places[rawKey], b, errors, warnings);
    if (p) places[p.key] = p;
  }
  let spec: string | null = null;
  if (raw.spec !== undefined) {
    spec = typeof raw.spec === 'string' && /^1\.\d{1,2}(\.\d{1,2})?$/.test(raw.spec) ? raw.spec : null;
    if (!spec) warnings.push(`spec: "${cleanText(raw.spec, 20) ?? typeof raw.spec}" is not a 1.x version; ignored`);
    else if (specNewer(spec, PLACES_SPEC)) warnings.push(`spec: the places are written for ${spec}; this ForgeCoach reads ${PLACES_SPEC}, so newer fields are ignored`);
  }
  const pack: PlacesPack = { schema: 1, spec, name: cleanText(raw.name, 80) ?? 'Untitled places', author: cleanText(raw.author, 80), license: cleanText(raw.license, 160), note: cleanText(raw.note, 400), base: b, places };
  for (const [ref, bytes] of placesBytesByRef(pack))
    if (bytes > MAX_PLACES_REF_BYTES) warnings.push(`places: ${(bytes / 1048576).toFixed(1)} MB declared in ${ref}; a jsDelivr ref holds at most 50 MB, so keep each ref under ${MAX_PLACES_REF_BYTES / 1048576} MB`);
  return { places: pack, errors, warnings };
}

/** The places manifest URL for what was given: a `.json` URL as is, else `<folder>/places.json`. */
export function placesManifestUrl(input: string): string | null {
  const s = input.trim();
  if (!s) return null;
  try {
    const u = new URL(s);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (u.username || u.password) return null;
    u.hash = '';
    if (!/\.json$/i.test(u.pathname)) u.pathname = `${u.pathname.replace(/\/?$/, '/')}${PLACES_MANIFEST_FILE}`;
    return u.href;
  } catch {
    return null;
  }
}

type FetchText = (url: string, init?: RequestInit) => Promise<Pick<Response, 'ok' | 'status' | 'text'>>;

/** Fetch and validate a places manifest. Never throws: problems come back as `errors`. */
export async function fetchPlaces(input: string, deps: { fetch: FetchText; signal?: AbortSignal }): Promise<PlacesResult & { manifestUrl: string | null }> {
  const manifestUrl = placesManifestUrl(input);
  if (!manifestUrl) return { manifestUrl: null, places: null, errors: ['The places URL must start with http:// or https:// (no user name or password).'], warnings: [] };
  let text: string;
  try {
    const res = await deps.fetch(manifestUrl, { cache: 'no-cache', signal: deps.signal, credentials: 'omit' });
    if (!res.ok) return { manifestUrl, places: null, errors: [`${manifestUrl} answered HTTP ${res.status}.`], warnings: [] };
    text = await res.text();
  } catch {
    return { manifestUrl, places: null, errors: [`${manifestUrl} is unreachable.`], warnings: [] };
  }
  if (text.length > MAX_PLACES_MANIFEST_BYTES) return { manifestUrl, places: null, errors: [`The places manifest is over ${MAX_PLACES_MANIFEST_BYTES / 1048576} MB.`], warnings: [] };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { manifestUrl, places: null, errors: ['The places manifest is not valid JSON.'], warnings: [] };
  }
  return { manifestUrl, ...validatePlaces(raw, manifestUrl) };
}
