/*
 * ForgeCoach — live.test.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseLog, type GameLog } from './log.ts';
import {
  classifyLiveUrl,
  connectLive,
  REFUSED_CLOSE_CODE,
  type FetchResponseLike,
  type LiveStatus,
  type SocketLike,
} from './live.ts';

const SAMPLE = gunzipSync(
  readFileSync(new URL('../public/samples/human-auto-42.jsonl.gz', import.meta.url)),
).toString('utf8');
const LINES = SAMPLE.split('\n').filter((l) => l.trim() !== '');
const FULL = parseLog(SAMPLE);

class FakeSocket implements SocketLike {
  onopen: SocketLike['onopen'] = null;
  onmessage: SocketLike['onmessage'] = null;
  onclose: SocketLike['onclose'] = null;
  onerror: SocketLike['onerror'] = null;
  closed: number | null = null;
  /** Any send would be a bug: the fake has no send at all, and this proves nothing reached for one. */
  readonly sendCalls: unknown[] = [];
  constructor(readonly url: string) {}
  send(data: unknown) {
    this.sendCalls.push(data);
  }
  close(code = 1000) {
    this.closed = code;
  }
  open() {
    this.onopen?.({});
  }
  msg(data: unknown) {
    this.onmessage?.({ data: typeof data === 'string' ? data : JSON.stringify(data) });
  }
  drop(code = 1006, reason = '') {
    this.onclose?.({ code, reason });
  }
}

function harness() {
  const logs: GameLog[] = [];
  const statuses: [LiveStatus, string | undefined][] = [];
  return {
    logs,
    statuses,
    h: {
      onLog: (l: GameLog) => logs.push(l),
      onStatus: (s: LiveStatus, d?: string) => statuses.push([s, d]),
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('classifyLiveUrl', () => {
  it('refuses the seat socket and the bare port', () => {
    expect(classifyLiveUrl('ws://127.0.0.1:8642/ws')).toHaveProperty('error');
    expect(classifyLiveUrl('ws://127.0.0.1:8642/ws/')).toHaveProperty('error');
    expect(classifyLiveUrl('ws://127.0.0.1:8642')).toHaveProperty('error');
  });
  it('accepts an observer socket and an http log', () => {
    expect(classifyLiveUrl('ws://127.0.0.1:8642/observe')).toEqual({ kind: 'ws' });
    expect(classifyLiveUrl('http://127.0.0.1:8650/frames.jsonl')).toEqual({ kind: 'http' });
    expect(classifyLiveUrl('ftp://x')).toHaveProperty('error');
    expect(classifyLiveUrl('nope')).toHaveProperty('error');
  });
});

describe('connectLive — seat socket', () => {
  it('never opens a socket to /ws', async () => {
    const factory = vi.fn((u: string) => new FakeSocket(u));
    const t = harness();
    connectLive('ws://127.0.0.1:8642/ws', t.h, { socketFactory: factory });
    await Promise.resolve();
    expect(factory).not.toHaveBeenCalled();
    expect(t.statuses[0]?.[0]).toBe('error');
    expect(t.statuses[0]?.[1]).toMatch(/seat/);
  });
});

describe('connectLive — observer socket', () => {
  const s2c = LINES.slice(1)
    .map((l) => JSON.parse(l) as { dir?: string; seq: number })
    .filter((f) => f.dir === 's2c')
    .map(({ dir: _dir, ...f }) => f);

  it('accumulates frames into a GameLog with a synthesized header, throttled, sending nothing', () => {
    let sock: FakeSocket | null = null;
    const t = harness();
    const handle = connectLive('ws://127.0.0.1:8642/observe', t.h, {
      socketFactory: (u) => (sock = new FakeSocket(u)),
    });
    expect(t.statuses.at(-1)?.[0]).toBe('connecting');
    sock!.open();
    expect(t.statuses.at(-1)?.[0]).toBe('open');
    for (const f of s2c) sock!.msg(f);
    // Leading edge fired once; the rest is pending.
    expect(t.logs.length).toBe(1);
    vi.advanceTimersByTime(300);
    expect(t.logs.length).toBe(2);
    const log = t.logs.at(-1)!;
    expect(log.header.kind).toBe('session');
    expect(log.header.gameId).toBe(FULL.hello!.gameId);
    expect(log.seat).toBe(FULL.seat);
    expect(log.hello?.gameId).toBe(FULL.hello!.gameId);
    expect(log.frames.length).toBe(s2c.length);
    expect(log.frames.every((f) => f.dir === 's2c')).toBe(true);
    expect(log.over).not.toBeNull();
    expect(sock!.sendCalls).toEqual([]);
    handle.close();
    expect(sock!.closed).toBe(1000);
    expect(t.statuses.at(-1)?.[0]).toBe('closed');
  });

  it('dedupes verbatim re-delivery after a reconnect, skips seq 0, and backs off', () => {
    const socks: FakeSocket[] = [];
    const t = harness();
    connectLive('ws://127.0.0.1:8642/observe', t.h, {
      socketFactory: (u) => {
        const s = new FakeSocket(u);
        socks.push(s);
        return s;
      },
    });
    socks[0]!.open();
    for (const f of s2c.slice(0, 10)) socks[0]!.msg(f);
    socks[0]!.msg({ v: 1, seq: 0, t: 1, type: 'pong', body: {} });
    socks[0]!.drop(1006);
    expect(t.statuses.at(-1)?.[0]).toBe('error');
    vi.advanceTimersByTime(499);
    expect(socks.length).toBe(1);
    vi.advanceTimersByTime(2);
    expect(socks.length).toBe(2);
    socks[1]!.open();
    for (const f of s2c.slice(0, 20)) socks[1]!.msg(f); // first 10 again, verbatim
    vi.advanceTimersByTime(1000);
    expect(t.logs.at(-1)!.frames.length).toBe(20);
    expect(socks.every((s) => s.sendCalls.length === 0)).toBe(true);
  });

  it('stops on the bridge refusal (4001) and does not retry', () => {
    const socks: FakeSocket[] = [];
    const t = harness();
    connectLive('ws://127.0.0.1:8642/observe', t.h, {
      socketFactory: (u) => {
        const s = new FakeSocket(u);
        socks.push(s);
        return s;
      },
    });
    socks[0]!.open();
    socks[0]!.drop(REFUSED_CLOSE_CODE, 'another client is already connected to this game');
    vi.advanceTimersByTime(60_000);
    expect(socks.length).toBe(1);
    expect(t.statuses.at(-1)).toEqual(['error', expect.stringMatching(/not retrying/)]);
  });

  it('starts a new log when hello_ok names a new game', () => {
    let sock: FakeSocket | null = null;
    const t = harness();
    connectLive('ws://x/observe', t.h, { socketFactory: (u) => (sock = new FakeSocket(u)) });
    sock!.open();
    for (const f of s2c.slice(0, 5)) sock!.msg(f);
    const hello = s2c[0] as unknown as { body: { gameId: string } };
    sock!.msg({ ...hello, body: { ...hello.body, gameId: 'g1-g2' } });
    vi.advanceTimersByTime(300);
    const last = t.logs.at(-1)!;
    expect(last.header.gameId).toBe('g1-g2');
    expect(last.frames.length).toBe(1);
  });
});

describe('connectLive — following frames.jsonl over HTTP', () => {
  const enc = new TextEncoder();

  /** A file that grows; the server honours Range like a static server would. */
  function fileServer(opts: { honourRange: boolean }) {
    let content = '';
    const requests: Record<string, string>[] = [];
    const fetchImpl = async (_u: string, init: { headers: Record<string, string> }): Promise<FetchResponseLike> => {
      requests.push(init.headers);
      const bytes = enc.encode(content);
      if (bytes.length === 0) return { status: 404, arrayBuffer: async () => new ArrayBuffer(0) };
      const range = init.headers['Range'];
      if (range && opts.honourRange) {
        const from = Number(/bytes=(\d+)-/.exec(range)![1]);
        if (from >= bytes.length) return { status: 416, arrayBuffer: async () => new ArrayBuffer(0) };
        const slice = bytes.slice(from);
        return { status: 206, arrayBuffer: async () => slice.buffer };
      }
      return { status: 200, arrayBuffer: async () => bytes.slice().buffer };
    };
    return {
      fetchImpl,
      requests,
      set: (c: string) => (content = c),
    };
  }

  async function tick(ms: number) {
    await vi.advanceTimersByTimeAsync(ms);
  }

  for (const honourRange of [true, false]) {
    it(`follows a growing file to the end (Range ${honourRange ? 'honoured' : 'ignored'})`, async () => {
      const srv = fileServer({ honourRange });
      const t = harness();
      connectLive('http://127.0.0.1:8650/frames.jsonl', t.h, { fetchImpl: srv.fetchImpl });
      await tick(0);
      expect(t.statuses.at(-1)?.[0]).toBe('error'); // 404: not started yet
      const half = Math.floor(LINES.length / 2);
      // Half the file plus a half-written line.
      srv.set(LINES.slice(0, half).join('\n') + '\n' + LINES[half]!.slice(0, 20));
      await tick(1000);
      expect(t.statuses.at(-1)?.[0]).toBe('open');
      await tick(300);
      expect(t.logs.at(-1)!.frames.length).toBe(half - 1);
      srv.set(SAMPLE.endsWith('\n') ? SAMPLE : SAMPLE + '\n');
      await tick(1000);
      await tick(300);
      const log = t.logs.at(-1)!;
      expect(log.frames.length).toBe(FULL.frames.length);
      expect(log.header).toEqual(FULL.header);
      expect(log.over).toEqual(FULL.over);
      expect(t.statuses.at(-1)).toEqual(['closed', 'the game is over']);
      if (honourRange) expect(srv.requests.at(-1)?.['Range']).toMatch(/^bytes=\d+-$/);
      const n = srv.requests.length;
      await tick(10_000);
      expect(srv.requests.length).toBe(n); // stopped polling after `over`
    });
  }

  it('starts over when the file is replaced by a shorter one', async () => {
    const srv = fileServer({ honourRange: true });
    const t = harness();
    srv.set(LINES.slice(0, 40).join('\n') + '\n');
    connectLive('http://h/frames.jsonl', t.h, { fetchImpl: srv.fetchImpl });
    await tick(300);
    expect(t.logs.at(-1)!.frames.length).toBe(39);
    srv.set(LINES.slice(0, 5).join('\n') + '\n');
    await tick(1000);
    await tick(300);
    expect(t.logs.at(-1)!.frames.length).toBe(4);
  });

  it('reports a file that is not a frame log', async () => {
    const srv = fileServer({ honourRange: true });
    srv.set('{"hello":1}\n');
    const t = harness();
    const handle = connectLive('http://h/x.jsonl', t.h, { fetchImpl: srv.fetchImpl });
    await tick(0);
    expect(t.statuses.at(-1)?.[1]).toMatch(/session header/);
    handle.close();
    expect(t.statuses.at(-1)?.[0]).toBe('closed');
    expect(t.logs).toEqual([]);
  });
});
