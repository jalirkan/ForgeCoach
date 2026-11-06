/*
 * ForgeCoach — ambience/scenes.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Spec 1.20, scenes: one whole-half painting made for an exact set of lands.
 * The owner judged the three-colour half ugly (2026-11-06: a pair picture
 * with a tiny tree pasted under the land chips), so a half may instead show
 * a painting of that very state -- every colour on it, each at its own stage
 * -- and nothing else: no pair logic, no element, no cut-out, no band, no
 * panel. Only a state with no scene is drawn by the 1.9-1.19 rules, unchanged.
 *
 * - The key ({@link sceneKey}): the half's live biomes (a land weight above
 *   0) in pairs.ts `GEOGRAPHY`'s order (island, swamp, plains, forest,
 *   mountain), each with its stage from model.ts `stageFor` on the pack's own
 *   `stageThresholds` (ForgeCoach's pack: [1..6], so the stage is the land
 *   count, at most 6; a dual is ½ to each colour and a lone half-land is
 *   stage 1), joined by `+`: `island2+forest3+mountain2`. Board order,
 *   arrival order and which side is "left" do not matter: a scene is drawn as
 *   painted, never mirrored. A half with a `wastes` slot has no key (a scene
 *   names only the five).
 * - The file: `scenes.json`, a manifest of its own beside the pack's (prefs.ts
 *   `FORGECOACH_SCENES_URL`, `scenesUrlOf`), fetched whenever the pack is
 *   ForgeCoach's own -- with the whole-half flag or without. A file that does
 *   not load or validate is "no scenes", never an error on the board.
 * - A scene's `half` is a manifest.ts `PackHalf` (read by the same
 *   `parseHalf`: `src`, `src2x`, `subjectBand`, `horizon`, `focal`, `safe`,
 *   `hour`, `key`) that MUST carry a `phone` picture: a scene is drawn on a
 *   desktop and a phone alike, so one without is refused.
 *
 * The plan is pairfull.ts `pairFullPlan`'s (a `scene` item, before any pair
 * logic); the drawing SceneryStrip's `ScenePanel`. Pure and DOM-free.
 */
import { DEFAULT_STAGE_THRESHOLDS, MAX_STAGES, stageFor, type Biome, type SlotState } from './model.ts';
import { cleanText } from '../lab/status.ts';
import { isObj, packBase, parseHalf, type HalfPicture, type PackHalf } from './manifest.ts';
import { GEOGRAPHY } from './pairs.ts';

/** The scenes manifest, at the root of the scenes URL. */
export const SCENES_MANIFEST_FILE = 'scenes.json';
/** The newest spec version this reader knows (1.20 added scenes). */
export const SCENES_SPEC = '1.20';
/** A scenes manifest longer than this is refused unread (the pairs manifest's cap). */
export const MAX_SCENES_MANIFEST_BYTES = 1024 * 1024;
/** Declared files of one scene (desktop and phone, 1x and 2x) past this get a warning (a pair stage's budget). */
export const MAX_SCENE_BYTES = 4 * 1024 * 1024;
/** Declared files of the whole scenes pack in its own folder past this get a warning: jsDelivr serves a ref of at most 50 MB. */
export const MAX_SCENES_PACK_BYTES = 45 * 1024 * 1024;

/** One colour of a scene's state: its biome and its stage (1-6). */
export interface SceneLand {
  biome: Biome;
  stage: number;
}

/** A scene's picture: a 1.5 half that always has its phone picture. */
export type SceneHalf = PackHalf & { phone: HalfPicture };

export interface PackScene {
  /** {@link sceneKeyOf} of its lands: `island2+forest3+mountain2`. */
  key: string;
  /** The state it was painted for, in the geography's order. */
  lands: SceneLand[];
  half: SceneHalf;
}

export interface ScenesPack {
  schema: 1;
  spec: string | null;
  name: string;
  author: string | null;
  license: string | null;
  note: string | null;
  /** The base every relative file was resolved against. */
  base: string;
  /** Keyed by {@link sceneKeyOf}. */
  scenes: Partial<Record<string, PackScene>>;
}

export interface ScenesResult {
  scenes: ScenesPack | null;
  /** A file that is not a scenes manifest (then `scenes` is null), and every scene refused (the rest still load). */
  errors: string[];
  /** Budgets, and fields corrected or ignored; the scenes still work. */
  warnings: string[];
}

/** A biome of the five a scene may name (pairs.ts `GEOGRAPHY`; not `wastes`). */
const onGeography = (b: unknown): b is Biome => (GEOGRAPHY as readonly unknown[]).includes(b);

/**
 * The key for a set of lands: each `<biome><stage>` in the geography's order, joined by `+`; null when a biome is off
 * the geography or named twice, a stage is not a whole number 1-6, or there is none.
 */
export function sceneKeyOf(lands: readonly SceneLand[]): string | null {
  if (!lands.length) return null;
  const seen = new Set<Biome>();
  for (const l of lands) {
    if (!onGeography(l.biome) || seen.has(l.biome) || !Number.isInteger(l.stage) || l.stage < 1 || l.stage > MAX_STAGES) return null;
    seen.add(l.biome);
  }
  return [...lands]
    .sort((a, b) => GEOGRAPHY.indexOf(a.biome) - GEOGRAPHY.indexOf(b.biome))
    .map((l) => `${l.biome}${l.stage}`)
    .join('+');
}

/**
 * A half's scene key: its live slots (weight above 0) with each one's stage on `thresholds` (model.ts `stageFor`; the
 * pack's `stageThresholds`, else the default), at most {@link MAX_STAGES}. Null with no live slot, or with one off the
 * geography (`wastes`). The lands alone decide it: `#ambience`'s stage slider does not (a scene is made for an exact
 * set of lands, and the strip, the pieces and the caption must agree on it).
 */
export function sceneKey(slots: readonly Pick<SlotState, 'biome' | 'weight'>[], thresholds: readonly number[] | null = DEFAULT_STAGE_THRESHOLDS): string | null {
  const live = slots.filter((s) => s.weight > 0);
  if (!live.length || !live.every((s) => onGeography(s.biome))) return null;
  const th = thresholds ?? DEFAULT_STAGE_THRESHOLDS;
  return sceneKeyOf(live.map((s) => ({ biome: s.biome, stage: Math.min(MAX_STAGES, stageFor(s.weight, th)) })));
}

/** The scene painted for a half's exact state, or null (no scenes, or none for this state). */
export function sceneFor(scenes: ScenesPack | null | undefined, slots: readonly Pick<SlotState, 'biome' | 'weight'>[], thresholds: readonly number[] | null = DEFAULT_STAGE_THRESHOLDS): PackScene | null {
  if (!scenes) return null;
  const key = sceneKey(slots, thresholds);
  return key ? (scenes.scenes[key] ?? null) : null;
}

/** "island 2, forest 3, mountain 2": a scene's state in words, in the geography's order. */
export function sceneWords(scene: Pick<PackScene, 'lands'>): string {
  return scene.lands.map((l) => `${l.biome} ${l.stage}`).join(', ');
}

/** Is version `a` (1.x or 1.x.y) newer than `b`? */
function specNewer(a: string, b: string): boolean {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 1; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0);
  return false;
}

/** One scene, or the reason it is refused (pushed to `errors`). */
function parseScene(rawKey: string, v: unknown, base: string, errors: string[], warnings: string[]): PackScene | null {
  const path = `scenes.${cleanText(rawKey, 80) ?? '?'}`;
  const refuse = (why: string) => {
    errors.push(`${path}: ${why}; scene refused`);
    return null;
  };
  if (!isObj(v)) return refuse('not an object { lands, half }');
  if (!Array.isArray(v.lands) || !v.lands.length) return refuse('lands: a list of { biome, stage }, one per colour on the half');
  const lands: SceneLand[] = [];
  for (let i = 0; i < v.lands.length; i++) {
    const l: unknown = v.lands[i];
    if (!isObj(l)) return refuse(`lands[${i}]: not an object { biome, stage }`);
    if (!onGeography(l.biome)) return refuse(`lands[${i}].biome: "${cleanText(l.biome, 20) ?? typeof l.biome}" is not one of the five (${GEOGRAPHY.join(', ')})`);
    if (typeof l.stage !== 'number' || !Number.isInteger(l.stage) || l.stage < 1 || l.stage > MAX_STAGES) return refuse(`lands[${i}].stage: ${cleanText(l.stage, 20) ?? typeof l.stage} is not a whole stage 1–${MAX_STAGES}`);
    if (lands.some((x) => x.biome === l.biome)) return refuse(`lands[${i}].biome: ${l.biome} is named twice`);
    lands.push({ biome: l.biome, stage: l.stage });
  }
  const key = sceneKeyOf(lands)!;
  if (key !== rawKey) return refuse(`the key does not match its lands, which make "${key}" (each <biome><stage> in the order ${GEOGRAPHY.join(', ')}, joined by +)`);
  if (!isObj(v.half)) return refuse('half: missing (a 1.5 half picture with its phone picture)');
  const halfWarn: string[] = [];
  const half = parseHalf(v.half, base, `${path}.half`, halfWarn);
  if (!half) {
    // parseHalf's own reason already names the field.
    errors.push(`${halfWarn[0] ?? `${path}.half: unusable`}; scene refused`);
    return null;
  }
  if (!half.phone) return refuse(`half.phone: missing or unusable${halfWarn.length ? ` (${halfWarn.join('; ')})` : ''} -- a scene must look right on a desktop and a phone`);
  warnings.push(...halfWarn);
  const bytes = (half.bytes ?? 0) + (half.phoneBytes ?? 0);
  if (bytes > MAX_SCENE_BYTES) warnings.push(`${path}: ${(bytes / 1048576).toFixed(1)} MB declared; a scene's budget is ${MAX_SCENE_BYTES / 1048576} MB (desktop and phone, 1x and 2x; kept)`);
  // Every land is in the key and nothing else: `lands` is now the key's, in the geography's order.
  return { key, lands: [...lands].sort((a, b) => GEOGRAPHY.indexOf(a.biome) - GEOGRAPHY.indexOf(b.biome)), half: half as SceneHalf };
}

/**
 * Spec 1.20: validate a `scenes.json`. In the spirit of pairs.ts `validatePairs`: every string cleaned, every picture
 * read by manifest.ts `parseHalf`, every URL http(s) or relative to the manifest. A file that is not a schema-1 scenes
 * manifest is an error and no scenes; a scene of the wrong shape -- a key that is not its lands' key, a biome off the
 * five, a stage outside 1–6, no phone picture -- is refused with an error naming why, and the rest load. Budgets are
 * warnings.
 */
export function validateScenes(raw: unknown, base: string): ScenesResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const b = packBase(base);
  if (!b) return { scenes: null, errors: ['The scenes URL must be http:// or https:// (no user name or password).'], warnings };
  if (!isObj(raw)) return { scenes: null, errors: ['The scenes manifest is not a JSON object.'], warnings };
  if (raw.schema !== 1) return { scenes: null, errors: [`schema: expected 1, found ${cleanText(raw.schema, 20) ?? 'nothing'}.`], warnings };
  if (!isObj(raw.scenes)) return { scenes: null, errors: ['scenes: missing (an object keyed by the lands, "island2+forest3+mountain2").'], warnings };
  const scenes: Partial<Record<string, PackScene>> = {};
  for (const rawKey of Object.keys(raw.scenes)) {
    const s = parseScene(rawKey, raw.scenes[rawKey], b, errors, warnings);
    if (s) scenes[s.key] = s;
  }
  let spec: string | null = null;
  if (raw.spec !== undefined) {
    spec = typeof raw.spec === 'string' && /^1\.\d{1,2}(\.\d{1,2})?$/.test(raw.spec) ? raw.spec : null;
    if (!spec) warnings.push(`spec: "${cleanText(raw.spec, 20) ?? typeof raw.spec}" is not a 1.x version; ignored`);
    else if (specNewer(spec, SCENES_SPEC)) warnings.push(`spec: the scenes are written for ${spec}; this ForgeCoach reads ${SCENES_SPEC}, so newer fields are ignored`);
  }
  const pack: ScenesPack = { schema: 1, spec, name: cleanText(raw.name, 80) ?? 'Untitled scenes', author: cleanText(raw.author, 80), license: cleanText(raw.license, 80), note: cleanText(raw.note, 400), base: b, scenes };
  const total = scenesRefBytes(pack);
  if (total > MAX_SCENES_PACK_BYTES) warnings.push(`scenes: ${(total / 1048576).toFixed(1)} MB declared in this pack's own folder; a jsDelivr ref holds at most 50 MB, so keep a scenes pack under ${MAX_SCENES_PACK_BYTES / 1048576} MB (files named at another tag's URL are not counted)`);
  return { scenes: pack, errors, warnings };
}

/** The declared bytes of every scene's files (desktop and phone). */
export function scenesBytes(scenes: ScenesPack | null | undefined): number {
  return Object.values(scenes?.scenes ?? {}).reduce((n, s) => n + (s?.half.bytes ?? 0) + (s?.half.phoneBytes ?? 0), 0);
}

/** The declared bytes of the scenes whose files lie in the manifest's own folder (its CDN ref). */
function scenesRefBytes(scenes: ScenesPack): number {
  return Object.values(scenes.scenes).reduce((n, s) => n + (s && s.half.src.startsWith(scenes.base) ? s.half.bytes ?? 0 : 0) + (s?.half.phone.src.startsWith(scenes.base) ? s.half.phoneBytes ?? 0 : 0), 0);
}

/** The scenes manifest URL for what was given: a `.json` URL as is, else `<folder>/scenes.json`. */
export function scenesManifestUrl(input: string): string | null {
  const s = input.trim();
  if (!s) return null;
  try {
    const u = new URL(s);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (u.username || u.password) return null;
    u.hash = '';
    if (!/\.json$/i.test(u.pathname)) u.pathname = `${u.pathname.replace(/\/?$/, '/')}${SCENES_MANIFEST_FILE}`;
    return u.href;
  } catch {
    return null;
  }
}

type FetchText = (url: string, init?: RequestInit) => Promise<Pick<Response, 'ok' | 'status' | 'text'>>;

/** Fetch and validate a scenes manifest. Never throws: problems come back as `errors`. */
export async function fetchScenes(input: string, deps: { fetch: FetchText; signal?: AbortSignal }): Promise<ScenesResult & { manifestUrl: string | null }> {
  const manifestUrl = scenesManifestUrl(input);
  if (!manifestUrl) return { manifestUrl: null, scenes: null, errors: ['The scenes URL must start with http:// or https:// (no user name or password).'], warnings: [] };
  let text: string;
  try {
    const res = await deps.fetch(manifestUrl, { cache: 'no-cache', signal: deps.signal, credentials: 'omit' });
    if (!res.ok) return { manifestUrl, scenes: null, errors: [`${manifestUrl} answered HTTP ${res.status}.`], warnings: [] };
    text = await res.text();
  } catch {
    return { manifestUrl, scenes: null, errors: [`${manifestUrl} is unreachable.`], warnings: [] };
  }
  if (text.length > MAX_SCENES_MANIFEST_BYTES) return { manifestUrl, scenes: null, errors: [`The scenes manifest is over ${MAX_SCENES_MANIFEST_BYTES / 1048576} MB.`], warnings: [] };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { manifestUrl, scenes: null, errors: ['The scenes manifest is not valid JSON.'], warnings: [] };
  }
  return { manifestUrl, ...validateScenes(raw, manifestUrl) };
}

/**
 * The scene pictures worth warming for these halves (`slots` per half), at one shape (`phone`: the phone picture):
 * each half's own scene, and every scene one basic land away (a live colour's next land, or a new colour's first), so
 * a scene that arrives with a land is usually there already. Each once.
 */
export function scenePictures(scenes: ScenesPack | null | undefined, halves: readonly (readonly Pick<SlotState, 'biome' | 'weight'>[])[], opts: { phone: boolean; thresholds?: readonly number[] | null }): { src: string; src2x: string | null }[] {
  if (!scenes || !Object.keys(scenes.scenes).length) return [];
  const out: { src: string; src2x: string | null }[] = [];
  const add = (s: PackScene | null) => {
    const pic = s ? (opts.phone ? s.half.phone : s.half) : null;
    if (pic && !out.some((x) => x.src === pic.src)) out.push({ src: pic.src, src2x: pic.src2x });
  };
  for (const slots of halves) {
    add(sceneFor(scenes, slots, opts.thresholds ?? null));
    for (const b of GEOGRAPHY) {
      const has = slots.some((s) => s.biome === b);
      const next = has ? slots.map((s) => (s.biome === b ? { biome: s.biome, weight: s.weight + 1 } : s)) : [...slots, { biome: b, weight: 1 }];
      add(sceneFor(scenes, next, opts.thresholds ?? null));
    }
  }
  return out;
}
