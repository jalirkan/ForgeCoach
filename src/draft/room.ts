/*
 * ForgeCoach — draft/room.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Draft with a friend: the client for mtg-table's draft room (mtg-table
 * docs/draft-room.md, decision D400). Two people grid-draft a cube from their
 * own browsers; the owner's machine holds the draft and checks every pick.
 *
 *   coach helper (8643, the owner's door)   POST /room {cubeId, cubeTitle, cards, name, firstSeat?}
 *                                            → 201 {id, seat:0, token, friendToken, roomPort, bases, cube, …}
 *                                            /health → {…, draftRoom: 1, roomPort} (no key without it)
 *   room listener (8644, a seat token on every route, header X-Room-Token)
 *     GET  /room/<id>          → the seat's state
 *     GET  /room/<id>/events   → text/event-stream: `event: state` now and after every change, `event: gone`
 *     POST /room/<id>/join     {name?} → state
 *     POST /room/<id>/pick     {line, expect: state.version} → state | 409 {code: stale|turn|waiting|done, state}
 *     POST /room/<id>/deck     {name, main, sideboard?, record?} → state | 409 {code: drafting|playing} | 400 {code: deck, problems}
 *     POST /room/<id>/record   {record} → state   (D407: this seat's consent for its next game)
 *     GET  /room/<id>/review/<matchId> → {state, report?}   (D407: this seat's own engine review)
 *     GET  /room/<id>/log/<matchId>    → this seat's own frame log of that game (the review's frames)
 *
 * Phase 3 (mtg-table D406, D407): the room runs a best of three, one engine
 * start per game. `match` is the score and what the next game is (its number,
 * and who chooses to play or draw: the previous game's loser); `games` every
 * finished game with THIS seat's consent and review. Sideboarding is a deck
 * handed in again, checked against this seat's picks. Each player opts their
 * own seat in or out of recording (the human test set and the engine's
 * review), game by game; the default is the owner's, chosen when making the
 * room. A review is built from this seat's own log and only this seat gets it.
 *
 * Phase 2 (mtg-table D404): once the draft is over each player hands the room
 * a deck — privately, checked by the room against that player's own picks
 * (basic lands free). The state then says `decks` (the other seat's by name
 * and count only), `yourDeck` (this seat's own list) and `game`: when both
 * decks are in, the room starts a game between the two seats on the owner's
 * engine (D402) and hands each seat its own seat token for that game, in its
 * own stream only (`game.token`, while `ready`). play/friendTable.ts turns it
 * into the table's seat URL.
 *
 * The join link carries the friend's token in the #fragment
 * (`#draft/friend/join?room=<id>&t=<token>`), which no server and no Referer
 * ever sees; the page keeps it in this browser's storage and drops it from the
 * address bar. A Grid draft has no hidden information: both seats see the
 * same state, the other seat's picks included. The rules are draft.ts's, held
 * to the server by src/draft/testdata/grid-golden.json, and when the draft is
 * over the server reveals the seed so `replayMatches` can re-deal and replay
 * the whole draft here.
 *
 * DOM-free: `fetch`, timers and storage are injected for tests.
 */
import type { DeckState } from './deck.ts';
import { apply, newDraft, type DraftEvent, type GridDraft } from './draft.ts';
import { pageHelperTarget, TOKEN_HEADER, type HelperTarget } from '../coachHelper.ts';
import { DEFAULT_ROOM_PORT, servedByEngine } from '../play/seatUrl.ts';
import { FRIEND_ROOMS_KEY } from '../play/friendTable.ts';
import { fetchSeatLog, fetchSeatReview, REVIEW_STATES, SeatReviewError, type RoomReview, type RoomReviewState } from '../play/friendReview.ts';

export { REVIEW_STATES, type RoomReview, type RoomReviewState };
import type { MatchDeck } from './launch.ts';

export { DEFAULT_ROOM_PORT };
export const ROOM_TOKEN_HEADER = 'X-Room-Token';
export const ROOM_ID = /^r[A-Za-z0-9_-]{8}$/;
export const ROOM_TOKEN = /^[A-Za-z0-9_-]{22,64}$/;
export const MAX_NAME = 24;

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;
const realFetch: FetchLike = (u, i) => fetch(u, i);

export interface RoomSeat {
  name: string;
  joined: boolean;
  online: boolean;
  picks: string[];
}

export interface RoomEvent {
  n: number;
  seat: 0 | 1;
  grid: number;
  line: number;
  cards: string[];
}

/** D404: one seat's deck as the other seat sees it — whether it is in, its name and main-deck count; never the list. */
export interface RoomDeckInfo {
  ready: boolean;
  name: string | null;
  cards: number | null;
}

/** D404: this seat's own deck as the room holds it. */
export interface RoomOwnDeck {
  name: string;
  main: Array<[number, string]>;
  sideboard: Array<[number, string]>;
}

/** D404: the game the room started between the two seats. */
export interface RoomGame {
  n: number;
  state: 'starting' | 'ready' | 'failed' | 'unavailable';
  error: string | null;
  matchId: string | null;
  tablePort: number | null;
  /** THIS seat's seat token for this game, only while `ready`. */
  token: string | null;
  /** D406: its number in the match (null from a room before it). */
  game: number | null;
  /** D406: how it ended; null while it is played. `winner` null: a draw. */
  result: { winner: 0 | 1 | null; reason: string | null } | null;
}

/** D406: the best of three between the two seats. */
export interface RoomMatch {
  n: number;
  bestOf: number;
  wins: [number, number];
  over: boolean;
  winner: 0 | 1 | null;
  /** The game the next pair of decks starts, and who chooses to play or draw in it (null: a coin toss). */
  next: { game: number; chooser: 0 | 1 | null; newMatch: boolean };
}


/** D406/D407: one finished game of the room; `recorded` and `review` are THIS seat's. */
export interface RoomPlayed {
  match: number;
  game: number;
  matchId: string;
  winner: 0 | 1 | null;
  reason: string | null;
  recorded: boolean;
  review: RoomReviewState;
}

export interface RoomState {
  v: 1;
  id: string;
  version: number;
  you: 0 | 1;
  format: 'grid';
  cube: { id: string; title: string; hash: string; size: number };
  grids: number;
  g: number;
  slots: Array<string | null>;
  firstLine: number | null;
  firstSeat: 0 | 1;
  toAct: 0 | 1 | null;
  done: boolean;
  seats: [RoomSeat, RoomSeat];
  log: RoomEvent[];
  createdAt: string;
  expiresAt: string;
  seed: number | null;
  /** D404 (absent from a room server before it): both seats' decks, the other's by name and count only. */
  decks?: [RoomDeckInfo, RoomDeckInfo];
  /** D404: this seat's own deck, or null before it is handed in. */
  yourDeck?: RoomOwnDeck | null;
  /** D404: the game between the two seats, or null. */
  game?: RoomGame | null;
  /** D406: the match (null before its first game); absent from a room server before D406. */
  match?: RoomMatch | null;
  /** D406/D407: every finished game. */
  games?: RoomPlayed[];
  /** D407: this seat's consent for its next game, and the room's default. */
  record?: { you: boolean; default: boolean };
}



export interface RoomBases {
  local: string;
  lan: string[];
  public: string | null;
}

export interface CreatedRoom {
  id: string;
  seat: 0;
  token: string;
  friendToken: string;
  roomPort: number;
  bases: RoomBases;
  cube: { id: string; title: string; hash: string; size: number };
  grids: number;
  expiresAt: string;
}

// ---------------------------------------------------------------------------
// Reading what the server sends (untrusted: checked field by field)

const isStr = (x: unknown): x is string => typeof x === 'string';
const isInt = (x: unknown): x is number => Number.isInteger(x);
const isSeat = (x: unknown): x is 0 | 1 => x === 0 || x === 1;
const strs = (x: unknown, max = 4000): x is string[] => Array.isArray(x) && x.length <= max && x.every(isStr);

/** A room state from the server, or null when it is not one. */
export function parseRoomState(x: unknown): RoomState | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  if (o.v !== 1 || o.format !== 'grid' || !isStr(o.id) || !ROOM_ID.test(o.id) || !isInt(o.version) || !isSeat(o.you)) return null;
  const c = o.cube as Record<string, unknown> | undefined;
  if (!c || !isStr(c.id) || !isStr(c.title) || !isStr(c.hash) || !isInt(c.size)) return null;
  if (!isInt(o.grids) || !isInt(o.g) || o.g < 0 || o.g > o.grids) return null;
  if (!Array.isArray(o.slots) || o.slots.length !== 9 || !o.slots.every((s) => s === null || isStr(s))) return null;
  if (!(o.firstLine === null || (isInt(o.firstLine) && o.firstLine >= 0 && o.firstLine <= 5))) return null;
  if (!isSeat(o.firstSeat) || !(o.toAct === null || isSeat(o.toAct)) || typeof o.done !== 'boolean') return null;
  if (!Array.isArray(o.seats) || o.seats.length !== 2) return null;
  for (const s of o.seats as unknown[]) {
    const q = s as Record<string, unknown> | null;
    if (!q || !isStr(q.name) || typeof q.joined !== 'boolean' || typeof q.online !== 'boolean' || !strs(q.picks)) return null;
  }
  if (!Array.isArray(o.log)) return null;
  for (const e of o.log as unknown[]) {
    const q = e as Record<string, unknown> | null;
    if (!q || !isInt(q.n) || !isSeat(q.seat) || !isInt(q.grid) || !isInt(q.line) || q.line < 0 || q.line > 5 || !strs(q.cards, 3)) return null;
  }
  if (!isStr(o.createdAt) || !isStr(o.expiresAt) || !(o.seed === null || isInt(o.seed))) return null;
  // D404's keys: absent from an older room server; wrong is wrong.
  if (o.decks !== undefined) {
    if (!Array.isArray(o.decks) || o.decks.length !== 2) return null;
    for (const d of o.decks as unknown[]) {
      const q = d as Record<string, unknown> | null;
      if (!q || typeof q.ready !== 'boolean' || !(q.name === null || isStr(q.name)) || !(q.cards === null || isInt(q.cards))) return null;
    }
  }
  if (o.yourDeck !== undefined && o.yourDeck !== null) {
    const y = o.yourDeck as Record<string, unknown>;
    const rows = (r: unknown) => Array.isArray(r) && r.length <= 400 && r.every((e) => Array.isArray(e) && e.length === 2 && isInt(e[0]) && isStr(e[1]));
    if (typeof y !== 'object' || !isStr(y.name) || !rows(y.main) || !rows(y.sideboard)) return null;
  }
  if (o.game !== undefined && o.game !== null) {
    const g = o.game as Record<string, unknown>;
    if (typeof g !== 'object' || !isInt(g.n) || !['starting', 'ready', 'failed', 'unavailable'].includes(g.state as string)) return null;
    if (!(g.error === null || g.error === undefined || isStr(g.error)) || !(g.matchId === null || g.matchId === undefined || isStr(g.matchId))) return null;
    if (!(g.tablePort === null || g.tablePort === undefined || (isInt(g.tablePort) && g.tablePort > 0 && g.tablePort < 65536))) return null;
    if (!(g.token === null || g.token === undefined || (isStr(g.token) && ROOM_TOKEN.test(g.token)))) return null;
    // D406: its number in the match and its result.
    if (!(g.game === null || g.game === undefined || (isInt(g.game) && g.game >= 1 && g.game <= 9))) return null;
    let result: RoomGame['result'] = null;
    if (g.result !== null && g.result !== undefined) {
      const r = g.result as Record<string, unknown>;
      if (typeof r !== 'object' || !(r.winner === null || isSeat(r.winner)) || !(r.reason === null || r.reason === undefined || isStr(r.reason))) return null;
      result = { winner: r.winner as 0 | 1 | null, reason: isStr(r.reason) ? r.reason.slice(0, 40) : null };
    }
    o.game = { n: g.n, state: g.state, error: g.error ?? null, matchId: g.matchId ?? null, tablePort: g.tablePort ?? null, token: g.token ?? null, game: g.game ?? null, result };
  }
  // D406 / D407's keys: absent from an older room server; wrong is wrong.
  if (o.match !== undefined && o.match !== null) {
    const m = o.match as Record<string, unknown>;
    const nx = m.next as Record<string, unknown> | undefined;
    const wins = m.wins as unknown[];
    if (typeof m !== 'object' || !isInt(m.n) || !isInt(m.bestOf) || !Array.isArray(wins) || wins.length !== 2 || !wins.every((w) => isInt(w) && w >= 0 && w <= 5)) return null;
    if (typeof m.over !== 'boolean' || !(m.winner === null || isSeat(m.winner))) return null;
    if (!nx || typeof nx !== 'object' || !isInt(nx.game) || !(nx.chooser === null || isSeat(nx.chooser)) || typeof nx.newMatch !== 'boolean') return null;
  }
  if (o.games !== undefined) {
    if (!Array.isArray(o.games) || o.games.length > 50) return null;
    for (const e of o.games as unknown[]) {
      const q = e as Record<string, unknown> | null;
      if (!q || !isInt(q.match) || !isInt(q.game) || !isStr(q.matchId) || !/^m[0-9]{13}$/.test(q.matchId) || !(q.winner === null || isSeat(q.winner))) return null;
      if (!(q.reason === null || isStr(q.reason)) || typeof q.recorded !== 'boolean' || !REVIEW_STATES.includes(q.review as RoomReviewState)) return null;
    }
  }
  if (o.record !== undefined) {
    const r = o.record as Record<string, unknown> | null;
    if (!r || typeof r.you !== 'boolean' || typeof r.default !== 'boolean') return null;
  }
  return x as RoomState;
}

/** The POST /room answer, or null. */
export function parseCreated(x: unknown): CreatedRoom | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  const b = o.bases as Record<string, unknown> | undefined;
  if (o.ok !== true || !isStr(o.id) || !ROOM_ID.test(o.id) || !isStr(o.token) || !ROOM_TOKEN.test(o.token) || !isStr(o.friendToken) || !ROOM_TOKEN.test(o.friendToken)) return null;
  if (!isInt(o.roomPort) || !b || !isStr(b.local) || !strs(b.lan, 32) || !(b.public === null || isStr(b.public))) return null;
  return x as CreatedRoom;
}

// ---------------------------------------------------------------------------
// Links and addresses

/** The friend's join link: the room listener's own page, the seat token in the fragment. */
export function joinLink(base: string, id: string, token: string): string {
  return `${base.replace(/\/+$/, '')}/#draft/friend/join?room=${encodeURIComponent(id)}&t=${encodeURIComponent(token)}`;
}

/** A join link's room and token (and, optionally, `s`: a room server other than the page's own). */
export function parseJoinHash(hash: string): { room: string; token: string; server: string | null } | null {
  const m = /^#draft\/friend\/join\?(.*)$/.exec(hash);
  if (!m) return null;
  const q = new URLSearchParams(m[1]);
  const room = q.get('room') ?? '';
  const token = q.get('t') ?? '';
  const s = q.get('s')?.replace(/\/+$/, '') ?? null;
  if (!ROOM_ID.test(room) || !ROOM_TOKEN.test(token)) return null;
  const server = s && /^https?:\/\/[A-Za-z0-9.[\]:-]+$/.test(s) ? s : null;
  return { room, token, server };
}

export interface PageLoc {
  protocol: string;
  hostname: string;
  host: string;
  port: string;
  origin: string;
  search: string;
}

/**
 * Where the room listener is for the person who made the room: the page's own
 * origin when the room listener served it; the page's host on the room port
 * when the bridge served it (a phone on the LAN); else this machine.
 */
export function ownerRoomBase(loc: PageLoc, roomPort: number): string {
  if (loc.port === String(roomPort)) return loc.origin;
  if (servedByEngine(loc)) {
    const name = loc.hostname.includes(':') && !loc.hostname.startsWith('[') ? `[${loc.hostname}]` : loc.hostname;
    return `${loc.protocol === 'https:' ? 'https:' : 'http:'}//${name}:${roomPort}`;
  }
  return `http://127.0.0.1:${roomPort}`;
}

/** The friend's links, best first: the LAN addresses, a public URL, then this machine. */
export function friendLinks(c: Pick<CreatedRoom, 'bases' | 'id' | 'friendToken'>): Array<{ label: string; url: string }> {
  const out: Array<{ label: string; url: string }> = [];
  for (const b of c.bases.lan) out.push({ label: 'On your Wi-Fi', url: joinLink(b, c.id, c.friendToken) });
  if (c.bases.public) out.push({ label: 'Over the internet', url: joinLink(c.bases.public, c.id, c.friendToken) });
  out.push({ label: 'On this computer (another browser)', url: joinLink(c.bases.local, c.id, c.friendToken) });
  return out;
}

/** A name a seat may carry (the server's rule): trimmed, 1-24 characters. */
export function cleanName(s: string): string | null {
  const t = s.trim().replace(/\s+/g, ' ');
  // eslint-disable-next-line no-control-regex
  return t.length >= 1 && [...t].length <= MAX_NAME && !/[\u0000-\u001f\u007f]/.test(t) ? t : null;
}

// ---------------------------------------------------------------------------
// The calls

export class RoomError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly state: RoomState | null = null,
    /** D404: every problem with a refused deck. */
    readonly problems: string[] = [],
  ) {
    super(message);
  }
}

async function errorOf(r: Response, what: string): Promise<RoomError> {
  let body: Record<string, unknown> = {};
  try {
    body = (await r.json()) as Record<string, unknown>;
  } catch {
    /* not JSON */
  }
  const code = isStr(body.code) ? body.code : String(r.status);
  const msg = isStr(body.message) ? body.message : `${what} failed (HTTP ${r.status})`;
  const problems = strs(body.problems, 50) ? body.problems.map((p) => p.slice(0, 300)) : [];
  return new RoomError(msg, r.status, code, parseRoomState(body.state), problems);
}

/** The draft room on the coach helper: on (with its port) or not. */
export async function roomSupport(opts: { fetch?: FetchLike; target?: HelperTarget } = {}): Promise<{ on: boolean; roomPort: number | null; reason?: string }> {
  const f = opts.fetch ?? realFetch;
  const t = opts.target ?? pageHelperTarget();
  try {
    const r = await f(`${t.baseUrl}/health`, { headers: t.token ? { [TOKEN_HEADER]: t.token } : {} });
    if (!r.ok) return { on: false, roomPort: null, reason: `the coach helper answered HTTP ${r.status}` };
    const j = (await r.json()) as Record<string, unknown>;
    if (j.draftRoom === 1 && isInt(j.roomPort)) return { on: true, roomPort: j.roomPort };
    return { on: false, roomPort: null, reason: 'the coach helper runs without the draft room' };
  } catch {
    return { on: false, roomPort: null, reason: 'no coach helper on this machine' };
  }
}

export interface CreateRequest {
  cubeId: string;
  cubeTitle: string;
  cards: string[];
  name: string;
  firstSeat?: 0 | 1;
  /** D407: the room's default for recording each seat's games (each player can still opt out). */
  record?: boolean;
}

/** POST /room through the coach helper (the owner's door). */
export async function createRoom(req: CreateRequest, opts: { fetch?: FetchLike; target?: HelperTarget } = {}): Promise<CreatedRoom> {
  const f = opts.fetch ?? realFetch;
  const t = opts.target ?? pageHelperTarget();
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (t.token) h[TOKEN_HEADER] = t.token;
  let r: Response;
  try {
    r = await f(`${t.baseUrl}/room`, { method: 'POST', headers: h, body: JSON.stringify(req) });
  } catch {
    throw new RoomError('Could not reach the coach helper on this machine. Start the engine with ./scripts/play.sh --engine-only --lan --draft-room.', 0, 'offline');
  }
  if (r.status === 404) throw new RoomError('The coach helper runs without the draft room. Start it with ./scripts/play.sh --engine-only --lan --draft-room.', 404, 'off');
  if (!r.ok) throw await errorOf(r, 'Making the room');
  const c = parseCreated(await r.json());
  if (!c) throw new RoomError('The coach helper answered something that is not a room.', r.status, 'bad');
  return c;
}

/** One seat's handle on a room: read, join, pick, and the live stream. */
export class RoomClient {
  private readonly f: FetchLike;
  constructor(
    readonly base: string,
    readonly id: string,
    private readonly token: string,
    fetchImpl?: FetchLike,
  ) {
    this.f = fetchImpl ?? realFetch;
  }

  private url(p = ''): string {
    return `${this.base.replace(/\/+$/, '')}/room/${encodeURIComponent(this.id)}${p}`;
  }

  private headers(json: boolean): Record<string, string> {
    return json ? { [ROOM_TOKEN_HEADER]: this.token, 'Content-Type': 'application/json' } : { [ROOM_TOKEN_HEADER]: this.token };
  }

  private async call(p: string, init: RequestInit, what: string): Promise<RoomState> {
    let r: Response;
    try {
      r = await this.f(this.url(p), init);
    } catch {
      throw new RoomError('The room’s computer cannot be reached.', 0, 'offline');
    }
    if (!r.ok) throw await errorOf(r, what);
    const s = parseRoomState(await r.json());
    if (!s) throw new RoomError('The room answered something that is not a room.', r.status, 'bad');
    return s;
  }

  get(): Promise<RoomState> {
    return this.call('', { headers: this.headers(false) }, 'Reading the room');
  }

  join(name?: string): Promise<RoomState> {
    return this.call('/join', { method: 'POST', headers: this.headers(true), body: JSON.stringify(name ? { name } : {}) }, 'Joining');
  }

  /** Take a line. `expect` is the version the player saw; a stale view comes back as RoomError code "stale" with the current state. */
  pick(line: number, expect: number): Promise<RoomState> {
    return this.call('/pick', { method: 'POST', headers: this.headers(true), body: JSON.stringify({ line, expect }) }, 'The pick');
  }

  /**
   * D404: hand the room this seat's deck for the next game. The room checks it
   * against this seat's own picks; a wrong one comes back as RoomError code
   * "deck" (its first problem as the message, all of them in `problems`).
   */
  async submitDeck(deck: MatchDeck, record?: boolean): Promise<RoomState> {
    let r: Response;
    const body = JSON.stringify({ name: deck.name, main: deck.main, ...(deck.sideboard?.length ? { sideboard: deck.sideboard } : {}), ...(record === undefined ? {} : { record }) });
    try {
      r = await this.f(this.url('/deck'), { method: 'POST', headers: this.headers(true), body });
    } catch {
      throw new RoomError('The room’s computer cannot be reached.', 0, 'offline');
    }
    if (!r.ok) throw await errorOf(r, 'Handing in the deck');
    const s = parseRoomState(await r.json());
    if (!s) throw new RoomError('The room answered something that is not a room.', r.status, 'bad');
    return s;
  }

  /** D407: this seat's consent to recording its next game (the human test set and its own engine review). */
  setRecord(record: boolean): Promise<RoomState> {
    return this.call('/record', { method: 'POST', headers: this.headers(true), body: JSON.stringify({ record }) }, 'Saving your choice');
  }

  /** D407: this seat's own engine review of one finished game of the room (play/friendReview.ts). */
  async review(matchId: string): Promise<RoomReview> {
    try {
      return await fetchSeatReview({ base: this.base, id: this.id, token: this.token }, matchId, this.f);
    } catch (e) {
      throw e instanceof SeatReviewError ? new RoomError(e.message, e.status, e.code) : e;
    }
  }

  /** D407: this seat's own frame log of a recorded game (the frames its review numbers), as text. */
  async seatLog(matchId: string): Promise<string> {
    try {
      return await fetchSeatLog({ base: this.base, id: this.id, token: this.token }, matchId, this.f);
    } catch (e) {
      throw e instanceof SeatReviewError ? new RoomError(e.message, e.status, e.code) : e;
    }
  }

  /**
   * The live stream, reconnecting by itself (1 s, 2 s, 4 s … 15 s). `onState`
   * gets every state; `onStatus` says live / reconnecting / gone (the room
   * expired, or the link is wrong). Returns stop().
   */
  stream(
    onState: (s: RoomState) => void,
    onStatus: (st: 'live' | 'reconnecting' | 'gone', why?: string) => void,
    timers: { setTimeout: (f: () => void, ms: number) => unknown; clearTimeout: (h: unknown) => void } = { setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: (h) => clearTimeout(h as number) },
  ): () => void {
    let stopped = false;
    let ac: AbortController | null = null;
    let retry: unknown = null;
    let attempt = 0;
    const again = (why: string) => {
      if (stopped) return;
      onStatus('reconnecting', why);
      const ms = Math.min(15_000, 1000 * 2 ** Math.min(attempt, 4));
      attempt++;
      retry = timers.setTimeout(open, ms);
    };
    const open = async () => {
      if (stopped) return;
      ac = new AbortController();
      let r: Response;
      try {
        r = await this.f(this.url('/events'), { headers: this.headers(false), signal: ac.signal });
      } catch {
        again('offline');
        return;
      }
      if (r.status === 404 || r.status === 403) {
        const e = await errorOf(r, 'The room');
        onStatus('gone', e.message);
        return;
      }
      if (!r.ok || !r.body) {
        again(`HTTP ${r.status}`);
        return;
      }
      const reader = r.body.getReader();
      const parser = sseParser((ev, data) => {
        if (ev === 'gone') {
          stopped = true;
          onStatus('gone', 'The room has expired.');
          return;
        }
        if (ev !== 'state') return;
        let s: RoomState | null = null;
        try {
          s = parseRoomState(JSON.parse(data));
        } catch {
          /* torn */
        }
        if (s) {
          attempt = 0;
          onStatus('live');
          onState(s);
        }
      });
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          parser.push(value);
          if (stopped) break;
        }
      } catch {
        /* dropped */
      }
      if (!stopped) again('the connection dropped');
    };
    void open();
    return () => {
      stopped = true;
      ac?.abort();
      if (retry !== null) timers.clearTimeout(retry);
    };
  }
}

/** A server-sent events parser over bytes: `cb(event, data)` per complete event. */
export function sseParser(cb: (event: string, data: string) => void): { push: (chunk: Uint8Array | string) => void } {
  const dec = new TextDecoder();
  let buf = '';
  return {
    push(chunk) {
      buf += typeof chunk === 'string' ? chunk : dec.decode(chunk, { stream: true });
      buf = buf.replace(/\r\n/g, '\n');
      let i: number;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, i);
        buf = buf.slice(i + 2);
        let event = 'message';
        const data: string[] = [];
        for (const line of block.split('\n')) {
          if (line.startsWith(':')) continue;
          if (line.startsWith('event:')) event = line.slice(6).trim();
          else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
        }
        if (data.length) cb(event, data.join('\n'));
      }
    },
  };
}

// ---------------------------------------------------------------------------
// The room as the pick screen's GridDraft (you = this seat, ai = the other)

export function toGridDraft(s: RoomState): GridDraft {
  const me = s.you;
  const them = (1 - me) as 0 | 1;
  const who = (seat: 0 | 1) => (seat === me ? 'you' : 'ai') as 'you' | 'ai';
  const log: DraftEvent[] = s.log.map((e) => ({ n: e.n, who: who(e.seat), kind: 'line', at: e.grid, line: e.line, cards: [...e.cards] }));
  const now = Date.parse(s.createdAt) || 0;
  return {
    v: 1,
    id: `room-${s.id}`,
    cubeId: s.cube.id,
    seed: s.seed ?? 0,
    youFirst: s.firstSeat === me,
    dealt: [],
    picks: { you: [...s.seats[me].picks], ai: [...s.seats[them].picks] },
    seen: { you: [], ai: [] },
    log,
    done: s.done,
    startedAt: now,
    updatedAt: now,
    format: 'grid',
    grids: s.grids,
    g: s.g,
    slots: [...s.slots],
    firstLine: s.firstLine,
  };
}

/**
 * Once the draft is over: re-deal the cube from the revealed seed with this
 * page's own draft.ts and replay every pick. True when the server's draft is
 * exactly what draft.ts makes; null while the seed is not out yet.
 */
export function replayMatches(s: RoomState, cubeNames: string[]): boolean | null {
  if (!s.done || s.seed === null) return null;
  try {
    let d = newDraft({ cubeId: s.cube.id, format: 'grid', cube: cubeNames, seed: s.seed, youFirst: s.firstSeat === 0, now: 0 }) as GridDraft;
    for (const e of s.log) {
      const turn = (d.g % 2 === 0) === d.youFirst ? (d.firstLine === null ? 0 : 1) : d.firstLine === null ? 1 : 0;
      if (turn !== e.seat) return false;
      const before = d.log.length;
      d = apply(d, { kind: 'line', line: e.line }, 0) as GridDraft;
      const got = d.log[before];
      if (!got || JSON.stringify(got.cards) !== JSON.stringify(e.cards)) return false;
    }
    return d.done && d.grids === s.grids;
  } catch {
    return false;
  }
}

/** SHA-256 of the cube as the room deals from it (de-duplicated, '\n'-joined), hex; the server's `cube.hash`. */
export async function cubeHash(names: string[], subtle: SubtleCrypto = globalThis.crypto.subtle): Promise<string> {
  const bytes = new TextEncoder().encode([...new Set(names)].join('\n'));
  const d = new Uint8Array(await subtle.digest('SHA-256', bytes));
  return [...d].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** The other seat's last line, for the banner: "Sam took the top row (3 cards)". */
export function lastOpponentEvent(s: RoomState): RoomEvent | null {
  const e = s.log[s.log.length - 1];
  return e && e.seat !== s.you ? e : null;
}

// ---------------------------------------------------------------------------
// The rooms this browser holds a seat in

export const FRIEND_KEY = FRIEND_ROOMS_KEY;

export interface SavedRoom {
  id: string;
  /** The room listener's address, as this browser reaches it. */
  base: string;
  token: string;
  seat: 0 | 1;
  cubeId: string;
  cubeTitle: string;
  /** The owner's copy of the friend's links (until the friend has joined). */
  friendLinks?: Array<{ label: string; url: string }>;
  hints: boolean;
  side: string[];
  deck?: DeckState;
  poolId?: string;
  savedAt: number;
}

type KV = Pick<Storage, 'getItem' | 'setItem'>;

function kv(s?: KV | null): KV | null {
  if (s) return s;
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function loadRooms(s?: KV | null): SavedRoom[] {
  const st = kv(s);
  if (!st) return [];
  try {
    const raw = JSON.parse(st.getItem(FRIEND_KEY) ?? '[]') as unknown;
    if (!Array.isArray(raw)) return [];
    return raw.filter((r): r is SavedRoom => !!r && typeof r === 'object' && ROOM_ID.test((r as SavedRoom).id) && ROOM_TOKEN.test((r as SavedRoom).token) && isStr((r as SavedRoom).base) && isSeat((r as SavedRoom).seat));
  } catch {
    return [];
  }
}

export function saveRoom(r: SavedRoom, s?: KV | null): void {
  const st = kv(s);
  if (!st) return;
  const all = loadRooms(st).filter((x) => x.id !== r.id || x.seat !== r.seat);
  all.unshift(r);
  try {
    st.setItem(FRIEND_KEY, JSON.stringify(all.slice(0, 12)));
  } catch {
    /* quota or private mode */
  }
}

export function forgetRoom(id: string, s?: KV | null): void {
  const st = kv(s);
  if (!st) return;
  try {
    st.setItem(FRIEND_KEY, JSON.stringify(loadRooms(st).filter((x) => x.id !== id)));
  } catch {
    /* ignore */
  }
}
