/*
 * ForgeCoach — cube/humanPicks.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * What human drafters pick: a pick model fitted to 17Lands' public Powered
 * Cube draft data (CC BY 4.0; docs/human-picks.md, scripts/human-picks/),
 * shipped per cube as `public/cubes/<file>.picks.json` for the cubes that
 * passed that document's pre-registered test (cubes.ts `humanPicks`).
 *
 * The model is a conditional logit: each card on offer gets a utility
 *
 *   u = s · (1 + γ·t) + β · x
 *
 * where s is the card's pick strength (log-odds, from the file), t = how far
 * into the draft the pool is (pool size / tScale, at most 1) and x eleven
 * features of the card against the pool (colour fit, off-colour count, gold,
 * colourless, land, a dual in the pool's colours, curve), computed here
 * exactly as fit.py does. The chance a human takes card i from the set is
 * exp(u_i) / Σ exp(u_j).
 *
 * It is a SIGNAL beside the lab number, never part of the card value or the
 * advice's ranking: it was tested on Arena booster picks, not on grid lines
 * (docs/human-picks.md § Transfer). Pure and DOM-free.
 */
import type { CardFacts } from './facts.ts';

export const PICKS_SCHEMA = 1;

export const PICK_FEATURES = ['fit', 'fitT', 'off', 'offT', 'goldT', 'colourlessT', 'landT', 'dual', 'dualT', 'curve', 'curveT'] as const;
export type PickFeature = (typeof PICK_FEATURES)[number];

export interface HumanPickCard {
  /** Pick strength, log-odds. */
  s: number;
  /** Times the card was in a pack, and taken, in the data. */
  seen: number;
  taken: number;
  /** The colours the model was fitted with (Scryfall's, WUBRG; '' colourless): a cube document may file a colourless Mox under its colour. */
  colors?: string;
}

export interface HumanPicks {
  schema: 1;
  source: { name: string; page: string; licence: string; licenceUrl: string; dataset: string; files: string[]; updated: string; changes?: string };
  generated: string;
  cube: { file: string; cards: number; matched: number };
  picks: number;
  drafts: number;
  model: { gamma: number; beta: Record<PickFeature, number>; tScale: number; offShare: number; offMinPool: number };
  /** Held-out top-1 accuracy on this cube's cards: the model, cardValue and pickValue (docs/human-picks.md). */
  test: { picks: number; top1: number; top1CardValue: number; top1PickValue: number };
  cards: Record<string, HumanPickCard>;
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const isNum = (x: unknown, lo = -1e6, hi = 1e6): x is number => typeof x === 'number' && Number.isFinite(x) && x >= lo && x <= hi;
const isCount = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x) && x >= 0 && x <= 1e10;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const HTTPS = /^https:\/\/[A-Za-z0-9.-]+(\/[A-Za-z0-9._~\-/%]*)?$/;
const clean = (x: unknown, max: number): string | null => {
  if (typeof x !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const s = x.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  return s && s.length <= max ? s : null;
};

/** Validates a parsed `.picks.json`; throws an Error saying what is wrong. A malformed card is dropped. */
export function parseHumanPicks(raw: unknown): HumanPicks {
  if (!isObj(raw)) throw new Error('picks.json is not a JSON object.');
  if (raw.schema !== PICKS_SCHEMA) throw new Error(`picks.json schema ${String(raw.schema)} is not supported (this page reads schema ${PICKS_SCHEMA}).`);
  const s = raw.source;
  if (!isObj(s)) throw new Error('picks.json has no source.');
  const name = clean(s.name, 40);
  const page = clean(s.page, 200);
  const licence = clean(s.licence, 40);
  const licenceUrl = clean(s.licenceUrl, 200);
  const dataset = clean(s.dataset, 80);
  const updated = clean(s.updated, 10);
  if (!name || !licence || !dataset || !page || !HTTPS.test(page) || !licenceUrl || !HTTPS.test(licenceUrl)) throw new Error('picks.json: the source must name the data, its page and its licence.');
  if (!updated || !DATE.test(updated)) throw new Error('picks.json: source.updated must be a YYYY-MM-DD date.');
  const generated = clean(raw.generated, 10);
  if (!generated || !DATE.test(generated)) throw new Error('picks.json: generated must be a YYYY-MM-DD date.');
  const c = raw.cube;
  if (!isObj(c) || !clean(c.file, 120) || !isCount(c.cards) || !isCount(c.matched)) throw new Error('picks.json: cube must give file, cards and matched.');
  if (!isCount(raw.picks) || !isCount(raw.drafts)) throw new Error('picks.json: picks and drafts must be counts.');
  const m = raw.model;
  if (!isObj(m) || !isNum(m.gamma, -10, 10) || !isNum(m.tScale, 1, 1000) || !isNum(m.offShare, 0, 1) || !isNum(m.offMinPool, 0, 1000) || !isObj(m.beta)) throw new Error('picks.json: model must give gamma, beta, tScale, offShare and offMinPool.');
  const beta = {} as Record<PickFeature, number>;
  for (const f of PICK_FEATURES) {
    const v = m.beta[f];
    if (!isNum(v, -100, 100)) throw new Error(`picks.json: model.beta.${f} must be a number.`);
    beta[f] = v;
  }
  const t = raw.test;
  if (!isObj(t) || !isCount(t.picks) || !isNum(t.top1, 0, 1) || !isNum(t.top1CardValue, 0, 1) || !isNum(t.top1PickValue, 0, 1)) throw new Error('picks.json: test must give picks and the three top-1 rates.');
  if (!isObj(raw.cards)) throw new Error('picks.json has no cards.');
  const cards: Record<string, HumanPickCard> = {};
  for (const [k, v] of Object.entries(raw.cards)) {
    const key = clean(k, 160);
    if (!key || !isObj(v) || !isNum(v.s, -50, 50) || !isCount(v.seen) || !isCount(v.taken) || v.taken > v.seen) continue;
    const card: HumanPickCard = { s: v.s, seen: v.seen, taken: v.taken };
    if (typeof v.colors === 'string' && /^W?U?B?R?G?$/.test(v.colors)) card.colors = v.colors;
    cards[key] = card;
  }
  const source: HumanPicks['source'] = { name, page, licence, licenceUrl, dataset, updated, files: Array.isArray(s.files) ? s.files.map((f) => clean(f, 120)).filter((f): f is string => !!f) : [] };
  const changes = clean(s.changes, 400);
  if (changes) source.changes = changes;
  return {
    schema: 1,
    source,
    generated,
    cube: { file: clean(c.file, 120)!, cards: c.cards, matched: c.matched },
    picks: raw.picks,
    drafts: raw.drafts,
    model: { gamma: m.gamma, beta, tScale: m.tScale, offShare: m.offShare, offMinPool: m.offMinPool },
    test: { picks: t.picks, top1: t.top1, top1CardValue: t.top1CardValue, top1PickValue: t.top1PickValue },
    cards,
  };
}

type Fetch = (url: string) => Promise<Pick<Response, 'ok' | 'status' | 'json'>>;

/** The shipped pick model for a cube (cubes.ts `humanPicks`), or null when none ships or it is unreadable. */
export async function loadHumanPicks(info: { file: string; humanPicks?: boolean }, base: string, fetcher: Fetch = (u) => fetch(u)): Promise<HumanPicks | null> {
  if (!info.humanPicks) return null;
  try {
    const res = await fetcher(`${base}cubes/${info.file}.picks.json`);
    if (!res.ok) return null;
    return parseHumanPicks(await res.json());
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// The model

const COLOURS = 'WUBRG';
type Facts = Pick<CardFacts, 'colors' | 'land' | 'mv' | 'produces'>;
type FactsOf = (name: string) => Facts | undefined;

/** What the features need from a pool, computed once per pool (fit.py `_pool_stats`). */
export interface PickPool {
  t: number;
  share: number[];
  coloured: number;
  top2: Set<string>;
  hasPair: boolean;
  nonland: number;
  mvCounts: number[];
}

const mvBucket = (mv: number) => Math.min(Math.max(Math.trunc(mv), 1), 6) - 1;

export function pickPool(pool: readonly string[], factsOf: FactsOf, tScale: number): PickPool {
  const mass = [0, 0, 0, 0, 0];
  let coloured = 0;
  let nonland = 0;
  const mvCounts = [0, 0, 0, 0, 0, 0];
  for (const p of pool) {
    const f = factsOf(p);
    if (!f || f.land) continue;
    nonland++;
    mvCounts[mvBucket(f.mv)]!++;
    const cs = [...f.colors].filter((c) => COLOURS.includes(c));
    if (!cs.length) continue;
    coloured++;
    for (const c of cs) mass[COLOURS.indexOf(c)]! += 1 / cs.length;
  }
  const tot = mass.reduce((a, b) => a + b, 0);
  const share = mass.map((m) => (tot > 0 ? m / tot : 0));
  // Top two colours by mass, ties in WUBRG order, only colours with mass.
  const order = [0, 1, 2, 3, 4].sort((a, b) => mass[b]! - mass[a]! || a - b);
  const top2 = new Set(order.slice(0, 2).filter((i) => mass[i]! > 0).map((i) => COLOURS[i]!));
  return { t: Math.min(1, pool.length / tScale), share, coloured, top2, hasPair: top2.size === 2, nonland, mvCounts };
}

/** The eleven features of one card against a pool, in PICK_FEATURES order (fit.py `features`). */
export function pickFeatures(f: Facts | undefined, pp: PickPool, model: Pick<HumanPicks['model'], 'offShare' | 'offMinPool'>): number[] {
  if (!f) return PICK_FEATURES.map(() => 0);
  const t = pp.t;
  const cs = [...f.colors].filter((c) => COLOURS.includes(c));
  const land = f.land;
  const coloured = !land && cs.length > 0;
  const shares = cs.map((c) => pp.share[COLOURS.indexOf(c)]!);
  const fit = coloured ? Math.min(...shares) : 0;
  const off = coloured && pp.coloured >= model.offMinPool ? shares.filter((x) => x < model.offShare).length : 0;
  const gold = coloured && cs.length >= 2 ? 1 : 0;
  const cless = !land && cs.length === 0 ? 1 : 0;
  const dual = land && pp.hasPair && [...pp.top2].every((c) => f.produces.includes(c)) ? 1 : 0;
  const curve = !land && pp.nonland > 0 ? pp.mvCounts[mvBucket(f.mv)]! / pp.nonland : 0;
  return [fit, fit * t, off, off * t, gold * t, cless * t, (land ? 1 : 0) * t, dual, dual * t, curve, curve * t];
}

export interface HumanPickChance {
  name: string;
  /** The chance a human with this pool takes it from the covered cards on offer. */
  p: number;
}

/** `factsOf` with the file's own colours for the cards it covers, so the features see what fit.py saw. */
export function modelFacts(d: HumanPicks, factsOf: FactsOf): FactsOf {
  return (n) => {
    const f = factsOf(n);
    const c = d.cards[n]?.colors;
    return f && c !== undefined && !f.land ? { ...f, colors: c } : f;
  };
}

/**
 * The model's chance that a human drafter with `pool` takes each covered card of `names` (cards the
 * file does not cover are left out), highest first. Empty when fewer than two are covered.
 */
export function humanPickChances(d: HumanPicks, names: readonly string[], pool: readonly string[], appFacts: FactsOf): HumanPickChance[] {
  const factsOf = modelFacts(d, appFacts);
  const covered = [...new Set(names)].filter((n) => d.cards[n]);
  if (covered.length < 2) return [];
  const pp = pickPool(pool, factsOf, d.model.tScale);
  const beta = PICK_FEATURES.map((k) => d.model.beta[k]);
  const u = covered.map((n) => {
    const x = pickFeatures(factsOf(n), pp, d.model);
    return d.cards[n]!.s * (1 + d.model.gamma * pp.t) + x.reduce((a, xi, i) => a + xi * beta[i]!, 0);
  });
  const mx = Math.max(...u);
  const e = u.map((x) => Math.exp(x - mx));
  const z = e.reduce((a, b) => a + b, 0);
  return covered.map((name, i) => ({ name, p: e[i]! / z })).sort((a, b) => b.p - a.p || (a.name < b.name ? -1 : 1));
}

// ---------------------------------------------------------------------------
// Words

export type PickTier = 'early' | 'middle' | 'late';

/** The card's place among the file's cards by strength: 1 = humans' most wanted. */
export function humanPickRank(d: HumanPicks, name: string): { rank: number; of: number } | null {
  const c = d.cards[name];
  if (!c) return null;
  const all = Object.values(d.cards);
  return { rank: 1 + all.filter((o) => o.s > c.s).length, of: all.length };
}

/** Top fifth: early; bottom third: late; else middle. */
export function humanPickTier(d: HumanPicks, name: string): PickTier | null {
  const r = humanPickRank(d, name);
  if (!r) return null;
  const q = (r.rank - 1) / Math.max(1, r.of - 1);
  return q < 0.2 ? 'early' : q >= 2 / 3 ? 'late' : 'middle';
}

export const TIER_WORDS: Record<PickTier, string> = {
  early: 'Humans take this early',
  middle: 'Humans take this mid-pack',
  late: 'Humans take this late',
};

/** "Humans take this early · #12 of 152 by human picks" — one card's line; null when the file does not cover it. */
export function humanPickLine(d: HumanPicks, name: string): string | null {
  const tier = humanPickTier(d, name);
  const r = humanPickRank(d, name);
  if (!tier || !r) return null;
  return `${TIER_WORDS[tier]} · #${r.rank} of ${r.of} by human picks`;
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

/**
 * For a choice (a pack, a grid, a pile): "Humans with your pool would most often take X (54%), then Y (21%)."
 * Null when fewer than two of the cards are covered.
 */
export function humanPickNote(d: HumanPicks, names: readonly string[], pool: readonly string[], factsOf: FactsOf): string | null {
  const ch = humanPickChances(d, names, pool, factsOf);
  if (!ch.length) return null;
  const [a, b] = ch;
  const missing = new Set(names).size - ch.length;
  return `Of these, humans with your pool would most often take ${a!.name} (${pct(a!.p)})${b ? `, then ${b.name} (${pct(b.p)})` : ''}${missing > 0 ? `; ${missing} card${missing === 1 ? ' is' : 's are'} not in their data` : ''}.`;
}

export const PICKS_NOTE =
  'A pick model fitted to 8-player booster drafts of Arena’s Powered Cube: it says what those players take, not what wins, and was never tested on grid or Winston picks.';

/** "Powered Cube draft data, updated 2025-12-01, 2,316,631 picks" — the credit's line. */
export const humanPicksSourceLine = (d: HumanPicks): string => `${d.source.dataset} draft data, updated ${d.source.updated}, ${d.picks.toLocaleString('en-US')} picks from ${d.drafts.toLocaleString('en-US')} drafts`;
