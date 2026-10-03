/*
 * ForgeCoach — draft/launch.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The client for mtg-table's match launcher (mtg-table docs/match-launcher.md,
 * decision D303, amendment M53): the local coach helper (port 8643, the same
 * server as coachHelper.ts) restarts the engine on two decklists.
 *
 *   GET  /health  → {…, match: 0 | 1}
 *   POST /match   {deck:{name, main:[[n,card]…], sideboard?}, aiDeck:{…},
 *                  aiProfile?, games?: 1..9}
 *                 → 200 {ok:true, yourDeck:{name,path,cards}, aiDeck:{name,cards},
 *                        aiProfile, games, ms, warnings[]}
 *                 → {ok:false, message, problems?[] (400), restored? (502)}
 *
 *   POST /engine/start (D308) → the /match 200 shape + {already}, or a refusal
 *
 * Since D308 the engine can be asleep: play.sh and the helper stay up, nothing
 * listens on the seat port, and /health says `engine: "idle"` (and
 * `engine_start: 1` when /engine/start exists). POST /match wakes it by itself;
 * plain Play vs Forge wakes it with /engine/start before taking the seat. A
 * missing `engine` key is an older helper: running.
 *
 * The engine restart closes the seat's /ws socket; after a 200 the page takes
 * the seat again and the next hello_ok is the new match. The AI's deck goes to
 * the engine and nowhere else: the page never shows it (hidden information),
 * and its name is its archetype, never a card in it. `fetch` is injected for
 * tests.
 */
import { pageHelperTarget, TOKEN_HEADER, type HelperTarget } from '../coachHelper.ts';

export type DeckEntry = [count: number, cardName: string];

export interface MatchDeck {
  name: string;
  main: DeckEntry[];
  sideboard?: DeckEntry[];
}

export type AiProfile = 'Default' | 'Cautious' | 'Reckless' | 'Experimental';

export const AI_PROFILES: Array<{ id: AiProfile; blurb: string }> = [
  { id: 'Default', blurb: 'Balanced play.' },
  { id: 'Cautious', blurb: 'Prefers defence and card advantage.' },
  { id: 'Reckless', blurb: 'Aggressive; attacks often.' },
  { id: 'Experimental', blurb: 'Unpredictable heuristics.' },
];

export interface MatchRequest {
  deck: MatchDeck;
  aiDeck: MatchDeck;
  aiProfile?: AiProfile;
  /** 1..9, default 3. */
  games?: number;
}

export interface MatchStarted {
  ok: true;
  yourDeck: { name: string; path: string; cards: number };
  aiDeck: { name: string; cards: number };
  aiProfile: string;
  games: number;
  ms: number;
  warnings: string[];
}

export interface MatchRefused {
  ok: false;
  /** HTTP status, or 0 when the helper could not be reached. */
  status: number;
  message: string;
  problems?: string[];
  /** 502: the previous match is running again. */
  restored?: boolean;
}

export type LaunchResult = MatchStarted | MatchRefused;

type FetchFn = (input: string, init?: RequestInit) => Promise<Pick<Response, 'ok' | 'status' | 'json'>>;

export interface LaunchOptions {
  fetch?: FetchFn;
  target?: HelperTarget;
  timeoutMs?: number;
  /** Cancels the request (the user pressed Cancel). */
  signal?: AbortSignal;
}

export const MIN_MAIN = 40;
export const MAX_MAIN = 250;
/** The launcher answers within 180 s; a little more for the network. */
export const LAUNCH_TIMEOUT_MS = 185_000;

const NAME_OK = /^[A-Za-z0-9][A-Za-z0-9 '’,.!?&()+:/_-]*$/;

/** A deck name the launcher accepts: allowed characters only, single spaces, 1–80 characters. */
export function safeDeckName(s: string, fallback = 'Cube draft'): string {
  let n = s
    .replace(/[—–·•|]/g, '-')
    .replace(/[^A-Za-z0-9 '’,.!?&()+:/_-]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/(\s-)+\s/g, ' - ')
    .trim()
    .replace(/^[^A-Za-z0-9]+/, '')
    .slice(0, 80)
    .trim();
  if (!NAME_OK.test(n)) n = fallback;
  return n;
}

export const deckSize = (d: Pick<MatchDeck, 'main'>) => d.main.reduce((s, [n]) => s + n, 0);

function headers(t: HelperTarget, json: boolean): Record<string, string> {
  const h: Record<string, string> = {};
  if (json) h['Content-Type'] = 'application/json';
  if (t.token) h[TOKEN_HEADER] = t.token;
  return h;
}

function withTimeout(ms: number, outer?: AbortSignal): { signal: AbortSignal | undefined; done: () => void } {
  if (typeof AbortController === 'undefined') return { signal: outer, done: () => undefined };
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  const stop = () => c.abort();
  if (outer) {
    if (outer.aborted) c.abort();
    else outer.addEventListener('abort', stop, { once: true });
  }
  return {
    signal: c.signal,
    done: () => {
      clearTimeout(t);
      outer?.removeEventListener('abort', stop);
    },
  };
}

/**
 * What the helper on this machine says: running with a launcher and an engine,
 * with a launcher and the engine asleep (D308), running without a launcher, or
 * not answering.
 */
export type LauncherStatus = 'ready' | 'asleep' | 'no-launcher' | 'down';

export interface EngineHealth {
  status: LauncherStatus;
  /** POST /engine/start exists (`engine_start: 1`). */
  canWake: boolean;
}

/** GET /health, read for the launcher and the engine (`match`, `engine`, `engine_start` are there whether `ok` is true or false). */
export async function engineHealth(opts: LaunchOptions = {}): Promise<EngineHealth> {
  const f = opts.fetch ?? ((u, i) => fetch(u, i));
  const t = opts.target ?? pageHelperTarget();
  const to = withTimeout(opts.timeoutMs ?? 1500);
  try {
    const res = await f(`${t.baseUrl}/health`, { headers: headers(t, false), signal: to.signal });
    let j: { match?: unknown; engine?: unknown; engine_start?: unknown } = {};
    try {
      j = ((await res.json()) ?? {}) as typeof j;
    } catch {
      /* no body */
    }
    if (j.match !== 1) return { status: 'no-launcher', canWake: false };
    // No `engine` key: an older helper, whose engine runs whenever the helper does.
    return { status: j.engine === 'idle' ? 'asleep' : 'ready', canWake: j.engine_start === 1 };
  } catch {
    return { status: 'down', canWake: false };
  } finally {
    to.done();
  }
}

export async function launcherStatus(opts: LaunchOptions = {}): Promise<LauncherStatus> {
  return (await engineHealth(opts)).status;
}

/** Does the helper start matches? (GET /health says `match: 1`; an asleep engine counts, POST /match wakes it.) */
export async function matchSupported(opts: LaunchOptions = {}): Promise<boolean> {
  const s = await launcherStatus(opts);
  return s === 'ready' || s === 'asleep';
}

/** Checks a request before it goes out, with the launcher's own limits. */
export function checkRequest(r: MatchRequest): string | null {
  for (const [who, d] of [
    ['Your deck', r.deck],
    ['The AI’s deck', r.aiDeck],
  ] as const) {
    const n = deckSize(d);
    if (n < MIN_MAIN) return `${who} has ${n} cards; a match needs ${MIN_MAIN}.`;
    if (n > MAX_MAIN) return `${who} has ${n} cards; the most is ${MAX_MAIN}.`;
    if (!NAME_OK.test(d.name) || d.name.length > 80 || / {2}/.test(d.name)) return `${who}’s name “${d.name}” has characters the launcher doesn’t take.`;
  }
  if (r.aiProfile && !AI_PROFILES.some((p) => p.id === r.aiProfile)) return `Unknown AI profile ${r.aiProfile}.`;
  if (r.games !== undefined && (!Number.isInteger(r.games) || r.games < 1 || r.games > 9)) return 'A match is 1 to 9 games.';
  return null;
}

const STATUS_WORDS: Record<number, string> = {
  403: 'The helper refused this page (origin or pairing token).',
  409: 'A match is already being started — wait a moment.',
  413: 'The decks are too large to send.',
  503: 'The helper has no match launcher: start ForgeCoach again (the app-menu launcher, or ./scripts/play.sh).',
  504: 'The engine took more than three minutes to start.',
};

type Parsed = { res: { ok: boolean; status: number }; body: Record<string, unknown> };

async function post(path: string, body: string | undefined, opts: LaunchOptions): Promise<Parsed | MatchRefused> {
  const f = opts.fetch ?? ((u, i) => fetch(u, i));
  const t = opts.target ?? pageHelperTarget();
  const to = withTimeout(opts.timeoutMs ?? LAUNCH_TIMEOUT_MS, opts.signal);
  try {
    const res = await f(`${t.baseUrl}${path}`, { method: 'POST', headers: headers(t, body !== undefined), body, signal: to.signal });
    let parsed: Record<string, unknown> = {};
    try {
      parsed = ((await res.json()) ?? {}) as Record<string, unknown>;
    } catch {
      /* no body */
    }
    return { res, body: parsed };
  } catch (e) {
    const aborted = e instanceof Error && e.name === 'AbortError';
    return {
      ok: false,
      status: 0,
      message: opts.signal?.aborted
        ? 'Cancelled.'
        : aborted
          ? 'The helper didn’t answer within three minutes.'
          : 'Couldn’t reach the helper on this computer: start ForgeCoach again (the app-menu launcher, or ./scripts/play.sh).',
    };
  } finally {
    to.done();
  }
}

function refused(status: number, body: Record<string, unknown>, fallback: string): MatchRefused {
  const message = typeof body.message === 'string' && body.message ? body.message : (STATUS_WORDS[status] ?? fallback);
  const out: MatchRefused = { ok: false, status, message: status === 503 || status === 504 ? (STATUS_WORDS[status] ?? message) : message };
  if (Array.isArray(body.problems)) out.problems = body.problems.filter((p): p is string => typeof p === 'string');
  if (typeof body.restored === 'boolean') out.restored = body.restored;
  return out;
}

const warningsOf = (b: Record<string, unknown>): string[] => (Array.isArray(b.warnings) ? b.warnings.filter((w): w is string => typeof w === 'string') : []);

/** POST /match. Resolves to what happened (never throws). */
export async function launchMatch(r: MatchRequest, opts: LaunchOptions = {}): Promise<LaunchResult> {
  const bad = checkRequest(r);
  if (bad) return { ok: false, status: 0, message: bad };
  const p = await post('/match', JSON.stringify(r), opts);
  if ('ok' in p) return p;
  const { res, body } = p;
  if (res.ok && body.ok === true) return { ...(body as unknown as MatchStarted), warnings: warningsOf(body) };
  return refused(res.status, body, `The match didn’t start (HTTP ${res.status}).`);
}

/** POST /engine/start's 200: the engine runs (woken now, or `already` running). */
export interface EngineWoken {
  ok: true;
  already: boolean;
  warnings: string[];
  ms?: number;
}

export type WakeResult = EngineWoken | MatchRefused;

/** POST /engine/start (D308): wake a sleeping engine on the last match setup. Never throws. */
export async function wakeEngine(opts: LaunchOptions = {}): Promise<WakeResult> {
  const p = await post('/engine/start', undefined, opts);
  if ('ok' in p) return p;
  const { res, body } = p;
  if (res.ok && body.ok === true) return { ok: true, already: body.already === true, warnings: warningsOf(body), ms: typeof body.ms === 'number' ? body.ms : undefined };
  return refused(res.status, body, `The engine didn’t start (HTTP ${res.status}).`);
}

/**
 * Before Play vs Forge takes the seat: when the helper says the engine is
 * asleep and can be woken, wake it (`onWaking` first, for a "Waking the
 * engine…" state). Anything else — running, an older helper, no helper, no
 * launcher — resolves `{ok: true, woke: false}` at once and the page simply
 * connects, as before D308.
 */
export async function ensureEngineAwake(opts: LaunchOptions & { onWaking?: () => void } = {}): Promise<(EngineWoken & { woke: boolean }) | MatchRefused> {
  const h = await engineHealth({ ...opts, timeoutMs: 1500 });
  if (h.status !== 'asleep' || !h.canWake) return { ok: true, already: true, warnings: [], woke: false };
  opts.onWaking?.();
  const r = await wakeEngine(opts);
  return r.ok ? { ...r, woke: !r.already } : r;
}
