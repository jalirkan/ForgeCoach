/*
 * ForgeCoach — cube/human.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Human card numbers from 17Lands' public datasets, for the cubes 17Lands
 * covers: `public/cubes/<file>.human.json`, written by
 * scripts/human-cards/ (`npm run human-cards`) from 17Lands' published game
 * data (one row per game an Arena player recorded with 17Lands). Pure and
 * DOM-free; `fetch` is injected.
 *
 *   {"schema":1,
 *    "source":{"name":"17Lands","page","licence":"CC BY 4.0","licenceUrl","dataset","files":[…],
 *              "updated":"YYYY-MM-DD","changes"},
 *    "generated":"YYYY-MM-DD",
 *    "cube":{"file","title","cards","matched"},
 *    "minGih":500,
 *    "games","wins",                       every game in the files
 *    "gih":{"games","wins"},               pooled over every card of the dataset: the format's average card in hand
 *    "cards":{"<cube name>":{"gih","gihW","oh","ohW","gns","gnsW"}}}
 *
 * GIH = games in which the card was in the opening hand or drawn (17Lands'
 * "games in hand"; tutored-only does not count), OH = in the opening hand,
 * GNS = in the deck but never seen. IWD ("improvement when drawn") is
 * GIH WR − GNS WR. Only counts are stored; rates and intervals are computed
 * here. Cards are keyed by this cube's own names (front face matched).
 *
 * HONESTY (as draft/labStats.ts).
 *  - A card is called strong (weak) only when its whole 95% Wilson interval
 *    lies above (below) the format's average — not 50%: 17Lands users are an
 *    engaged population that wins well over half its games.
 *  - The players draft Arena's Powered Cube, not this paper cube: the card
 *    list and power level differ (ARENA_NOTE).
 */
import { wilson } from '../bench/benchStats.ts';

export const HUMAN_SCHEMA = 1;

export interface HumanCardCounts {
  gih: number;
  gihW: number;
  oh?: number;
  ohW?: number;
  gns?: number;
  gnsW?: number;
}

export interface HumanSource {
  name: string;
  page: string;
  licence: string;
  licenceUrl: string;
  dataset: string;
  files: string[];
  /** The dataset's "Last Updated" date on 17Lands' page. */
  updated: string;
  changes?: string;
}

export interface HumanCards {
  schema: 1;
  source: HumanSource;
  generated: string;
  cube: { file: string; title: string; cards: number; matched: number };
  minGih: number;
  games: number;
  wins: number;
  gih: { games: number; wins: number };
  cards: Record<string, HumanCardCounts>;
}

/** The join key between 17Lands' names and a cube's: front face, case-folded, accents and curly quotes flattened, spaces collapsed (mtg-table cards17l.py `norm`). */
export function normName(name: string): string {
  const s = name.split(' // ')[0]!.replace(/[’‘]/g, "'");
  return s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().split(/\s+/).filter(Boolean).join(' ');
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const isCount = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x) && x >= 0 && x <= 1e9;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const HTTPS = /^https:\/\/[A-Za-z0-9.-]+(\/[A-Za-z0-9._~\-/%]*)?$/;
const clean = (x: unknown, max: number): string | null => {
  if (typeof x !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const s = x.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  return s && s.length <= max ? s : null;
};

/** Validates a parsed `.human.json`; throws an Error saying what is wrong. A malformed card is dropped (the rest stand). */
export function parseHumanCards(raw: unknown): HumanCards {
  if (!isObj(raw)) throw new Error('human.json is not a JSON object.');
  if (raw.schema !== HUMAN_SCHEMA) throw new Error(`human.json schema ${String(raw.schema)} is not supported (this page reads schema ${HUMAN_SCHEMA}).`);
  const s = raw.source;
  if (!isObj(s)) throw new Error('human.json has no source.');
  const name = clean(s.name, 40);
  const page = clean(s.page, 200);
  const licence = clean(s.licence, 40);
  const licenceUrl = clean(s.licenceUrl, 200);
  const dataset = clean(s.dataset, 80);
  const updated = clean(s.updated, 10);
  if (!name || !licence || !dataset || !page || !HTTPS.test(page) || !licenceUrl || !HTTPS.test(licenceUrl)) throw new Error('human.json: the source must name the data, its page and its licence.');
  if (!updated || !DATE.test(updated)) throw new Error('human.json: source.updated must be a YYYY-MM-DD date.');
  const files = Array.isArray(s.files) ? s.files.map((f) => clean(f, 120)).filter((f): f is string => !!f) : [];
  const generated = clean(raw.generated, 10);
  if (!generated || !DATE.test(generated)) throw new Error('human.json: generated must be a YYYY-MM-DD date.');
  const c = raw.cube;
  if (!isObj(c)) throw new Error('human.json has no cube.');
  const file = clean(c.file, 120);
  const title = clean(c.title, 200);
  if (!file || !title || !isCount(c.cards) || !isCount(c.matched)) throw new Error('human.json: cube must give file, title, cards and matched.');
  if (!isCount(raw.minGih) || !isCount(raw.games) || !isCount(raw.wins) || raw.wins > raw.games || raw.games === 0) throw new Error('human.json: games, wins and minGih must be counts, wins ≤ games.');
  const g = raw.gih;
  if (!isObj(g) || !isCount(g.games) || !isCount(g.wins) || g.wins > g.games || g.games === 0) throw new Error('human.json: gih must hold the pooled games and wins.');
  if (!isObj(raw.cards)) throw new Error('human.json has no cards.');
  const cards: Record<string, HumanCardCounts> = {};
  const pair = (n: unknown, k: unknown) => isCount(n) && isCount(k) && k <= n;
  for (const [k, v] of Object.entries(raw.cards)) {
    const key = clean(k, 160);
    if (!key || !isObj(v) || !pair(v.gih, v.gihW) || (v.gih as number) < raw.minGih) continue;
    const out: HumanCardCounts = { gih: v.gih as number, gihW: v.gihW as number };
    if (pair(v.oh, v.ohW)) Object.assign(out, { oh: v.oh, ohW: v.ohW });
    if (pair(v.gns, v.gnsW)) Object.assign(out, { gns: v.gns, gnsW: v.gnsW });
    cards[key] = out;
  }
  const source: HumanSource = { name, page, licence, licenceUrl, dataset, files, updated };
  const changes = clean(s.changes, 400);
  if (changes) source.changes = changes;
  return {
    schema: 1,
    source,
    generated,
    cube: { file, title, cards: c.cards, matched: c.matched },
    minGih: raw.minGih,
    games: raw.games,
    wins: raw.wins,
    gih: { games: g.games, wins: g.wins },
    cards,
  };
}

type Fetch = (url: string) => Promise<Pick<Response, 'ok' | 'status' | 'json'>>;

/** The shipped human numbers for a cube (cubes.ts `CubeInfo`), or null when none ship (`humanData` not set) or they are unreadable. */
export async function loadHumanCards(info: { file: string; humanData?: boolean }, base: string, fetcher: Fetch = (u) => fetch(u)): Promise<HumanCards | null> {
  // None ships: don't ask (a 404 on every page that shows this cube).
  if (!info.humanData) return null;
  try {
    const res = await fetcher(`${base}cubes/${info.file}.human.json`);
    if (!res.ok) return null;
    return parseHumanCards(await res.json());
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// One card's view

export interface HumanRate {
  k: number;
  n: number;
  p: number;
  lo: number;
  hi: number;
}

export type HumanVerdict = 'strong' | 'weak' | 'unclear';

export interface HumanCardView {
  name: string;
  /** Win rate in games where the card was in hand (opening hand or drawn), Wilson 95%. */
  gih: HumanRate;
  /** Opening-hand win rate, when the file has it. */
  oh: HumanRate | null;
  /** Improvement when drawn, GIH WR − GNS WR, with a normal-approximation 95% interval. */
  iwd: { d: number; lo: number; hi: number } | null;
  /** The format's average win rate for a card in hand (pooled over all of the dataset's cards). */
  avg: number;
  /** Strong / weak only when the GIH interval excludes the average. */
  verdict: HumanVerdict;
}

function rate(k: number, n: number): HumanRate | null {
  const w = n > 0 && k >= 0 && k <= n ? wilson(k, n) : null;
  return w ? { k, n, p: k / n, lo: w.lo, hi: w.hi } : null;
}

/** The format's average: pooled GIH win rate over every card of the dataset. */
export const humanAverage = (d: HumanCards) => d.gih.wins / d.gih.games;

export function humanVerdict(r: Pick<HumanRate, 'lo' | 'hi'>, avg: number): HumanVerdict {
  if (r.lo > avg) return 'strong';
  if (r.hi < avg) return 'weak';
  return 'unclear';
}

/** The view of one cube card, or null when the file has no numbers for it (not in 17Lands' cube, or under minGih games). */
export function humanCardView(d: HumanCards | null, name: string): HumanCardView | null {
  const c = d?.cards[name];
  if (!d || !c) return null;
  const gih = rate(c.gihW, c.gih);
  if (!gih) return null;
  const avg = humanAverage(d);
  const oh = c.oh !== undefined && c.ohW !== undefined && c.oh > 0 ? rate(c.ohW, c.oh) : null;
  let iwd: HumanCardView['iwd'] = null;
  if (c.gns !== undefined && c.gnsW !== undefined && c.gns > 0) {
    const p1 = gih.p;
    const p2 = c.gnsW / c.gns;
    const se = Math.sqrt((p1 * (1 - p1)) / gih.n + (p2 * (1 - p2)) / c.gns);
    iwd = { d: p1 - p2, lo: p1 - p2 - 1.96 * se, hi: p1 - p2 + 1.96 * se };
  }
  return { name, gih, oh, iwd, avg, verdict: humanVerdict(gih, avg) };
}

// ---------------------------------------------------------------------------
// Words

const p1 = (x: number) => `${(x * 100).toFixed(1)}%`;
const n1 = (x: number) => (x * 100).toFixed(1);
const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
const pts = (x: number) => `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(1)}`;

/** "57.1% win when drawn [56.2, 58.0], 14,210 games" */
export function humanLine(v: HumanCardView): string {
  return `${p1(v.gih.p)} win when drawn [${n1(v.gih.lo)}, ${n1(v.gih.hi)}], ${fmt(v.gih.n)} game${v.gih.n === 1 ? '' : 's'}`;
}

/** "improvement when drawn +3.1 points [+2.0, +4.2]" */
export function iwdLine(i: NonNullable<HumanCardView['iwd']>): string {
  return `improvement when drawn ${pts(i.d)} points [${pts(i.lo)}, ${pts(i.hi)}]`;
}

export function humanVerdictLine(v: HumanCardView): string {
  const a = p1(v.avg);
  if (v.verdict === 'strong') return `strong for humans: the interval is above the format’s ${a} average`;
  if (v.verdict === 'weak') return `weak for humans: the interval is below the format’s ${a} average`;
  return `neither strong nor weak: the interval includes the format’s ${a} average`;
}

/** The section's title: "Human data (17Lands, Arena cube)". */
export const HUMAN_TITLE = 'Human data (17Lands, Arena cube)';

export const ARENA_NOTE = '17Lands players draft the Arena version of this cube (Powered Cube), so its card list and power level differ slightly from this paper cube.';

/** "Powered Cube game data, updated 2025-11-23, 294,975 games" — what the credit links to 17Lands' page with. */
export function humanSourceLine(d: HumanCards): string {
  return `${d.source.dataset} game data, updated ${d.source.updated}, ${fmt(d.games)} games`;
}
