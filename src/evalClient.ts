/*
 * ForgeCoach — evalClient.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The win chance: the client for the coach helper's POST /eval (mtg-table
 * tools/eval-runner.mjs, D361). The helper runs a learned position evaluator
 * on the player's PC (trained there on Forge-vs-Forge games) and answers
 * P(the viewing seat wins) for one position:
 *
 *   GET  /health → {…, eval: 1, evalModel: "<12 hex>", evalSchema: "<16 hex>"}
 *                  ("eval": 0, or no key at all, when it has no model)
 *   POST /eval   {seat, state, history?}         (winChance.ts builds it)
 *        → 200 {ok:true, p, model, schema, turn, decision, featureHash, ms}
 *        | {ok:false, type:"error", message} with 400 / 405 / 413 / 429 / 503 / 504
 *
 * The request carries the board's own state — the viewing seat's redacted view,
 * exactly what the log holds — and the earlier frames' events. Nothing else: no
 * card the player cannot see is ever sent, and the model never comes to the
 * browser (only its hash and the number).
 *
 * Where the helper is (base URL, `?coachPort`, the engine-served host, the
 * pairing token) and whether it serves /eval are coachHelper.ts's: the same
 * cached /health. DOM-free; `fetch` is injected for tests.
 */
import { detectHelper, pageHelperTarget, TOKEN_HEADER, type DetectOptions, type HelperEval, type HelperStatus, type HelperTarget } from './coachHelper.ts';
import type { EvalRequest } from './winChance.ts';

export type EvalFetch = (url: string, init?: RequestInit) => Promise<Pick<Response, 'ok' | 'status' | 'json'>>;

export interface EvalAnswer {
  ok: true;
  /** P(the viewing seat wins), 0..1 — an estimate. */
  p: number;
  /** The model file's hash (12 hex), so answers from two models are never mixed. */
  model: string;
  schema: string;
  turn: number;
  /** The state is a decision row as the model's training data picks them (the viewer holds priority in a main phase or combat). */
  decision: boolean;
}

export interface EvalRefused {
  ok: false;
  /** HTTP status, or 0 when the helper could not be reached or answered nonsense. */
  status: number;
  message: string;
}

/** The helper's win-chance model, or null when it has none (or is not there). */
export function helperEval(h: HelperStatus | null): HelperEval | null {
  return h?.eval ?? null;
}

/** Does the helper serve the win chance? Reads the cached /health (coachHelper.ts), asking when it is stale. Never throws. */
export async function detectEval(opts: DetectOptions = {}): Promise<HelperEval | null> {
  try {
    return helperEval(await detectHelper(opts));
  } catch {
    return null;
  }
}

/** A /eval answer body → the answer, or null when it is not one. */
export function parseEvalAnswer(body: unknown): EvalAnswer | null {
  const b = body as Record<string, unknown> | null;
  if (!b || typeof b !== 'object' || b.ok !== true) return null;
  const p = b.p;
  if (typeof p !== 'number' || !Number.isFinite(p) || p < 0 || p > 1) return null;
  if (typeof b.model !== 'string' || !/^[0-9a-f]{12}$/.test(b.model)) return null;
  if (typeof b.schema !== 'string' || !/^[0-9a-f]{16}$/.test(b.schema)) return null;
  const turn = typeof b.turn === 'number' && Number.isInteger(b.turn) && b.turn >= 0 ? b.turn : 0;
  return { ok: true, p, model: b.model, schema: b.schema, turn, decision: b.decision === true };
}

const defaultFetch: EvalFetch = (u, i) => fetch(u, i);

export interface EvalOptions {
  fetch?: EvalFetch;
  target?: HelperTarget;
  signal?: AbortSignal;
  /** Give up after this long (default 8 s). */
  timeoutMs?: number;
}

/** Ask the helper for one position's win chance. Never throws: a failure is `{ok: false}` (status 0 when aborted or unreachable). */
export async function evalPosition(req: EvalRequest, opts: EvalOptions = {}): Promise<EvalAnswer | EvalRefused> {
  const target = opts.target ?? pageHelperTarget();
  const f = opts.fetch ?? defaultFetch;
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const onAbort = () => ctrl?.abort();
  opts.signal?.addEventListener('abort', onAbort);
  if (opts.signal?.aborted) ctrl?.abort();
  const timer = ctrl ? setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 8000) : null;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (target.token) headers[TOKEN_HEADER] = target.token;
  try {
    const res = await f(`${target.baseUrl}/eval`, { method: 'POST', headers, body: JSON.stringify(req), cache: 'no-store', ...(ctrl ? { signal: ctrl.signal } : {}) });
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      /* not JSON */
    }
    if (res.ok) {
      const a = parseEvalAnswer(body);
      return a ?? { ok: false, status: 0, message: 'The coach helper’s win chance answer could not be read.' };
    }
    const m = (body as { message?: unknown } | null)?.message;
    return { ok: false, status: res.status, message: typeof m === 'string' && m.trim() ? m.trim().slice(0, 300) : `The coach helper answered ${res.status}.` };
  } catch {
    return { ok: false, status: 0, message: opts.signal?.aborted ? 'Stopped.' : 'The coach helper did not answer.' };
  } finally {
    if (timer) clearTimeout(timer);
    opts.signal?.removeEventListener('abort', onAbort);
  }
}
