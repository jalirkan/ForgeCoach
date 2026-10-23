/*
 * ForgeCoach — ambience/pairs.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Pair bands (spec 1.9): when one side of the half board has two colours, the
 * seam between their two pictures becomes a third painted place, the colour
 * pair's own (named for its dual land), which widens with every land that is
 * both colours. The pictures come from a second, optional manifest,
 * `pairs.json`, fetched beside the pack's `scenery.json` (prefs.ts
 * `FORGECOACH_PAIRS_URL`), so the pair art can live in a CDN ref of its own.
 * Pure and DOM-free; the drawing is ui/ambience/SceneryStrip.tsx.
 *
 * - The pair's entry is found by {@link pairKey}, so both orders resolve to
 *   one; the art is mirrored when the board has the pair the other way round
 *   from the manifest key (the key's first biome is the art's left), as a
 *   bridge is (bridges.ts).
 * - The width: `band.min` of the half as soon as the side has both colours,
 *   `band.perDual` more per land that is both colours (model.ts `dualPairs`,
 *   the count the bridges widen by), at most `band.max` — the same rule as a
 *   bridge's seam ({@link widenedRatio}), with the band's own numbers.
 * - The two neighbouring panels each give up half the band's width (never
 *   more than half their own share: past that the band is narrower), and the
 *   band meets each of them in half the seam they met in, so a band of width
 *   0 is exactly the seam it replaces ({@link halfRow}).
 * - The stage: `stageMap` on the LOWER of the two neighbours' stages.
 *
 * Motifs (spec 1.12): a pair stage may carry a `motif`, a transparent picture
 * painted for the band's own narrow, full-height shape (pairs-v3: the road or
 * river both lands share, running from the foreground up the seam to the
 * horizon). A pair whose stages carry a motif and no `half` is a MOTIF pair:
 * its seam stays the plain 1.10 seam (the panels give up no width) and the
 * motif is drawn over it, centred on the seam, {@link motifWidth} of the half
 * wide and the half's full height, so its own soft banks are the band's edges.
 * A pair with `half` pictures is a BAND pair as in 1.9, and a motif on one of
 * its stages is drawn over the band's picture, in the band's box.
 */
import { BIOMES, MAX_STAGES, pairKey, type Biome, type SlotState } from './model.ts';
import { cleanText, int } from '../lab/status.ts';
import { isObj, packBase, parseBytes, parseHalf, parseTransitions, ranged, type PackHalf, type PackStage, type PackTransitions, type ScenePack } from './manifest.ts';
import { halfLayout, type HalfSlotLayout } from './layout.ts';
import { halfSeams, SEAM_CAP_VW, widenedRatio } from './bridges.ts';

/** The pair pack's manifest, at the root of the pairs URL. */
export const PAIRS_MANIFEST_FILE = 'pairs.json';
/** The newest spec version this reader knows (1.9 added pair bands, 1.12 motifs, 1.15 whole-half panoramas). */
export const PAIRS_SPEC = '1.15';
const MAX_PAIRS_MANIFEST_BYTES = 256 * 1024;

/** How wide a pair's band is, as fractions of the half's width. */
export interface PairBand {
  /** As soon as the side has both colours. */
  min: number;
  /** More for each land that is both colours. */
  perDual: number;
  /** The widest it gets. */
  max: number;
}

/** Spec 1.9 defaults: the seam's width (0.10) at first, +0.04 per dual, a full middle third (0.34) at six duals. */
export const DEFAULT_PAIR_BAND: PairBand = { min: 0.1, perDual: 0.04, max: 0.34 };
/** Spec 1.9 default: neighbour stages 1–2 show pair stage 1, 3–4 stage 2, 5–6 stage 3. */
export const DEFAULT_STAGE_MAP: readonly (readonly [number, number])[] = [
  [1, 2],
  [3, 4],
  [5, 6],
];
/** Declared stage pictures per pair (desktop and phone, 1x and 2x) past this get a warning. */
export const MAX_PAIR_HALF_BYTES = 4 * 1024 * 1024;
/** Declared files of the whole pairs pack past this get a warning: jsDelivr serves a ref of at most 50 MB. */
export const MAX_PAIRS_PACK_BYTES = 45 * 1024 * 1024;

/**
 * Spec 1.12: a stage's motif, in the shape of a 1.5 `half` (`src`, `src2x`,
 * `phone`, `width` / `height` of the 1x file, `bytes`); its picture is
 * transparent and drawn stretched to its box (`fill`), never cropped.
 */
export type PairMotif = PackHalf;

/** A pair's stage: a 1.5 `half` (a band pair), a 1.12 `motif`, or both. */
export interface PairStage extends PackStage {
  motif?: PairMotif;
  /**
   * Spec 1.15: the stage's whole-half panorama, in the shape of a 1.5
   * `half` (`src`, `src2x`, `width` / `height` of the 1x file, `focal`,
   * `safe`, optional `phone`, `bytes`): one place about 1.6 × the half's
   * width, the first biome the ground at its left end and the second at its
   * right, the transition at `focal.x`. Read only under `?pairfull=1`
   * (pairfull.ts), where it is drawn instead of the stage's `half`.
   */
  panorama?: PackHalf;
}

/**
 * `band` (spec 1.9): the pair's pictures are an opaque panel between its two
 * biomes (a motif, where a stage has one, drawn over it). `motif` (1.12): no
 * stage has a `half`, the seam stays plain and the motif is drawn over it.
 */
export type PairKind = 'band' | 'motif';

export interface PackPair {
  /** {@link pairKey}: the two biomes in alphabetical order, `forest+island`. */
  key: string;
  /** The biome the art has on its left, and on its right (the manifest key's order). */
  left: Biome;
  right: Biome;
  /** The dual land and the shock land the place is named for: for a caption only, never read by the rules. */
  dual: string | null;
  shock: string | null;
  /** Spec 1.12: how the pair is drawn ({@link PairKind}). */
  kind: PairKind;
  /** stages[0] is the pair's stage 1; each has a `half` (a band pair) or a `motif` (a motif pair), and no strip layers. */
  stages: PairStage[];
  /** Spec 1.7's in-betweens per stage step, or null (a step cross-fades). A motif pair's are its motif's (`motifTransitions`). */
  transitions: PackTransitions | null;
  band: PairBand;
  /** Index k (0-based) holds the neighbour stages [from, to] that show pair stage k + 1. */
  stageMap: [number, number][];
  /** Declared bytes of the pair's stage pictures and motifs (each file once) and frames. */
  bytes: number;
}

/** Spec 1.12: the motif a pair shows at a pair stage (the last stage it has past its end), or null. */
export function pairMotifAt(pair: PackPair | null | undefined, stage: number): PairMotif | null {
  if (!pair || stage <= 0 || !pair.stages.length) return null;
  return pair.stages[Math.min(stage, pair.stages.length) - 1]?.motif ?? null;
}

/**
 * Spec 1.12: a motif pair's drawn width, as a fraction of the half: the band's
 * width for the side's duals ({@link bandWidth}), but never wider than either
 * neighbour's share, so it covers at most half of each panel beside it (the
 * floor a band keeps, {@link halfRow}).
 */
export function motifWidth(width: number, leftShare: number, rightShare: number): number {
  return r4(Math.max(0, Math.min(width, leftShare, rightShare)));
}

export interface PairsPack {
  schema: 1;
  spec: string | null;
  name: string;
  author: string | null;
  license: string | null;
  /** The pack's own note (a draft says so). */
  note: string | null;
  /** The base every relative file was resolved against. */
  base: string;
  /** Keyed by {@link pairKey}. */
  pairs: Partial<Record<string, PackPair>>;
}

export interface PairsResult {
  pairs: PairsPack | null;
  errors: string[];
  warnings: string[];
}

/** A manifest key (`island+forest` or `forest+island`) as its {@link pairKey}, or null when it is not two different biomes. */
export function normalisePairKey(raw: string): string | null {
  const parts = raw.split('+');
  if (parts.length !== 2) return null;
  const [a, b] = parts as [string, string];
  if (!(BIOMES as readonly string[]).includes(a) || !(BIOMES as readonly string[]).includes(b) || a === b) return null;
  return pairKey(a as Biome, b as Biome);
}

/** A band's width for `duals` lands that are both colours: min + perDual × duals, at most max ({@link widenedRatio}). */
export function bandWidth(band: PairBand, duals: number): number {
  return widenedRatio(band.min, band.perDual, band.max, duals);
}

/** The pair stage for the lower neighbour's stage: the map's entry holding it (past the last, the last; under the first, the first); 0 with no stage. */
export function pairStageFor(map: readonly (readonly [number, number])[], lower: number): number {
  if (!(lower > 0) || !map.length) return 0;
  for (let k = 0; k < map.length; k++) if (lower >= map[k]![0] && lower <= map[k]![1]) return k + 1;
  return lower > map[map.length - 1]![1] ? map.length : 1;
}

/** Spec 1.15: the panorama a pair's stage carries (the last stage past its end), or null: never borrowed from another stage. */
export function pairPanoramaAt(pair: PackPair | null | undefined, stage: number): PackHalf | null {
  if (!pair || stage <= 0 || !pair.stages.length) return null;
  return pair.stages[Math.min(stage, pair.stages.length) - 1]?.panorama ?? null;
}

/** The half picture a pair shows at a pair stage (the last stage it has past its end), or null. */
export function pairHalfAt(pair: PackPair | null | undefined, stage: number): PackHalf | null {
  if (!pair || stage <= 0 || !pair.stages.length) return null;
  return pair.stages[Math.min(stage, pair.stages.length) - 1]?.half ?? null;
}

/** The pair pack's entry for two biomes in either order, and whether to mirror it (the board has them the other way round). */
export function pairFor(pairs: PairsPack | null | undefined, left: Biome, right: Biome): { pair: PackPair; mirror: boolean } | null {
  if (left === right) return null;
  const pair = pairs?.pairs[pairKey(left, right)];
  return pair ? { pair, mirror: pair.left !== left } : null;
}

// ---------------------------------------------------------------------------
// The manifest

function parseStageMap(v: unknown, path: string, warn: string[]): [number, number][] {
  const dflt = DEFAULT_STAGE_MAP.map(([a, b]) => [a, b] as [number, number]);
  if (v === undefined || v === null) return dflt;
  const rows: unknown[] = Array.isArray(v) ? v : [];
  const out: [number, number][] = [];
  let next = 1;
  for (const row of rows) {
    const lo = Array.isArray(row) && row.length === 2 ? int(row[0], 1, MAX_STAGES) : null;
    const hi = Array.isArray(row) && row.length === 2 ? int(row[1], 1, MAX_STAGES) : null;
    if (lo === null || hi === null || lo !== next || hi < lo) {
      out.length = 0;
      break;
    }
    out.push([lo, hi]);
    next = hi + 1;
  }
  if (!out.length || out.length > MAX_STAGES) {
    warn.push(`${path}: a list of [from, to] neighbour stages, from 1 up with no gap ([[1, 2], [3, 4], [5, 6]]); using the default`);
    return dflt;
  }
  return out;
}

function parseBand(v: unknown, path: string, warn: string[]): PairBand {
  const d = DEFAULT_PAIR_BAND;
  if (v === undefined || v === null) return { ...d };
  if (!isObj(v)) {
    warn.push(`${path}: not an object { min, perDual, max }; using ${d.min}, ${d.perDual}, ${d.max}`);
    return { ...d };
  }
  const min = ranged(v.min, 0, 0.5, d.min, `${path}.min`, warn);
  const perDual = ranged(v.perDual, 0, 0.2, d.perDual, `${path}.perDual`, warn);
  let max = ranged(v.max, 0, 0.6, Math.max(d.max, min), `${path}.max`, warn);
  if (max < min) {
    warn.push(`${path}.max: ${max} is narrower than min ${min}; using ${min}`);
    max = min;
  }
  return { min, perDual, max };
}

function parsePair(rawKey: string, e: unknown, base: string, warn: string[]): PackPair | null {
  const path = `pairs.${cleanText(rawKey, 40)}`;
  const key = normalisePairKey(rawKey);
  if (!key) {
    warn.push(`${path}: not a pair of two different biomes joined by + ("forest+island"); ignored`);
    return null;
  }
  if (!isObj(e)) {
    warn.push(`${path}: not an object { dual, shock, stages, band, stageMap }; ignored`);
    return null;
  }
  const [left, right] = rawKey.split('+') as [Biome, Biome];
  const rawStages: unknown[] = Array.isArray(e.stages) ? e.stages : [];
  if (rawStages.length > MAX_STAGES) warn.push(`${path}.stages: more than ${MAX_STAGES}; the rest ignored`);
  // Spec 1.12: a pair none of whose stages names a `half` is a motif pair; any `half` makes it a band pair.
  const kind: PairKind = rawStages.some((st) => isObj(st) && st.half !== undefined && st.half !== null) ? 'band' : 'motif';
  const stages: PairStage[] = [];
  rawStages.slice(0, MAX_STAGES).forEach((st, i) => {
    const sp = `${path}.stages[${i}]`;
    if (!isObj(st)) return void warn.push(`${sp}: not an object { half, motif }; stage dropped`);
    const motif = parseHalf(st.motif, base, `${sp}.motif`, warn);
    if (kind === 'motif') {
      if (!motif) return void warn.push(`${sp}: no usable motif (and the pair has no half pictures); stage dropped`);
      return void stages.push({ layers: [], motif });
    }
    const half = parseHalf(st.half, base, `${sp}.half`, warn);
    if (!half) return void warn.push(`${sp}: no usable half picture; stage dropped`);
    const panorama = parseHalf(st.panorama, base, `${sp}.panorama`, warn);
    stages.push({ layers: [], half, ...(motif ? { motif } : {}), ...(panorama ? { panorama } : {}) });
  });
  if (!stages.length) {
    warn.push(`${path}: no stage with a usable ${kind === 'motif' ? 'motif' : 'half picture'}; pair dropped`);
    return null;
  }
  const intact = stages.length === Math.min(rawStages.length, MAX_STAGES);
  if (kind === 'motif' && e.transitions !== undefined && e.transitions !== null) warn.push(`${path}.transitions: a motif pair has no half pictures to step between (its frames are \`motifTransitions\`); ignored`);
  if (kind === 'band' && e.motifTransitions !== undefined && e.motifTransitions !== null) warn.push(`${path}.motifTransitions: only a motif pair plays motif frames (a band pair's motif cross-fades with its stage); ignored`);
  const transitions = kind === 'motif' ? parseTransitions(e.motifTransitions, base, `${path}.motifTransitions`, warn, stages.length, intact) : parseTransitions(e.transitions, base, `${path}.transitions`, warn, stages.length, intact);
  const stageMap = parseStageMap(e.stageMap, `${path}.stageMap`, warn);
  if (stageMap.length > stages.length) warn.push(`${path}.stageMap: ${stageMap.length} pair stages, ${stages.length} pictured; the later ones show the last stage`);
  const seen = new Set<string>();
  let halfBytes = 0;
  for (const s of stages)
    for (const h of [s.half, s.motif, s.panorama]) {
      if (!h || seen.has(h.src)) continue;
      seen.add(h.src);
      halfBytes += h.bytes ?? 0;
    }
  if (halfBytes > MAX_PAIR_HALF_BYTES) warn.push(`${path}: ${(halfBytes / 1048576).toFixed(1)} MB of stage pictures declared; their budget is ${MAX_PAIR_HALF_BYTES / 1048576} MB per pair (pictures kept)`);
  const frameBytes = (transitions?.steps ?? []).reduce((n, s) => n + (s.bytes ?? 0), 0);
  return {
    key,
    left,
    right,
    dual: cleanText(e.dual, 60),
    shock: cleanText(e.shock, 60),
    kind,
    stages,
    transitions,
    band: parseBand(e.band, `${path}.band`, warn),
    stageMap,
    bytes: halfBytes + frameBytes + (parseBytes(e, path, warn) ?? 0),
  };
}

/**
 * Spec 1.9: validate a `pairs.json`. Strict like `validateManifest`: every
 * string cleaned, every number range-checked, every URL http(s) or relative to
 * the manifest; a bad pair drops that pair (a warning), and only a manifest
 * that is not a schema-1 pair pack with at least one usable pair is an error.
 */
export function validatePairs(raw: unknown, base: string): PairsResult {
  const warnings: string[] = [];
  const b = packBase(base);
  if (!b) return { pairs: null, errors: ['The pairs URL must be http:// or https:// (no user name or password).'], warnings };
  if (!isObj(raw)) return { pairs: null, errors: ['The pairs manifest is not a JSON object.'], warnings };
  if (raw.schema !== 1) return { pairs: null, errors: [`schema: expected 1, found ${cleanText(raw.schema, 20) ?? 'nothing'}.`], warnings };
  if (!isObj(raw.pairs)) return { pairs: null, errors: ['pairs: missing (an object keyed by biome pairs, "forest+island").'], warnings };
  const pairs: Partial<Record<string, PackPair>> = {};
  for (const rawKey of Object.keys(raw.pairs)) {
    const p = parsePair(rawKey, raw.pairs[rawKey], b, warnings);
    if (!p) continue;
    if (pairs[p.key]) {
      warnings.push(`pairs.${cleanText(rawKey, 40)}: the pair ${p.key} is given twice; the first is kept`);
      continue;
    }
    pairs[p.key] = p;
  }
  if (!Object.keys(pairs).length) return { pairs: null, errors: ['No pair has a usable stage picture or motif.'], warnings };
  let spec: string | null = null;
  if (raw.spec !== undefined) {
    spec = typeof raw.spec === 'string' && /^1\.\d{1,2}$/.test(raw.spec) ? raw.spec : null;
    if (!spec) warnings.push(`spec: "${cleanText(raw.spec, 20) ?? typeof raw.spec}" is not a 1.x version; ignored`);
    else if (Number(spec.split('.')[1]) > Number(PAIRS_SPEC.split('.')[1])) warnings.push(`spec: the pairs are written for ${spec}; this ForgeCoach reads ${PAIRS_SPEC}, so newer fields are ignored`);
  }
  const total = Object.values(pairs).reduce((n, p) => n + (p?.bytes ?? 0), 0);
  if (total > MAX_PAIRS_PACK_BYTES) warnings.push(`pairs: ${(total / 1048576).toFixed(1)} MB declared; a jsDelivr ref holds at most 50 MB, so keep a pairs pack under ${MAX_PAIRS_PACK_BYTES / 1048576} MB`);
  return {
    pairs: { schema: 1, spec, name: cleanText(raw.name, 80) ?? 'Untitled pairs', author: cleanText(raw.author, 80), license: cleanText(raw.license, 80), note: cleanText(raw.note, 400), base: b, pairs },
    errors: [],
    warnings,
  };
}

/** The pairs manifest URL for what was given: a `.json` URL as is, else `<folder>/pairs.json`. */
export function pairsManifestUrl(input: string): string | null {
  const s = input.trim();
  if (!s) return null;
  try {
    const u = new URL(s);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (u.username || u.password) return null;
    u.hash = '';
    if (!/\.json$/i.test(u.pathname)) u.pathname = `${u.pathname.replace(/\/?$/, '/')}${PAIRS_MANIFEST_FILE}`;
    return u.href;
  } catch {
    return null;
  }
}

type FetchText = (url: string, init?: RequestInit) => Promise<Pick<Response, 'ok' | 'status' | 'text'>>;

/** Fetch and validate a pairs manifest. Never throws: problems come back as `errors`. */
export async function fetchPairs(input: string, deps: { fetch: FetchText; signal?: AbortSignal }): Promise<PairsResult & { manifestUrl: string | null }> {
  const manifestUrl = pairsManifestUrl(input);
  if (!manifestUrl) return { manifestUrl: null, pairs: null, errors: ['The pairs URL must start with http:// or https:// (no user name or password).'], warnings: [] };
  let text: string;
  try {
    const res = await deps.fetch(manifestUrl, { cache: 'no-cache', signal: deps.signal, credentials: 'omit' });
    if (!res.ok) return { manifestUrl, pairs: null, errors: [`${manifestUrl} answered HTTP ${res.status}.`], warnings: [] };
    text = await res.text();
  } catch {
    return { manifestUrl, pairs: null, errors: [`${manifestUrl} is unreachable.`], warnings: [] };
  }
  if (text.length > MAX_PAIRS_MANIFEST_BYTES) return { manifestUrl, pairs: null, errors: [`The pairs manifest is over ${MAX_PAIRS_MANIFEST_BYTES / 1024} KB.`], warnings: [] };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { manifestUrl, pairs: null, errors: ['The pairs manifest is not valid JSON.'], warnings: [] };
  }
  return { manifestUrl, ...validatePairs(raw, manifestUrl) };
}

// ---------------------------------------------------------------------------
// The band on the half board

/** One band to draw: between which two slots, which pair, its width and its stage. */
export interface PairBandPlacement {
  key: string;
  /** The slot right of the band (its index in the layout); the band is between it and the slot before. */
  index: number;
  /** The two biomes as the board has them, left and right. */
  left: Biome;
  right: Biome;
  pair: PackPair;
  mirror: boolean;
  /** Lands on the side that are both colours (model.ts `dualPairs`). */
  duals: number;
  /** The band's width as a fraction of the half's ({@link bandWidth}), before the panels' floor ({@link halfRow}). */
  width: number;
  /** The lower of the two neighbours' stages, and the pair stage it maps to (at most the pair's last pictured stage). */
  lower: number;
  stage: number;
}

/**
 * The bands a side draws: one per neighbouring pair of live slots (both with
 * lands; a withered panel's seam has none) that the pairs pack has an entry
 * for.
 */
export function pairBands(layout: readonly HalfSlotLayout[], pairs: PairsPack | null | undefined, duals: Readonly<Record<string, number>> = {}): PairBandPlacement[] {
  if (!pairs || layout.length < 2) return [];
  const out: PairBandPlacement[] = [];
  for (let i = 1; i < layout.length; i++) {
    const l = layout[i - 1]!;
    const r = layout[i]!;
    if (!(l.stage > 0 && r.stage > 0 && l.slot.weight > 0 && r.slot.weight > 0)) continue;
    const found = pairFor(pairs, l.slot.biome, r.slot.biome);
    if (!found) continue;
    const n = duals[found.pair.key] ?? 0;
    const lower = Math.min(l.stage, r.stage);
    out.push({
      key: found.pair.key,
      index: i,
      left: l.slot.biome,
      right: r.slot.biome,
      pair: found.pair,
      mirror: found.mirror,
      duals: n,
      width: bandWidth(found.pair.band, n),
      lower,
      stage: Math.min(pairStageFor(found.pair.stageMap, lower), found.pair.stages.length),
    });
  }
  return out;
}

/** Spec 1.12: the bands that are panels of the half's row (band pairs); a motif pair's seam stays plain and its motif is drawn over it. */
export function panelBands<T extends Pick<PairBandPlacement, 'pair'>>(bands: readonly T[]): T[] {
  return bands.filter((b) => b.pair.kind !== 'motif');
}

/** Spec 1.12: the bands drawn as a motif over a plain seam. */
export function motifBands<T extends Pick<PairBandPlacement, 'pair'>>(bands: readonly T[]): T[] {
  return bands.filter((b) => b.pair.kind === 'motif');
}

/** Spec 1.10: the seams (the index of the slot right of each) that have a pair band, so they draw no bridge (bridges.ts). A motif pair's seam counts (1.12). */
export function bandedSeams(bands: readonly Pick<PairBandPlacement, 'index'>[]): ReadonlySet<number> {
  return new Set(bands.map((b) => b.index));
}

/** One item of the half's flex row: a biome's panel, or a pair's band between two. */
export interface RowItem {
  kind: 'slot' | 'band';
  /** The biome, or the pair key. */
  key: string;
  /** The slot's index in the layout; a band's is the slot right of it. */
  index: number;
  /** Its share of the half (the flex row's grow). */
  share: number;
  /** How far it overlaps the item before it, as a fraction of the half's width (0 for the first). */
  seam: number;
  band?: PairBandPlacement;
}

const r4 = (n: number) => Math.round(n * 10000) / 10000;

/**
 * The half's row with its bands. `seams[i]` is the seam left of slot i
 * (bridges.ts `halfSeams`). A band in `bands` that is `open` (its picture has
 * loaded) takes its width from the two panels beside it, half from each, but
 * never more than half a panel's share (a narrow panel next to a wide band
 * keeps half its room and the band is narrower); a band not open has no width
 * (it is still in the row, so its element and its fade survive). Either way
 * the band meets each neighbour in half the seam they met in, so a band of no
 * width is exactly that seam.
 */
export function halfRow(layout: readonly HalfSlotLayout[], seams: readonly number[], bands: readonly PairBandPlacement[] = [], open: (key: string) => boolean = () => true): RowItem[] {
  const at = new Map<number, PairBandPlacement>();
  for (const b of bands) if (b.index > 0 && b.index < layout.length && !at.has(b.index)) at.set(b.index, b);
  const want = new Map<number, number>();
  for (const [i, b] of at) want.set(i, open(b.key) ? Math.max(0, b.width) : 0);
  // Each panel gives up half of each band beside it, at most half its own share.
  const factor = layout.map((l, j) => {
    const give = ((want.get(j) ?? 0) + (want.get(j + 1) ?? 0)) / 2;
    return give > l.share / 2 && give > 0 ? l.share / 2 / give : 1;
  });
  const width = new Map<number, number>();
  for (const [i, w] of want) width.set(i, w * Math.min(factor[i - 1]!, factor[i]!));
  const out: RowItem[] = [];
  layout.forEach((l, j) => {
    const b = at.get(j);
    const seam = j === 0 ? 0 : (seams[j] ?? 0);
    if (b) out.push({ kind: 'band', key: b.key, index: j, share: r4(width.get(j)!), seam: r4(seam / 2), band: b });
    out.push({ kind: 'slot', key: l.slot.biome, index: j, share: r4(Math.max(0, l.share - ((width.get(j) ?? 0) + (width.get(j + 1) ?? 0)) / 2)), seam: r4(b ? seam / 2 : seam) });
  });
  return out;
}

/**
 * The centre of row item `i`, in px across a half `width` px wide in a
 * viewport `vw` px wide, as the flex row lays it out: each item its share of
 * the width plus every seam, each later item pulled left by its own seam, each
 * seam capped at 14vw (scenery.css). The numeric twin of {@link rowCentreCss}.
 */
export function rowCentre(items: readonly Pick<RowItem, 'share' | 'seam'>[], i: number, width: number, vw = Infinity): number {
  const px = (k: number) => (k === 0 ? 0 : Math.min(items[k]!.seam * width, SEAM_CAP_VW * vw));
  const total = width + items.reduce((n, _, k) => n + px(k), 0);
  const sum = items.reduce((n, x) => n + x.share, 0) || 1;
  const before = items.slice(0, i).reduce((n, x) => n + x.share, 0) / sum;
  let pulled = 0;
  for (let k = 1; k <= i; k++) pulled += px(k);
  return (before + items[i]!.share / sum / 2) * total - pulled;
}

/** Each row item's span across a half `width` px wide in a viewport `vw` px wide, as the flex row lays it out (rowCentre's rule): its left edge, its width, and the seam it overlaps the item before in (px, capped at 14vw). */
export function rowSpans(items: readonly Pick<RowItem, 'share' | 'seam'>[], width: number, vw = Infinity): { left: number; width: number; seam: number }[] {
  const px = (k: number) => (k === 0 ? 0 : Math.min(items[k]!.seam * width, SEAM_CAP_VW * vw));
  const total = width + items.reduce((n, _, k) => n + px(k), 0);
  const sum = items.reduce((n, x) => n + x.share, 0) || 1;
  let x = 0;
  return items.map((it, k) => {
    const w = (it.share / sum) * total;
    const left = x - px(k);
    x = left + w;
    return { left: Math.round(left * 10) / 10, width: Math.round(w * 10) / 10, seam: Math.round(px(k) * 10) / 10 };
  });
}

/**
 * Spec 1.10: where a biome's own panel lies across its half, for drawing
 * something of that biome's over its panel only (the full-area accent): the
 * panel's span and the ramps it shares with its neighbours (px), from the same
 * row the half board lays out (folded to three panels, the bands as wide as
 * when open). Null when the half is not split (the biome fills it), or when the
 * biome has no panel (folded away).
 */
export function halfPanelSpan(
  slots: SlotState[],
  pack: ScenePack | null,
  biome: Biome,
  width: number,
  opts: { duals?: Readonly<Record<string, number>>; stageOverride?: number | null; vw?: number } = {},
): { left: number; right: number; fadeLeft: number; fadeRight: number } | 'none' | null {
  const layout = halfLayout(slots, pack, opts.stageOverride ?? null);
  if (layout.length < 2 || !(width > 0)) return layout.some((l) => l.slot.biome === biome) || !layout.length ? null : 'none';
  const duals = opts.duals ?? {};
  const bands = pairBands(layout, pack?.pairs ?? null, duals);
  const seams = halfSeams(layout, pack, duals, bandedSeams(bands));
  const items = halfRow(layout, seams, panelBands(bands));
  const at = items.findIndex((it) => it.kind === 'slot' && it.key === biome);
  if (at < 0) return 'none';
  const spans = rowSpans(items, width, opts.vw);
  const me = spans[at]!;
  const next = spans[at + 1];
  return { left: Math.max(0, me.left), right: Math.min(width, me.left + me.width), fadeLeft: at === 0 ? 0 : me.seam, fadeRight: next ? next.seam : 0 };
}

/** Spec 1.10: a mask that keeps a panel's span, eased in and out over the seams it shares (px). */
export function panelMaskCss(s: { left: number; right: number; fadeLeft: number; fadeRight: number }): string {
  const r = (n: number) => `${Math.round(n)}px`;
  return `linear-gradient(to right, transparent ${r(s.left)}, #000 ${r(s.left + s.fadeLeft)}, #000 ${r(s.right - s.fadeRight)}, transparent ${r(s.right)})`;
}

/** {@link rowCentre} as CSS for an element inside the half (a size container: `cqw` is the half's width). */
export function rowCentreCss(items: readonly Pick<RowItem, 'share' | 'seam'>[], i: number): string {
  const f = (n: number) => String(r4(n));
  const s = (k: number) => `min(${f(items[k]!.seam * 100)}cqw, ${f(SEAM_CAP_VW * 100)}vw)`;
  const sum = items.reduce((n, x) => n + x.share, 0) || 1;
  const at = items.slice(0, i).reduce((n, x) => n + x.share, 0) / sum + items[i]!.share / sum / 2;
  const all = items.map((_, k) => k).filter((k) => k > 0).map(s);
  const pulled = Array.from({ length: i }, (_, k) => s(k + 1));
  return `calc(${f(at)} * (100cqw${all.map((x) => ` + ${x}`).join('')})${pulled.length ? ` - (${pulled.join(' + ')})` : ''})`;
}

/**
 * The band pictures worth warming with a side's split pictures: for every two
 * live biomes on a side with an entry, the pair's picture at the stage their
 * lower stage maps to, and the next pair stage's, at the shape the board
 * shows. Each file once.
 */
export function pairPictures(pairs: PairsPack | null | undefined, sides: readonly (readonly { biome: Biome; stage: number }[])[], opts: { phone: boolean }): { src: string; src2x: string | null }[] {
  if (!pairs) return [];
  const out: { src: string; src2x: string | null }[] = [];
  const seen = new Set<string>();
  for (const slots of sides) {
    const live = slots.filter((s) => s.stage > 0);
    for (let i = 0; i < live.length; i++)
      for (let j = i + 1; j < live.length; j++) {
        const found = pairFor(pairs, live[i]!.biome, live[j]!.biome);
        if (!found) continue;
        const stage = pairStageFor(found.pair.stageMap, Math.min(live[i]!.stage, live[j]!.stage));
        for (const st of [stage, stage + 1]) {
          if (st > found.pair.stages.length) continue;
          for (const h of [pairHalfAt(found.pair, st), pairMotifAt(found.pair, st)]) {
            if (!h) continue;
            const p = opts.phone && h.phone ? h.phone : h;
            if (seen.has(p.src)) continue;
            seen.add(p.src);
            out.push({ src: p.src, src2x: p.src2x });
          }
        }
      }
  }
  return out;
}

/** Spec 1.9: the declared bytes of a pairs pack. */
export function pairsBytes(pairs: PairsPack | null | undefined): number {
  return Object.values(pairs?.pairs ?? {}).reduce((n, p) => n + (p?.bytes ?? 0), 0);
}
