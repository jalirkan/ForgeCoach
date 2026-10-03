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
 * The engine restart closes the seat's /ws socket; after a 200 the page takes
 * the seat again and the next hello_ok is the new match. The AI's deck goes to
 * the engine and nowhere else: the page never shows it (hidden information),
 * and its name is its archetype, never a card in it. `fetch` is injected for
 * tests.
 */
import { mainDeck, sideboard, type DeckBuild } from '../cube/builder.ts';
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

function counted(names: string[]): DeckEntry[] {
  const m = new Map<string, number>();
  for (const n of names) m.set(n, (m.get(n) ?? 0) + 1);
  return [...m.entries()].map(([n, c]) => [c, n]);
}

/** A build plus its pool as the launcher's deck shape (the AI's deck: named by its archetype). */
export function matchDeck(name: string, b: DeckBuild, pool: string[]): MatchDeck {
  return { name: safeDeckName(name), main: mainDeck(b), sideboard: counted(sideboard(b, pool)) };
}

export const deckSize = (d: Pick<MatchDeck, 'main'>) => d.main.reduce((s, [n]) => s + n, 0);

function headers(t: HelperTarget, json: boolean): Record<string, string> {
  const h: Record<string, string> = {};
  if (json) h['Content-Type'] = 'application/json';
  if (t.token) h[TOKEN_HEADER] = t.token;
  return h;
}

function withTimeout(ms: number): { signal: AbortSignal | undefined; done: () => void } {
  if (typeof AbortController === 'undefined') return { signal: undefined, done: () => undefined };
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  return { signal: c.signal, done: () => clearTimeout(t) };
}

/** What the helper on this machine says: running with a launcher, running without one, or not answering. */
export type LauncherStatus = 'ready' | 'no-launcher' | 'down';

export async function launcherStatus(opts: LaunchOptions = {}): Promise<LauncherStatus> {
  const f = opts.fetch ?? ((u, i) => fetch(u, i));
  const t = opts.target ?? pageHelperTarget();
  const to = withTimeout(opts.timeoutMs ?? 1500);
  try {
    const res = await f(`${t.baseUrl}/health`, { headers: headers(t, false), signal: to.signal });
    let j: { match?: unknown } = {};
    try {
      j = ((await res.json()) ?? {}) as { match?: unknown };
    } catch {
      /* no body */
    }
    // `match` is there whether `ok` is true or false: read it on both.
    return j.match === 1 ? 'ready' : 'no-launcher';
  } catch {
    return 'down';
  } finally {
    to.done();
  }
}

/** Does the helper start matches? (GET /health says `match: 1`.) */
export async function matchSupported(opts: LaunchOptions = {}): Promise<boolean> {
  return (await launcherStatus(opts)) === 'ready';
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

/** POST /match. Resolves to what happened (never throws). */
export async function launchMatch(r: MatchRequest, opts: LaunchOptions = {}): Promise<LaunchResult> {
  const bad = checkRequest(r);
  if (bad) return { ok: false, status: 0, message: bad };
  const f = opts.fetch ?? ((u, i) => fetch(u, i));
  const t = opts.target ?? pageHelperTarget();
  const to = withTimeout(opts.timeoutMs ?? LAUNCH_TIMEOUT_MS);
  try {
    const res = await f(`${t.baseUrl}/match`, { method: 'POST', headers: headers(t, true), body: JSON.stringify(r), signal: to.signal });
    let body: Record<string, unknown> = {};
    try {
      body = ((await res.json()) ?? {}) as Record<string, unknown>;
    } catch {
      /* no body */
    }
    if (res.ok && body.ok === true) {
      const b = body as unknown as MatchStarted;
      return { ...b, warnings: Array.isArray(b.warnings) ? b.warnings.filter((w) => typeof w === 'string') : [] };
    }
    const message = typeof body.message === 'string' && body.message ? body.message : (STATUS_WORDS[res.status] ?? `The match didn’t start (HTTP ${res.status}).`);
    const out: MatchRefused = { ok: false, status: res.status, message: res.status === 503 || res.status === 504 ? (STATUS_WORDS[res.status] ?? message) : message };
    if (Array.isArray(body.problems)) out.problems = body.problems.filter((p): p is string => typeof p === 'string');
    if (typeof body.restored === 'boolean') out.restored = body.restored;
    return out;
  } catch (e) {
    const aborted = e instanceof Error && e.name === 'AbortError';
    return {
      ok: false,
      status: 0,
      message: aborted ? 'The helper didn’t answer within three minutes.' : 'Couldn’t reach the helper on this computer: start ForgeCoach again (the app-menu launcher, or ./scripts/play.sh).',
    };
  } finally {
    to.done();
  }
}
