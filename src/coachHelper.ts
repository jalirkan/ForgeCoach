/*
 * ForgeCoach — coachHelper.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Coaching without an API key: mtg-table's local "coach helper" (started by
 * `./scripts/play.sh`) runs the Claude Code CLI that is logged in on the
 * player's PC and streams its answer back.
 *
 * Contract (mtg-table tools/coach-helper.mjs, D292, D325 and D346):
 *   GET  /health → {"ok":true,"helper":1,"claude":"<version>","models":[…]}
 *                | {"ok":false,"helper":1,"error":"…"}
 *                  D325 adds "concurrency":1, "queue":{"max","length"}, "running":0|1,
 *                  "supersedes":1. A helper without "queue" refuses a second question (429).
 *                  D346 adds "thinking":["off","low","default"].
 *   POST /coach  {"system","user","model"?:"opus"|"sonnet"|"haiku","supersedes"?:"<key>",
 *                 "thinking"?:"off"|"low"|"default"}   (D346: send "thinking" only to a
 *                 helper whose /health lists it; absent = "default", anything else is 400)
 *        → application/x-ndjson: {"type":"text","text"} / {"type":"thinking","text"} lines,
 *          ending with one {"type":"done","stopReason","model"} or {"type":"error","message"}.
 *          D325: a question that waits first gets {"type":"queued","position":n} (n ahead
 *          of it, again as it moves up) and {"type":"running"} when its turn comes; a newer
 *          question with the same "supersedes" key ends a queued one with
 *          {"type":"error","code":"superseded"}. Aborting the request cancels the run or
 *          leaves the queue; 429 when the queue is full (or, before D325, when busy).
 * Default base http://127.0.0.1:8643. When the engine serves this page on the
 * LAN (phone play) the helper is on the page's host, port 8643 -- or the port
 * in the page URL's `coachPort` parameter, which mtg-table's `play.sh --lan`
 * adds to the phone link when it runs the helper elsewhere (`--coach-port`) --
 * and the pairing token goes along as `X-ForgeCoach-Token`.
 *
 * DOM-light: `fetch` and the page location are injectable for tests.
 */
import { CoachError, type CoachResult, type ModelId, type Settings, type StreamHandlers } from './claude.ts';
import type { Prompt } from './prompt.ts';
import { SEAT_TOKEN_KEY, servedByEngine, tokenFromSearch } from './play/seatUrl.ts';

export const HELPER_PORT = 8643;
export const DEFAULT_HELPER_URL = `http://127.0.0.1:${HELPER_PORT}`;
export const TOKEN_HEADER = 'X-ForgeCoach-Token';

export type HelperModel = 'opus' | 'sonnet' | 'haiku';
/** D346: how much Claude Code may think before it answers. */
export type HelperThinking = 'off' | 'low' | 'default';
const HELPER_THINKING: readonly HelperThinking[] = ['off', 'low', 'default'];

/** The "thinking" to send for `want`: only a value this helper's /health lists, and never 'default' (the same as none). */
export function helperThinking(helper: HelperStatus | null, want: HelperThinking | undefined): HelperThinking | undefined {
  if (!want || want === 'default' || helper?.state !== 'ok') return undefined;
  return helper.thinking?.includes(want) ? want : undefined;
}

/** The helper's alias for a ForgeCoach model choice. */
export function helperModel(id: ModelId | string): HelperModel {
  if (id.includes('haiku')) return 'haiku';
  if (id.includes('sonnet')) return 'sonnet';
  return 'opus';
}

// ---------------------------------------------------------------------------
// Where the helper is

export interface HelperTarget {
  baseUrl: string;
  token: string | null;
}

export interface HelperLocation {
  protocol: string;
  hostname: string;
  /** hostname plus port, like `location.host`. */
  host: string;
  search: string;
}

/**
 * The helper's port from the page URL's `coachPort` parameter, or null when it
 * is absent or not a port. mtg-table's `play.sh --lan` adds it to the phone
 * link only when the helper is not on 8643 (`--coach-port`, config.json
 * `coachPort`), so a link without it means the default.
 */
export function helperPortFromSearch(search: string): number | null {
  let raw: string | null = null;
  try {
    raw = new URLSearchParams(search).get('coachPort');
  } catch {
    return null;
  }
  if (raw === null || !/^\d{1,5}$/.test(raw)) return null;
  const n = Number(raw);
  return n >= 1 && n <= 65535 ? n : null;
}

/**
 * Where the helper lives for a page at `loc`. `?coach=http://…` overrides the
 * base URL (a development aid). Served by the engine (phone/LAN): the page's
 * host on port 8643, or on `?coachPort=` when the link names one, with the
 * pairing token (from the URL, else `storedToken`).
 */
export function helperTarget(loc: HelperLocation, storedToken: string | null = null): HelperTarget {
  let override: string | null = null;
  try {
    override = new URLSearchParams(loc.search).get('coach');
  } catch {
    /* ignore */
  }
  const engine = servedByEngine(loc);
  const token = engine ? (tokenFromSearch(loc.search) ?? storedToken ?? null) : null;
  if (override && /^https?:\/\/[^\s]+$/i.test(override)) return { baseUrl: override.replace(/\/+$/, ''), token };
  if (engine) {
    const name = loc.hostname.includes(':') && !loc.hostname.startsWith('[') ? `[${loc.hostname}]` : loc.hostname;
    return { baseUrl: `http://${name}:${helperPortFromSearch(loc.search) ?? HELPER_PORT}`, token };
  }
  return { baseUrl: DEFAULT_HELPER_URL, token: null };
}

/** The target for this browser page (the default when there is no page). */
export function pageHelperTarget(): HelperTarget {
  try {
    if (typeof location === 'undefined') return { baseUrl: DEFAULT_HELPER_URL, token: null };
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(SEAT_TOKEN_KEY);
    } catch {
      /* storage unavailable */
    }
    return helperTarget(location, stored);
  } catch {
    return { baseUrl: DEFAULT_HELPER_URL, token: null };
  }
}

function headers(t: HelperTarget, json: boolean): Record<string, string> {
  const h: Record<string, string> = {};
  if (json) h['Content-Type'] = 'application/json';
  if (t.token) h[TOKEN_HEADER] = t.token;
  return h;
}

// ---------------------------------------------------------------------------
// Detection

/** What a D325 helper says about its queue; null from an older helper (one question, the rest 429). */
export interface HelperQueue {
  max: number;
  length: number;
}

export type HelperStatus =
  | {
      state: 'ok';
      baseUrl: string;
      claude: string;
      models: string[];
      checkedAt: number;
      /** Questions it answers at once (1 when it doesn't say). */
      concurrency?: number;
      queue?: HelperQueue | null;
      /** It honours a "supersedes" key on /coach. */
      supersedes?: boolean;
      /** D346: the "thinking" values /coach accepts; [] from an older helper (send none). */
      thinking?: HelperThinking[];
    }
  | { state: 'down'; baseUrl: string; reason: 'not_running' | 'not_ready' | 'unauthorized'; message: string; checkedAt: number };

type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

export interface DetectOptions {
  fetch?: FetchFn;
  target?: HelperTarget;
  /** Give up after this long (default 800 ms): a missing helper must not hold up the coach. */
  timeoutMs?: number;
  /** Ignore the cached result and ask again. */
  force?: boolean;
  now?: () => number;
}

/** How long a result stays fresh. A found helper is trusted longer than a missing one is. */
const OK_TTL = 60_000;
const DOWN_TTL = 8_000;

const cache = new Map<string, HelperStatus>();
const inflight = new Map<string, Promise<HelperStatus>>();
const listeners = new Set<() => void>();

function publish(s: HelperStatus) {
  cache.set(s.baseUrl, s);
  for (const l of listeners) l();
}

/** Called whenever a detection result changes what is known. */
export function onHelperStatus(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** The last known status for `target` (stale or not), without asking. */
export function peekHelper(target: HelperTarget = pageHelperTarget()): HelperStatus | null {
  return cache.get(target.baseUrl) ?? null;
}

/** True when the last result for `target` is fresh enough to act on without asking again. */
export function helperFresh(target: HelperTarget = pageHelperTarget(), now = Date.now()): boolean {
  const s = cache.get(target.baseUrl);
  return !!s && now - s.checkedAt < (s.state === 'ok' ? OK_TTL : DOWN_TTL);
}

/** Forget cached results (tests; and after the helper fails a request). */
export function forgetHelper(baseUrl?: string): void {
  if (baseUrl) cache.delete(baseUrl);
  else cache.clear();
}

const NOT_RUNNING = 'The coach helper isn’t running. Start `./scripts/play.sh` in mtg-table (it starts the helper), with Claude Code installed and logged in.';

/** Is the coach helper there, and is Claude Code ready behind it? Never throws. */
export function detectHelper(opts: DetectOptions = {}): Promise<HelperStatus> {
  const target = opts.target ?? pageHelperTarget();
  const now = opts.now ?? Date.now;
  if (!opts.force && helperFresh(target, now())) return Promise.resolve(cache.get(target.baseUrl)!);
  const running = inflight.get(target.baseUrl);
  if (running) return running;
  const p = probe(target, opts.fetch ?? defaultFetch(), opts.timeoutMs ?? 800, now).then((s) => {
    publish(s);
    return s;
  });
  inflight.set(target.baseUrl, p);
  void p.finally(() => inflight.delete(target.baseUrl));
  return p;
}

function defaultFetch(): FetchFn {
  return (input, init) => fetch(input, init);
}

async function probe(target: HelperTarget, f: FetchFn, timeoutMs: number, now: () => number): Promise<HelperStatus> {
  const baseUrl = target.baseUrl;
  const down = (reason: 'not_running' | 'not_ready' | 'unauthorized', message: string): HelperStatus => ({ state: 'down', baseUrl, reason, message, checkedAt: now() });
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await f(`${baseUrl}/health`, { method: 'GET', headers: headers(target, false), signal: ctrl.signal, cache: 'no-store' });
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      /* not JSON */
    }
    const b = (body ?? {}) as {
      ok?: unknown;
      helper?: unknown;
      claude?: unknown;
      models?: unknown;
      error?: unknown;
      message?: unknown;
      concurrency?: unknown;
      queue?: unknown;
      supersedes?: unknown;
      thinking?: unknown;
    };
    if (res.status === 401 || res.status === 403) return down('unauthorized', refusedMessage(String(b.message ?? b.error ?? '')));
    if (b.helper === undefined && !res.ok) return down('not_running', NOT_RUNNING);
    if (b.ok === true) {
      return {
        state: 'ok',
        baseUrl,
        claude: typeof b.claude === 'string' ? b.claude : '',
        models: Array.isArray(b.models) ? b.models.filter((m): m is string => typeof m === 'string') : [],
        checkedAt: now(),
        concurrency: typeof b.concurrency === 'number' && b.concurrency >= 1 ? Math.floor(b.concurrency) : 1,
        queue: helperQueue(b.queue),
        supersedes: b.supersedes === 1 || b.supersedes === true,
        thinking: Array.isArray(b.thinking) ? HELPER_THINKING.filter((t) => (b.thinking as unknown[]).includes(t)) : [],
      };
    }
    if (b.helper !== undefined) return down('not_ready', helperProblem(typeof b.error === 'string' ? b.error : ''));
    return down('not_running', NOT_RUNNING);
  } catch {
    return down('not_running', NOT_RUNNING);
  } finally {
    clearTimeout(timer);
  }
}

function helperQueue(q: unknown): HelperQueue | null {
  const o = q as { max?: unknown; length?: unknown } | null;
  if (!o || typeof o !== 'object' || typeof o.max !== 'number') return null;
  return { max: o.max, length: typeof o.length === 'number' ? o.length : 0 };
}

/** Why the helper turned this page away (403): its address (Origin) or the pairing token. */
export function refusedMessage(raw: string): string {
  if (/origin/i.test(raw)) {
    return 'The coach helper doesn’t accept requests from this page’s address. Add it to `wsAllowedOrigins` in mtg-table’s config.json, or open ForgeCoach from an allowed address.';
  }
  return 'The coach helper refused this page (pairing token missing or wrong). Open the link `play.sh` printed.';
}

/** A helper-reported problem in words the player can act on. */
export function helperProblem(raw: string): string {
  const msg = raw.trim();
  if (/not\s*(be\s*)?logged\s*in|log\s*in|login|authenticat|unauthori[sz]ed|credential|api key/i.test(msg)) {
    return 'Claude Code on your PC isn’t logged in. Run `claude` in a terminal and log in, then try again.';
  }
  if (/not found|ENOENT|no such file|not installed|command not found/i.test(msg)) {
    return 'The coach helper can’t find Claude Code on your PC. Install Claude Code and log in, then restart `./scripts/play.sh`.';
  }
  if (/usage limit|rate limit|quota/i.test(msg)) return `Claude Code hit a usage limit: ${msg}`;
  return msg ? `Claude Code on your PC couldn’t answer: ${msg}` : 'Claude Code on your PC couldn’t answer.';
}

// ---------------------------------------------------------------------------
// Asking

/** A 429: an older helper answers one question at a time; a D325 helper's queue is full. */
const BUSY = 'Claude Code on your PC is busy with another answer. Wait for it to finish (or stop it), then ask again.';

export interface AskHelperOptions {
  signal?: AbortSignal;
  model?: ModelId | HelperModel;
  fetch?: FetchFn;
  target?: HelperTarget;
  /**
   * D325: a newer question with the same key replaces this one while it waits in
   * the helper's queue. Send it only to a helper whose /health has `supersedes`
   * (an older one ignores unknown fields, so it is harmless either way).
   */
  supersedes?: string;
  /** D346: cap Claude Code's thinking. Send it only to a helper whose /health lists the value (`helperThinking`). */
  thinking?: HelperThinking;
  /** D325: the question is waiting; `position` questions are ahead of it. */
  onQueued?(position: number): void;
  /** D325: a queued question's turn has come. */
  onRunning?(): void;
}

/** Streams the coach's answer from Claude Code on the player's PC. Rejects with a CoachError. */
export async function askHelper(prompt: Prompt, h: StreamHandlers, opts: AskHelperOptions = {}): Promise<CoachResult> {
  const target = opts.target ?? pageHelperTarget();
  const f = opts.fetch ?? defaultFetch();
  const model = opts.model ? helperModel(opts.model) : undefined;
  const aborted = () => new CoachError('Request cancelled.', 'aborted');
  if (opts.signal?.aborted) throw aborted();

  let res: Response;
  try {
    res = await f(`${target.baseUrl}/coach`, {
      method: 'POST',
      headers: headers(target, true),
      body: JSON.stringify({
        system: prompt.system,
        user: prompt.user,
        ...(model ? { model } : {}),
        ...(opts.supersedes ? { supersedes: opts.supersedes } : {}),
        ...(opts.thinking ? { thinking: opts.thinking } : {}),
      }),
      signal: opts.signal,
    });
  } catch (e) {
    if (opts.signal?.aborted || (e instanceof Error && e.name === 'AbortError')) throw aborted();
    forgetHelper(target.baseUrl);
    throw new CoachError(NOT_RUNNING, 'helper_down');
  }

  if (!res.ok) {
    let msg = '';
    try {
      const t = await res.text();
      try {
        const j = JSON.parse(t) as { error?: unknown; message?: unknown };
        msg = String(j.message ?? j.error ?? '');
      } catch {
        msg = t.slice(0, 300);
      }
    } catch {
      /* no body */
    }
    if (res.status === 429) throw new CoachError(BUSY, 'helper_busy', 429);
    if (res.status === 401 || res.status === 403) throw new CoachError(refusedMessage(msg), 'auth', res.status);
    throw new CoachError(helperProblem(msg || `HTTP ${res.status}`), res.status >= 500 ? 'server' : 'unknown', res.status);
  }
  if (!res.body) throw new CoachError('The coach helper sent an empty reply.', 'server');

  let text = '';
  let end: { stopReason: string | null; model: string } | null = null;
  const handle = (line: string) => {
    const s = line.trim();
    if (!s || end) return;
    let ev: { type?: unknown; text?: unknown; stopReason?: unknown; model?: unknown; message?: unknown; code?: unknown; position?: unknown };
    try {
      ev = JSON.parse(s);
    } catch {
      return; // a garbled line is skipped, not fatal
    }
    if (ev.type === 'text' && typeof ev.text === 'string') {
      text += ev.text;
      h.onText(ev.text);
    } else if (ev.type === 'thinking' && typeof ev.text === 'string') {
      h.onThinking?.(ev.text);
    } else if (ev.type === 'queued') {
      opts.onQueued?.(typeof ev.position === 'number' ? ev.position : 1);
    } else if (ev.type === 'running') {
      opts.onRunning?.();
    } else if (ev.type === 'done') {
      end = { stopReason: typeof ev.stopReason === 'string' ? ev.stopReason : null, model: typeof ev.model === 'string' && ev.model ? ev.model : (model ?? '') };
    } else if (ev.type === 'error') {
      if (ev.code === 'superseded') throw new CoachError('A newer question took this one’s place.', 'superseded');
      throw new CoachError(helperProblem(typeof ev.message === 'string' ? ev.message : ''), /logged\s*in|log\s*in|login|authenticat/i.test(String(ev.message ?? '')) ? 'not_logged_in' : 'server');
    }
  };

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        handle(line);
      }
      if (end) break;
    }
    if (end) void reader.cancel().catch(() => {});
    else {
      buf += decoder.decode();
      handle(buf);
    }
  } catch (e) {
    if (e instanceof CoachError) {
      void reader.cancel().catch(() => {});
      throw e;
    }
    if (opts.signal?.aborted || (e instanceof Error && e.name === 'AbortError')) throw aborted();
    throw new CoachError('The connection to the coach helper broke mid-answer. Try again.', 'network');
  }
  if (opts.signal?.aborted) throw aborted();
  if (!end) throw new CoachError('The coach helper stopped mid-answer. Try again.', 'server');
  const { stopReason, model: answeredBy } = end as { stopReason: string | null; model: string };
  return { text, stopReason, refused: stopReason === 'refusal', model: answeredBy };
}

// ---------------------------------------------------------------------------
// Which source answers

export type ActiveSource = 'helper' | 'apiKey';

/**
 * Who answers, given the settings and what is known about the helper:
 * 'auto' prefers the helper when it was detected, then the API key; null means
 * nothing is available (say so, and offer Copy prompt).
 */
export function chooseSource(s: Pick<Settings, 'apiKey' | 'coachSource'>, helper: HelperStatus | null): ActiveSource | null {
  const key = s.apiKey.trim().length > 0;
  if (s.coachSource === 'apiKey') return key ? 'apiKey' : null;
  if (s.coachSource === 'helper') return 'helper';
  if (helper?.state === 'ok') return 'helper';
  return key ? 'apiKey' : null;
}

/** True when asking now would reach a coach (for auto-coach and the "no coach yet" hint). */
export function coachReady(s: Pick<Settings, 'apiKey' | 'coachSource'>, helper: HelperStatus | null): boolean {
  const src = chooseSource(s, helper);
  return src === 'apiKey' || (src === 'helper' && helper?.state === 'ok');
}

export const SOURCE_LABEL: Record<ActiveSource, string> = {
  helper: 'via Claude Code on your PC',
  apiKey: 'via API key',
};
