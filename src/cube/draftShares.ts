/*
 * ForgeCoach — cube/draftShares.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The colour shares of REAL drafts of a cube: of the decks people actually
 * built after drafting it (friend drafts in mtg-table's draft room, and the
 * player's own drafts against the bot), what share play each colour, and how
 * the decks split by their exact colours — mono, each pair, each triple (when
 * there are enough decks to say anything per triple) and four or five colours
 * folded into "4+". Every share carries the count of decks behind it and a
 * Wilson 95% interval. Nothing here is a verdict; it is a count. It is the
 * human ground truth the lab's bot-drafted shares are compared against.
 *
 * THE DATA (mtg-table D455, tools/draft-decks.mjs): the coach helper's
 * `GET /draft-decks?cube=<id>` answers each recorded deck as the count of its
 * nonland cards of each colour — never a card name. A friend's deck is there
 * only if that seat agreed to recording (D407), and its list never leaves the
 * owner's machine; this module only ever sees colour counts.
 *
 * THE RULE (the lab census's `coloursWith3`, mtg-table D447): a deck's MAIN
 * colours are the colours with at least MAIN_MIN_SPELLS of its nonland cards
 * (a gold card counts in each of its colours). A deck with none — all
 * colourless spells — is "no main colour". A splash of one or two cards is not
 * a main colour.
 *
 * Pure and DOM-free; the client (`fetchDraftDecks`, `recordSoloDeck`) takes an
 * injected fetch.
 */
import { wilson } from '../bench/benchStats.ts';
import { pageHelperTarget, TOKEN_HEADER, type HelperTarget } from '../coachHelper.ts';
import { COLOURS, colourPairs, type Colour } from './colors.ts';

/** A colour is a deck's main colour from this many of its nonland cards of that colour (D447's 3+). */
export const MAIN_MIN_SPELLS = 3;
/** Triples are shown one by one from this many decks; below it, one "3 colours" row (ten cells of a handful say nothing). */
export const TRIPLE_MIN_DECKS = 30;

export type DraftSource = 'room' | 'solo';

/** One recorded deck, as the helper answers it: colour counts only. */
export interface DraftDeckMakeup {
  source: DraftSource;
  /** YYYY-MM-DD, the day the deck was handed in. */
  day: string;
  format: 'grid' | 'winston' | 'booster' | null;
  spells: Record<Colour, number>;
  colourless: number;
  lands: number;
  /** Cards no Forge script describes (not in Forge 2.0.14, a typo): left out of the colours. */
  unread: number;
}

export interface DraftDecks {
  cube: string;
  /** The helper read card colours from Forge's scripts (false: every nonbasic is unread). */
  scripts: boolean;
  decks: DraftDeckMakeup[];
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const count = (x: unknown): x is number => Number.isInteger(x) && (x as number) >= 0 && (x as number) <= 1000;

/** The helper's GET /draft-decks body, strictly: null when it is not one (or not this cube's). */
export function parseDraftDecks(body: unknown, cube: string): DraftDecks | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  if (b.ok !== true || b.v !== 1 || b.cube !== cube || !Array.isArray(b.decks)) return null;
  const decks: DraftDeckMakeup[] = [];
  for (const raw of b.decks) {
    if (!raw || typeof raw !== 'object') return null;
    const d = raw as Record<string, unknown>;
    const sp = d.spells as Record<string, unknown> | null;
    if ((d.source !== 'room' && d.source !== 'solo') || typeof d.day !== 'string' || !DAY.test(d.day)) return null;
    if (!sp || typeof sp !== 'object' || !COLOURS.every((c) => count(sp[c]))) return null;
    if (!count(d.colourless) || !count(d.lands) || !count(d.unread)) return null;
    const format = d.format === 'grid' || d.format === 'winston' || d.format === 'booster' ? d.format : null;
    decks.push({
      source: d.source,
      day: d.day,
      format,
      spells: { W: sp.W as number, U: sp.U as number, B: sp.B as number, R: sp.R as number, G: sp.G as number },
      colourless: d.colourless,
      lands: d.lands,
      unread: d.unread,
    });
  }
  return { cube, scripts: b.scripts === true, decks };
}

/** A deck's main colours, WUBRG order ('' for none). */
export function mainColours(d: Pick<DraftDeckMakeup, 'spells'>, min = MAIN_MIN_SPELLS): string {
  return COLOURS.filter((c) => d.spells[c] >= min).join('');
}

/** The exact-colours bucket of a set of main colours: '' (none), a mono colour, a pair, a triple, or '4+'. */
export function makeupBucket(main: string): string {
  return main.length >= 4 ? '4+' : main;
}

export interface ShareRow {
  /** 'W', 'WU', 'WUB', '3' (every triple together), '4+' or '' (no main colour). */
  key: string;
  /** Decks in this row. */
  k: number;
  /** Decks in all. */
  n: number;
  share: number;
  lo: number;
  hi: number;
}

export interface DraftShareTable {
  n: number;
  bySource: Record<DraftSource, number>;
  /** Decks with at least one unread card, and unread cards in all. */
  unreadDecks: number;
  unreadCards: number;
  first: string | null;
  last: string | null;
  /** Each colour: the share of decks it is a main colour of (they add up past 100%). */
  colours: ShareRow[];
  /** The decks split by their exact main colours: mono, pairs, triples (or '3'), '4+', and '' when any deck has none. */
  makeups: ShareRow[];
  /** Triples are rows of their own (n ≥ TRIPLE_MIN_DECKS). */
  triples: boolean;
  /** The number of main colours: 1, 2, 3 and 4+ (and 0 when any deck has none). */
  sizes: ShareRow[];
}

function row(key: string, k: number, n: number): ShareRow {
  const w = wilson(k, n);
  return { key, k, n, share: w?.mean ?? 0, lo: w?.lo ?? 0, hi: w?.hi ?? 0 };
}

function triplesAll(): string[] {
  const out: string[] = [];
  for (let a = 0; a < 5; a++) for (let b = a + 1; b < 5; b++) for (let c = b + 1; c < 5; c++) out.push(`${COLOURS[a]}${COLOURS[b]}${COLOURS[c]}`);
  return out;
}

/** The share table of a cube's recorded decks. */
export function draftShares(decks: DraftDeckMakeup[], opts: { tripleMin?: number; mainMin?: number } = {}): DraftShareTable {
  const n = decks.length;
  const tripleMin = opts.tripleMin ?? TRIPLE_MIN_DECKS;
  const mains = decks.map((d) => mainColours(d, opts.mainMin));
  const buckets = new Map<string, number>();
  for (const m of mains) buckets.set(makeupBucket(m), (buckets.get(makeupBucket(m)) ?? 0) + 1);
  const triples = n >= tripleMin;
  const days = decks.map((d) => d.day).sort();
  const colours = COLOURS.map((c) => row(c, mains.filter((m) => m.includes(c)).length, n));
  const makeups: ShareRow[] = [
    ...COLOURS.map((c) => row(c, buckets.get(c) ?? 0, n)),
    ...colourPairs().map((p) => row(p, buckets.get(p) ?? 0, n)),
    ...(triples ? triplesAll().map((t) => row(t, buckets.get(t) ?? 0, n)) : [row('3', mains.filter((m) => m.length === 3).length, n)]),
    row('4+', buckets.get('4+') ?? 0, n),
    ...((buckets.get('') ?? 0) > 0 ? [row('', buckets.get('') ?? 0, n)] : []),
  ];
  const sizeOf = (m: string) => Math.min(m.length, 4);
  const sizes = [...((buckets.get('') ?? 0) > 0 ? [0] : []), 1, 2, 3, 4].map((s) => row(s === 4 ? '4+' : String(s), mains.filter((m) => sizeOf(m) === s).length, n));
  return {
    n,
    bySource: { room: decks.filter((d) => d.source === 'room').length, solo: decks.filter((d) => d.source === 'solo').length },
    unreadDecks: decks.filter((d) => d.unread > 0).length,
    unreadCards: decks.reduce((t, d) => t + d.unread, 0),
    first: days[0] ?? null,
    last: days[days.length - 1] ?? null,
    colours,
    makeups,
    triples,
    sizes,
  };
}

export interface MonthShares {
  /** YYYY-MM. */
  month: string;
  n: number;
  colours: ShareRow[];
}

/** Each colour's share month by month, oldest first: how the drafts moved over time. */
export function sharesByMonth(decks: DraftDeckMakeup[], mainMin = MAIN_MIN_SPELLS): MonthShares[] {
  const by = new Map<string, DraftDeckMakeup[]>();
  for (const d of decks) {
    const m = d.day.slice(0, 7);
    by.set(m, [...(by.get(m) ?? []), d]);
  }
  return [...by.keys()].sort().map((month) => {
    const ds = by.get(month)!;
    const mains = ds.map((d) => mainColours(d, mainMin));
    return { month, n: ds.length, colours: COLOURS.map((c) => row(c, mains.filter((m) => m.includes(c)).length, ds.length)) };
  });
}

/** "62% (5 of 8; 31–86%)". */
export function shareWords(r: ShareRow): string {
  const pc = (x: number) => `${Math.round(x * 100)}%`;
  return `${pc(r.share)} (${r.k} of ${r.n}; ${Math.round(r.lo * 100)}–${pc(r.hi)})`;
}

// ---------------------------------------------------------------------------
// The client: the coach helper's two routes (mtg-table D455). Never throws.

export type DraftDecksFetch = (url: string, init?: RequestInit) => Promise<Pick<Response, 'ok' | 'status' | 'json'>>;

export interface DraftDecksOptions {
  fetch?: DraftDecksFetch;
  target?: HelperTarget;
  timeoutMs?: number;
}

export type DraftDecksResult =
  | { state: 'ok'; data: DraftDecks }
  /** No engine on this PC answered at all (a visitor with no helper): the page says nothing. */
  | { state: 'none' }
  /** No helper, or one without the ledger (an older mtg-table: no `draftDecks` route). */
  | { state: 'unavailable'; message: string }
  | { state: 'error'; message: string };

async function call(path: string, init: RequestInit, o: DraftDecksOptions): Promise<{ status: number; body: unknown }> {
  const f = o.fetch ?? ((u, i) => fetch(u, i));
  const t = o.target ?? pageHelperTarget();
  const c = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = c ? setTimeout(() => c.abort(), o.timeoutMs ?? 4000) : null;
  const h: Record<string, string> = {};
  if (init.method === 'POST') h['Content-Type'] = 'application/json';
  if (t.token) h[TOKEN_HEADER] = t.token;
  try {
    const res = await f(`${t.baseUrl}${path}`, { ...init, headers: h, ...(c ? { signal: c.signal } : {}), cache: 'no-store' });
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      /* not JSON */
    }
    return { status: res.status, body };
  } catch {
    return { status: 0, body: null };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** GET /draft-decks?cube=<id>: this cube's recorded decks, as colour counts. */
export async function fetchDraftDecks(cube: string, o: DraftDecksOptions = {}): Promise<DraftDecksResult> {
  const r = await call(`/draft-decks?cube=${encodeURIComponent(cube)}`, { method: 'GET' }, o);
  if (r.status === 0) return { state: 'none' };
  if (r.status === 404) return { state: 'unavailable', message: 'The engine on your PC is older and doesn’t record drafts yet: update mtg-table.' };
  if (r.status !== 200) {
    const m = r.body && typeof r.body === 'object' ? (r.body as { message?: unknown }).message : null;
    return { state: 'error', message: typeof m === 'string' && m ? m.slice(0, 300) : `The engine on your PC answered ${r.status}.` };
  }
  const data = parseDraftDecks(r.body, cube);
  return data ? { state: 'ok', data } : { state: 'error', message: 'The engine on your PC sent drafts this page can’t read.' };
}

export interface SoloDeckRecord {
  cubeId: string;
  draftId: string;
  format: 'grid' | 'winston' | 'booster';
  main: Array<[number, string]>;
}

/** POST /draft-deck: the deck you built after a draft against the bot, for the cube's real-draft shares. True when kept. */
export async function recordSoloDeck(rec: SoloDeckRecord, o: DraftDecksOptions = {}): Promise<boolean> {
  const r = await call('/draft-deck', { method: 'POST', body: JSON.stringify(rec) }, o);
  return r.status === 201;
}
