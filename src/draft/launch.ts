/*
 * ForgeCoach — draft/launch.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The client for mtg-table's match launcher (mtg-table docs/match-launcher.md,
 * decision D303, amendment M53): the local coach helper (port 8643, the same
 * server as coachHelper.ts) restarts the engine on two decklists.
 *
 *   GET  /health  → {…, match: 0 | 1, aiPolicies?: [...], aiSearchMs?: {min,max,default}}
 *   POST /match   {deck:{name, main:[[n,card]…], sideboard?}, aiDeck:{…},
 *                  aiProfile?, games?: 1..9, aiPolicy?, aiSearchMs?}
 *                 → 200 {ok:true, yourDeck:{name,path,cards}, aiDeck:{name,cards},
 *                        aiProfile, aiPolicy?, games, ms, warnings[]}
 *                 → {ok:false, message, problems?[] (400), restored? (502)}
 *
 *   POST /engine/start (D308) → the /match 200 shape + {already}, or a refusal
 *                      body (D381, only when /health has `engine_start_profile: 1`):
 *                      none, or {"aiProfile"} — the last setup with that AI profile;
 *                      a running engine answers {already: true} and, for another
 *                      profile than its own, a warning (nothing restarts);
 *                      (D414, only with `engine_start_policy: 1`) {"aiPolicy"} too
 *
 * The opponent AI (mtg-table D333, over D314's `--ai-policy`): Forge's own AI,
 * Forge with the sacrifice-outlet policy (D310), or the search AI (D312). The
 * page offers the choice only when /health advertises `aiPolicies`; with an
 * older helper the request carries no `aiPolicy` and the engine plays as
 * play.sh started it. Since mtg-table D414 the pickers start on the search AI
 * (search-v2) whenever it is offered (`defaultPolicy`); plain Forge is one tap
 * away, and a choice the helper does not offer falls back to plain.
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

/** The AI seat's controller (mtg-table D314 `--ai-policy`, D333 on the launcher). */
export type AiPolicy = 'plain' | 'outlets' | 'search';

export const AI_POLICIES: Array<{ id: AiPolicy; label: string; blurb: string }> = [
  { id: 'plain', label: 'Forge', blurb: 'Forge’s own AI, as always. Answers at once.' },
  {
    id: 'outlets',
    label: 'Forge + sacrifice play',
    blurb: 'Forge’s AI plus a sacrifice-outlet rule: it sacrifices creatures that would die anyway and goes all in when that is lethal. As fast as Forge.',
  },
  {
    id: 'search',
    label: 'Search AI (stronger, slower)',
    blurb:
      'Sacrifice play plus a look-ahead at its main-phase plays, attacks and blocks. Thinks about 1–3 s per decision, so games run slower. The default (search-v2): against Forge’s own AI it won 60% of 1,200 games in mtg-table’s tests. It never sees your hand or library: it guesses them.',
  },
];

/** The search budget's limits as the launcher takes them (ms per searched decision). */
export interface SearchBudget {
  min: number;
  max: number;
  default: number;
}

export interface MatchRequest {
  deck: MatchDeck;
  aiDeck: MatchDeck;
  aiProfile?: AiProfile;
  /** 1..9, default 3. */
  games?: number;
  /** Absent: the AI play.sh was started with. Send only when /health lists it. */
  aiPolicy?: AiPolicy;
  /** Only with `aiPolicy: 'search'`; 500..5000. */
  aiSearchMs?: number;
}

export interface MatchStarted {
  ok: true;
  yourDeck: { name: string; path: string; cards: number };
  aiDeck: { name: string; cards: number };
  aiProfile: string;
  /** D333: the policy the engine started with; absent from an older helper. */
  aiPolicy?: string | null;
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
  /** POST /engine/start takes `{"aiProfile"}` (D381, `engine_start_profile: 1`): plain Play vs Forge can pick the AI profile. */
  canPickProfile?: boolean;
  /** POST /engine/start takes `{"aiPolicy"}` (mtg-table D414, `engine_start_policy: 1`): plain Play vs Forge can pick the opponent AI. */
  canPickPolicy?: boolean;
  /** The opponent AIs POST /match takes (D333 `aiPolicies`, known ids only); empty: an older helper, no choice. */
  aiPolicies: AiPolicy[];
  /** The search budget's limits (D333 `aiSearchMs`), when advertised and sane. */
  aiSearchMs?: SearchBudget;
}

const isPolicy = (x: unknown): x is AiPolicy => AI_POLICIES.some((p) => p.id === x);

/** The opponent AIs a /health body advertises: known ids, in our order, or none. */
export function advertisedPolicies(j: { aiPolicies?: unknown }): AiPolicy[] {
  if (!Array.isArray(j.aiPolicies)) return [];
  const got = new Set(j.aiPolicies.filter(isPolicy));
  // A choice needs plain Forge in it: without it the helper is not one we understand.
  if (!got.has('plain')) return [];
  return AI_POLICIES.map((p) => p.id).filter((id) => got.has(id));
}

/** The search budget a /health body advertises, when it is a sane range. */
export function advertisedSearchBudget(j: { aiSearchMs?: unknown }): SearchBudget | undefined {
  const b = j.aiSearchMs as Partial<SearchBudget> | null | undefined;
  if (!b || typeof b !== 'object') return undefined;
  const { min, max, default: def } = b;
  if (![min, max, def].every((n) => Number.isInteger(n))) return undefined;
  if (!(min! > 0 && min! <= def! && def! <= max!)) return undefined;
  return { min: min!, max: max!, default: def! };
}

/**
 * The request fields for the chosen opponent: nothing when the helper offers no
 * choice (an older helper: the engine plays as play.sh started it), else the
 * policy, falling back to plain Forge if the chosen one is not offered.
 */
export function policyFields(choice: AiPolicy, health: Pick<EngineHealth, 'aiPolicies'>): Pick<MatchRequest, 'aiPolicy'> {
  if (health.aiPolicies.length === 0) return {};
  return { aiPolicy: effectivePolicy(choice, health) };
}

/**
 * The opponent a picker starts on (mtg-table D414): the search AI (search-v2)
 * whenever the helper offers it, else plain Forge. Plain stays one tap away.
 */
export const DEFAULT_POLICY: AiPolicy = 'search';
export function defaultPolicy(health: Pick<EngineHealth, 'aiPolicies'> | null | undefined): AiPolicy {
  return health?.aiPolicies.includes(DEFAULT_POLICY) ? DEFAULT_POLICY : 'plain';
}

/** What a choice becomes on this helper: itself when offered, else plain Forge (as `policyFields` sends). */
export function effectivePolicy(choice: AiPolicy, health: Pick<EngineHealth, 'aiPolicies'>): AiPolicy {
  return health.aiPolicies.includes(choice) ? choice : 'plain';
}

/** GET /health, read for the launcher and the engine (`match`, `engine`, `engine_start` are there whether `ok` is true or false). */
export async function engineHealth(opts: LaunchOptions = {}): Promise<EngineHealth> {
  const f = opts.fetch ?? ((u, i) => fetch(u, i));
  const t = opts.target ?? pageHelperTarget();
  const to = withTimeout(opts.timeoutMs ?? 1500);
  try {
    const res = await f(`${t.baseUrl}/health`, { headers: headers(t, false), signal: to.signal });
    let j: { match?: unknown; engine?: unknown; engine_start?: unknown; engine_start_profile?: unknown; engine_start_policy?: unknown; aiPolicies?: unknown; aiSearchMs?: unknown } = {};
    try {
      j = ((await res.json()) ?? {}) as typeof j;
    } catch {
      /* no body */
    }
    if (j.match !== 1) return { status: 'no-launcher', canWake: false, aiPolicies: [] };
    // No `engine` key: an older helper, whose engine runs whenever the helper does.
    const aiPolicies = advertisedPolicies(j);
    const aiSearchMs = aiPolicies.includes('search') ? advertisedSearchBudget(j) : undefined;
    const canWake = j.engine_start === 1;
    return {
      status: j.engine === 'idle' ? 'asleep' : 'ready',
      canWake,
      ...(canWake && j.engine_start_profile === 1 ? { canPickProfile: true } : {}),
      // D414: only with a policy list we understand (plain in it), so the choice can fall back to plain.
      ...(canWake && j.engine_start_policy === 1 && aiPolicies.length > 0 ? { canPickPolicy: true } : {}),
      aiPolicies,
      ...(aiSearchMs ? { aiSearchMs } : {}),
    };
  } catch {
    return { status: 'down', canWake: false, aiPolicies: [] };
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
  if (r.aiPolicy !== undefined && !isPolicy(r.aiPolicy)) return `Unknown opponent AI ${String(r.aiPolicy)}.`;
  if (r.aiSearchMs !== undefined) {
    if (r.aiPolicy !== 'search') return 'A thinking time goes only with the search AI.';
    if (!Number.isInteger(r.aiSearchMs) || r.aiSearchMs < 500 || r.aiSearchMs > 5000) return 'The search AI thinks 0.5 to 5 seconds per decision.';
  }
  return null;
}

const STATUS_WORDS: Record<number, string> = {
  403: 'The engine on your PC refused this page (its address or pairing token).',
  409: 'A match is already being started — wait a moment.',
  413: 'The decks are too large to send.',
  503: 'The engine on your PC has no match launcher: start ForgeCoach again (the app-menu launcher, or ./scripts/play.sh).',
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
          ? 'The engine on your PC didn’t answer within three minutes.'
          : 'Couldn’t reach the engine on your PC: start ForgeCoach again (the app-menu launcher, or ./scripts/play.sh).',
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

export const isAiProfile = (x: unknown): x is AiProfile => AI_PROFILES.some((p) => p.id === x);

/**
 * POST /engine/start (D308): wake a sleeping engine on the last match setup.
 * With `aiProfile` (D381; send it only to a helper whose /health says
 * `engine_start_profile: 1`) the AI plays that profile; no deck is named or
 * sent. Never throws.
 */
export async function wakeEngine(opts: LaunchOptions & { aiProfile?: AiProfile | null; aiPolicy?: AiPolicy | null } = {}): Promise<WakeResult> {
  const ask = { ...(opts.aiProfile ? { aiProfile: opts.aiProfile } : {}), ...(opts.aiPolicy ? { aiPolicy: opts.aiPolicy } : {}) };
  const p = await post('/engine/start', Object.keys(ask).length ? JSON.stringify(ask) : undefined, opts);
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
 *
 * `aiProfile` (D381) goes only to a helper that takes it (`canPickProfile`);
 * to an older one the wake has no body, as before. With a profile picked and
 * the engine already running, the request still goes out — nothing restarts —
 * so its warning that the running match keeps its own profile reaches the
 * player. `profileSent` says whether the profile went to the helper.
 *
 * `aiPolicy` (mtg-table D414) goes the same way, only to a helper with
 * `canPickPolicy`, as `effectivePolicy` makes it (plain when the helper does
 * not offer the choice): with the engine running, its warning says the running
 * match keeps its own AI. `policySent` says whether it went.
 */
export async function ensureEngineAwake(
  opts: LaunchOptions & { onWaking?: () => void; aiProfile?: AiProfile | null; aiPolicy?: AiPolicy | null } = {},
): Promise<(EngineWoken & { woke: boolean; profileSent: boolean; policySent: boolean }) | MatchRefused> {
  const h = await engineHealth({ ...opts, timeoutMs: 1500 });
  const aiProfile = opts.aiProfile && h.canPickProfile ? opts.aiProfile : null;
  const aiPolicy = opts.aiPolicy && h.canPickPolicy ? effectivePolicy(opts.aiPolicy, h) : null;
  const asks = aiProfile !== null || aiPolicy !== null;
  if (!h.canWake || (h.status !== 'asleep' && !(h.status === 'ready' && asks))) return { ok: true, already: true, warnings: [], woke: false, profileSent: false, policySent: false };
  if (h.status === 'asleep') opts.onWaking?.();
  const r = await wakeEngine({ ...opts, aiProfile, aiPolicy });
  return r.ok ? { ...r, woke: !r.already, profileSent: aiProfile !== null, policySent: aiPolicy !== null } : r;
}
