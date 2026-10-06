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
import { servedByEngine } from '../play/seatUrl.ts';

export const ROOM_TOKEN_HEADER = 'X-Room-Token';
export const DEFAULT_ROOM_PORT = 8644;
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
  return new RoomError(msg, r.status, code, parseRoomState(body.state));
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

export const FRIEND_KEY = 'forgecoach.friendRooms.v1';

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
