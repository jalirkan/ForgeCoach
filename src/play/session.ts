/*
 * ForgeCoach — play/session.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Playing a game: ForgeCoach is the player's seat on a running mtg-table
 * bridge (ws://127.0.0.1:8642/ws, protocol §2). This module owns the socket,
 * the growing GameLog, the current input/ask, and sending acts and answers.
 *
 * Connection behaviour is adapted from mtg-table web/src/transport/ws.ts
 * (Copyright (C) 2026 the mtg-table authors, GPL-3.0-or-later), which is the
 * reference client, rule for rule:
 *
 *   - the client sends NO handshake. The server sends `hello_ok`, the last
 *     `state`, the current `input` (once the engine has pushed one, M42) and
 *     any outstanding `ask` the moment a session exists (§2.1, M15/M20);
 *   - our own c2s `seq` is stamped here, monotonic for the life of the session
 *     object (§1), with `v` and `t`;
 *   - on every RE-connect (never the first) a `resync` is sent (§2.4); the
 *     server re-delivers `hello_ok` / `state` / `ask` verbatim with their
 *     original `seq` (M10), which the log builder de-duplicates;
 *   - an inbound `ping` is answered with a `pong` (§2.5); we also ping every
 *     `pingMs` as a keepalive (the server's `pong` is `seq: 0`, never logged);
 *   - backoff 250 ms doubling to a 5 s ceiling, giving up after 12 attempts;
 *   - a close code ≥ 4000 is the server saying no (M13: 4001, one seat) — it
 *     is terminal, never retried;
 *   - a close after `over` is the end, not a hiccup — not retried;
 *   - acts are NEVER queued across a disconnect: a click is a statement about
 *     the board the user was looking at. While the socket is not open an act
 *     is dropped and a client notice says so;
 *   - every frame we send is also folded into our own view and log, because
 *     nothing the server sends ever says "that question is closed": the
 *     `answer` is what clears `ask` (ws.ts, measured 2026-09-11).
 *
 * The Origin of the page must be on mtg-table's `wsAllowedOrigins` (M50; the
 * defaults include https://jalirkan.github.io and http://localhost:*), else the
 * upgrade is a 403 the browser reports as a plain failed connection.
 */
import { PROTOCOL_VERSION } from '../protocol.ts';
import type {
  ActBody,
  AnswerValue,
  AskBody,
  GameStateBody,
  HelloOkBody,
  InputBody,
  NoticeBody,
  OverBody,
} from '../protocol.ts';
import type { GameLog, LoggedFrame } from '../log.ts';
import { LiveLogBuilder } from '../live.ts';
import { guardFrame } from '../faceDown.ts';
import { whyNotAct, whyNotAnswer } from './acts.ts';
import { recordFinishedGame } from '../history/record.ts';

import { DEFAULT_SEAT_URL, redactSeatUrl } from './seatUrl.ts';

export { DEFAULT_SEAT_URL, defaultSeatUrl, servedByEngine, redactSeatUrl, tokenFromSearch } from './seatUrl.ts';
export type { PageLocation } from './seatUrl.ts';
/** mtg-table's "one client at a time" refusal (protocol amendment M13). */
export const SEAT_REFUSED_CLOSE_CODE = 4001;

export type SeatStatus =
  | 'idle'
  | 'connecting'
  | 'open'
  /** Another client holds the seat (close 4001) — e.g. the mtg-table board tab. */
  | 'refused'
  | 'closed'
  | 'error';

/** A message for the player: the engine's `notice` frames, plus the client's own complaints. */
export interface SessionNotice {
  /** The frame's seq; negative for a client-side notice. */
  seq: number;
  t: number;
  level: NoticeBody['level'];
  title: string;
  text: string;
  /** `client` when ForgeCoach itself refused or dropped something. */
  source: 'engine' | 'client';
}

export interface PlaySnapshot {
  status: SeatStatus;
  /** Human-readable detail for the status (why it failed, what to do). */
  detail: string | null;
  /** Everything received this game, as a GameLog (same shape parseLog returns). */
  log: GameLog | null;
  state: GameStateBody | null;
  /** The engine's current prompt (buttons, selectable cards…); null when none. */
  input: InputBody | null;
  /** The open blocking question, if any. Exactly one answer per ask. */
  ask: AskBody | null;
  over: OverBody | null;
  /** The viewing seat's player id. */
  seat: number | null;
  // ---- additions beyond the original contract ----
  /** This game's handshake (deck names, match length, players). */
  hello: HelloOkBody | null;
  /** Finished (or abandoned) earlier games of this session, oldest first — for post-game review. */
  previousLogs: GameLog[];
  /** Recent notices, oldest first (at most 20). */
  notices: SessionNotice[];
  /** The engine has pushed an `input` this game (M42) — before that only `concede` is accepted. */
  inputSeen: boolean;
  /** Consecutive failed connection attempts. */
  attempts: number;
  /** The seat URL this session connects to. */
  url: string;
}

export interface PlaySession {
  snapshot(): PlaySnapshot;
  /** Called on every change (throttled to animation frames by the implementation). */
  subscribe(cb: (s: PlaySnapshot) => void): () => void;
  /** Sends an act; returns false (and records a client notice) when the guard refused it. */
  act(body: ActBody): boolean;
  /** Answers the open ask; returns false when refused (not the open ask, already answered, not connected). */
  answer(askId: string, value: AnswerValue): boolean;
  resync(): void;
  /** Drop the socket and connect again from scratch (the "Retry" button). Also leaves `refused`/`closed`. */
  reconnect(): void;
  close(): void;
}

/** The subset of `WebSocket` used here; injectable for tests. */
export interface SeatSocket {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: { code?: number; reason?: string }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
}

export interface SeatOptions {
  socketFactory?: (url: string) => SeatSocket;
  /** Runs a notification flush later; default requestAnimationFrame, else setTimeout 0. */
  schedule?: (fn: () => void) => void;
  /** Backoff base and ceiling (defaults 250 ms, 5 s — mtg-table ws.ts). */
  backoffMs?: number;
  maxBackoffMs?: number;
  /** Give up (status `closed`) after this many consecutive failures (default 12). */
  maxAttempts?: number;
  /** Keepalive ping interval while open (default 25 s; 0 disables). */
  pingMs?: number;
  now?: () => number;
}

/** `WebSocket.OPEN`, spelled out so this module needs no DOM at runtime. */
const OPEN = 1;
const MAX_NOTICES = 20;
/** How long reconnect() waits for its old socket to finish closing. */
const CLOSE_WAIT_MS = 1_000;

export const REFUSED_DETAIL =
  'Another window is the player (probably the mtg-table board tab) — close it and retry';

/** What to tell the user when the seat socket cannot be reached at all. */
export function unreachableDetail(rawUrl: string, retryInMs: number | null): string {
  const port = portOf(rawUrl);
  const url = redactSeatUrl(rawUrl);
  return (
    `Could not reach the Forge engine at ${url}. Start it in your mtg-table checkout with ` +
    `\`./scripts/play.sh --engine-only${port === '8642' ? '' : ` --port ${port}`}\`, and close any mtg-table ` +
    `board tab (it would take the seat). Chrome may ask to let this page access devices on your local network — allow it ` +
    `(Safari blocks it). The page must be served from https://jalirkan.github.io, localhost or the bridge itself ` +
    `(\`--lan\`), or the bridge refuses the handshake.` +
    (retryInMs === null ? '' : ` Retrying in ${(Math.round(retryInMs / 100) / 10).toString()} s.`)
  );
}

function portOf(url: string): string {
  try {
    return new URL(url).port || '8642';
  } catch {
    return '8642';
  }
}

export const AI_DECK_WARNING_REDACTED = 'The AI’s deck has cards it can’t play well (hidden by ForgeCoach: they are the AI’s cards).';

/**
 * Forge's start-of-match warning about the AI's deck (Match.prepareAllZones →
 * GameAction.revealUnplayableByAI, `lblAICantPlayCards`): a reveal listing the
 * AI deck's AI:RemAIDeck cards to the human seat. It names cards of a hidden
 * decklist, so ForgeCoach neither shows nor keeps it.
 */
export function isAiDeckWarning(a: AskBody): boolean {
  return a.kind === 'choose_list' && a.reveal === true && /^AI can'?’?t play these cards well/i.test(a.prompt.trim());
}

function defaultSchedule(fn: () => void): void {
  const raf = (globalThis as { requestAnimationFrame?: (cb: () => void) => unknown }).requestAnimationFrame;
  if (typeof raf === 'function') raf(fn);
  else setTimeout(fn, 0);
}

function looksLikeFrame(value: unknown): value is LoggedFrame {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v['v'] === 'number' &&
    typeof v['seq'] === 'number' &&
    typeof v['t'] === 'number' &&
    typeof v['type'] === 'string' &&
    typeof v['body'] === 'object' &&
    v['body'] !== null &&
    !Array.isArray(v['body'])
  );
}

export function connectSeat(url: string = DEFAULT_SEAT_URL, opts: SeatOptions = {}): PlaySession {
  const factory = opts.socketFactory ?? ((u: string) => new WebSocket(u) as unknown as SeatSocket);
  const schedule = opts.schedule ?? defaultSchedule;
  const backoffBase = opts.backoffMs ?? 250;
  const backoffMax = opts.maxBackoffMs ?? 5_000;
  const maxAttempts = opts.maxAttempts ?? 12;
  const pingMs = opts.pingMs ?? 25_000;
  const now = opts.now ?? (() => Date.now());

  const builder = new LiveLogBuilder();
  const previousLogs: GameLog[] = [];
  const subscribers = new Set<(s: PlaySnapshot) => void>();

  let status: SeatStatus = 'idle';
  let detail: string | null = null;
  let hello: HelloOkBody | null = null;
  /** The seq and t of the hello_ok frame `hello` came in: a reconnect re-delivers it byte for byte (M10). */
  let helloStamp: { seq: number; t: number } | null = null;
  let state: GameStateBody | null = null;
  let input: InputBody | null = null;
  // The bridge can put concurrent frames on the wire out of seq order (5, 3, 4);
  // an older state or input must not replace a newer one on screen.
  let stateSeq = 0;
  let inputSeq = 0;
  let ask: AskBody | null = null;
  let over: OverBody | null = null;
  let inputSeen = false;
  let notices: SessionNotice[] = [];
  let clientNoticeSeq = 0;
  /** Every askId answered this game — never answer one twice (§2.3). */
  const answered = new Set<string>();

  let socket: SeatSocket | null = null;
  let everOpened = false;
  let attempts = 0;
  let shutDown = false;
  let seq = 0;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let pingTimer: ReturnType<typeof setInterval> | null = null;

  let cached: PlaySnapshot | null = null;
  let flushPending = false;

  // -- snapshot & notification ------------------------------------------------

  const build = (): PlaySnapshot => ({
    status,
    detail,
    log: builder.snapshot(),
    state,
    input,
    ask,
    over,
    seat: hello?.you ?? null,
    hello,
    previousLogs: previousLogs.slice(),
    notices,
    inputSeen,
    attempts,
    url,
  });

  const snapshot = (): PlaySnapshot => {
    if (cached === null) cached = build();
    return cached;
  };

  const changed = () => {
    cached = null;
    if (flushPending || subscribers.size === 0) return;
    flushPending = true;
    schedule(() => {
      flushPending = false;
      if (subscribers.size === 0) return;
      const s = snapshot();
      for (const cb of [...subscribers]) cb(s);
    });
  };

  const setStatus = (s: SeatStatus, d: string | null) => {
    if (s === status && d === detail) return;
    status = s;
    detail = d;
    changed();
  };

  const note = (level: NoticeBody['level'], title: string, text: string, source: SessionNotice['source'], s?: number, t?: number) => {
    const n: SessionNotice = { seq: s ?? -++clientNoticeSeq, t: t ?? now(), level, title, text, source };
    const next = [...notices, n];
    notices = next.length > MAX_NOTICES ? next.slice(next.length - MAX_NOTICES) : next;
    changed();
  };

  // -- the game model ---------------------------------------------------------

  /** A new game (M38): archive the finished log, forget everything game-scoped. */
  const newGame = () => {
    const done = builder.snapshot();
    if (done) previousLogs.push(done);
    builder.reset();
    state = null;
    input = null;
    stateSeq = 0;
    inputSeq = 0;
    ask = null;
    over = null;
    inputSeen = false;
    answered.clear();
    notices = [];
  };

  const receive = (raw: LoggedFrame) => {
    // Defence in depth (faceDown.ts, mtg-table D371): the board, the coach and
    // the log never see the face of a face-down permanent this seat does not control.
    const f = hello !== null && raw.type !== 'hello_ok' ? guardFrame(raw, hello.you) : raw;
    switch (f.type) {
      case 'hello_ok': {
        const body = f.body as HelloOkBody;
        // A new game (M38): a different gameId. Or a new engine under the same id: a
        // reconnect is handed the SAME hello_ok frame again (M10, same seq and t), so
        // one with another stamp was generated by a process that started over -- a
        // bare play.sh restarted keeps its default id -- with its own seq series.
        const restarted = helloStamp !== null && (helloStamp.seq !== f.seq || helloStamp.t !== f.t);
        if (hello !== null && (hello.gameId !== body.gameId || restarted)) newGame();
        hello = body;
        helloStamp = { seq: f.seq, t: f.t };
        break;
      }
      case 'state': {
        const body = f.body as GameStateBody;
        // Between a new game's hello_ok and its first state, a reconnect can be
        // handed the previous game's last state (M50); it belongs to no game we show.
        if (hello !== null && body.gameId !== hello.gameId) return;
        if (f.seq > 0 && f.seq < stateSeq) break; // stale: log it, don't show it
        state = body;
        if (f.seq > 0) stateSeq = f.seq;
        break;
      }
      case 'input':
        if (f.seq > 0 && f.seq < inputSeq) break; // stale: log it, don't show it
        input = f.body as InputBody;
        if (f.seq > 0) inputSeq = f.seq;
        inputSeen = true;
        break;
      case 'ask': {
        const body = f.body as AskBody;
        // A re-delivery of a question we already answered is not a new question.
        if (answered.has(body.askId)) return;
        if (isAiDeckWarning(body)) {
          // Forge's pre-game "AI can't play these cards well" reveal lists cards
          // of the AI's deck: hidden information. Never shown, never logged by
          // name; acknowledged at once, as its OK would.
          const hidden = { ...body, prompt: AI_DECK_WARNING_REDACTED, options: [] } as AskBody;
          builder.add({ ...f, body: hidden, dir: 's2c' } as LoggedFrame, true);
          ask = hidden;
          answer(body.askId, []);
          changed();
          return;
        }
        ask = body;
        break;
      }
      case 'notice': {
        const body = f.body as NoticeBody;
        note(body.level, body.title, body.text, 'engine', f.seq, f.t);
        break;
      }
      case 'over':
        over = f.body as OverBody;
        ask = null;
        break;
      case 'ping':
        sendFrame('pong', {});
        return;
      default:
        break;
    }
    // seq 0 (pong, refusal, dropped-frame notices) and verbatim re-deliveries
    // are skipped by the builder, exactly as live.ts follows a game.
    builder.add({ ...f, dir: 's2c' }, true);
    // "Your record" (#history): the finished game, saved once per game id, never throwing.
    if (f.type === 'over') void recordFinishedGame(builder.snapshot());
    changed();
  };

  // -- sending ----------------------------------------------------------------

  /** Stamps and sends one c2s frame; returns the stamped frame, or null when not sent. */
  function sendFrame(type: 'act' | 'answer' | 'resync' | 'ping' | 'pong', body: object): LoggedFrame | null {
    const s = socket;
    if (s === null || s.readyState !== OPEN) return null;
    seq += 1;
    const frame = { v: PROTOCOL_VERSION, seq, t: now(), type, body } as unknown as LoggedFrame;
    try {
      s.send(JSON.stringify(frame));
    } catch (err) {
      note('error', 'Send failed', String(err), 'client');
      return null;
    }
    // §8.2: a client log reads both directions. The terminal `over` ends the
    // game's log (§8.4) — a newGame sent after it belongs to no file.
    if ((type === 'act' || type === 'answer' || type === 'resync') && over === null) {
      if (builder.add({ ...frame, dir: 'c2s' }, true)) changed();
    }
    return frame;
  }

  const act = (body: ActBody): boolean => {
    const why = whyNotAct({ status, ask, over, inputSeen }, body);
    if (why !== null) {
      note('warn', 'Not sent', `${body.action}: ${why}`, 'client');
      return false;
    }
    return sendFrame('act', body) !== null;
  };

  const answer = (askId: string, value: AnswerValue): boolean => {
    const why = whyNotAnswer({ status, ask, over, inputSeen }, askId, answered);
    if (why !== null) {
      note('warn', 'Not sent', `answer: ${why}`, 'client');
      return false;
    }
    if (sendFrame('answer', { askId, value }) === null) return false;
    answered.add(askId);
    if (ask?.askId === askId) ask = null;
    changed();
    return true;
  };

  const resync = () => {
    if (sendFrame('resync', {}) === null) note('warn', 'Not sent', 'resync: not connected to the engine', 'client');
  };

  // -- connection ---------------------------------------------------------------

  const clearRetry = () => {
    if (retryTimer !== null) clearTimeout(retryTimer);
    retryTimer = null;
  };
  const stopPing = () => {
    if (pingTimer !== null) clearInterval(pingTimer);
    pingTimer = null;
  };

  const detach = (s: SeatSocket) => {
    s.onopen = null;
    s.onmessage = null;
    s.onclose = null;
    s.onerror = null;
  };

  const scheduleRetry = (opened: boolean, code: number, reason: string) => {
    if (shutDown) return;
    if (attempts >= maxAttempts) {
      setStatus(
        'closed',
        everOpened
          ? `Lost the engine at ${redactSeatUrl(url)} and ${attempts.toString()} reconnects failed. Is the bridge still running? Press Retry.`
          : `${unreachableDetail(url, null)} Gave up after ${attempts.toString()} attempts — press Retry.`,
      );
      return;
    }
    const wait = Math.min(backoffMax, backoffBase * 2 ** Math.max(0, attempts - 1));
    retryTimer = setTimeout(() => {
      retryTimer = null;
      open();
    }, wait);
    if (!everOpened) {
      setStatus('error', unreachableDetail(url, wait));
    } else {
      setStatus(
        'error',
        `Disconnected from the engine${opened ? '' : ' again'} (${code.toString()}${reason ? ` — ${reason}` : ''}); ` +
          `reconnecting in ${(Math.round(wait / 100) / 10).toString()} s.`,
      );
    }
  };

  function open(): void {
    if (shutDown || socket !== null) return;
    clearRetry();
    attempts += 1;
    setStatus('connecting', everOpened ? `reconnecting (attempt ${attempts.toString()})` : null);
    let s: SeatSocket;
    try {
      s = factory(url);
    } catch (err) {
      note('error', 'Cannot connect', String(err), 'client');
      scheduleRetry(false, 0, String(err));
      return;
    }
    socket = s;
    let opened = false;

    s.onopen = () => {
      if (socket !== s) return;
      opened = true;
      attempts = 0;
      const reconnected = everOpened;
      everOpened = true;
      setStatus('open', null);
      if (reconnected && ask !== null) {
        // The bridge cancelled every ask parked when the socket dropped (M19: they
        // took their §5.4 defaults) and re-sends, in this same catch-up, only those
        // still waiting (§2.4). One we still show is a dead question that would hold
        // the board modal; if it is still open it comes back with its own id.
        ask = null;
        changed();
      }
      // §2.4 — only on a RE-connect; a first connect is sent hello_ok + state + input unasked.
      if (reconnected) sendFrame('resync', {});
      stopPing();
      if (pingMs > 0) pingTimer = setInterval(() => void sendFrame('ping', {}), pingMs);
    };

    s.onmessage = (ev) => {
      if (socket !== s) return;
      if (typeof ev.data !== 'string') {
        note('error', 'Protocol', `received a non-text frame (${typeof ev.data}) — §1 is JSON text frames`, 'client');
        return;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(ev.data);
      } catch (err) {
        note('error', 'Protocol', `frame is not valid JSON: ${String(err)}`, 'client');
        return;
      }
      if (!looksLikeFrame(parsed)) {
        note('error', 'Protocol', `not a §1 envelope: ${ev.data.slice(0, 200)}`, 'client');
        return;
      }
      if (parsed.v !== PROTOCOL_VERSION) {
        note('error', 'Protocol', `frame ${parsed.type}@${parsed.seq.toString()} has v=${String(parsed.v)}; ForgeCoach speaks v=${PROTOCOL_VERSION.toString()}`, 'client');
        return;
      }
      receive(parsed);
    };

    s.onerror = () => {
      /* the browser gives no detail (a security boundary); onclose follows with the code */
    };

    s.onclose = (ev) => {
      if (socket !== s) return;
      socket = null;
      stopPing();
      const code = ev.code ?? 0;
      const reason = ev.reason ?? '';
      if (shutDown) {
        setStatus('closed', null);
        return;
      }
      if (code >= 4000) {
        // M13: the server said no. Retrying would fight a bridge that already answered.
        setStatus('refused', code === SEAT_REFUSED_CLOSE_CODE ? REFUSED_DETAIL : `${REFUSED_DETAIL} (close ${code.toString()}${reason ? ` — ${reason}` : ''})`);
        return;
      }
      if (over !== null) {
        // The bridge plays its games and exits; reconnecting to a process that is gone would spin forever.
        setStatus('closed', `The engine closed the connection after the game ended${reason ? ` (${reason})` : ''}.`);
        return;
      }
      scheduleRetry(opened, code, reason);
    };
  }

  /**
   * The bridge admits one seat (M13): a new socket that reaches it before it
   * has seen the old one close is refused 4001. So when we are dropping our
   * own socket, the new one is opened only once the old one has finished
   * closing (or after `CLOSE_WAIT_MS`, whichever is first).
   */
  const reconnect = () => {
    shutDown = false;
    clearRetry();
    stopPing();
    attempts = 0;
    const s = socket;
    socket = null;
    if (s === null || s.readyState === 3) {
      if (s !== null) detach(s);
      open();
      return;
    }
    let started = false;
    const go = () => {
      if (started) return;
      started = true;
      clearTimeout(fallback);
      detach(s);
      open();
    };
    const fallback = setTimeout(go, CLOSE_WAIT_MS);
    s.onopen = null;
    s.onmessage = null;
    s.onerror = null;
    s.onclose = go;
    setStatus('connecting', 'reconnecting');
    try {
      s.close(1000, 'reconnecting');
    } catch {
      go();
    }
  };

  const close = () => {
    shutDown = true;
    clearRetry();
    stopPing();
    const s = socket;
    socket = null;
    if (s !== null) {
      detach(s);
      try {
        s.close(1000, 'ForgeCoach closed');
      } catch {
        /* already gone */
      }
    }
    setStatus('closed', null);
  };

  open();

  return {
    snapshot,
    subscribe(cb) {
      subscribers.add(cb);
      return () => {
        subscribers.delete(cb);
      };
    },
    act,
    answer,
    resync,
    reconnect,
    close,
  };
}
