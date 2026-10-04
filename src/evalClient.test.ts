// ForgeCoach — evalClient.test.ts
// SPDX-License-Identifier: GPL-3.0-or-later
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { detectHelper, forgetHelper, helperEvalOf, helperTarget, TOKEN_HEADER, type HelperTarget } from './coachHelper.ts';
import { detectEval, evalPosition, explainPosition, helperEval, parseEvalAnswer, parseEvalExplain } from './evalClient.ts';
import { loadSettings, saveSettings, SETTINGS_KEY } from './claude.ts';
import type { EvalRequest } from './winChance.ts';
import type { GameStateBody } from './protocol.ts';

const target: HelperTarget = { baseUrl: 'http://127.0.0.1:8643', token: null };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const HEALTH = { ok: true, helper: 1, claude: '2.1.289 (Claude Code)', models: ['opus', 'sonnet', 'haiku'] };
const ANSWER = { ok: true, p: 0.62, model: 'abcdef012345', schema: '0123456789abcdef', turn: 4, decision: true, featureHash: '00000000000000aa', ms: 4 };
const REQ: EvalRequest = { seat: 0, state: { turn: 4, players: [] } as unknown as GameStateBody, history: [] };

beforeEach(() => forgetHelper());
afterEach(() => vi.unstubAllGlobals());

describe('detecting the win chance (/health "eval")', () => {
  it('reads eval 1 with the model and schema; anything less is no win chance', () => {
    expect(helperEvalOf({ ...HEALTH, eval: 1, evalModel: 'abcdef012345', evalSchema: '0123456789abcdef' })).toEqual({ model: 'abcdef012345', schema: '0123456789abcdef', ensemble: 1, explain: false });
    expect(helperEvalOf({ ...HEALTH, eval: 0, evalError: 'no model' })).toBeNull();
    expect(helperEvalOf(HEALTH)).toBeNull(); // an older helper
    expect(helperEvalOf({ eval: 1 })).toBeNull();
    expect(helperEvalOf({ eval: 1, evalModel: 'NOT-HEX', evalSchema: '0123456789abcdef' })).toBeNull();
    expect(helperEvalOf({ eval: true, evalModel: 'abcdef012345', evalSchema: '0123456789abcdef' })).toBeNull();
    expect(helperEvalOf(null)).toBeNull();
  });

  it('goes through coachHelper’s cached /health, and works when Claude Code is not ready', async () => {
    let calls = 0;
    const f = vi.fn(async () => {
      calls++;
      return json({ ok: false, helper: 1, error: 'claude not found', eval: 1, evalModel: 'abcdef012345', evalSchema: '0123456789abcdef' });
    });
    expect(await detectEval({ fetch: f, target })).toEqual({ model: 'abcdef012345', schema: '0123456789abcdef', ensemble: 1, explain: false });
    expect(await detectEval({ fetch: f, target })).toMatchObject({ model: 'abcdef012345' });
    expect(calls).toBe(1); // cached
    const s = await detectHelper({ fetch: f, target });
    expect(s.state).toBe('down');
    expect(helperEval(s)).not.toBeNull();
  });

  it('no helper, or one without a model: null', async () => {
    expect(await detectEval({ fetch: async () => json({ ...HEALTH, eval: 0 }), target, force: true })).toBeNull();
    expect(await detectEval({ fetch: async () => Promise.reject(new Error('refused')), target, force: true })).toBeNull();
    expect(helperEval(null)).toBeNull();
  });

  it('uses the helper target of coachHelper: ?coachPort and the engine-served host', () => {
    const loc = (protocol: string, host: string, search = '') => ({ protocol, host, hostname: host.split(':')[0]!, search });
    expect(helperTarget(loc('http:', '192.168.1.20:8642', '?token=abc&coachPort=8653'))).toEqual({ baseUrl: 'http://192.168.1.20:8653', token: 'abc' });
  });
});

describe('evalPosition', () => {
  it('POSTs {seat, state, history} to /eval and reads the answer', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const f = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return json(ANSWER);
    });
    const a = await evalPosition(REQ, { fetch: f, target: { baseUrl: 'http://192.168.1.20:8653', token: 'tok' } });
    expect(a).toEqual({ ok: true, p: 0.62, model: 'abcdef012345', schema: '0123456789abcdef', turn: 4, decision: true, n: 1 });
    expect(calls[0]!.url).toBe('http://192.168.1.20:8653/eval');
    expect(calls[0]!.init!.method).toBe('POST');
    expect((calls[0]!.init!.headers as Record<string, string>)[TOKEN_HEADER]).toBe('tok');
    expect(JSON.parse(String(calls[0]!.init!.body))).toEqual(REQ);
  });

  it('refusals keep the helper’s words and status', async () => {
    const a = await evalPosition(REQ, { fetch: async () => json({ ok: false, type: 'error', message: 'the win chance is off here: no model' }, 503), target });
    expect(a).toEqual({ ok: false, status: 503, message: 'the win chance is off here: no model' });
    const b = await evalPosition(REQ, { fetch: async () => new Response('nope', { status: 500 }), target });
    expect(b).toMatchObject({ ok: false, status: 500 });
    const c = await evalPosition(REQ, { fetch: async () => json({ ok: true, p: 1.5, model: 'abcdef012345', schema: '0123456789abcdef' }), target });
    expect(c).toMatchObject({ ok: false, status: 0 });
    const d = await evalPosition(REQ, { fetch: async () => Promise.reject(new TypeError('Failed to fetch')), target });
    expect(d).toMatchObject({ ok: false, status: 0 });
  });

  it('can be stopped, and gives up after its timeout', async () => {
    const hang = (_u: string, init?: RequestInit) =>
      new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
    const ctrl = new AbortController();
    const p = evalPosition(REQ, { fetch: hang, target, signal: ctrl.signal });
    ctrl.abort();
    expect(await p).toEqual({ ok: false, status: 0, message: 'Stopped.' });
    expect(await evalPosition(REQ, { fetch: hang, target, timeoutMs: 20 })).toMatchObject({ ok: false, status: 0 });
  });

  it('parseEvalAnswer checks every field it uses', () => {
    expect(parseEvalAnswer(ANSWER)).not.toBeNull();
    expect(parseEvalAnswer({ ...ANSWER, ok: false })).toBeNull();
    expect(parseEvalAnswer({ ...ANSWER, p: -0.1 })).toBeNull();
    expect(parseEvalAnswer({ ...ANSWER, p: Number.NaN })).toBeNull();
    expect(parseEvalAnswer({ ...ANSWER, model: 'x' })).toBeNull();
    expect(parseEvalAnswer({ ...ANSWER, schema: 'x' })).toBeNull();
    expect(parseEvalAnswer({ ...ANSWER, decision: 'yes' })!.decision).toBe(false);
    expect(parseEvalAnswer({ ...ANSWER, turn: -3 })!.turn).toBe(0);
  });
});

// mtg-table D368: an ensemble's sd and n, and the attributions.
const EXPLAIN = {
  method: 'integrated-gradients-exact',
  baseline: { what: 'the training games’ mean board, no card known by name', p: 0.5, logit: 0 },
  p: 0.62,
  logit: 0.49,
  members: 5,
  buckets: [
    { key: 'me.board', label: 'your board', pts: 9, logit: 0.4 },
    { key: 'opp.life', label: 'their life', pts: 5, logit: 0.2 },
    { key: 'card.me:Glorybringer', label: 'your Glorybringer', pts: -2, logit: -0.1 },
  ],
};

describe('mtg-table D368: an ensemble and its attributions', () => {
  it('/health: evalEnsemble and evalExplain, and an older helper says neither', () => {
    const h = { ...HEALTH, eval: 1, evalModel: 'abcdef012345', evalSchema: '0123456789abcdef' };
    expect(helperEvalOf({ ...h, evalEnsemble: 5, evalExplain: 1 })).toEqual({ model: 'abcdef012345', schema: '0123456789abcdef', ensemble: 5, explain: true });
    expect(helperEvalOf(h)).toMatchObject({ ensemble: 1, explain: false });
    expect(helperEvalOf({ ...h, evalEnsemble: 0, evalExplain: true })).toMatchObject({ ensemble: 1, explain: false });
    expect(helperEvalOf({ ...h, evalEnsemble: 2.5 })).toMatchObject({ ensemble: 1 });
  });

  it('reads n and sd; an sd is kept only beside two or more models', () => {
    expect(parseEvalAnswer({ ...ANSWER, n: 5, sd: 0.06 })).toMatchObject({ p: 0.62, n: 5, sd: 0.06 });
    expect(parseEvalAnswer({ ...ANSWER, n: 1, sd: 0.06 })!.sd).toBeUndefined();
    expect(parseEvalAnswer({ ...ANSWER, sd: 0.06 })!.sd).toBeUndefined(); // no n: one model
    expect(parseEvalAnswer({ ...ANSWER, n: 5, sd: -1 })!.sd).toBeUndefined();
    expect(parseEvalAnswer({ ...ANSWER, n: 5, sd: Number.NaN })!.sd).toBeUndefined();
    expect(parseEvalAnswer({ ...ANSWER, n: 'five' })!.n).toBe(1);
  });

  it('parseEvalExplain: the baseline, every bucket; anything malformed is no attribution', () => {
    expect(parseEvalExplain(EXPLAIN)).toEqual({
      baseline: 0.5,
      buckets: [
        { key: 'me.board', label: 'your board', pts: 9 },
        { key: 'opp.life', label: 'their life', pts: 5 },
        { key: 'card.me:Glorybringer', label: 'your Glorybringer', pts: -2 },
      ],
    });
    expect(parseEvalExplain(null)).toBeNull();
    expect(parseEvalExplain({ ...EXPLAIN, baseline: { p: 2 } })).toBeNull();
    expect(parseEvalExplain({ ...EXPLAIN, buckets: 'x' })).toBeNull();
    expect(parseEvalExplain({ ...EXPLAIN, buckets: [{ key: 'a', label: 'b', pts: Number.POSITIVE_INFINITY }] })).toBeNull();
    expect(parseEvalExplain({ ...EXPLAIN, buckets: [{ key: 'a', label: '', pts: 1 }] })).toBeNull();
    expect(parseEvalExplain({ ...EXPLAIN, buckets: [{ key: 'a', label: 'your\u0007 board', pts: 1 }] })!.buckets[0]!.label).toBe('your  board');
    // An answer whose explain is malformed is still an answer, without it.
    expect(parseEvalAnswer({ ...ANSWER, explain: { buckets: 3 } })).not.toHaveProperty('explain');
    expect(parseEvalAnswer({ ...ANSWER, explain: EXPLAIN })!.explain!.buckets).toHaveLength(3);
  });

  it('explain is sent only when asked, and only to a helper that explains', async () => {
    const bodies: unknown[] = [];
    const f = vi.fn(async (_u: string, init?: RequestInit) => {
      const b = JSON.parse(String(init!.body)) as { explain?: boolean };
      bodies.push(b);
      return json({ ...ANSWER, n: 5, sd: 0.06, ...(b.explain ? { explain: EXPLAIN } : {}) });
    });
    const plain = await evalPosition(REQ, { fetch: f, target });
    expect(plain).toMatchObject({ ok: true, n: 5, sd: 0.06 });
    expect(plain).not.toHaveProperty('explain');
    expect(bodies[0]).toEqual(REQ);
    const model = { model: 'abcdef012345', schema: '0123456789abcdef', ensemble: 5, explain: true };
    const a = await explainPosition(REQ, model, { fetch: f, target });
    expect(a).toMatchObject({ ok: true, explain: { baseline: 0.5 } });
    expect(bodies[1]).toEqual({ ...REQ, explain: true });
    expect(await explainPosition(REQ, { ...model, explain: false }, { fetch: f, target })).toBeNull();
    expect(await explainPosition(REQ, null, { fetch: f, target })).toBeNull();
    expect(bodies).toHaveLength(2);
  });

  it('a helper that answers without the attributions it was asked for: not an explanation', async () => {
    const a = await evalPosition(REQ, { fetch: async () => json(ANSWER), target, explain: true });
    expect(a).toMatchObject({ ok: false, status: 0 });
  });
});

describe('the setting', () => {
  it('is off by default and round-trips', () => {
    const mem = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) });
    expect(loadSettings().winChance).toBe(false);
    saveSettings({ ...loadSettings(), winChance: true });
    expect(loadSettings().winChance).toBe(true);
    mem.set(SETTINGS_KEY, JSON.stringify({ winChance: 'yes' }));
    expect(loadSettings().winChance).toBe(false);
  });
});
