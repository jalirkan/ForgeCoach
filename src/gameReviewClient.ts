/*
 * ForgeCoach — gameReviewClient.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The client for the coach helper's engine review (mtg-table
 * docs/game-review.md § "/review on the coach helper", D353):
 *
 *   GET  /health        → {…, review: 1} when the helper can run reviews
 *   POST /review        {gameId, seat?, oppPool?, oppKnown?, deepK?, triageS?, deepS?}
 *                       → 202 {ok:true, id, state:"queued", position}
 *   GET  /review/<id>   → {ok:true, id, state: queued|running|done|failed,
 *                          position?, stage?: plan|triage|deepen|report,
 *                          startedAt?, endedAt?, error?, report?}
 *   refusals            → {ok:false, type:"error", message} with 400 / 404 /
 *                          405 / 413 / 429 / 503
 *
 * The same helper and gate as /coach and /match (coachHelper.ts's target: the
 * base URL and, on a LAN-served page, the pairing token header). The AI's deck
 * is never sent: the request has no field for it. `fetch` and the clock are
 * injected for tests; DOM-free.
 */
import { pageHelperTarget, TOKEN_HEADER, type HelperTarget } from './coachHelper.ts';
import { parseReviewReport, ReviewReportError, type ReviewReport } from './gameReview.ts';
import { cleanText, int, parseTime } from './lab/status.ts';

export type ReviewFetch = (url: string, init?: RequestInit) => Promise<Pick<Response, 'ok' | 'status' | 'json'>>;

export interface ReviewRequest {
  gameId: string;
  seat?: number;
  /** The cube list, as [count, card name] (at least 80 cards). */
  oppPool?: [number, string][];
  /** AI picks the player saw (at most 60 names). */
  oppKnown?: string[];
  deepK?: number;
  triageS?: number;
  deepS?: number;
}

export type ReviewState = 'queued' | 'running' | 'done' | 'failed';
export type ReviewStage = 'plan' | 'triage' | 'deepen' | 'report';

export interface ReviewStarted {
  ok: true;
  id: string;
  state: ReviewState;
  position: number | null;
}

export interface ReviewJob {
  ok: true;
  id: string;
  state: ReviewState;
  position: number | null;
  stage: ReviewStage | null;
  startedAt: Date | null;
  endedAt: Date | null;
  error: string | null;
  /** Once `done`: the validated report (null if it was missing or unreadable — see `error`). */
  report: ReviewReport | null;
}

export interface ReviewRefused {
  ok: false;
  /** HTTP status, or 0 when the helper could not be reached or answered nonsense. */
  status: number;
  message: string;
}

const GAME_ID = /^[A-Za-z0-9._-]{1,128}$/;
const REVIEW_ID = /^[A-Za-z0-9_-]{1,64}$/;
export const MIN_POOL = 80;
export const MAX_KNOWN = 60;
const STATES: readonly ReviewState[] = ['queued', 'running', 'done', 'failed'];
const STAGES: readonly ReviewStage[] = ['plan', 'triage', 'deepen', 'report'];

/** Does this /health body say the helper runs engine reviews (`review: 1`)? */
export function helperReviewAvailable(health: unknown): boolean {
  return typeof health === 'object' && health !== null && (health as { review?: unknown }).review === 1;
}

function headers(t: HelperTarget, json: boolean): Record<string, string> {
  const h: Record<string, string> = {};
  if (json) h['Content-Type'] = 'application/json';
  if (t.token) h[TOKEN_HEADER] = t.token;
  return h;
}

const defaultFetch: ReviewFetch = (u, i) => fetch(u, i);

/** GET /health and read `review` (never throws; false when the helper is not there). */
export async function reviewSupported(target: HelperTarget = pageHelperTarget(), f: ReviewFetch = defaultFetch, timeoutMs = 1500): Promise<boolean> {
  const c = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = c ? setTimeout(() => c.abort(), timeoutMs) : null;
  try {
    const res = await f(`${target.baseUrl}/health`, { method: 'GET', headers: headers(target, false), ...(c ? { signal: c.signal } : {}), cache: 'no-store' });
    return helperReviewAvailable(await res.json());
  } catch {
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Checks a request with the helper's own limits before it goes out. */
export function checkReviewRequest(r: ReviewRequest): string | null {
  if (!GAME_ID.test(r.gameId) || /^\.+$/.test(r.gameId)) return 'This game has no id the engine can look up.';
  if (r.seat !== undefined && r.seat !== 0 && r.seat !== 1) return 'The seat must be 0 or 1.';
  if (r.oppPool !== undefined) {
    const n = r.oppPool.reduce((s, e) => s + (Array.isArray(e) && Number.isInteger(e[0]) && e[0] > 0 ? e[0] : 0), 0);
    if (n < MIN_POOL) return `The cube pool has ${n} cards; the engine needs at least ${MIN_POOL}.`;
    if (r.oppPool.some((e) => !Array.isArray(e) || typeof e[1] !== 'string' || !e[1].trim())) return 'The cube pool has an entry without a card name.';
  }
  if (r.oppKnown !== undefined && (r.oppKnown.length > MAX_KNOWN || r.oppKnown.some((n) => typeof n !== 'string' || !n.trim()))) return `At most ${MAX_KNOWN} known AI picks, each a card name.`;
  const range = (v: number | undefined, lo: number, hi: number) => v === undefined || (Number.isInteger(v) && v >= lo && v <= hi);
  if (!range(r.deepK, 1, 12)) return 'deepK is 1 to 12.';
  if (!range(r.triageS, 5, 120)) return 'triageS is 5 to 120 seconds.';
  if (!range(r.deepS, 30, 900)) return 'deepS is 30 to 900 seconds.';
  return null;
}

const STATUS_WORDS: Record<number, string> = {
  400: 'The engine on your PC refused the request.',
  403: 'The engine on your PC refused this page (its address or pairing token).',
  404: 'The engine has no log for this game (only games played through this engine can be reviewed).',
  405: 'Your mtg-table does not take that request: update it and start ForgeCoach again.',
  413: 'The request is too large for the engine on your PC.',
  429: 'The engine is already reviewing other games and its queue is full — try again when one finishes.',
  503: 'Engine review is off on your PC (the bridge is not built, or play.sh was started with --no-review).',
};

const UNREACHABLE = 'Couldn’t reach the engine on your PC: start ForgeCoach again (the app-menu launcher, or ./scripts/play.sh).';

async function call(path: string, init: RequestInit, target: HelperTarget, f: ReviewFetch): Promise<{ status: number; ok: boolean; body: Record<string, unknown> } | ReviewRefused> {
  let res: Pick<Response, 'ok' | 'status' | 'json'>;
  try {
    res = await f(`${target.baseUrl}${path}`, init);
  } catch (e) {
    const aborted = e instanceof Error && e.name === 'AbortError';
    return { ok: false, status: 0, message: aborted ? 'Cancelled.' : UNREACHABLE };
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* no body */
  }
  return { status: res.status, ok: res.ok, body: typeof body === 'object' && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : {} };
}

function refusal(status: number, body: Record<string, unknown>): ReviewRefused {
  const msg = cleanText(body.message, 300);
  // 503 and 429 have a fixed meaning; say what to do about it.
  const message = status === 503 || status === 429 ? STATUS_WORDS[status]! : (msg ?? STATUS_WORDS[status] ?? `The engine on your PC answered HTTP ${status}.`);
  return { ok: false, status, message };
}

function stateOf(v: unknown): ReviewState | null {
  return typeof v === 'string' && (STATES as readonly string[]).includes(v) ? (v as ReviewState) : null;
}

/** POST /review. Resolves to the queued review's id, or why not (never throws). */
export async function startReview(target: HelperTarget, req: ReviewRequest, f: ReviewFetch = defaultFetch, signal?: AbortSignal): Promise<ReviewStarted | ReviewRefused> {
  const bad = checkReviewRequest(req);
  if (bad) return { ok: false, status: 0, message: bad };
  const body: Record<string, unknown> = { gameId: req.gameId };
  for (const k of ['seat', 'oppPool', 'oppKnown', 'deepK', 'triageS', 'deepS'] as const) if (req[k] !== undefined) body[k] = req[k];
  const r = await call('/review', { method: 'POST', headers: headers(target, true), body: JSON.stringify(body), ...(signal ? { signal } : {}) }, target, f);
  if ('message' in r) return r;
  if (!r.ok || r.body.ok !== true) return refusal(r.status, r.body);
  const id = typeof r.body.id === 'string' && REVIEW_ID.test(r.body.id) ? r.body.id : null;
  if (!id) return { ok: false, status: 0, message: 'The engine accepted the review but gave no usable id.' };
  return { ok: true, id, state: stateOf(r.body.state) ?? 'queued', position: int(r.body.position, 0, 1000) };
}

/** GET /review/<id>. The report, once done, is validated here (never throws). */
export async function pollReview(target: HelperTarget, id: string, f: ReviewFetch = defaultFetch, signal?: AbortSignal): Promise<ReviewJob | ReviewRefused> {
  if (!REVIEW_ID.test(id)) return { ok: false, status: 0, message: 'Not a review id.' };
  const r = await call(`/review/${encodeURIComponent(id)}`, { method: 'GET', headers: headers(target, false), cache: 'no-store', ...(signal ? { signal } : {}) }, target, f);
  if ('message' in r) return r;
  if (!r.ok || r.body.ok !== true) return refusal(r.status, r.body);
  const state = stateOf(r.body.state);
  if (!state) return { ok: false, status: 0, message: 'The engine answered with an unknown review state.' };
  const stage = typeof r.body.stage === 'string' && (STAGES as readonly string[]).includes(r.body.stage) ? (r.body.stage as ReviewStage) : null;
  let error = cleanText(r.body.error, 400);
  let report: ReviewReport | null = null;
  let finalState = state;
  if (state === 'done') {
    try {
      report = parseReviewReport(r.body.report);
    } catch (e) {
      finalState = 'failed';
      error = `The engine finished but its report could not be read: ${e instanceof ReviewReportError ? e.message : 'invalid report'}`;
    }
  }
  return {
    ok: true,
    id,
    state: finalState,
    position: int(r.body.position, 0, 1000),
    stage,
    startedAt: parseTime(r.body.startedAt),
    endedAt: parseTime(r.body.endedAt),
    error,
    report,
  };
}

export interface RunOptions {
  fetch?: ReviewFetch;
  signal?: AbortSignal;
  /** Between polls (default 2000 ms). */
  intervalMs?: number;
  /** Injected for tests. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** Consecutive failed polls tolerated before giving up (default 5). */
  maxPollErrors?: number;
  onUpdate?: (job: ReviewJob) => void;
}

function sleepFor(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        resolve();
      },
      { once: true },
    );
  });
}

/**
 * Starts a review and polls it until it is done or failed (or `signal`
 * aborts: resolves to a "Cancelled." refusal). A poll that fails (helper
 * restarting, a dropped connection) is retried up to `maxPollErrors` times.
 */
export async function runReview(target: HelperTarget, req: ReviewRequest, opts: RunOptions = {}): Promise<ReviewJob | ReviewRefused> {
  const f = opts.fetch ?? defaultFetch;
  const sleep = opts.sleep ?? sleepFor;
  const cancelled: ReviewRefused = { ok: false, status: 0, message: 'Cancelled.' };
  const started = await startReview(target, req, f, opts.signal);
  if (!started.ok) return started;
  if (opts.signal?.aborted) return cancelled;
  opts.onUpdate?.({ ok: true, id: started.id, state: started.state, position: started.position, stage: null, startedAt: null, endedAt: null, error: null, report: null });
  let errors = 0;
  for (;;) {
    await sleep(opts.intervalMs ?? 2000, opts.signal);
    if (opts.signal?.aborted) return cancelled;
    const job = await pollReview(target, started.id, f, opts.signal);
    if (opts.signal?.aborted) return cancelled;
    if (!job.ok) {
      // 404 now means the helper forgot the review (it restarted): nothing to wait for.
      if (job.status === 404 || ++errors > (opts.maxPollErrors ?? 5)) return job;
      continue;
    }
    errors = 0;
    opts.onUpdate?.(job);
    if (job.state === 'done' || job.state === 'failed') return job;
  }
}
