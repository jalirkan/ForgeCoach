/*
 * ForgeCoach — watch/client.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The coach helper's /watch routes (mtg-table D440, docs/watch-bots.md):
 *
 *   GET  /health                "watch": 1 when it can run one, "watchRunning"
 *   POST /watch                 202 {id, seed, state, game} | 409 {code: "busy", running} | 400 | 503
 *   GET  /watch                 {running, watches: [...]}
 *   GET  /watch/<id>            {id, running, match, draft}
 *   GET  /watch/<id>/game/<n>   the game's frame log, complete lines; live.ts's
 *                               HTTP follower polls it with Range (206/416)
 *   POST /watch/<id>/stop       {stopping: true} | 409 {code: "not-running"}
 *
 * The same helper and door as /review and /match (coachHelper.ts's target:
 * the base URL and, on a LAN page, the pairing token as a header — or, for
 * the game log, which live.ts fetches with only a Range header, as `?token=`,
 * which the route also takes). Never the seat: the games are followed over
 * HTTP, read-only (CLAUDE.md's seat rule). `fetch` is injected for tests.
 */
import { pageHelperTarget, TOKEN_HEADER, type HelperTarget } from '../coachHelper.ts';
import { watchCapsOf, type WatchBody, type WatchCaps } from './choices.ts';
import { parseWatchList, parseWatchState, type WatchListEntry, type WatchState } from './data.ts';

export type WatchFetch = (url: string, init?: RequestInit) => Promise<Pick<Response, 'ok' | 'status' | 'json'>>;

export interface WatchClientOptions {
  fetch?: WatchFetch;
  target?: HelperTarget;
  timeoutMs?: number;
}

const ID = /^watch-[A-Za-z0-9._-]{1,120}$/;

function headers(t: HelperTarget, json: boolean): Record<string, string> {
  const h: Record<string, string> = {};
  if (json) h['Content-Type'] = 'application/json';
  if (t.token) h[TOKEN_HEADER] = t.token;
  return h;
}

async function call(path: string, init: RequestInit, o: WatchClientOptions): Promise<{ status: number; body: unknown } | { status: 0; body: null }> {
  const f = o.fetch ?? ((u, i) => fetch(u, i));
  const t = o.target ?? pageHelperTarget();
  const c = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = c ? setTimeout(() => c.abort(), o.timeoutMs ?? 8000) : null;
  try {
    const res = await f(`${t.baseUrl}${path}`, { ...init, headers: headers(t, init.method === 'POST'), ...(c ? { signal: c.signal } : {}), cache: 'no-store' });
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      /* not JSON */
    }
    return { status: res.status, body };
  } catch {
    return { status: 0, body: null };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const UNREACHABLE = 'Couldn’t reach the engine on your PC: start ForgeCoach again (the app-menu launcher, or ./scripts/play.sh).';

function messageOf(body: unknown, fallback: string): string {
  const m = body && typeof body === 'object' ? (body as { message?: unknown }).message : null;
  return typeof m === 'string' && m.trim() ? m.trim().slice(0, 400) : fallback;
}

/** GET /health, read for the watch (never throws; a missing helper is no watch). */
export async function watchCaps(o: WatchClientOptions = {}): Promise<WatchCaps> {
  const r = await call('/health', { method: 'GET' }, { timeoutMs: 1500, ...o });
  return watchCapsOf(r.body);
}

export type StartResult =
  | { ok: true; id: string; seed: number | null }
  | { ok: false; status: number; message: string; busy?: string };

export async function startWatch(body: WatchBody, o: WatchClientOptions = {}): Promise<StartResult> {
  const r = await call('/watch', { method: 'POST', body: JSON.stringify(body) }, o);
  const b = (r.body ?? {}) as { ok?: unknown; id?: unknown; seed?: unknown; code?: unknown; running?: unknown };
  if (r.status === 202 && b.ok === true && typeof b.id === 'string' && ID.test(b.id)) {
    return { ok: true, id: b.id, seed: typeof b.seed === 'number' && Number.isInteger(b.seed) ? b.seed : null };
  }
  if (r.status === 0) return { ok: false, status: 0, message: UNREACHABLE };
  if (r.status === 409 && b.code === 'busy' && typeof b.running === 'string' && ID.test(b.running)) {
    return { ok: false, status: 409, message: 'Another watch is running on your PC: one at a time.', busy: b.running };
  }
  if (r.status === 503) return { ok: false, status: 503, message: messageOf(r.body, 'The engine on your PC can’t run a watch right now.') };
  return { ok: false, status: r.status, message: messageOf(r.body, `The engine refused the watch (HTTP ${r.status}).`) };
}

export type GetResult = { ok: true; state: WatchState } | { ok: false; status: number; message: string };

export async function getWatch(id: string, o: WatchClientOptions = {}): Promise<GetResult> {
  if (!ID.test(id)) return { ok: false, status: 400, message: 'That isn’t a watch.' };
  const r = await call(`/watch/${encodeURIComponent(id)}`, { method: 'GET' }, o);
  if (r.status === 0) return { ok: false, status: 0, message: UNREACHABLE };
  if (r.status === 404) return { ok: false, status: 404, message: 'The engine on your PC has no such watch: it may have been replaced by a newer watch of the same cube and seed.' };
  if (r.status !== 200) return { ok: false, status: r.status, message: messageOf(r.body, `HTTP ${r.status}`) };
  try {
    return { ok: true, state: parseWatchState(r.body) };
  } catch (e) {
    return { ok: false, status: 200, message: e instanceof Error ? e.message : String(e) };
  }
}

export async function listWatches(o: WatchClientOptions = {}): Promise<{ running: string | null; watches: WatchListEntry[] } | null> {
  const r = await call('/watch', { method: 'GET' }, o);
  if (r.status !== 200) return null;
  try {
    return parseWatchList(r.body);
  } catch {
    return null;
  }
}

export async function stopWatch(id: string, o: WatchClientOptions = {}): Promise<{ ok: boolean; message: string }> {
  if (!ID.test(id)) return { ok: false, message: 'That isn’t a watch.' };
  const r = await call(`/watch/${encodeURIComponent(id)}/stop`, { method: 'POST' }, o);
  if (r.status === 200) return { ok: true, message: 'Stopping…' };
  if (r.status === 409) return { ok: true, message: 'It had already ended.' };
  if (r.status === 0) return { ok: false, message: UNREACHABLE };
  return { ok: false, message: messageOf(r.body, `HTTP ${r.status}`) };
}

/**
 * The game log's URL for live.ts's HTTP follower. The pairing token, when
 * this page has one, rides as `?token=` (the follower sends only a Range
 * header); show it with `redactSeatUrl`.
 */
export function gameLogUrl(id: string, n: number, target: HelperTarget = pageHelperTarget()): string {
  const q = target.token ? `?token=${encodeURIComponent(target.token)}` : '';
  return `${target.baseUrl}/watch/${encodeURIComponent(id)}/game/${n}${q}`;
}

/** Wait for GET /watch to say nothing runs (after a stop), up to `ms`. */
export async function waitIdle(o: WatchClientOptions & { ms?: number; every?: number; sleep?: (ms: number) => Promise<void> } = {}): Promise<boolean> {
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const until = Date.now() + (o.ms ?? 20_000);
  while (Date.now() < until) {
    const l = await listWatches(o);
    if (l && l.running === null) return true;
    await sleep(o.every ?? 700);
  }
  return false;
}
