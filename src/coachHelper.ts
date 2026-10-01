/*
 * ForgeCoach — coachHelper.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Coaching without an API key: mtg-table's local "coach helper" (started by
 * `./scripts/play.sh`) runs the Claude Code CLI that is logged in on the
 * player's PC and streams its answer back.
 *
 * Contract (mtg-table tools/coach-helper.mjs):
 *   GET  /health → {"ok":true,"helper":1,"claude":"<version>","models":[…]}
 *                | {"ok":false,"helper":1,"error":"…"}
 *   POST /coach  {"system","user","model"?:"opus"|"sonnet"|"haiku"}
 *        → application/x-ndjson: {"type":"text","text"} / {"type":"thinking","text"} lines,
 *          ending with one {"type":"done","stopReason","model"} or {"type":"error","message"}.
 *          Aborting the request cancels the run; 429 when it is busy.
 * Default base http://127.0.0.1:8643. When the engine serves this page on the
 * LAN (phone play) the helper is on the page's host, port 8643, and the
 * pairing token goes along as `X-ForgeCoach-Token`.
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
 * Where the helper lives for a page at `loc`. `?coach=http://…` overrides the
 * base URL (a development aid). Served by the engine (phone/LAN): the page's
 * host on port 8643, with the pairing token (from the URL, else `storedToken`).
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
    return { baseUrl: `http://${name}:${HELPER_PORT}`, token };
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

export type HelperStatus =
  | { state: 'ok'; baseUrl: string; claude: string; models: string[]; checkedAt: number }
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
    const b = (body ?? {}) as { ok?: unknown; helper?: unknown; claude?: unknown; models?: unknown; error?: unknown; message?: unknown };
    if (res.status === 401 || res.status === 403) return down('unauthorized', refusedMessage(String(b.message ?? b.error ?? '')));
    if (b.helper === undefined && !res.ok) return down('not_running', NOT_RUNNING);
    if (b.ok === true) {
      return {
        state: 'ok',
        baseUrl,
        claude: typeof b.claude === 'string' ? b.claude : '',
        models: Array.isArray(b.models) ? b.models.filter((m): m is string => typeof m === 'string') : [],
        checkedAt: now(),
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

export interface AskHelperOptions {
  signal?: AbortSignal;
  model?: ModelId | HelperModel;
  fetch?: FetchFn;
  target?: HelperTarget;
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
      body: JSON.stringify(model ? { system: prompt.system, user: prompt.user, model } : { system: prompt.system, user: prompt.user }),
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
    if (res.status === 429) throw new CoachError('Claude Code on your PC is busy with another answer. Wait for it to finish (or stop it), then ask again.', 'helper_busy', 429);
    if (res.status === 401 || res.status === 403) throw new CoachError(refusedMessage(msg), 'auth', res.status);
    throw new CoachError(helperProblem(msg || `HTTP ${res.status}`), res.status >= 500 ? 'server' : 'unknown', res.status);
  }
  if (!res.body) throw new CoachError('The coach helper sent an empty reply.', 'server');

  let text = '';
  let end: { stopReason: string | null; model: string } | null = null;
  const handle = (line: string) => {
    const s = line.trim();
    if (!s || end) return;
    let ev: { type?: unknown; text?: unknown; stopReason?: unknown; model?: unknown; message?: unknown };
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
    } else if (ev.type === 'done') {
      end = { stopReason: typeof ev.stopReason === 'string' ? ev.stopReason : null, model: typeof ev.model === 'string' && ev.model ? ev.model : (model ?? '') };
    } else if (ev.type === 'error') {
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
