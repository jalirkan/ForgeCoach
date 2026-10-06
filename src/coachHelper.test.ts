import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  askHelper,
  chooseSource,
  coachReady,
  detectHelper,
  forgetHelper,
  helperFresh,
  helperModel,
  helperPortFromSearch,
  helperTarget,
  helperThinking,
  peekHelper,
  TOKEN_HEADER,
  tunnelCoachMessage,
  type HelperStatus,
  type HelperTarget,
} from './coachHelper.ts';

const target: HelperTarget = { baseUrl: 'http://127.0.0.1:8643', token: null };
const prompt = { system: 'You are a Magic coach.', user: 'Should I attack?' };

type Call = { url: string; init: RequestInit | undefined };

function fakeFetch(respond: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const f = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return respond(url, init);
  });
  return { f, calls };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** A streamed body delivered in exactly these chunks (strings are UTF-8 encoded; split anywhere). */
function chunked(chunks: Array<string | Uint8Array>, opts: { signal?: AbortSignal | null; hang?: boolean } = {}): Response {
  const enc = new TextEncoder();
  let i = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(ctrl) {
      if (i < chunks.length) {
        const c = chunks[i++]!;
        ctrl.enqueue(typeof c === 'string' ? enc.encode(c) : c);
        return;
      }
      if (!opts.hang) {
        ctrl.close();
        return;
      }
      // Hang until aborted, like a long answer cut off by Stop.
      return new Promise<void>((_, reject) => {
        opts.signal?.addEventListener('abort', () => {
          const e = new Error('The operation was aborted.');
          e.name = 'AbortError';
          ctrl.error(e);
          reject(e);
        });
      });
    },
  });
  return new Response(stream, { status: 200, headers: { 'Content-Type': 'application/x-ndjson' } });
}

const line = (o: unknown) => JSON.stringify(o) + '\n';

beforeEach(() => forgetHelper());

describe('helperModel', () => {
  it('maps the model choice to Claude Code aliases', () => {
    expect(helperModel('claude-opus-5-5')).toBe('opus');
    expect(helperModel('claude-sonnet-5-5')).toBe('sonnet');
    expect(helperModel('claude-haiku-4-5')).toBe('haiku');
  });
});

describe('helperTarget', () => {
  const loc = (protocol: string, host: string, search = '') => ({ protocol, host, hostname: host.replace(/:\d+$/, ''), search });
  it('is localhost:8643 on Pages and the dev server, with no token', () => {
    expect(helperTarget(loc('https:', 'jalirkan.github.io'))).toEqual({ baseUrl: 'http://127.0.0.1:8643', token: null });
    expect(helperTarget(loc('http:', 'localhost:5173', '?token=x'))).toEqual({ baseUrl: 'http://127.0.0.1:8643', token: null });
  });
  it('is the page host on 8643 with the pairing token when the engine serves the page', () => {
    expect(helperTarget(loc('http:', '192.168.1.20:8642', '?token=abc'))).toEqual({ baseUrl: 'http://192.168.1.20:8643', token: 'abc' });
    expect(helperTarget(loc('http:', '192.168.1.20:8642'), 'stored')).toEqual({ baseUrl: 'http://192.168.1.20:8643', token: 'stored' });
  });
  it('uses the coachPort play.sh --lan --coach-port adds to the phone link', () => {
    expect(helperTarget(loc('http:', '192.168.1.20:8642', '?token=abc&coachPort=8653'))).toEqual({ baseUrl: 'http://192.168.1.20:8653', token: 'abc' });
    // A malformed or out-of-range port is ignored: the default, never a URL built from it.
    for (const bad of ['0', '70000', '86x3', '-1', '8653/evil', '']) {
      expect(helperTarget(loc('http:', '192.168.1.20:8642', `?token=abc&coachPort=${encodeURIComponent(bad)}`)).baseUrl).toBe('http://192.168.1.20:8643');
    }
    // Only an engine-served page reads it: Pages and the dev server keep localhost:8643.
    expect(helperTarget(loc('https:', 'jalirkan.github.io', '?coachPort=8653')).baseUrl).toBe('http://127.0.0.1:8643');
  });
  it('helperPortFromSearch reads a port and nothing else', () => {
    expect(helperPortFromSearch('?coachPort=8653')).toBe(8653);
    expect(helperPortFromSearch('coachPort=1')).toBe(1);
    expect(helperPortFromSearch('?token=x')).toBeNull();
    expect(helperPortFromSearch('?coachPort=65536')).toBeNull();
  });
  it('a tunnel page (mtg-table D408) never probes the tunnel host: only the visitor’s own helper, no token', () => {
    expect(helperTarget(loc('https:', 'play.example.com', '?token=x&coachPort=8653'))).toEqual({ baseUrl: 'http://127.0.0.1:8643', token: null, tunnel: true });
    expect(helperTarget(loc('https:', 'play.example.com'), 'stored').token).toBeNull();
    expect(helperTarget(loc('http:', '192.168.1.20:8642')).tunnel).toBeUndefined();
  });
  it('?coach= overrides the base URL', () => {
    expect(helperTarget(loc('http:', 'localhost:5173', '?coach=http://127.0.0.1:8653/'))).toEqual({ baseUrl: 'http://127.0.0.1:8653', token: null });
    expect(helperTarget(loc('http:', 'localhost:5173', '?coach=javascript:alert(1)')).baseUrl).toBe('http://127.0.0.1:8643');
  });
});

describe('detectHelper', () => {
  it('reports a running helper, and caches it', async () => {
    const { f, calls } = fakeFetch(() => json({ ok: true, helper: 1, claude: '2.1.7 (Claude Code)', models: ['opus', 'sonnet', 'haiku'] }));
    const s = await detectHelper({ fetch: f, target });
    expect(s).toMatchObject({ state: 'ok', claude: '2.1.7 (Claude Code)', models: ['opus', 'sonnet', 'haiku'] });
    expect(calls[0]!.url).toBe('http://127.0.0.1:8643/health');
    expect(peekHelper(target)).toEqual(s);
    expect(helperFresh(target)).toBe(true);
    await detectHelper({ fetch: f, target });
    expect(calls).toHaveLength(1);
    await detectHelper({ fetch: f, target, force: true });
    expect(calls).toHaveLength(2);
  });

  it('shares one request between simultaneous callers', async () => {
    const { f, calls } = fakeFetch(() => json({ ok: true, helper: 1, claude: '2.1.7', models: [] }));
    await Promise.all([detectHelper({ fetch: f, target }), detectHelper({ fetch: f, target })]);
    expect(calls).toHaveLength(1);
  });

  it('reports a helper whose Claude Code is not logged in', async () => {
    const { f } = fakeFetch(() => json({ ok: false, helper: 1, error: 'Claude Code is not logged in' }, 503));
    const s = await detectHelper({ fetch: f, target });
    expect(s).toMatchObject({ state: 'down', reason: 'not_ready' });
    expect(s.state === 'down' && s.message).toMatch(/isn’t logged in/);
  });

  it('reports not running when nothing answers', async () => {
    const { f } = fakeFetch(() => Promise.reject(new TypeError('Failed to fetch')));
    expect(await detectHelper({ fetch: f, target })).toMatchObject({ state: 'down', reason: 'not_running' });
  });

  it('on a tunnel page, a missing or refusing helper is explained for the friend: their own key or their own helper', async () => {
    const tunnelTarget = { baseUrl: 'http://127.0.0.1:8643', token: null, tunnel: true as const };
    const none = await detectHelper({ fetch: fakeFetch(() => Promise.reject(new TypeError('Failed to fetch'))).f, target: tunnelTarget, force: true });
    expect(none).toMatchObject({ state: 'down', reason: 'not_running' });
    expect(none.state === 'down' && none.message).toMatch(/Cloudflare tunnel.*own Anthropic API key in Settings.*own mtg-table coach helper/);
    const refused = await detectHelper({ fetch: fakeFetch(() => json({ type: 'error', message: 'origin not allowed' }, 403)).f, target: tunnelTarget, force: true });
    expect(refused).toMatchObject({ state: 'down', reason: 'unauthorized' });
    expect(refused.state === 'down' && refused.message).toMatch(/wsAllowedOrigins/);
    const ready = await detectHelper({ fetch: fakeFetch(() => json({ ok: true, helper: 1, claude: '2.1.7', models: [] })).f, target: tunnelTarget, force: true });
    expect(ready.state).toBe('ok');
    expect(tunnelCoachMessage('play.example.com')).toContain('https://play.example.com');
  });

  it('gives up after the timeout', async () => {
    const f = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
        }),
    );
    const t0 = Date.now();
    const s = await detectHelper({ fetch: f, target, timeoutMs: 40 });
    expect(s).toMatchObject({ state: 'down', reason: 'not_running' });
    expect(Date.now() - t0).toBeLessThan(1000);
  });

  it('sends the pairing token', async () => {
    const t: HelperTarget = { baseUrl: 'http://192.168.1.20:8643', token: 'abc' };
    const { f, calls } = fakeFetch(() => json({ ok: true, helper: 1, claude: '2.1.7', models: [] }));
    await detectHelper({ fetch: f, target: t });
    expect(new Headers(calls[0]!.init?.headers).get(TOKEN_HEADER)).toBe('abc');
  });
});

describe('askHelper', () => {
  it('streams NDJSON split anywhere across chunks, including inside a UTF-8 character', async () => {
    const body = [line({ type: 'thinking', text: 'Hmm…' }), line({ type: 'text', text: 'Attack with ' }), line({ type: 'text', text: 'Grizzly Bears — 2 damage.' }), line({ type: 'done', stopReason: 'end_turn', model: 'claude-haiku-4-5-20251001' })].join('');
    const bytes = new TextEncoder().encode(body);
    // Split into 7-byte pieces: lines, JSON and the multi-byte "…" / "—" all straddle chunk boundaries.
    const pieces: Uint8Array[] = [];
    for (let i = 0; i < bytes.length; i += 7) pieces.push(bytes.slice(i, i + 7));
    const { f, calls } = fakeFetch(() => chunked(pieces));
    const texts: string[] = [];
    const thinking: string[] = [];
    const r = await askHelper(prompt, { onText: (d) => texts.push(d), onThinking: (d) => thinking.push(d) }, { fetch: f, target, model: 'claude-haiku-4-5' });
    expect(texts).toEqual(['Attack with ', 'Grizzly Bears — 2 damage.']);
    expect(thinking).toEqual(['Hmm…']);
    expect(r).toEqual({ text: 'Attack with Grizzly Bears — 2 damage.', stopReason: 'end_turn', refused: false, model: 'claude-haiku-4-5-20251001' });
    expect(calls[0]!.url).toBe('http://127.0.0.1:8643/coach');
    expect(calls[0]!.init?.method).toBe('POST');
    expect(JSON.parse(String(calls[0]!.init?.body))).toEqual({ system: prompt.system, user: prompt.user, model: 'haiku' });
  });

  it('handles a final line without a trailing newline, blank lines and a garbled line', async () => {
    const { f } = fakeFetch(() => chunked(['\n', '{not json\n', line({ type: 'text', text: 'Hi' }), JSON.stringify({ type: 'done', stopReason: 'refusal', model: 'opus' })]));
    const r = await askHelper(prompt, { onText() {} }, { fetch: f, target });
    expect(r).toMatchObject({ text: 'Hi', stopReason: 'refusal', refused: true, model: 'opus' });
  });

  it('rejects with the helper’s error line, in friendly words', async () => {
    const { f } = fakeFetch(() => chunked([line({ type: 'text', text: 'Part' }), line({ type: 'error', message: 'Invalid API key · Please run /login' })]));
    await expect(askHelper(prompt, { onText() {} }, { fetch: f, target })).rejects.toMatchObject({ kind: 'not_logged_in', message: expect.stringMatching(/isn’t logged in/) });
    const { f: g } = fakeFetch(() => chunked([line({ type: 'error', message: 'claude exited with code 1' })]));
    await expect(askHelper(prompt, { onText() {} }, { fetch: g, target })).rejects.toMatchObject({ kind: 'server', message: expect.stringMatching(/claude exited with code 1/) });
  });

  it('rejects when the stream ends without done', async () => {
    const { f } = fakeFetch(() => chunked([line({ type: 'text', text: 'Part' })]));
    await expect(askHelper(prompt, { onText() {} }, { fetch: f, target })).rejects.toMatchObject({ message: expect.stringMatching(/stopped mid-answer/) });
  });

  it('says why a 403 was refused (origin vs token)', async () => {
    const { f } = fakeFetch(() => json({ type: 'error', message: 'origin not allowed' }, 403));
    await expect(askHelper(prompt, { onText() {} }, { fetch: f, target })).rejects.toMatchObject({ kind: 'auth', message: expect.stringMatching(/wsAllowedOrigins/) });
    const { f: g } = fakeFetch(() => json({ type: 'error', message: 'pairing token missing or wrong' }, 403));
    await expect(askHelper(prompt, { onText() {} }, { fetch: g, target })).rejects.toMatchObject({ kind: 'auth', message: expect.stringMatching(/pairing token/) });
    expect(await detectHelper({ fetch: g, target })).toMatchObject({ state: 'down', reason: 'unauthorized' });
  });

  it('is busy on 429', async () => {
    const { f } = fakeFetch(() => json({ type: 'error', message: 'the coach is busy' }, 429));
    await expect(askHelper(prompt, { onText() {} }, { fetch: f, target })).rejects.toMatchObject({ kind: 'helper_busy', status: 429 });
  });

  it('says how to start the helper when it is not running, and forgets a cached "ok"', async () => {
    await detectHelper({ fetch: fakeFetch(() => json({ ok: true, helper: 1, claude: '2', models: [] })).f, target });
    expect(peekHelper(target)?.state).toBe('ok');
    const { f } = fakeFetch(() => Promise.reject(new TypeError('Failed to fetch')));
    await expect(askHelper(prompt, { onText() {} }, { fetch: f, target })).rejects.toMatchObject({ kind: 'helper_down', message: expect.stringMatching(/play\.sh/) });
    expect(peekHelper(target)).toBeNull();
  });

  it('aborting cancels the request mid-stream', async () => {
    const ctrl = new AbortController();
    const { f } = fakeFetch((_u, init) => chunked([line({ type: 'text', text: 'Thinking about ' })], { signal: init?.signal, hang: true }));
    const texts: string[] = [];
    const p = askHelper(prompt, { onText: (d) => (texts.push(d), ctrl.abort()) }, { fetch: f, target, signal: ctrl.signal });
    await expect(p).rejects.toMatchObject({ kind: 'aborted', name: 'AbortError' });
    expect(texts).toEqual(['Thinking about ']);
  });

  it('an already-aborted signal sends nothing', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const { f, calls } = fakeFetch(() => json({}));
    await expect(askHelper(prompt, { onText() {} }, { fetch: f, target, signal: ctrl.signal })).rejects.toMatchObject({ kind: 'aborted' });
    expect(calls).toHaveLength(0);
  });
});

describe('the D325 queue', () => {
  it('reads the queue, concurrency and supersede support from /health, and defaults for an older helper', async () => {
    forgetHelper();
    const { f } = fakeFetch(() => json({ ok: true, helper: 1, claude: '2', models: [], concurrency: 1, queue: { max: 4, length: 2 }, running: 1, supersedes: 1 }));
    expect(await detectHelper({ fetch: f, target, force: true })).toMatchObject({ state: 'ok', concurrency: 1, queue: { max: 4, length: 2 }, supersedes: true });
    const { f: old } = fakeFetch(() => json({ ok: true, helper: 1, claude: '2', models: [] }));
    expect(await detectHelper({ fetch: old, target, force: true })).toMatchObject({ state: 'ok', concurrency: 1, queue: null, supersedes: false });
  });

  it('reports queued positions and the turn coming, then streams as before', async () => {
    const { f, calls } = fakeFetch(() =>
      chunked([line({ type: 'queued', position: 2 }), line({ type: 'queued', position: 1 }), line({ type: 'running' }), line({ type: 'text', text: 'Hold.' }), line({ type: 'done', stopReason: 'end_turn', model: 'sonnet' })]),
    );
    const seen: string[] = [];
    const r = await askHelper(prompt, { onText: (d) => seen.push(`text ${d}`) }, { fetch: f, target, supersedes: 'tab-1', onQueued: (n) => seen.push(`queued ${n}`), onRunning: () => seen.push('running') });
    expect(seen).toEqual(['queued 2', 'queued 1', 'running', 'text Hold.']);
    expect(r.text).toBe('Hold.');
    expect(JSON.parse(String(calls[0]!.init?.body))).toEqual({ system: prompt.system, user: prompt.user, supersedes: 'tab-1' });
  });

  it('sends no supersede key unless given one', async () => {
    const { f, calls } = fakeFetch(() => chunked([line({ type: 'done', stopReason: 'end_turn', model: 'sonnet' })]));
    await askHelper(prompt, { onText() {} }, { fetch: f, target });
    expect(JSON.parse(String(calls[0]!.init?.body))).not.toHaveProperty('supersedes');
  });

  it('a superseded question ends with its own error kind', async () => {
    const { f } = fakeFetch(() => chunked([line({ type: 'queued', position: 1 }), line({ type: 'error', code: 'superseded', message: 'superseded by a newer question' })]));
    await expect(askHelper(prompt, { onText() {} }, { fetch: f, target })).rejects.toMatchObject({ kind: 'superseded' });
  });

  it('a full queue (or an older helper) is still the friendly busy message on 429', async () => {
    const { f } = fakeFetch(() => json({ type: 'error', message: 'the coach is busy with other questions' }, 429));
    await expect(askHelper(prompt, { onText() {} }, { fetch: f, target })).rejects.toMatchObject({ kind: 'helper_busy', status: 429, message: expect.stringMatching(/busy with another answer/) });
  });
});

describe('thinking (mtg-table D346)', () => {
  it('reads the offered values from /health, and none from an older helper', async () => {
    const { f } = fakeFetch(() => json({ ok: true, helper: 1, claude: '2', models: [], thinking: ['off', 'low', 'default', 'max'] }));
    expect(await detectHelper({ fetch: f, target, force: true })).toMatchObject({ state: 'ok', thinking: ['off', 'low', 'default'] });
    const { f: old } = fakeFetch(() => json({ ok: true, helper: 1, claude: '2', models: [] }));
    expect(await detectHelper({ fetch: old, target, force: true })).toMatchObject({ state: 'ok', thinking: [] });
  });

  it('sends "thinking" when given, and nothing otherwise', async () => {
    const { f, calls } = fakeFetch(() => chunked([line({ type: 'done', stopReason: 'end_turn', model: 'haiku' })]));
    await askHelper(prompt, { onText() {} }, { fetch: f, target, model: 'haiku', thinking: 'off' });
    expect(JSON.parse(String(calls[0]!.init?.body))).toEqual({ system: prompt.system, user: prompt.user, model: 'haiku', thinking: 'off' });
    await askHelper(prompt, { onText() {} }, { fetch: f, target });
    expect(JSON.parse(String(calls[1]!.init?.body))).not.toHaveProperty('thinking');
  });

  it('helperThinking: only an offered value, never default, never to a helper that is down', () => {
    const ok = (thinking?: ('off' | 'low' | 'default')[]): HelperStatus => ({ state: 'ok', baseUrl: target.baseUrl, claude: '2', models: [], checkedAt: 0, ...(thinking ? { thinking } : {}) });
    const down: HelperStatus = { state: 'down', baseUrl: target.baseUrl, reason: 'not_running', message: '', checkedAt: 0 };
    expect(helperThinking(ok(['off', 'low', 'default']), 'off')).toBe('off');
    expect(helperThinking(ok(['off', 'low', 'default']), 'low')).toBe('low');
    expect(helperThinking(ok(['off', 'low', 'default']), 'default')).toBeUndefined();
    expect(helperThinking(ok(['off', 'low', 'default']), undefined)).toBeUndefined();
    expect(helperThinking(ok([]), 'off')).toBeUndefined();
    expect(helperThinking(ok(), 'off')).toBeUndefined();
    expect(helperThinking(down, 'off')).toBeUndefined();
    expect(helperThinking(null, 'off')).toBeUndefined();
  });
});

describe('chooseSource', () => {
  const ok: HelperStatus = { state: 'ok', baseUrl: target.baseUrl, claude: '2', models: [], checkedAt: 0 };
  const down: HelperStatus = { state: 'down', baseUrl: target.baseUrl, reason: 'not_running', message: '', checkedAt: 0 };
  it('auto prefers the helper, then the key, else nothing', () => {
    expect(chooseSource({ apiKey: 'k', coachSource: 'auto' }, ok)).toBe('helper');
    expect(chooseSource({ apiKey: 'k', coachSource: 'auto' }, down)).toBe('apiKey');
    expect(chooseSource({ apiKey: ' ', coachSource: 'auto' }, down)).toBeNull();
    expect(chooseSource({ apiKey: '', coachSource: 'auto' }, null)).toBeNull();
  });
  it('helper and apiKey are fixed choices', () => {
    expect(chooseSource({ apiKey: 'k', coachSource: 'helper' }, down)).toBe('helper');
    expect(chooseSource({ apiKey: 'k', coachSource: 'apiKey' }, ok)).toBe('apiKey');
    expect(chooseSource({ apiKey: '', coachSource: 'apiKey' }, ok)).toBeNull();
  });
  it('coachReady needs a detected helper for the helper source', () => {
    expect(coachReady({ apiKey: '', coachSource: 'helper' }, down)).toBe(false);
    expect(coachReady({ apiKey: '', coachSource: 'helper' }, ok)).toBe(true);
    expect(coachReady({ apiKey: 'k', coachSource: 'auto' }, down)).toBe(true);
  });
});
