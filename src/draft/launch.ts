/*
 * ForgeCoach — draft/launch.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The client for mtg-table's match launcher: the local coach helper (the
 * same server as coachHelper.ts, port 8643) restarts the engine on two
 * decklists. It advertises itself as `match: 1` in GET /health; until a
 * helper says so, the page keeps its "Play this match" button disabled.
 *
 *   POST /match {deck:{name, main:[[n,name]…], sideboard:[[n,name]…]},
 *                aiDeck:{…same…}, aiProfile, games}
 *
 * The AI's deck travels to the engine and nowhere else: the page never shows
 * it (hidden information, as at a real table). `fetch` is injected for tests.
 */
import { mainDeck, sideboard, type DeckBuild } from '../cube/builder.ts';
import { pageHelperTarget, TOKEN_HEADER, type HelperTarget } from '../coachHelper.ts';

export interface MatchDeck {
  name: string;
  main: Array<[number, string]>;
  sideboard: Array<[number, string]>;
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
  aiProfile: AiProfile;
  /** 1 or 3 (best of). */
  games: 1 | 3;
}

type FetchFn = (input: string, init?: RequestInit) => Promise<Pick<Response, 'ok' | 'status' | 'json'>>;

export interface LaunchOptions {
  fetch?: FetchFn;
  target?: HelperTarget;
  timeoutMs?: number;
}

function counted(names: string[]): Array<[number, string]> {
  const m = new Map<string, number>();
  for (const n of names) m.set(n, (m.get(n) ?? 0) + 1);
  return [...m.entries()].map(([n, c]) => [c, n]);
}

/** A build plus its pool as the launcher's deck shape. */
export function matchDeck(name: string, b: DeckBuild, pool: string[]): MatchDeck {
  return { name, main: mainDeck(b), sideboard: counted(sideboard(b, pool)) };
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

/** Does the helper on this machine start matches? (GET /health says `match: 1`.) False when it is not running. */
export async function matchSupported(opts: LaunchOptions = {}): Promise<boolean> {
  const f = opts.fetch ?? ((u, i) => fetch(u, i));
  const t = opts.target ?? pageHelperTarget();
  const to = withTimeout(opts.timeoutMs ?? 1200);
  try {
    const res = await f(`${t.baseUrl}/health`, { headers: headers(t, false), signal: to.signal });
    if (!res.ok) return false;
    const j = (await res.json()) as { match?: unknown };
    return typeof j.match === 'number' && j.match >= 1;
  } catch {
    return false;
  } finally {
    to.done();
  }
}

export type LaunchResult = { ok: true; detail: string | null } | { ok: false; message: string };

/** Checks a request before it goes out: two 40+-card decks, a known profile, Bo1 or Bo3. */
export function checkRequest(r: MatchRequest): string | null {
  if (deckSize(r.deck) < 40) return `Your deck has ${deckSize(r.deck)} cards; a match needs 40.`;
  if (deckSize(r.aiDeck) < 40) return 'The AI’s deck is not complete.';
  if (!AI_PROFILES.some((p) => p.id === r.aiProfile)) return `Unknown AI profile ${r.aiProfile}.`;
  if (r.games !== 1 && r.games !== 3) return 'A match is one game or best of three.';
  return null;
}

/** POST /match. Resolves to what happened, in words the page can show (never the AI's list). */
export async function launchMatch(r: MatchRequest, opts: LaunchOptions = {}): Promise<LaunchResult> {
  const bad = checkRequest(r);
  if (bad) return { ok: false, message: bad };
  const f = opts.fetch ?? ((u, i) => fetch(u, i));
  const t = opts.target ?? pageHelperTarget();
  const to = withTimeout(opts.timeoutMs ?? 30_000);
  try {
    const res = await f(`${t.baseUrl}/match`, { method: 'POST', headers: headers(t, true), body: JSON.stringify(r), signal: to.signal });
    let body: { message?: unknown; detail?: unknown } = {};
    try {
      body = ((await res.json()) ?? {}) as typeof body;
    } catch {
      /* no body */
    }
    if (!res.ok) {
      const msg = typeof body.message === 'string' ? body.message : `HTTP ${res.status}`;
      if (res.status === 404) return { ok: false, message: 'This helper has no match launcher yet — update mtg-table.' };
      if (res.status === 401 || res.status === 403) return { ok: false, message: `The helper refused the match (${msg}).` };
      return { ok: false, message: `The match didn’t start: ${msg}.` };
    }
    return { ok: true, detail: typeof body.detail === 'string' ? body.detail : typeof body.message === 'string' ? body.message : null };
  } catch (e) {
    const aborted = e instanceof Error && e.name === 'AbortError';
    return { ok: false, message: aborted ? 'The helper took too long to start the match.' : 'Couldn’t reach the helper on this computer (is ./scripts/play.sh running?).' };
  } finally {
    to.done();
  }
}
