/*
 * ForgeCoach — evalClient.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The win chance: the client for the coach helper's POST /eval (mtg-table
 * tools/eval-runner.mjs, D361). The helper runs a learned position evaluator
 * on the player's PC (trained there on Forge-vs-Forge games) and answers
 * P(the viewing seat wins) for one position:
 *
 *   GET  /health → {…, eval: 1, evalModel: "<12 hex>", evalSchema: "<16 hex>",
 *                   evalEnsemble?: <models>, evalExplain?: 1}         (the last two: D368)
 *                  ("eval": 0, or no key at all, when it has no model)
 *   POST /eval   {seat, state, history?, explain?}   (winChance.ts builds it)
 *        → 200 {ok:true, p, model, schema, turn, decision, featureHash, ms,
 *               n?, sd?, explain?}
 *        | {ok:false, type:"error", message} with 400 / 405 / 413 / 429 / 503 / 504
 *
 * mtg-table D368. A helper serving an ENSEMBLE of models (seeds of one training
 * run) answers their mean as `p`, their sample standard deviation as `sd` and
 * their number as `n`: `sd` is how far the models disagree on this position,
 * the model's own uncertainty — not the game's luck. `explain: true` (sent only
 * to a helper whose /health says "evalExplain": 1; an older one refuses the
 * field) adds the attributions: the buckets of the position ("your board",
 * "their life", "your Glorybringer") with their share of the distance from the
 * model's baseline position, in points of win chance, summing to
 * 100 × (p − baseline). Exact integrated gradients, computed on the PC
 * (mtg-table tools/ml/attribution.py).
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
  /** D368: how many models the answer averages (1 from an older helper). */
  n: number;
  /** D368: their sample standard deviation of P(win), when n ≥ 2. */
  sd?: number;
  /** D368: the attributions, when asked for and given. */
  explain?: EvalExplain;
}

/** One bucket of an attribution: a part of the position and its share, in points of win chance. */
export interface ExplainBucket {
  /** "me.board", "opp.life", "card.me:Glorybringer", … */
  key: string;
  /** "your board", "their life", "your Glorybringer", … */
  label: string;
  /** Share of 100 × (p − baseline.p), in points. */
  pts: number;
}

export interface EvalExplain {
  /** P(win) of the model's baseline position (the training games' average board, no card known by name). */
  baseline: number;
  /** Every bucket with a share, largest first. */
  buckets: ExplainBucket[];
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

const MAX_BUCKETS = 400;
// eslint-disable-next-line no-control-regex
const clean = (s: string, max: number) => s.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);

/** An answer's `explain` → the attribution, or null when it is not one (an answer without it is still an answer). */
export function parseEvalExplain(x: unknown): EvalExplain | null {
  const e = x as { baseline?: { p?: unknown }; buckets?: unknown } | null;
  if (!e || typeof e !== 'object' || !Array.isArray(e.buckets)) return null;
  const b0 = e.baseline?.p;
  if (typeof b0 !== 'number' || !Number.isFinite(b0) || b0 < 0 || b0 > 1) return null;
  const buckets: ExplainBucket[] = [];
  for (const raw of e.buckets.slice(0, MAX_BUCKETS)) {
    const b = raw as { key?: unknown; label?: unknown; pts?: unknown } | null;
    if (!b || typeof b.key !== 'string' || typeof b.label !== 'string' || typeof b.pts !== 'number' || !Number.isFinite(b.pts) || Math.abs(b.pts) > 100) return null;
    const key = clean(b.key, 200);
    const label = clean(b.label, 120);
    if (!key || !label) return null;
    buckets.push({ key, label, pts: b.pts });
  }
  return { baseline: b0, buckets };
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
  const n = typeof b.n === 'number' && Number.isInteger(b.n) && b.n >= 1 ? b.n : 1;
  const a: EvalAnswer = { ok: true, p, model: b.model, schema: b.schema, turn, decision: b.decision === true, n };
  if (n >= 2 && typeof b.sd === 'number' && Number.isFinite(b.sd) && b.sd >= 0 && b.sd <= 0.5) a.sd = b.sd;
  if (b.explain !== undefined) {
    const ex = parseEvalExplain(b.explain);
    if (ex) a.explain = ex;
  }
  return a;
}

const defaultFetch: EvalFetch = (u, i) => fetch(u, i);

export interface EvalOptions {
  fetch?: EvalFetch;
  target?: HelperTarget;
  signal?: AbortSignal;
  /** Give up after this long (default 8 s). */
  timeoutMs?: number;
  /** D368: ask for the attributions too. Send only to a helper whose /health says `evalExplain` (HelperEval.explain). */
  explain?: boolean;
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
    const body = opts.explain ? { ...req, explain: true } : req;
    const res = await f(`${target.baseUrl}/eval`, { method: 'POST', headers, body: JSON.stringify(body), cache: 'no-store', ...(ctrl ? { signal: ctrl.signal } : {}) });
    let answer: unknown = null;
    try {
      answer = await res.json();
    } catch {
      /* not JSON */
    }
    if (res.ok) {
      const a = parseEvalAnswer(answer);
      if (a && opts.explain && !a.explain) return { ok: false, status: 0, message: 'The engine on your PC did not explain its win chance.' };
      return a ?? { ok: false, status: 0, message: 'The win chance from your PC could not be read.' };
    }
    const m = (answer as { message?: unknown } | null)?.message;
    return { ok: false, status: res.status, message: typeof m === 'string' && m.trim() ? m.trim().slice(0, 300) : `The engine on your PC answered HTTP ${res.status}.` };
  } catch {
    return { ok: false, status: 0, message: opts.signal?.aborted ? 'Stopped.' : 'The engine on your PC did not answer.' };
  } finally {
    if (timer) clearTimeout(timer);
    opts.signal?.removeEventListener('abort', onAbort);
  }
}

/**
 * D368: one position's win chance with its attributions. Null without asking
 * when the helper does not explain (an older helper refuses the field).
 */
export async function explainPosition(req: EvalRequest, model: HelperEval | null, opts: Omit<EvalOptions, 'explain'> = {}): Promise<EvalAnswer | EvalRefused | null> {
  if (!model?.explain) return null;
  return evalPosition(req, { ...opts, explain: true });
}
