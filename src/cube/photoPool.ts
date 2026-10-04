/*
 * ForgeCoach — cube/photoPool.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Photo to pool: read a paper draft's cards off one or more photos. This file
 * is the pure half (tested in node): the recognition prompt (constrained to
 * the cube's own card names), the parser and validator for the strict JSON it
 * asks for, cube-constrained name matching (exact, front face, punctuation-
 * blind, then a fuzzy near-miss), and the review model the sheet shows —
 * grouped by card, with a question whenever a card is seen in two photos or
 * more than once (never double-counted silently). Nothing here changes a pool:
 * `planAdd` says what the player's confirmation would add, and only the
 * player's tap applies it (the deck assistant's rule).
 *
 * Who reads the photos (Claude Code on the PC via mtg-table's coach helper
 * `/vision`, or the player's API key) is `ui/answers.ts` `startAnswer`'s
 * choice, as for the coach.
 */
import { BASIC_NAMES } from './colors.ts';

export const MAX_PHOTOS = 8;

// ---------------------------------------------------------------------------
// The prompt

export interface PhotoPrompt {
  system: string;
  user: string;
}

/** The recognition prompt for `photoCount` photos of cards from a cube with `cubeNames`. */
export function photoPrompt(cubeTitle: string, cubeNames: readonly string[], photoCount: number): PhotoPrompt {
  const names = [...new Set(cubeNames)];
  const system = [
    'You read photos of Magic: The Gathering cards and list which cards they show.',
    'Every card in the photos comes from one known list of card names. You answer with one JSON object and nothing else: no prose, no code fence.',
  ].join(' ');
  const photos = photoCount === 1 ? 'The photo shows' : `The ${photoCount} photos (numbered 1 to ${photoCount} in the order given) show`;
  const user = [
    `${photos} cards a player drafted from the cube "${cubeTitle}", spread on a table. Cards may overlap, be in sleeves, be rotated, glare in the light or be partly hidden.`,
    '',
    `Every card should be one of the cube's ${names.length} cards listed at the end. Identify each card you can see:`,
    '- "name": exactly as it is written in the list. Never a name that is not in the list.',
    '- "photo": the number of the photo it is in. A card visible in two photos is listed once for each photo; do not merge them.',
    '- "count": how many copies of that card you can see in that photo (almost always 1: the cube has one copy of most cards).',
    '- "confidence": 0 to 1, how sure you are of the name (1 = the name is clearly readable).',
    '- "note": "" or a few words, e.g. "partly covered, read from the art".',
    'A card you cannot match to the list, or cannot read well enough to choose, goes in "unrecognised" with its photo, a short note (where it lies, what you can read) and your best guess from the list, or "" if none.',
    'Ignore basic lands (Plains, Island, Swamp, Mountain, Forest, Wastes), tokens, sleeves, dice and anything that is not a card.',
    '',
    'Answer with exactly this shape:',
    '{"cards":[{"name":"<name from the list>","photo":1,"count":1,"confidence":0.95,"note":""}],"unrecognised":[{"photo":1,"note":"<what you see>","guess":"<name from the list or empty>"}]}',
    '',
    `The cube's cards (${names.length}):`,
    ...names,
  ].join('\n');
  return { system, user };
}

// ---------------------------------------------------------------------------
// Parsing and validating the answer

export interface RawSighting {
  name: string;
  photo: number;
  count: number;
  confidence: number;
  note: string;
}

export interface RawUnrecognised {
  photo: number;
  note: string;
  guess: string;
}

export interface ParsedRecognition {
  cards: RawSighting[];
  unrecognised: RawUnrecognised[];
  /** Entries dropped or repaired, in plain words (shown small under the review). */
  problems: string[];
}

export class PhotoAnswerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PhotoAnswerError';
  }
}

/** The first balanced JSON object or array in `text` (code fences and prose around it are skipped). */
export function extractJson(text: string): string | null {
  const s = text.replace(/```(?:json)?/gi, '');
  for (let start = 0; start < s.length; start++) {
    const open = s[start];
    if (open !== '{' && open !== '[') continue;
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = start; i < s.length; i++) {
      const ch = s[i];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === '\\') esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === '{' || ch === '[') depth++;
      else if (ch === '}' || ch === ']') {
        depth--;
        if (depth === 0) {
          const candidate = s.slice(start, i + 1);
          try {
            JSON.parse(candidate);
            return candidate;
          } catch {
            break; // not JSON from this start; try the next opening bracket
          }
        }
      }
    }
  }
  return null;
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

function photoOf(v: unknown, photoCount: number): number | null {
  const n = typeof v === 'string' && /^\d+$/.test(v.trim()) ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n)) return photoCount === 1 ? 1 : null;
  const i = Math.round(n);
  return i >= 1 && i <= photoCount ? i : null;
}

function confidenceOf(v: unknown): number {
  const raw = typeof v === 'string' ? Number(v.replace('%', '')) : v;
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return 0.5;
  const n = raw > 1 && raw <= 100 ? raw / 100 : raw;
  return Math.min(1, Math.max(0, n));
}

/**
 * The model's answer as validated sightings. Throws PhotoAnswerError when it
 * holds no JSON at all; repairs or drops bad entries (and says so in
 * `problems`) rather than throwing the whole answer away.
 */
export function parseRecognition(text: string, photoCount: number): ParsedRecognition {
  const raw = extractJson(text);
  if (raw === null) throw new PhotoAnswerError('The answer held no card list (no JSON). Try again, or try a sharper photo.');
  const top = JSON.parse(raw) as unknown;
  const obj = (Array.isArray(top) ? { cards: top } : top) as { cards?: unknown; unrecognised?: unknown; unrecognized?: unknown };
  if (!obj || typeof obj !== 'object') throw new PhotoAnswerError('The answer’s JSON was not a card list.');
  const problems: string[] = [];
  const cards: RawSighting[] = [];
  const unrecognised: RawUnrecognised[] = [];
  const list = Array.isArray(obj.cards) ? obj.cards : [];
  if (!Array.isArray(obj.cards)) problems.push('The answer had no "cards" list.');
  for (const item of list) {
    if (typeof item === 'string') {
      if (item.trim()) cards.push({ name: item.trim(), photo: photoCount === 1 ? 1 : 0, count: 1, confidence: 0.5, note: '' });
      continue;
    }
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const name = str(o.name);
    if (!name) {
      problems.push('A card with no name was dropped.');
      continue;
    }
    const photo = photoOf(o.photo, photoCount);
    const countRaw = typeof o.count === 'string' ? Number(o.count) : o.count;
    const count = typeof countRaw === 'number' && Number.isFinite(countRaw) ? Math.round(countRaw) : 1;
    if (count < 1) continue;
    if (count > 4) problems.push(`“${name}”: ${count} copies in one photo read as 4 at most.`);
    cards.push({ name, photo: photo ?? 0, count: Math.min(4, count), confidence: confidenceOf(o.confidence), note: str(o.note) });
  }
  const unr = Array.isArray(obj.unrecognised) ? obj.unrecognised : Array.isArray(obj.unrecognized) ? obj.unrecognized : [];
  for (const item of unr) {
    if (typeof item === 'string') {
      if (item.trim()) unrecognised.push({ photo: photoCount === 1 ? 1 : 0, note: item.trim(), guess: '' });
      continue;
    }
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const note = str(o.note) || str(o.description) || str(o.text);
    const guess = str(o.guess) || str(o.name);
    if (!note && !guess) continue;
    unrecognised.push({ photo: photoOf(o.photo, photoCount) ?? 0, note, guess });
  }
  if (cards.some((c) => c.photo === 0) || unrecognised.some((u) => u.photo === 0)) problems.push('Some entries named no photo (or one that was not sent).');
  return { cards, unrecognised, problems };
}

// ---------------------------------------------------------------------------
// Cube-constrained name matching

/** Lowercase, straight quotes, no accents, single spaces. */
export function normName(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[’‘`´]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Letters and digits only: "Jace, Vryn's Prodigy" and "jace vryns prodigy" meet here. */
function bare(s: string): string {
  return normName(s).replace(/[^a-z0-9]/g, '');
}

/** Edit distance with transpositions (optimal string alignment). */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev2: number[] = [];
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2]! + 1);
      cur.push(v);
    }
    prev2 = prev;
    prev = cur;
  }
  return prev[b.length]!;
}

/** 1 for the same letters, 0 for nothing in common. */
export function similarity(a: string, b: string): number {
  const x = bare(a);
  const y = bare(b);
  if (!x.length || !y.length) return 0;
  return 1 - editDistance(x, y) / Math.max(x.length, y.length);
}

export type MatchHow = 'exact' | 'fuzzy';

export interface NameMatch {
  /** The cube's own spelling, or null when nothing in the cube is close enough. */
  name: string | null;
  how: MatchHow | null;
  /** The similarity of a fuzzy match (1 for an exact one). */
  score: number;
  /** For no match (or a fuzzy one): the closest cube names, best first. */
  suggestions: string[];
}

/** Fuzzy matches must be this similar... */
export const FUZZY_MIN = 0.8;
/** ...and this much better than the runner-up, or the near-miss is ambiguous. */
const FUZZY_MARGIN = 0.06;

export interface NameIndex {
  names: string[];
  exact: Map<string, string>;
  bare: Map<string, string>;
}

export function nameIndex(cubeNames: readonly string[]): NameIndex {
  const names = [...new Set(cubeNames)];
  const exact = new Map<string, string>();
  const bareMap = new Map<string, string>();
  for (const n of names) {
    exact.set(normName(n), n);
    if (!bareMap.has(bare(n))) bareMap.set(bare(n), n);
  }
  // A face of a split / double-faced card, or the part before a comma, names it too (after the full names).
  for (const n of names) {
    for (const face of n.split(' // ')) {
      if (!exact.has(normName(face))) exact.set(normName(face), n);
      if (!bareMap.has(bare(face))) bareMap.set(bare(face), n);
    }
  }
  return { names, exact, bare: bareMap };
}

/** The cube card `raw` names: exactly (any case, punctuation or face), or as a near miss. */
export function matchName(raw: string, index: NameIndex): NameMatch {
  const cleaned = raw
    .replace(/\s+\([^)]*\)\s*$/, '') // "Name (M21)" / "Name (foil)"
    .replace(/^\d+\s*x?\s+/i, '') // "1x Name"
    .trim();
  for (const s of [raw, cleaned]) {
    const hit = index.exact.get(normName(s)) ?? index.bare.get(bare(s));
    if (hit) return { name: hit, how: 'exact', score: 1, suggestions: [] };
  }
  const scored = index.names
    .map((n) => {
      const faces = n.split(' // ');
      const s = Math.max(similarity(cleaned, n), ...(faces.length > 1 ? faces.map((f) => similarity(cleaned, f)) : []));
      return { n, s };
    })
    .sort((a, b) => b.s - a.s || (a.n < b.n ? -1 : 1));
  const best = scored[0];
  const second = scored[1];
  const suggestions = scored
    .filter((x) => x.s >= 0.45)
    .slice(0, 3)
    .map((x) => x.n);
  if (best && best.s >= FUZZY_MIN && (!second || best.s - second.s >= FUZZY_MARGIN)) {
    return { name: best.n, how: 'fuzzy', score: best.s, suggestions };
  }
  return { name: null, how: null, score: best?.s ?? 0, suggestions };
}

// ---------------------------------------------------------------------------
// The review: one row per cube card, the questions, what confirming would add

/** One time the model saw a card, matched to the cube. */
export interface Sighting {
  photo: number;
  count: number;
  confidence: number;
  note: string;
  /** What the model wrote, when it was not the cube's exact spelling (a fuzzy match). */
  readAs?: string;
  /** The player chose this card for something the model could not name. */
  byHand?: boolean;
}

export type RowQuestion =
  /** Seen in two or more photos: the same physical card, or more copies? */
  | 'photos'
  /** More than one copy counted (in one photo): really that many? */
  | 'copies';

export interface ReviewRow {
  id: string;
  /** The cube's spelling. */
  name: string;
  sightings: Sighting[];
  /** Copies of it already in the pool being added to. */
  inPool: number;
  /** Copies of it in the other list (marked as the opponent's when adding to yours, and the reverse). */
  inOther: number;
  /** Copies in the cube list (1 for most cards). */
  inCube: number;
  /** Ticked to add. */
  include: boolean;
  /**
   * The player's answer to the row's question: how many copies the photos show
   * in all. Null while unanswered (confirming waits for it).
   */
  copies: number | null;
}

export interface UnmatchedItem {
  id: string;
  photo: number;
  /** What the model wrote: a name not in the cube, or a description. */
  text: string;
  note: string;
  suggestions: string[];
}

export interface ReviewModel {
  rows: ReviewRow[];
  unmatched: UnmatchedItem[];
  /** Basic lands the model named anyway (ignored, as in the paste parser). */
  basics: number;
  problems: string[];
}

/** Below this the row starts unticked, marked unsure. */
export const SURE = 0.5;

/** The photos a row's card was seen in, ascending. */
export function rowPhotos(r: Pick<ReviewRow, 'sightings'>): number[] {
  return [...new Set(r.sightings.map((s) => s.photo).filter((p) => p > 0))].sort((a, b) => a - b);
}

/** Copies counted over every sighting (a card in two photos counts twice here, until the player says). */
export function rowSeen(r: Pick<ReviewRow, 'sightings'>): number {
  return r.sightings.reduce((n, s) => n + s.count, 0);
}

export function rowConfidence(r: Pick<ReviewRow, 'sightings'>): number {
  return r.sightings.reduce((m, s) => Math.max(m, s.byHand ? 1 : s.readAs ? s.confidence * 0.9 : s.confidence), 0);
}

/** The question a row needs answered before it can be added, or null. */
export function rowQuestion(r: Pick<ReviewRow, 'sightings'>): RowQuestion | null {
  if (rowPhotos(r).length > 1 || r.sightings.filter((s) => s.photo <= 0).length > 1) return 'photos';
  if (rowSeen(r) > 1) return 'copies';
  return null;
}

/** The copies to choose between for a row with a question: 1 up to what was counted. */
export function copyChoices(r: Pick<ReviewRow, 'sightings'>): number[] {
  const most = Math.max(1, Math.min(4, rowSeen(r)));
  return Array.from({ length: most }, (_, i) => i + 1);
}

function countIn(list: readonly string[], name: string): number {
  return list.reduce((n, x) => n + (x === name ? 1 : 0), 0);
}

let rowSeq = 0;
const rowId = (p: string) => `${p}${++rowSeq}`;

/** Adds a sighting of `name` to `rows` (a new row, or the card's existing one), returning new rows. */
export interface ReviewContext {
  /** The list being added to (your cards, or theirs). */
  pool: readonly string[];
  /** The other list, if any. */
  other?: readonly string[];
  cubeNames: readonly string[];
}

export function addSighting(rows: readonly ReviewRow[], name: string, s: Sighting, ctx: ReviewContext): ReviewRow[] {
  const at = rows.findIndex((r) => r.name === name);
  if (at >= 0) {
    const r = rows[at]!;
    const next: ReviewRow = { ...r, sightings: [...r.sightings, s] };
    // A new sighting reopens the question: the old answer was about fewer sightings.
    next.copies = rowQuestion(next) ? null : r.copies;
    if (s.byHand) next.include = true;
    return rows.map((x, i) => (i === at ? next : x));
  }
  const inPool = countIn(ctx.pool, name);
  const inOther = countIn(ctx.other ?? [], name);
  const row: ReviewRow = {
    id: rowId('r'),
    name,
    sightings: [s],
    inPool,
    inOther,
    inCube: Math.max(1, countIn(ctx.cubeNames, name)),
    include: false,
    copies: null,
  };
  row.include = inPool === 0 && inOther === 0 && (s.byHand === true || rowConfidence(row) >= SURE);
  row.copies = rowQuestion(row) ? null : 1;
  return [...rows, row];
}

/** The review model for a parsed answer: grouped by cube card, near misses matched, the rest left to the player. */
export function buildReview(parsed: ParsedRecognition, cubeNames: readonly string[], pool: readonly string[], other: readonly string[] = []): ReviewModel {
  const index = nameIndex(cubeNames);
  const ctx: ReviewContext = { pool, other, cubeNames };
  let rows: ReviewRow[] = [];
  const unmatched: UnmatchedItem[] = [];
  let basics = 0;
  const isBasic = (n: string) => BASIC_NAMES.has(n.replace(/^Snow-Covered /, '')) || /^(snow-covered )?(plains|island|swamp|mountain|forest|wastes)$/i.test(n.trim());
  for (const c of parsed.cards) {
    const m = matchName(c.name, index);
    if (m.name) {
      rows = addSighting(rows, m.name, { photo: c.photo, count: c.count, confidence: c.confidence, note: c.note, ...(m.how === 'fuzzy' ? { readAs: c.name } : {}) }, ctx);
    } else if (isBasic(c.name)) {
      basics += c.count;
    } else {
      unmatched.push({ id: rowId('u'), photo: c.photo, text: c.name, note: c.note, suggestions: m.suggestions });
    }
  }
  for (const u of parsed.unrecognised) {
    const g = u.guess ? matchName(u.guess, index) : null;
    const suggestions = g?.name ? [g.name, ...g.suggestions.filter((n) => n !== g.name)].slice(0, 3) : (g?.suggestions ?? []);
    unmatched.push({ id: rowId('u'), photo: u.photo, text: u.guess || '', note: u.note, suggestions });
  }
  rows.sort((a, b) => a.name.localeCompare(b.name));
  return { rows, unmatched, basics, problems: parsed.problems };
}

/** The player named an unmatched item: it becomes a sighting of that card (merged into its row if there is one). */
export function resolveUnmatched(model: ReviewModel, id: string, name: string, ctx: ReviewContext): ReviewModel {
  const u = model.unmatched.find((x) => x.id === id);
  if (!u) return model;
  const rows = addSighting(model.rows, name, { photo: u.photo, count: 1, confidence: 1, note: u.note, byHand: true }, ctx);
  return { ...model, rows: [...rows].sort((a, b) => a.name.localeCompare(b.name)), unmatched: model.unmatched.filter((x) => x.id !== id) };
}

/** The player corrected a row's card: its sightings move to `name` (merging with that card's row if any). */
export function renameRow(model: ReviewModel, id: string, name: string, ctx: ReviewContext): ReviewModel {
  const r = model.rows.find((x) => x.id === id);
  if (!r || r.name === name) return model;
  let rows = model.rows.filter((x) => x.id !== id);
  for (const s of r.sightings) rows = addSighting(rows, name, { ...s, readAs: undefined, byHand: true, confidence: 1 }, ctx);
  return { ...model, rows: [...rows].sort((a, b) => a.name.localeCompare(b.name)) };
}

export function updateRow(model: ReviewModel, id: string, patch: Partial<Pick<ReviewRow, 'include' | 'copies'>>): ReviewModel {
  return { ...model, rows: model.rows.map((r) => (r.id === id ? { ...r, ...patch } : r)) };
}

export function dropUnmatched(model: ReviewModel, id: string): ReviewModel {
  return { ...model, unmatched: model.unmatched.filter((x) => x.id !== id) };
}

export interface AddPlan {
  /** Names to append to the pool, a name once per copy. */
  add: string[];
  /** Ticked rows whose question is still open: confirming waits for these. */
  open: ReviewRow[];
  /** Ticked rows already fully in the pool: nothing to add. */
  already: ReviewRow[];
}

/**
 * What confirming would add: each ticked row's copies (1, or the player's
 * answer) less the copies already in the pool. A card in the pool is never
 * added again just because a photo shows it.
 */
export function planAdd(rows: readonly ReviewRow[]): AddPlan {
  const add: string[] = [];
  const open: ReviewRow[] = [];
  const already: ReviewRow[] = [];
  for (const r of rows) {
    if (!r.include) continue;
    if (rowQuestion(r) && r.copies === null) {
      open.push(r);
      continue;
    }
    const want = r.copies ?? 1;
    const n = Math.max(0, want - r.inPool);
    if (n === 0) already.push(r);
    for (let i = 0; i < n; i++) add.push(r.name);
  }
  return { add, open, already };
}
