// SPDX-License-Identifier: GPL-3.0-or-later
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkReviewRequest, helperReviewAvailable, pollReview, reviewSupported, runReview, startReview, type ReviewFetch } from './gameReviewClient.ts';

const fixture = JSON.parse(readFileSync(new URL('./testdata/human-auto-42.review.handmade.json', import.meta.url), 'utf8')) as unknown;
const local = { baseUrl: 'http://127.0.0.1:8643', token: null };
const lan = { baseUrl: 'http://192.168.1.5:8643', token: 'T0KEN' };

interface Call {
  url: string;
  init: RequestInit | undefined;
}

/** A fetch that answers each call from a script, and records it. */
function scripted(answers: Array<{ status: number; body?: unknown } | Error>): { f: ReviewFetch; calls: Call[] } {
  const calls: Call[] = [];
  let i = 0;
  const f: ReviewFetch = async (url, init) => {
    calls.push({ url, init });
    const a = answers[Math.min(i++, answers.length - 1)]!;
    if (a instanceof Error) throw a;
    return {
      ok: a.status >= 200 && a.status < 300,
      status: a.status,
      json: async () => {
        if (a.body === undefined) throw new SyntaxError('no body');
        return a.body;
      },
    };
  };
  return { f, calls };
}

const pool = (n: number): [number, string][] => Array.from({ length: n }, (_, i) => [1, `Card ${i}`]);

describe('helperReviewAvailable', () => {
  it('reads review: 1 from /health', () => {
    expect(helperReviewAvailable({ ok: true, helper: 1, review: 1 })).toBe(true);
    expect(helperReviewAvailable({ ok: true, helper: 1 })).toBe(false);
    expect(helperReviewAvailable({ review: true })).toBe(false);
    expect(helperReviewAvailable({ review: '1' })).toBe(false);
    expect(helperReviewAvailable(null)).toBe(false);
  });

  it('asks the helper, with the pairing token on a LAN page', async () => {
    const { f, calls } = scripted([{ status: 200, body: { ok: true, review: 1 } }]);
    expect(await reviewSupported(lan, f)).toBe(true);
    expect(calls[0]!.url).toBe('http://192.168.1.5:8643/health');
    expect((calls[0]!.init!.headers as Record<string, string>)['X-ForgeCoach-Token']).toBe('T0KEN');
    expect(await reviewSupported(local, scripted([new TypeError('refused')]).f)).toBe(false);
    expect(await reviewSupported(local, scripted([{ status: 200 }]).f)).toBe(false);
  });
});

describe('checkReviewRequest', () => {
  it('takes a plain request', () => {
    expect(checkReviewRequest({ gameId: 'g-20261003-1' })).toBeNull();
    expect(checkReviewRequest({ gameId: 'g', seat: 1, oppPool: pool(80), oppKnown: ['A'], deepK: 6, triageS: 15, deepS: 150 })).toBeNull();
  });

  it('refuses what the helper would refuse', () => {
    expect(checkReviewRequest({ gameId: '../../etc/passwd' })).toMatch(/no id/);
    expect(checkReviewRequest({ gameId: '..' })).toMatch(/no id/);
    expect(checkReviewRequest({ gameId: '' })).toMatch(/no id/);
    expect(checkReviewRequest({ gameId: 'g', seat: 2 })).toMatch(/seat/);
    expect(checkReviewRequest({ gameId: 'g', oppPool: pool(79) })).toMatch(/79 cards/);
    expect(checkReviewRequest({ gameId: 'g', oppKnown: Array.from({ length: 61 }, () => 'X') })).toMatch(/60/);
    expect(checkReviewRequest({ gameId: 'g', deepK: 13 })).toMatch(/deepK/);
    expect(checkReviewRequest({ gameId: 'g', triageS: 4 })).toMatch(/triageS/);
    expect(checkReviewRequest({ gameId: 'g', deepS: 901 })).toMatch(/deepS/);
  });
});

describe('startReview', () => {
  it('POSTs the request and reads the 202', async () => {
    const { f, calls } = scripted([{ status: 202, body: { ok: true, id: 'r1759520000000', state: 'queued', position: 1 } }]);
    const r = await startReview(lan, { gameId: 'g-1', seat: 0, oppPool: pool(80) }, f);
    expect(r).toEqual({ ok: true, id: 'r1759520000000', state: 'queued', position: 1 });
    expect(calls[0]!.url).toBe('http://192.168.1.5:8643/review');
    expect(calls[0]!.init!.method).toBe('POST');
    const h = calls[0]!.init!.headers as Record<string, string>;
    expect(h['Content-Type']).toBe('application/json');
    expect(h['X-ForgeCoach-Token']).toBe('T0KEN');
    const body = JSON.parse(String(calls[0]!.init!.body));
    expect(Object.keys(body).sort()).toEqual(['gameId', 'oppPool', 'seat']);
  });

  it('never sends a request the helper would refuse', async () => {
    const { f, calls } = scripted([{ status: 202, body: { ok: true, id: 'r1' } }]);
    const r = await startReview(local, { gameId: 'a/b' }, f);
    expect(r.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('explains 429 and 503 in its own words, and passes other messages on', async () => {
    const busy = await startReview(local, { gameId: 'g' }, scripted([{ status: 429, body: { ok: false, type: 'error', message: 'queue full' } }]).f);
    expect(busy).toMatchObject({ ok: false, status: 429 });
    expect(!busy.ok && busy.message).toMatch(/queue is full/);
    const off = await startReview(local, { gameId: 'g' }, scripted([{ status: 503, body: { ok: false, type: 'error', message: 'review off' } }]).f);
    expect(!off.ok && off.message).toMatch(/Engine review is off/);
    const missing = await startReview(local, { gameId: 'g' }, scripted([{ status: 404, body: { ok: false, type: 'error', message: 'no var/games/g/frames.jsonl' } }]).f);
    expect(missing).toEqual({ ok: false, status: 404, message: 'no var/games/g/frames.jsonl' });
    const bare = await startReview(local, { gameId: 'g' }, scripted([{ status: 413 }]).f);
    expect(!bare.ok && bare.message).toMatch(/too large/);
  });

  it('handles an unreachable helper and nonsense answers', async () => {
    const down = await startReview(local, { gameId: 'g' }, scripted([new TypeError('Failed to fetch')]).f);
    expect(down).toMatchObject({ ok: false, status: 0 });
    expect(!down.ok && down.message).toMatch(/Couldn’t reach the engine on your PC/);
    const noId = await startReview(local, { gameId: 'g' }, scripted([{ status: 202, body: { ok: true, id: '../x' } }]).f);
    expect(!noId.ok && noId.message).toMatch(/no usable id/);
    const arr = await startReview(local, { gameId: 'g' }, scripted([{ status: 202, body: [1, 2] }]).f);
    expect(arr.ok).toBe(false);
  });
});

describe('pollReview', () => {
  it('reads queued, running and done states', async () => {
    const q = await pollReview(local, 'r1', scripted([{ status: 200, body: { ok: true, id: 'r1', state: 'queued', position: 2 } }]).f);
    expect(q).toMatchObject({ ok: true, state: 'queued', position: 2, stage: null, report: null });
    const run = await pollReview(local, 'r1', scripted([{ status: 200, body: { ok: true, id: 'r1', state: 'running', stage: 'deepen', startedAt: '2026-10-03T21:00:00Z' } }]).f);
    expect(run).toMatchObject({ ok: true, state: 'running', stage: 'deepen' });
    expect(run.ok && run.startedAt?.toISOString()).toBe('2026-10-03T21:00:00.000Z');
    const { f, calls } = scripted([{ status: 200, body: { ok: true, id: 'r1', state: 'done', report: fixture } }]);
    const done = await pollReview(lan, 'r1', f);
    expect(calls[0]!.url).toBe('http://192.168.1.5:8643/review/r1');
    expect(done.ok && done.state).toBe('done');
    expect(done.ok && done.report?.decisions).toHaveLength(14);
  });

  it('turns a done review with an unreadable report into a failure', async () => {
    const r = await pollReview(local, 'r1', scripted([{ status: 200, body: { ok: true, id: 'r1', state: 'done', report: { kind: 'nope' } } }]).f);
    expect(r).toMatchObject({ ok: true, state: 'failed', report: null });
    expect(r.ok && r.error).toMatch(/could not be read/);
  });

  it('reads a failed review’s error, cleaned', async () => {
    const r = await pollReview(local, 'r1', scripted([{ status: 200, body: { ok: true, id: 'r1', state: 'failed', error: 'JVM\u0000 died', stage: 'evil' } }]).f);
    expect(r).toMatchObject({ ok: true, state: 'failed', error: 'JVM died', stage: null });
  });

  it('refuses bad ids and unknown states', async () => {
    const { f, calls } = scripted([{ status: 200, body: { ok: true, state: 'done' } }]);
    expect((await pollReview(local, '../../x', f)).ok).toBe(false);
    expect(calls).toHaveLength(0);
    const odd = await pollReview(local, 'r1', scripted([{ status: 200, body: { ok: true, state: 'exploded' } }]).f);
    expect(!odd.ok && odd.message).toMatch(/unknown review state/);
    const gone = await pollReview(local, 'r1', scripted([{ status: 404, body: { ok: false, type: 'error', message: 'no such review' } }]).f);
    expect(gone).toEqual({ ok: false, status: 404, message: 'no such review' });
  });
});

describe('runReview', () => {
  const noSleep = async () => undefined;

  it('starts, polls through the stages and returns the done job', async () => {
    const { f, calls } = scripted([
      { status: 202, body: { ok: true, id: 'r1', state: 'queued', position: 0 } },
      { status: 200, body: { ok: true, id: 'r1', state: 'running', stage: 'triage' } },
      { status: 503 },
      { status: 200, body: { ok: true, id: 'r1', state: 'running', stage: 'deepen' } },
      { status: 200, body: { ok: true, id: 'r1', state: 'done', report: fixture } },
    ]);
    const seen: string[] = [];
    const r = await runReview(local, { gameId: 'human-auto-42' }, { fetch: f, sleep: noSleep, onUpdate: (j) => seen.push(`${j.state}${j.stage ? `:${j.stage}` : ''}`) });
    expect(r.ok && r.state).toBe('done');
    expect(seen).toEqual(['queued', 'running:triage', 'running:deepen', 'done']);
    expect(calls).toHaveLength(5);
  });

  it('stops on abort', async () => {
    const c = new AbortController();
    const { f, calls } = scripted([
      { status: 202, body: { ok: true, id: 'r1', state: 'queued' } },
      { status: 200, body: { ok: true, id: 'r1', state: 'running', stage: 'plan' } },
    ]);
    let n = 0;
    const r = await runReview(local, { gameId: 'g' }, {
      fetch: f,
      signal: c.signal,
      sleep: async () => {
        if (++n === 3) c.abort();
      },
    });
    expect(r).toEqual({ ok: false, status: 0, message: 'Cancelled.' });
    expect(calls).toHaveLength(3);
  });

  it('gives up after too many failed polls, or at once when the review is gone', async () => {
    const flaky = scripted([{ status: 202, body: { ok: true, id: 'r1' } }, new TypeError('reset')]);
    const r = await runReview(local, { gameId: 'g' }, { fetch: flaky.f, sleep: noSleep, maxPollErrors: 2 });
    expect(r.ok).toBe(false);
    expect(flaky.calls).toHaveLength(4);
    const gone = scripted([{ status: 202, body: { ok: true, id: 'r1' } }, { status: 404, body: { ok: false, message: 'unknown review' } }]);
    const g = await runReview(local, { gameId: 'g' }, { fetch: gone.f, sleep: noSleep });
    expect(g).toEqual({ ok: false, status: 404, message: 'unknown review' });
    expect(gone.calls).toHaveLength(2);
  });

  it('returns the refusal when the review does not start', async () => {
    const r = await runReview(local, { gameId: 'g' }, { fetch: scripted([{ status: 429, body: { ok: false } }]).f, sleep: noSleep });
    expect(r).toMatchObject({ ok: false, status: 429 });
  });
});
