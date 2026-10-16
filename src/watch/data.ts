/*
 * ForgeCoach — watch/data.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Watch two bots (mtg-table D440, docs/watch-bots.md there): the files the
 * coach helper's GET /watch/<id> hands back, checked.
 *
 *   draft.json  (kind "watch-draft", v1)  the grid draft, pick by pick, both
 *               pools and both decks. A grid draft is face up: both drafters
 *               saw every grid and every line the other took, so nothing here
 *               was hidden from either.
 *   match.json  (kind "watch-match", v1)  the best of N: status, players,
 *               the games so far, the score.
 *
 * Strict as the other readers of the lab's files (lab/status.ts,
 * gameReview.ts): a draft whose picks do not add up (nine slots, a legal
 * line holding what was taken, the second pick on what the opener left,
 * pools the sum of the picks, 40-card decks) is refused whole with its
 * problems — mtg-table's `draftProblems` holds every watch to the same
 * checks before it writes the file. Strings are cleaned and capped, numbers
 * range-checked, unknown fields ignored. A match.json is read more kindly:
 * the runner's own last word for a watch it had to kill can be short (no
 * cube, no players), so only the status, the games and the score must be
 * there. DOM-free.
 */
import { LINES } from '../draft/draft.ts';
import { cleanText } from '../lab/status.ts';

export type WatchSide = 'A' | 'B';
export const SIDES: readonly WatchSide[] = ['A', 'B'];

export interface WatchPick {
  /** 1-based over the whole draft. */
  n: number;
  /** 1-based. */
  grid: number;
  seat: WatchSide;
  /** 1: this drafter opened the grid; 2: it took from what was left. */
  order: 1 | 2;
  /** The grid as this drafter saw it, row by row; null where the opener's line was. */
  slots: Array<string | null>;
  /** 0–2 the rows, 3–5 the columns (draft/draft.ts's LINES). */
  line: number;
  /** What the line held, in slot order. */
  took: string[];
  /** The lab drafter's own score for the line ("how much it liked it", not a probability). */
  value: number | null;
}

export interface WatchDeckWhy {
  spells: number | null;
  lands: number | null;
  creatures: number | null;
  /** Mana values 1, 2, … 6+ (the lab builder's buckets). */
  curve: number[];
  avgCmc: number | null;
  themes: Array<[string, number]>;
  score: number | null;
  alternatives: Array<{ colors: string; splash: string | null; score: number | null }>;
  stretched: boolean;
}

export interface WatchDeck {
  name: string;
  builder: 'lab' | 'forge';
  colors: string | null;
  splash: string | null;
  cards: number;
  main: Array<[number, string]>;
  sideboard: Array<[number, string]>;
  /** The lab builder's reasoning; null for Forge's build. */
  why: WatchDeckWhy | null;
  /** Why the lab's builder found no legal deck (Forge's then built it). */
  labErrors: string[];
}

export interface WatchDraft {
  id: string;
  cube: { title: string; file: string };
  seed: number;
  /** Each drafter's spec (D439 names: "lab", "forge-ranks", "llm:sonnet", …). */
  drafters: Record<WatchSide, string>;
  firstSeat: WatchSide;
  grids: number;
  picks: WatchPick[];
  pools: Record<WatchSide, string[]>;
  decks: Record<WatchSide, WatchDeck>;
  draftedMs: number | null;
}

export type WatchStatus = 'drafting' | 'playing' | 'done' | 'error' | 'stopped';
export const WATCH_STATUSES: readonly WatchStatus[] = ['drafting', 'playing', 'done', 'error', 'stopped'];
export const TERMINAL: readonly WatchStatus[] = ['done', 'error', 'stopped'];

export interface WatchPlayer {
  /** What was asked for: a Forge profile, or "search". */
  player: string;
  profile: string | null;
  policy: 'plain' | 'search' | null;
  /** The deck's name; null while drafting. */
  deck: string | null;
}

export interface WatchGame {
  n: number;
  status: 'playing' | 'done' | 'error';
  winner: WatchSide | 'draw' | null;
  reason: string | null;
  turns: number | null;
  startedMs: number | null;
  endedMs: number | null;
  redaction: 'pass' | 'fail' | null;
  error: string | null;
}

export interface WatchMatch {
  id: string;
  status: WatchStatus;
  error: string | null;
  cubeTitle: string | null;
  seed: number | null;
  bestOf: number | null;
  need: number | null;
  paceMs: number | null;
  /** Null when the runner's last word left them out. */
  players: Record<WatchSide, WatchPlayer> | null;
  games: WatchGame[];
  wins: { A: number; B: number; draws: number };
  winner: WatchSide | 'draw' | null;
  current: number | null;
  updatedAt: string | null;
}

export class WatchDataError extends Error {
  constructor(public problems: string[]) {
    super(`not a watch file: ${problems.slice(0, 3).join('; ')}${problems.length > 3 ? ` (+${problems.length - 3})` : ''}`);
  }
}

const MAX_NAME = 160;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const intIn = (v: unknown, lo: number, hi: number): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi ? v : null);
const numIn = (v: unknown, lo: number, hi: number): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : null);
const side = (v: unknown): WatchSide | null => (v === 'A' || v === 'B' ? v : null);
const result = (v: unknown): WatchSide | 'draw' | null => (v === 'A' || v === 'B' || v === 'draw' ? v : null);
const colours = (v: unknown): string | null => (typeof v === 'string' && /^[WUBRGC]{1,5}$/.test(v) ? v : null);

/** A card name: cleaned, capped, non-empty. */
function cardName(v: unknown): string | null {
  return cleanText(v, MAX_NAME);
}

function pairs(v: unknown, where: string, bad: string[]): Array<[number, string]> {
  if (!Array.isArray(v)) {
    bad.push(`${where} is not a list`);
    return [];
  }
  const out: Array<[number, string]> = [];
  for (const e of v) {
    const n = Array.isArray(e) ? intIn(e[0], 1, 99) : null;
    const name = Array.isArray(e) ? cardName(e[1]) : null;
    if (n === null || name === null || e.length !== 2) {
      bad.push(`${where} has an entry that is not [count, name]`);
      return out;
    }
    out.push([n, name]);
  }
  return out;
}

const sorted = (a: string[]) => [...a].sort();
const same = (a: unknown[], b: unknown[]) => JSON.stringify(a) === JSON.stringify(b);

/** The cards of line `l` in `slots`, in slot order (empty slots dropped). */
export function lineHolds(slots: Array<string | null>, l: number): string[] {
  return (LINES[l] ?? []).map((i) => slots[i]).filter((c): c is string => typeof c === 'string');
}

function parseWhy(v: unknown): WatchDeckWhy | null {
  if (!isObj(v)) return null;
  const curve = Array.isArray(v.curve) ? v.curve.map((x) => intIn(x, 0, 40)).filter((x): x is number => x !== null).slice(0, 8) : [];
  const themes: Array<[string, number]> = [];
  if (Array.isArray(v.themes)) {
    for (const t of v.themes.slice(0, 12)) {
      const k = Array.isArray(t) ? cleanText(t[0], 24) : null;
      const n = Array.isArray(t) ? intIn(t[1], 0, 40) : null;
      if (k && n !== null) themes.push([k, n]);
    }
  }
  const alternatives: WatchDeckWhy['alternatives'] = [];
  if (Array.isArray(v.alternatives)) {
    for (const a of v.alternatives.slice(0, 6)) {
      if (!isObj(a)) continue;
      const c = colours(a.colors);
      if (c) alternatives.push({ colors: c, splash: colours(a.splash), score: numIn(a.score, -1e4, 1e4) });
    }
  }
  return {
    spells: intIn(v.spells, 0, 40),
    lands: intIn(v.lands, 0, 40),
    creatures: intIn(v.creatures, 0, 40),
    curve,
    avgCmc: numIn(v.avgCmc, 0, 20),
    themes,
    score: numIn(v.score, -1e4, 1e4),
    alternatives,
    stretched: v.stretched === true,
  };
}

function parseDeck(v: unknown, s: WatchSide, bad: string[]): WatchDeck | null {
  if (!isObj(v)) {
    bad.push(`deck ${s} is missing`);
    return null;
  }
  const builder = v.builder === 'lab' || v.builder === 'forge' ? v.builder : null;
  if (!builder) bad.push(`deck ${s}'s builder is not lab or forge`);
  const main = pairs(v.main, `deck ${s}'s main`, bad);
  const sideboard = pairs(v.sideboard ?? [], `deck ${s}'s sideboard`, bad);
  const cards = intIn(v.cards, 0, 250);
  if (cards !== 40) bad.push(`deck ${s} has ${String(v.cards)} cards, not 40`);
  if (main.reduce((n, [c]) => n + c, 0) !== cards) bad.push(`deck ${s}'s count is not its main's`);
  const labErrors = Array.isArray(v.labErrors) ? v.labErrors.map((e) => cleanText(e, 200)).filter((e): e is string => !!e).slice(0, 8) : [];
  return {
    name: cleanText(v.name, 80) ?? `Drafter ${s}`,
    builder: builder ?? 'lab',
    colors: colours(v.colors),
    splash: colours(v.splash),
    cards: cards ?? 0,
    main,
    sideboard,
    why: builder === 'lab' ? parseWhy(v.why) : null,
    labErrors,
  };
}

/** draft.json → the view model, or a WatchDataError naming every problem. */
export function parseWatchDraft(raw: unknown): WatchDraft {
  const bad: string[] = [];
  if (!isObj(raw)) throw new WatchDataError(['not a JSON object']);
  if (raw.v !== 1 || raw.kind !== 'watch-draft' || raw.format !== 'grid' || raw.faceUp !== true) throw new WatchDataError(['not a v1 face-up grid watch-draft']);
  const id = typeof raw.id === 'string' && /^watch-[A-Za-z0-9._-]{1,120}$/.test(raw.id) ? raw.id : null;
  if (!id) bad.push('no watch id');
  const cube = isObj(raw.cube) ? raw.cube : {};
  const seed = intIn(raw.seed, 0, 999_999_999);
  if (seed === null) bad.push('no seed');
  const grids = intIn(raw.grids, 1, 60);
  if (grids === null) bad.push('no grid count');
  const firstSeat = side(raw.firstSeat);
  if (!firstSeat) bad.push('firstSeat is not A or B');
  const dr = isObj(raw.drafters) ? raw.drafters : {};
  const drafterOf = (s: WatchSide): string => {
    const d = isObj(dr[s]) ? (dr[s] as Record<string, unknown>).drafter : null;
    return typeof d === 'string' && /^[a-z][a-z0-9:=._-]{0,63}$/i.test(d) ? d : 'lab';
  };

  const picks: WatchPick[] = [];
  if (!Array.isArray(raw.picks)) bad.push('no picks');
  else {
    raw.picks.forEach((p: unknown, i: number) => {
      const where = `pick ${i + 1}`;
      if (!isObj(p)) {
        bad.push(`${where} is not an object`);
        return;
      }
      const n = intIn(p.n, 1, 999);
      const grid = intIn(p.grid, 1, 60);
      const seat = side(p.seat);
      const order = p.order === 1 || p.order === 2 ? p.order : null;
      const line = intIn(p.line, 0, 5);
      if (n !== i + 1) bad.push(`${where}: numbered out of order`);
      if (grid === null || seat === null || order === null || line === null) {
        bad.push(`${where}: grid, seat, order or line is missing`);
        return;
      }
      if (!Array.isArray(p.slots) || p.slots.length !== 9) {
        bad.push(`${where}: not nine slots`);
        return;
      }
      const slots = p.slots.map((c) => (c === null ? null : cardName(c)));
      if (p.slots.some((c, k) => c !== null && slots[k] === null)) bad.push(`${where}: a slot is not a card name`);
      if (order === 1 && slots.some((c) => c === null)) bad.push(`${where}: the opener saw an empty slot`);
      const took = Array.isArray(p.took) ? p.took.map(cardName) : [];
      const holds = lineHolds(slots, line);
      if (holds.length === 0) bad.push(`${where}: the line taken is empty`);
      if (!same(holds, took)) bad.push(`${where}: took is not what the line holds`);
      if (order === 2) {
        const prev = picks[picks.length - 1];
        if (!prev || prev.grid !== grid || prev.order !== 1 || prev.seat === seat) bad.push(`${where}: not after its grid's opener`);
        else {
          if (prev.line === line) bad.push(`${where}: the opener's own line`);
          const left = prev.slots.map((c, k) => ((LINES[prev.line] ?? []).includes(k) ? null : c));
          if (!same(left, slots)) bad.push(`${where}: not the grid the opener left`);
        }
      } else if (picks.length && picks[picks.length - 1]!.order !== 2) bad.push(`${where}: a grid opened before the last was finished`);
      picks.push({ n: i + 1, grid, seat, order, slots, line, took: holds, value: numIn(p.value, -1e5, 1e5) });
    });
    if (grids !== null && raw.picks.length !== grids * 2) bad.push(`${raw.picks.length} picks for ${grids} grids`);
  }

  const poolsRaw = isObj(raw.pools) ? raw.pools : {};
  const decksRaw = isObj(raw.decks) ? raw.decks : {};
  const pools = { A: [] as string[], B: [] as string[] };
  const decks: Partial<Record<WatchSide, WatchDeck>> = {};
  for (const s of SIDES) {
    const pr = poolsRaw[s];
    pools[s] = Array.isArray(pr) ? pr.map(cardName).filter((c): c is string => c !== null) : [];
    if (!Array.isArray(pr) || pools[s].length !== pr.length) bad.push(`pool ${s} is not a list of card names`);
    const gained = picks.filter((p) => p.seat === s).flatMap((p) => p.took);
    if (!same(sorted(gained), sorted(pools[s]))) bad.push(`pool ${s} is not the sum of its picks`);
    const d = parseDeck(decksRaw[s], s, bad);
    if (d) {
      decks[s] = d;
      const have = new Map<string, number>();
      for (const c of pools[s]) have.set(c, (have.get(c) ?? 0) + 1);
      for (const [c, name] of d.main) if (have.has(name) && have.get(name)! < c) bad.push(`deck ${s} plays ${c} ${name}, the pool has ${have.get(name)}`);
    }
  }
  if (bad.length) throw new WatchDataError(bad);
  return {
    id: id!,
    cube: { title: cleanText(cube.title, 200) ?? 'a cube', file: cleanText(cube.file, 120) ?? '' },
    seed: seed!,
    drafters: { A: drafterOf('A'), B: drafterOf('B') },
    firstSeat: firstSeat!,
    grids: grids!,
    picks,
    pools,
    decks: decks as Record<WatchSide, WatchDeck>,
    draftedMs: intIn(raw.draftedMs, 0, 1e9),
  };
}

function parsePlayer(v: unknown): WatchPlayer | null {
  if (!isObj(v)) return null;
  const player = cleanText(v.player, 40);
  if (!player) return null;
  return {
    player,
    profile: cleanText(v.profile, 40),
    policy: v.policy === 'plain' || v.policy === 'search' ? v.policy : null,
    deck: cleanText(v.deck, 80),
  };
}

function parseGame(v: unknown, i: number): WatchGame | string {
  if (!isObj(v)) return `game ${i + 1} is not an object`;
  if (v.n !== i + 1) return `game ${i + 1} is numbered ${String(v.n)}`;
  const status = v.status === 'playing' || v.status === 'done' || v.status === 'error' ? v.status : null;
  if (!status) return `game ${i + 1}'s status is not playing, done or error`;
  return {
    n: i + 1,
    status,
    winner: result(v.winner),
    reason: cleanText(v.reason, 60),
    turns: intIn(v.turns, 0, 999),
    startedMs: intIn(v.startedMs, 0, 1e10),
    endedMs: intIn(v.endedMs, 0, 1e10),
    redaction: v.redaction === 'pass' || v.redaction === 'fail' ? v.redaction : null,
    error: cleanText(v.error, 300),
  };
}

/** match.json → the view model, or a WatchDataError. */
export function parseWatchMatch(raw: unknown): WatchMatch {
  if (!isObj(raw) || raw.v !== 1 || raw.kind !== 'watch-match') throw new WatchDataError(['not a v1 watch-match']);
  const bad: string[] = [];
  const id = typeof raw.id === 'string' && /^watch-[A-Za-z0-9._-]{1,120}$/.test(raw.id) ? raw.id : null;
  if (!id) bad.push('no watch id');
  const status = WATCH_STATUSES.includes(raw.status as WatchStatus) ? (raw.status as WatchStatus) : null;
  if (!status) bad.push('an unknown status');
  const games: WatchGame[] = [];
  if (!Array.isArray(raw.games)) bad.push('no games list');
  else
    raw.games.slice(0, 9).forEach((g: unknown, i: number) => {
      const r = parseGame(g, i);
      if (typeof r === 'string') bad.push(r);
      else games.push(r);
    });
  if (games.filter((g) => g.status === 'playing').length > 1) bad.push('two games playing at once');
  // `wins` is the count of finished games (mtg-table's state machine); recount it rather than trust a stray number.
  const wins = { A: 0, B: 0, draws: 0 };
  for (const g of games) if (g.status === 'done') g.winner === 'A' ? wins.A++ : g.winner === 'B' ? wins.B++ : wins.draws++;
  if (bad.length) throw new WatchDataError(bad);
  const pl = isObj(raw.players) ? raw.players : null;
  const a = pl ? parsePlayer(pl.A) : null;
  const b = pl ? parsePlayer(pl.B) : null;
  const cube = isObj(raw.cube) ? raw.cube : {};
  return {
    id: id!,
    status: status!,
    error: cleanText(raw.error, 400),
    cubeTitle: cleanText(cube.title, 200),
    seed: intIn(raw.seed, 0, 999_999_999),
    bestOf: intIn(raw.bestOf, 1, 9),
    need: intIn(raw.need, 1, 9),
    paceMs: intIn(raw.paceMs, 0, 60_000),
    players: a && b ? { A: a, B: b } : null,
    games,
    wins,
    winner: result(raw.winner),
    current: intIn(raw.current, 1, 9),
    updatedAt: cleanText(raw.updatedAt, 40),
  };
}

export interface WatchState {
  id: string;
  running: boolean;
  match: WatchMatch | null;
  draft: WatchDraft | null;
  /** Why a draft.json that came back was refused (the replay is not shown). */
  draftProblem: string | null;
  matchProblem: string | null;
}

/** GET /watch/<id>'s answer. */
export function parseWatchState(raw: unknown): WatchState {
  if (!isObj(raw) || raw.ok !== true || typeof raw.id !== 'string') throw new WatchDataError(['not a watch answer']);
  let match: WatchMatch | null = null;
  let draft: WatchDraft | null = null;
  let draftProblem: string | null = null;
  let matchProblem: string | null = null;
  if (raw.match != null) {
    try {
      match = parseWatchMatch(raw.match);
    } catch (e) {
      matchProblem = e instanceof Error ? e.message : String(e);
    }
  }
  if (raw.draft != null) {
    try {
      draft = parseWatchDraft(raw.draft);
    } catch (e) {
      draftProblem = e instanceof Error ? e.message : String(e);
    }
  }
  return { id: cleanText(raw.id, 140) ?? '', running: raw.running === true, match, draft, draftProblem, matchProblem };
}

export interface WatchListEntry {
  id: string;
  status: WatchStatus | null;
  cubeTitle: string | null;
  seed: number | null;
  bestOf: number | null;
  wins: { A: number; B: number } | null;
  winner: WatchSide | 'draw' | null;
  players: Record<WatchSide, string> | null;
  updatedAt: string | null;
}

/** GET /watch's answer: the running id and the recent watches (bad rows dropped). */
export function parseWatchList(raw: unknown): { running: string | null; watches: WatchListEntry[] } {
  if (!isObj(raw) || raw.ok !== true) throw new WatchDataError(['not a watch list']);
  const running = typeof raw.running === 'string' && /^watch-[A-Za-z0-9._-]{1,120}$/.test(raw.running) ? raw.running : null;
  const watches: WatchListEntry[] = [];
  for (const w of Array.isArray(raw.watches) ? raw.watches.slice(0, 20) : []) {
    if (!isObj(w) || typeof w.id !== 'string' || !/^watch-[A-Za-z0-9._-]{1,120}$/.test(w.id)) continue;
    const wins = isObj(w.wins) ? { A: intIn(w.wins.A, 0, 9) ?? 0, B: intIn(w.wins.B, 0, 9) ?? 0 } : null;
    const pl = isObj(w.players) ? w.players : null;
    const pa = pl ? parsePlayer(pl.A) : null;
    const pb = pl ? parsePlayer(pl.B) : null;
    watches.push({
      id: w.id,
      status: WATCH_STATUSES.includes(w.status as WatchStatus) ? (w.status as WatchStatus) : null,
      cubeTitle: cleanText(w.cube, 200),
      seed: intIn(w.seed, 0, 999_999_999),
      bestOf: intIn(w.bestOf, 1, 9),
      wins,
      winner: result(w.winner),
      players: pa && pb ? { A: pa.player, B: pb.player } : null,
      updatedAt: cleanText(w.updatedAt, 40),
    });
  }
  return { running, watches };
}

/** The next game to follow: the one playing, else the last one that has started. */
export function gameToFollow(m: WatchMatch | null): number | null {
  if (!m || m.games.length === 0) return null;
  return (m.games.find((g) => g.status === 'playing') ?? m.games[m.games.length - 1]!).n;
}
