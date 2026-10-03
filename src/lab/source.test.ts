// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it, vi } from 'vitest';
import {
  HINT_KEYS,
  LOCAL_LADDER_URL,
  LOCAL_RETRY_MANUAL_MS,
  LOCAL_RETRY_MS,
  LOCAL_STATUS_URL,
  LOCAL_TIMEOUT_MS,
  REFRESH_LOCAL_MS,
  REFRESH_REMOTE_MS,
  fetchPreferLocal,
  freshnessLine,
  originLabel,
  readHint,
  refreshPeriod,
  shouldTryLocal,
  updatedAgo,
  writeHint,
  type StorageLike,
} from './source.ts';
import { DEFAULT_LAB_SRC, fetchLabStatus, labSource, type FetchLike } from './status.ts';
import { DEFAULT_LADDER_SRC } from './ladder.ts';

const REMOTE = DEFAULT_LAB_SRC;

function memStore(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

/** A clock and timers the test drives. */
function clock(start = 1_000_000) {
  let t = start;
  const timers: Array<{ at: number; fn: () => void; id: number }> = [];
  let next = 1;
  return {
    now: () => t,
    setTimer: (fn: () => void, ms: number) => {
      const id = next++;
      timers.push({ at: t + ms, fn, id });
      return id;
    },
    clearTimer: (id: unknown) => {
      const i = timers.findIndex((x) => x.id === id);
      if (i >= 0) timers.splice(i, 1);
    },
    advance(ms: number) {
      t += ms;
      for (const x of timers.filter((y) => y.at <= t)) {
        timers.splice(timers.indexOf(x), 1);
        x.fn();
      }
    },
    pending: () => timers.length,
  };
}

/** `get` that answers per URL: a value, an error, or 'hang' (until its signal aborts). */
function getter(answers: Record<string, string | Error | 'hang'>) {
  const calls: string[] = [];
  const get = (url: string, signal: AbortSignal): Promise<string> => {
    calls.push(url);
    const a = answers[url];
    if (a === 'hang') {
      return new Promise((_, reject) => signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
    }
    if (a instanceof Error || a === undefined) return Promise.reject(a ?? new Error(`no answer for ${url}`));
    return Promise.resolve(a);
  };
  return { get, calls };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('fetchPreferLocal: source selection and fallback', () => {
  it('reads the PC first and remembers that it answered', async () => {
    const store = memStore();
    const c = clock();
    const { get, calls } = getter({ [LOCAL_STATUS_URL]: 'pc', [REMOTE]: 'gh' });
    const r = await fetchPreferLocal({ localUrl: LOCAL_STATUS_URL, remoteUrl: REMOTE, get, storage: store, hintKey: HINT_KEYS.status, ...c });
    expect(r).toEqual({ value: 'pc', origin: 'local' });
    expect(calls).toEqual([LOCAL_STATUS_URL]);
    expect(readHint(store, HINT_KEYS.status)).toEqual({ local: true, triedAt: c.now() });
    expect(c.pending()).toBe(0);
  });

  it('falls back to GitHub when the PC refuses, and then skips the PC for a while', async () => {
    const store = memStore();
    const c = clock();
    const { get, calls } = getter({ [LOCAL_STATUS_URL]: new TypeError('Failed to fetch'), [REMOTE]: 'gh' });
    const o = { localUrl: LOCAL_STATUS_URL, remoteUrl: REMOTE, get, storage: store, hintKey: HINT_KEYS.status, ...c };
    expect(await fetchPreferLocal(o)).toEqual({ value: 'gh', origin: 'github' });
    expect(calls).toEqual([LOCAL_STATUS_URL, REMOTE]);
    expect(readHint(store, HINT_KEYS.status)).toEqual({ local: false, triedAt: c.now() });
    // The next refreshes (a phone, another machine) go straight to GitHub ...
    c.advance(60_000);
    calls.length = 0;
    expect(await fetchPreferLocal(o)).toEqual({ value: 'gh', origin: 'github' });
    expect(calls).toEqual([REMOTE]);
    // ... until the retry interval has passed.
    c.advance(LOCAL_RETRY_MS);
    calls.length = 0;
    await fetchPreferLocal(o);
    expect(calls).toEqual([LOCAL_STATUS_URL, REMOTE]);
  });

  it('a manual Refresh retries the PC sooner after a failure', async () => {
    const store = memStore();
    const c = clock();
    writeHint(store, HINT_KEYS.status, { local: false, triedAt: c.now() });
    const { get, calls } = getter({ [LOCAL_STATUS_URL]: 'pc', [REMOTE]: 'gh' });
    const o = { localUrl: LOCAL_STATUS_URL, remoteUrl: REMOTE, get, storage: store, hintKey: HINT_KEYS.status, ...c };
    c.advance(LOCAL_RETRY_MANUAL_MS - 1);
    expect((await fetchPreferLocal({ ...o, manual: true })).origin).toBe('github');
    c.advance(1);
    expect((await fetchPreferLocal({ ...o, manual: true })).origin).toBe('local');
    expect(calls).toEqual([REMOTE, LOCAL_STATUS_URL]);
  });

  it('a PC that does not answer within the timeout is abandoned for GitHub', async () => {
    const store = memStore();
    const c = clock();
    const { get, calls } = getter({ [LOCAL_STATUS_URL]: 'hang', [REMOTE]: 'gh' });
    const p = fetchPreferLocal({ localUrl: LOCAL_STATUS_URL, remoteUrl: REMOTE, get, storage: store, hintKey: HINT_KEYS.status, ...c });
    let done = false;
    void p.then(() => (done = true));
    c.advance(LOCAL_TIMEOUT_MS - 1);
    await flush();
    expect(done).toBe(false);
    expect(calls).toEqual([LOCAL_STATUS_URL]);
    c.advance(1);
    expect(await p).toEqual({ value: 'gh', origin: 'github' });
    expect(calls).toEqual([LOCAL_STATUS_URL, REMOTE]);
    expect(readHint(store, HINT_KEYS.status)?.local).toBe(false);
  });

  it('the timeout is about 800 ms, with real timers too', async () => {
    expect(LOCAL_TIMEOUT_MS).toBeGreaterThanOrEqual(500);
    expect(LOCAL_TIMEOUT_MS).toBeLessThanOrEqual(1000);
    vi.useFakeTimers();
    try {
      const { get } = getter({ [LOCAL_STATUS_URL]: 'hang', [REMOTE]: 'gh' });
      const p = fetchPreferLocal({ localUrl: LOCAL_STATUS_URL, remoteUrl: REMOTE, get, storage: null, hintKey: HINT_KEYS.status });
      await vi.advanceTimersByTimeAsync(LOCAL_TIMEOUT_MS);
      expect(await p).toEqual({ value: 'gh', origin: 'github' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('a PC that answers but with an error (503, not a status file) falls back too', async () => {
    const fetchImpl: FetchLike = async (url) =>
      url.startsWith(LOCAL_STATUS_URL)
        ? { ok: false, status: 503, text: async () => '{"error":"no status yet"}' }
        : { ok: true, status: 200, text: async () => JSON.stringify({ schema: 1, updated: '2026-10-03T10:00:00Z', running: [] }) };
    const get = (url: string, signal: AbortSignal) => fetchLabStatus(url, { fetch: fetchImpl, signal });
    const r = await fetchPreferLocal({ localUrl: LOCAL_STATUS_URL, remoteUrl: REMOTE, get, storage: memStore(), hintKey: HINT_KEYS.status });
    expect(r.origin).toBe('github');
    expect(r.value.schema).toBe(1);
  });

  it('a GitHub failure is thrown as it was; the caller’s abort is an AbortError and does not condemn the PC', async () => {
    const store = memStore();
    const boom = new Error('gh down');
    const { get } = getter({ [LOCAL_STATUS_URL]: new Error('refused'), [REMOTE]: boom });
    await expect(fetchPreferLocal({ localUrl: LOCAL_STATUS_URL, remoteUrl: REMOTE, get, storage: store, hintKey: HINT_KEYS.status })).rejects.toBe(boom);

    const store2 = memStore();
    writeHint(store2, HINT_KEYS.status, { local: true, triedAt: 0 });
    const c = clock();
    const outer = new AbortController();
    const hang = getter({ [LOCAL_STATUS_URL]: 'hang', [REMOTE]: 'gh' });
    const p = fetchPreferLocal({ localUrl: LOCAL_STATUS_URL, remoteUrl: REMOTE, get: hang.get, storage: store2, hintKey: HINT_KEYS.status, signal: outer.signal, ...c });
    outer.abort();
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
    expect(hang.calls).toEqual([LOCAL_STATUS_URL]);
    expect(readHint(store2, HINT_KEYS.status)).toEqual({ local: true, triedAt: 0 });
  });

  it('the status and the ladder keep separate hints', async () => {
    const store = memStore();
    const { get } = getter({ [LOCAL_STATUS_URL]: 'pc', [LOCAL_LADDER_URL]: new Error('no ladder'), [REMOTE]: 'gh', [DEFAULT_LADDER_SRC]: 'gh-ladder' });
    await fetchPreferLocal({ localUrl: LOCAL_STATUS_URL, remoteUrl: REMOTE, get, storage: store, hintKey: HINT_KEYS.status });
    expect(await fetchPreferLocal({ localUrl: LOCAL_LADDER_URL, remoteUrl: DEFAULT_LADDER_SRC, get, storage: store, hintKey: HINT_KEYS.ladder })).toEqual({ value: 'gh-ladder', origin: 'github' });
    expect(readHint(store, HINT_KEYS.status)?.local).toBe(true);
    expect(readHint(store, HINT_KEYS.ladder)?.local).toBe(false);
  });

  it('?src= still overrides: a custom or sample source is not the default, so the PC is never tried', () => {
    expect(labSource('#lab', '/').kind).toBe('default');
    expect(labSource('#lab?src=https://pc.tail1234.ts.net/public-status.json', '/')).toEqual({ kind: 'custom', url: 'https://pc.tail1234.ts.net/public-status.json' });
    expect(labSource('#lab?src=sample', '/').kind).toBe('sample');
  });
});

describe('the session hint', () => {
  it('survives storage that throws or holds junk', () => {
    const throwing: StorageLike = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    expect(readHint(throwing, 'k')).toBeNull();
    expect(() => writeHint(throwing, 'k', { local: true, triedAt: 1 })).not.toThrow();
    expect(readHint(null, 'k')).toBeNull();
    const s = memStore();
    for (const junk of ['{', 'null', '42', '{"local":"yes","triedAt":1}', '{"local":true}']) {
      s.data.set('k', junk);
      expect(readHint(s, 'k')).toBeNull();
    }
  });

  it('throwing storage still fetches (the PC is tried every time, which is the safe default)', async () => {
    const throwing: StorageLike = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    const { get } = getter({ [LOCAL_STATUS_URL]: new Error('refused'), [REMOTE]: 'gh' });
    expect(await fetchPreferLocal({ localUrl: LOCAL_STATUS_URL, remoteUrl: REMOTE, get, storage: throwing, hintKey: HINT_KEYS.status })).toEqual({ value: 'gh', origin: 'github' });
  });

  it('shouldTryLocal: no hint, a PC that worked, or an old failure', () => {
    expect(shouldTryLocal(null, 0)).toBe(true);
    expect(shouldTryLocal({ local: true, triedAt: 0 }, 1)).toBe(true);
    expect(shouldTryLocal({ local: false, triedAt: 0 }, LOCAL_RETRY_MS - 1)).toBe(false);
    expect(shouldTryLocal({ local: false, triedAt: 0 }, LOCAL_RETRY_MS)).toBe(true);
    expect(shouldTryLocal({ local: false, triedAt: 0 }, LOCAL_RETRY_MANUAL_MS, true)).toBe(true);
  });
});

describe('freshness labels and refresh periods', () => {
  const now = new Date('2026-10-03T12:00:00Z');
  const ago = (s: number) => new Date(now.getTime() - s * 1000);

  it('seconds under a minute, then minutes, hours, days', () => {
    expect(updatedAgo(ago(0), now)).toBe('updated 0 s ago');
    expect(updatedAgo(ago(12), now)).toBe('updated 12 s ago');
    expect(updatedAgo(ago(59.4), now)).toBe('updated 59 s ago');
    expect(updatedAgo(ago(60), now)).toBe('updated 1 min ago');
    expect(updatedAgo(ago(3 * 3600 + 600), now)).toBe('updated 3 h 10 min ago');
    expect(updatedAgo(ago(2 * 3600), now)).toBe('updated 2 h ago');
    expect(updatedAgo(ago(26 * 3600), now)).toBe('updated 1 d 2 h ago');
    expect(updatedAgo(new Date(now.getTime() + 3000), now)).toBe('updated 0 s ago');
    expect(updatedAgo(null, now)).toBe('no update time');
  });

  it('names where the data came from', () => {
    expect(freshnessLine(ago(12), now, 'local')).toBe('updated 12 s ago · from your PC');
    expect(freshnessLine(ago(12), now, 'github')).toBe('updated 12 s ago · from GitHub');
    expect(freshnessLine(ago(120), now, 'custom', 'https://pc.tail1234.ts.net/public-status.json')).toBe('updated 2 min ago · from pc.tail1234.ts.net');
    expect(originLabel('custom')).toBe('from a custom source');
    expect(originLabel('sample')).toBe('sample data');
  });

  it('auto-refresh: 15 s from the PC, a minute otherwise', () => {
    expect(refreshPeriod('local')).toBe(REFRESH_LOCAL_MS);
    expect(REFRESH_LOCAL_MS).toBe(15_000);
    for (const o of ['github', 'custom', 'sample', null] as const) expect(refreshPeriod(o)).toBe(REFRESH_REMOTE_MS);
    expect(REFRESH_REMOTE_MS).toBe(60_000);
  });
});
