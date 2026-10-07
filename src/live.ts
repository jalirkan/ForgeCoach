/*
 * ForgeCoach — live.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Read-only follow of a game that is being played right now. Two sources:
 *
 *   ws://127.0.0.1:8642/observe   the DEFAULT. mtg-table's read-only observer
 *                              socket (protocol amendment M50): any number of
 *                              observers, receive-only. On connect it sends the
 *                              seat's cached hello_ok, the latest state, the
 *                              over-or-latest input, then any open ask (same
 *                              bytes and seq as the seat), then every later s2c
 *                              frame. Anything we send is ignored (we send
 *                              nothing). A slow observer is dropped (close 1006)
 *                              and we reconnect with backoff for a fresh
 *                              catch-up; a new game's hello_ok mid-connection
 *                              starts a new log. The upgrade carries our Origin,
 *                              which must be on mtg-table's wsAllowedOrigins
 *                              (https://jalirkan.github.io and localhost are);
 *                              otherwise the handshake is a 403 and the browser
 *                              just sees a failed connection.
 *
 *   http(s)://…/frames.jsonl   FALLBACK: POLL the frame log the bridge is writing
 *                              (mtg-table docs/protocol.md §8: flushed per line).
 *                              Needs a static file server with CORS in front of
 *                              `var/games/<gameId>/`.
 *
 * What this module refuses to do, on purpose: connect to the bridge's SEAT
 * socket (`ws://127.0.0.1:8642/ws`). That socket admits exactly one client
 * (protocol amendment M13). If the mtg-table board holds it we would just be
 * refused (close 4001) — harmless. But if we got in first, or during a board
 * reload, we would OWN THE PLAYER'S SEAT: the board is refused and stops
 * retrying, every `ask` is delivered to us and never answered, and when we
 * disconnect the bridge cancels the parked asks, which spends the player's
 * decisions on Forge's §5.4 defaults (amendment M19). The connect itself is
 * also written into the player's frame log as a `resync` (M16). So a URL whose
 * path is `/ws` is rejected before any socket is opened.
 *
 * Nothing is ever sent on an observer socket — not an act, not an answer, not a
 * resync, not even a pong.
 */
import type { GameStateBody, HelloOkBody, OverBody, SessionHeader } from './protocol.ts';
import type { GameLog, LoggedFrame } from './log.ts';
import { guardFrame } from './faceDown.ts';

/** mtg-table's read-only observer socket (needs the "read-only /observe" bridge update). */
export const DEFAULT_LIVE_URL = 'ws://127.0.0.1:8642/observe';
/** The HTTP fallback: `npx http-server <dir> -p 8650 --cors -c-1` (README § Live mode). */
export const FALLBACK_LIVE_URL = 'http://127.0.0.1:8650/frames.jsonl';
/** The bridge's single-seat socket path. Never connected to. */
export const SEAT_PATH = '/ws';
/** mtg-table's read-only observer path (protocol amendment M50). */
export const OBSERVER_PATH = '/observe';
/** mtg-table's "one client at a time" refusal (protocol amendment M13). */
export const REFUSED_CLOSE_CODE = 4001;

export type LiveStatus = 'connecting' | 'open' | 'closed' | 'error';
export interface LiveHandle {
  close(): void;
}
export interface LiveHandlers {
  onLog(log: GameLog): void;
  onStatus(s: LiveStatus, detail?: string): void;
}

/** The slice of `WebSocket` used here; injectable for tests. */
export interface SocketLike {
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: { code?: number; reason?: string }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  close(code?: number, reason?: string): void;
}
/** The slice of `Response` used here; injectable for tests. */
export interface FetchResponseLike {
  readonly status: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}
export interface LiveOptions {
  socketFactory?: (url: string) => SocketLike;
  fetchImpl?: (url: string, init: { headers: Record<string, string>; cache: 'no-store' }) => Promise<FetchResponseLike>;
  /** Minimum gap between onLog calls (default 250 ms, ~4/s). */
  throttleMs?: number;
  /** HTTP poll interval while healthy (default 1000 ms). */
  pollMs?: number;
  /** Reconnect / retry backoff: base and ceiling (defaults 500 ms, 10 s). */
  backoffMs?: number;
  maxBackoffMs?: number;
}

type Kind = 'http' | 'ws';

/** Classify a URL, or explain why it is not followed. */
export function classifyLiveUrl(url: string): { kind: Kind } | { error: string } {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return { error: `Not a URL: ${url}` };
  }
  if (u.protocol === 'http:' || u.protocol === 'https:') return { kind: 'http' };
  if (u.protocol === 'ws:' || u.protocol === 'wss:') {
    const path = u.pathname.replace(/\/+$/, '') || '/';
    if (path === SEAT_PATH || path === '/') {
      return {
        error:
          `${url} is the bridge's player-seat socket (or its root). ForgeCoach never connects there: the bridge ` +
          `admits one client, so connecting could take the seat from your board and spend your pending ` +
          `decisions. Follow the frames.jsonl file over HTTP instead, or the observer endpoint (${OBSERVER_PATH}).`,
      };
    }
    return { kind: 'ws' };
  }
  return { error: `Unsupported scheme ${u.protocol} — use http(s):// for a frames.jsonl or ws(s):// for an observer.` };
}

// ---------------------------------------------------------------------------
// Accumulator: frames in, GameLog out.

/** Builds a GameLog incrementally; shapes match what `parseLog` returns. */
export class LiveLogBuilder {
  header: SessionHeader | null = null;
  frames: LoggedFrame[] = [];
  hello: HelloOkBody | null = null;
  over: OverBody | null = null;
  #seen = new Set<string>();
  #early: LoggedFrame[] = [];
  /** The seq and t of the hello_ok `hello` came in (a reconnect re-delivers that very frame, M10). */
  #helloStamp: { seq: number; t: number } | null = null;

  reset(): void {
    this.header = null;
    this.frames = [];
    this.hello = null;
    this.over = null;
    this.#seen.clear();
    this.#early = [];
    this.#helloStamp = null;
  }

  setHeader(h: SessionHeader): void {
    this.header = h;
  }

  /**
   * Synthesizes the session header a socket never carries (§8.1) from `hello_ok`.
   * `startedAt` is the hello_ok frame's own time when it has one: a reconnect or a
   * reload gets that very frame again (M10), so the game keeps one key — the
   * feedback and history keys, and the live coach's kept advice (adviceStore.ts).
   */
  static headerFromHello(hello: HelloOkBody, v: number, t?: number): SessionHeader {
    return {
      v,
      kind: 'session',
      gameId: hello.gameId,
      startedAt: (typeof t === 'number' && Number.isFinite(t) && t > 0 ? new Date(t) : new Date()).toISOString(),
      seed: hello.seed,
      forgeVersion: hello.forgeVersion,
      forgeJarSha256: hello.forgeJarSha256,
      seat: hello.you,
      recordedBy: 'client',
      decks: [],
    };
  }

  /**
   * Adds one frame. Returns whether the log changed. Frames with `seq: 0`
   * (pong, refusal and dropped-frame notices — no session stream, M10/M18) and
   * keepalives are skipped; a frame re-delivered verbatim on reconnect (same
   * type and seq, M10) is skipped too.
   */
  add(f: LoggedFrame, synthesizeHeader: boolean): boolean {
    if (f.type === 'ping' || f.type === 'pong') return false;
    if (synthesizeHeader && f.seq === 0) return false;
    if (f.type === 'hello_ok') {
      const hello = f.body as HelloOkBody;
      // A new game in the match (M38): new ids, new seq series, a new log. Or the same
      // id from an engine that started over (a bare play.sh restarted keeps its default
      // id): a hello_ok other than the one we have, since a reconnect re-sends that one
      // byte for byte (M10) -- its seq series is new, and the old seen-keys would drop it.
      const stamp = this.#helloStamp;
      const restarted = stamp !== null && (stamp.seq !== f.seq || stamp.t !== f.t);
      if (synthesizeHeader && this.hello && (this.hello.gameId !== hello.gameId || restarted)) {
        this.reset();
      }
      if (synthesizeHeader) this.#helloStamp ??= { seq: f.seq, t: f.t };
      if (!this.header && synthesizeHeader) this.header = LiveLogBuilder.headerFromHello(hello, f.v, f.t);
    }
    // A catch-up between a new game's hello_ok and its first state can carry
    // the previous game's last state (M50); it belongs to no log we keep.
    if (synthesizeHeader && f.type === 'state' && this.hello && (f.body as GameStateBody).gameId !== this.hello.gameId) {
      return false;
    }
    const key = `${f.dir ?? 's2c'}:${f.type}:${f.seq}`;
    if (synthesizeHeader && this.#seen.has(key)) return false;
    this.#seen.add(key);
    const frame: LoggedFrame = f.dir ? f : { ...f, dir: 's2c' };
    if (!this.header) {
      if (this.#early.length < 1000) this.#early.push(frame);
      return false;
    }
    // Defence in depth (faceDown.ts, mtg-table D371): a face-down permanent's
    // face only for its controller.
    const seat = this.header.seat;
    if (this.#early.length) {
      this.frames.push(...this.#early.map((e) => guardFrame(e, seat)));
      this.#early = [];
    }
    this.frames.push(guardFrame(frame, seat));
    if (frame.type === 'hello_ok' && !this.hello) this.hello = frame.body as HelloOkBody;
    if (frame.type === 'over') this.over = frame.body as OverBody;
    return true;
  }

  /** A fresh snapshot object (new arrays, so React sees a change). */
  snapshot(): GameLog | null {
    if (!this.header) return null;
    return {
      header: this.header,
      frames: this.frames.slice(),
      hello: this.hello,
      over: this.over,
      seat: this.header.seat,
    };
  }
}

// ---------------------------------------------------------------------------

/** Connects; calls onLog with a growing GameLog (throttled) as frames arrive. Never sends anything. */
export function connectLive(url: string, h: LiveHandlers, opts: LiveOptions = {}): LiveHandle {
  const throttleMs = opts.throttleMs ?? 250;
  const pollMs = opts.pollMs ?? 1000;
  const backoffBase = opts.backoffMs ?? 500;
  const backoffMax = opts.maxBackoffMs ?? 10_000;
  const builder = new LiveLogBuilder();
  let stopped = false;
  let failures = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastEmit = -Infinity;
  let emitTimer: ReturnType<typeof setTimeout> | null = null;
  let lastStatus: string | null = null;

  const status = (s: LiveStatus, detail?: string) => {
    const key = `${s}|${detail ?? ''}`;
    if (key === lastStatus || (s === 'closed' && lastStatus?.startsWith('closed|'))) return;
    lastStatus = key;
    h.onStatus(s, detail);
  };
  const emitNow = () => {
    if (emitTimer !== null) {
      clearTimeout(emitTimer);
      emitTimer = null;
    }
    lastEmit = Date.now();
    const log = builder.snapshot();
    if (log) h.onLog(log);
  };
  const changed = () => {
    if (stopped || emitTimer !== null) return;
    const wait = lastEmit + throttleMs - Date.now();
    if (wait <= 0) emitNow();
    else emitTimer = setTimeout(emitNow, wait);
  };
  const backoff = () => Math.min(backoffMax, backoffBase * 2 ** Math.max(0, failures - 1));
  const later = (fn: () => void, ms: number) => {
    if (stopped) return;
    timer = setTimeout(() => {
      timer = null;
      if (!stopped) fn();
    }, ms);
  };

  const cls = classifyLiveUrl(url);
  if ('error' in cls) {
    // Reported asynchronously so a caller's setState-in-render never sees it.
    queueMicrotask(() => {
      if (!stopped) status('error', cls.error);
    });
    return { close: () => void (stopped = true) };
  }

  // -- ws(s): an observer socket -----------------------------------------------
  let socket: SocketLike | null = null;
  const factory = opts.socketFactory ?? ((u: string) => new WebSocket(u) as unknown as SocketLike);
  const openSocket = () => {
    status('connecting', failures ? `retry ${failures}` : undefined);
    let s: SocketLike;
    try {
      s = factory(url);
    } catch (e) {
      failures++;
      status('error', `could not open ${url}: ${(e as Error).message}`);
      later(openSocket, backoff());
      return;
    }
    socket = s;
    let opened = false;
    s.onopen = () => {
      opened = true;
      failures = 0;
      status('open');
    };
    s.onmessage = (ev) => {
      if (typeof ev.data !== 'string') return;
      let f: LoggedFrame;
      try {
        f = JSON.parse(ev.data) as LoggedFrame;
      } catch {
        return;
      }
      if (!f || typeof f !== 'object' || typeof f.type !== 'string') return;
      if (builder.add(f, true)) changed();
    };
    s.onerror = () => {
      /* onclose follows and carries the code */
    };
    s.onclose = (ev) => {
      if (socket !== s) return;
      socket = null;
      if (stopped) return;
      if (builder.frames.length) emitNow();
      if (ev.code === REFUSED_CLOSE_CODE) {
        status('error', `the bridge refused the connection (${ev.reason || 'another client holds it'}) — not retrying`);
        stopped = true;
        return;
      }
      if (ev.code === 1000 && builder.over) {
        status('closed', 'the game is over');
        stopped = true;
        return;
      }
      failures++;
      const wait = backoff();
      if (!opened) {
        status(
          'error',
          `could not connect to ${url}. Is mtg-table running with the /observe update (needs the bridge from mtg-table ` +
            `PR "read-only /observe")? Chrome may ask for local network permission; Safari blocks it. Or use the HTTP ` +
            `fallback (http-server on the game folder; see README). Retrying in ${Math.round(wait / 100) / 10} s`,
        );
        later(openSocket, wait);
        return;
      }
      status('error', `disconnected${ev.code ? ` (${ev.code})` : ''}; retrying in ${Math.round(wait / 100) / 10} s`);
      later(openSocket, wait);
    };
  };

  // -- http(s): poll a growing frames.jsonl ------------------------------------
  const fetchImpl =
    opts.fetchImpl ??
    ((u: string, init: { headers: Record<string, string>; cache: 'no-store' }) =>
      fetch(u, init) as Promise<FetchResponseLike>);
  /** Bytes consumed — always just past a '\n'. */
  let offset = 0;
  let sawHeader = false;
  const decoder = new TextDecoder();

  const consume = (bytes: Uint8Array): boolean => {
    const cut = bytes.lastIndexOf(0x0a);
    if (cut < 0) return false;
    offset += cut + 1;
    let any = false;
    for (const line of decoder.decode(bytes.subarray(0, cut)).split('\n')) {
      if (!line.trim()) continue;
      let obj: unknown;
      try {
        obj = JSON.parse(line);
      } catch {
        continue;
      }
      if (!sawHeader) {
        sawHeader = true;
        const hdr = obj as SessionHeader;
        if (!hdr || hdr.kind !== 'session') throw new Error('line 0 is not an mtg-table session header');
        builder.setHeader(hdr);
        any = true;
        continue;
      }
      if (builder.add(obj as LoggedFrame, false)) any = true;
    }
    return any;
  };
  const restart = () => {
    offset = 0;
    sawHeader = false;
    builder.reset();
  };

  const poll = async () => {
    if (stopped) return;
    if (!sawHeader && failures === 0 && lastStatus === null) status('connecting');
    // Ask for one byte before the offset: it must be the '\n' we stopped at.
    // That keeps "nothing new" a 206 (not a 416) and detects a replaced file.
    const from = offset > 0 ? offset - 1 : 0;
    const headers: Record<string, string> = from > 0 ? { Range: `bytes=${from}-` } : {};
    try {
      const res = await fetchImpl(url, { headers, cache: 'no-store' });
      if (stopped) return;
      if (res.status === 404) throw new Error('not found (404) — has the game started? is the path right?');
      if (res.status === 416) {
        restart();
        later(poll, 0);
        return;
      }
      if (res.status !== 200 && res.status !== 206) throw new Error(`HTTP ${res.status}`);
      let bytes = new Uint8Array(await res.arrayBuffer());
      if (stopped) return;
      if (res.status === 200) {
        // Whole file (server ignored Range, or no Range was sent).
        if (from > 0) {
          if (bytes.length < offset || bytes[offset - 1] !== 0x0a) {
            restart();
          } else {
            bytes = bytes.subarray(offset);
          }
        }
      } else if (from > 0) {
        if (bytes[0] !== 0x0a) {
          restart();
          later(poll, 0);
          return;
        }
        bytes = bytes.subarray(1);
      }
      failures = 0;
      status('open');
      if (consume(bytes)) changed();
      if (builder.over) {
        emitNow();
        status('closed', 'the game is over');
        stopped = true;
        return;
      }
      later(poll, pollMs);
    } catch (e) {
      if (stopped) return;
      failures++;
      const wait = Math.max(pollMs, backoff());
      status('error', `${(e as Error).message || 'fetch failed'} — retrying in ${Math.round(wait / 100) / 10} s`);
      later(poll, wait);
    }
  };

  if (cls.kind === 'ws') openSocket();
  else void poll();

  return {
    close() {
      stopped = true;
      if (timer !== null) clearTimeout(timer);
      timer = null;
      if (emitTimer !== null) clearTimeout(emitTimer);
      emitTimer = null;
      const s = socket;
      socket = null;
      if (s) {
        try {
          s.close(1000, 'ForgeCoach closed');
        } catch {
          /* already closing */
        }
      }
      status('closed');
    },
  };
}
