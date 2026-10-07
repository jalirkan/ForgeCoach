// ForgeCoach — bug/deliver.test.ts
// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { FRIEND_ROOMS_KEY } from '../play/friendTable.ts';
import { chooseRoute, downloadName, downloadText, routeWords, savedRoomSeats, sendReport, tableRoom, type BugRoute } from './deliver.ts';
import type { BugReport } from './report.ts';

const report = { kind: 'forgecoach-bug', schema: 1, clientId: 'fc-20261007-153012-abcd', title: 't' } as unknown as BugReport;
const TOKEN = 'RoomSeatToken0123456789AB';
const rooms = [
  { id: 'rAbcd1234', seat: 1 as const, base: 'https://pc.tail1.ts.net/', token: TOKEN },
  { id: 'rOther123', seat: 0 as const, base: 'http://127.0.0.1:8644', token: 'OwnerSeatToken0123456789' },
];
const helper = { baseUrl: 'http://127.0.0.1:8643', token: null };

type Call = { url: string; init: RequestInit };
function fakeFetch(status: number, body: unknown, calls: Call[] = []) {
  return async (url: string, init?: RequestInit) => {
    calls.push({ url, init: init ?? {} });
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
  };
}

describe('choosing where a report goes', () => {
  it('a page in a room sends to that room, with its seat token', () => {
    expect(chooseRoute({ id: 'rAbcd1234', seat: 1 }, rooms, helper)).toEqual({ kind: 'room', base: 'https://pc.tail1.ts.net', id: 'rAbcd1234', seat: 1, token: TOKEN });
  });

  it('a room page whose seat this browser lost has no route (never the friend’s own helper)', () => {
    expect(chooseRoute({ id: 'rGone1234', seat: 1 }, rooms, helper)).toBeNull();
  });

  it('any other page sends to the coach helper (with the pairing token on a phone page)', () => {
    expect(chooseRoute(null, rooms, { baseUrl: 'http://192.168.1.5:8643', token: 'Pair_0123456789' })).toEqual({ kind: 'helper', baseUrl: 'http://192.168.1.5:8643', token: 'Pair_0123456789', tunnel: false });
  });

  it('a tunnel page outside a room has no route: its helper is the visitor’s, not the owner’s', () => {
    expect(chooseRoute(null, rooms, { ...helper, tunnel: true })).toBeNull();
  });

  it('reads saved room seats, dropping malformed ones', () => {
    const st = { getItem: (k: string) => (k === FRIEND_ROOMS_KEY ? JSON.stringify([...rooms, { id: 'bad', seat: 0, base: 'x', token: TOKEN }, { id: 'rAbcd1234', seat: 2, base: 'x', token: TOKEN }, null]) : null) };
    expect(savedRoomSeats(st).map((r) => r.id)).toEqual(['rAbcd1234', 'rOther123']);
    expect(savedRoomSeats({ getItem: () => '{oops' })).toEqual([]);
    expect(savedRoomSeats(null)).toEqual([]);
  });

  it('the table’s room comes from the saved table', () => {
    expect(tableRoom({ room: 'rAbcd1234', seat: 0 })).toEqual({ id: 'rAbcd1234', seat: 0 });
    expect(tableRoom({ room: 'nope', seat: 0 })).toBeNull();
    expect(tableRoom(null)).toBeNull();
  });

  it('tells a friend that their hand goes with it', () => {
    expect(routeWords(chooseRoute({ id: 'rAbcd1234', seat: 1 }, rooms, helper), true)).toMatch(/your own hand/);
    expect(routeWords(null, false)).toMatch(/download/i);
  });
});

describe('sending', () => {
  const room = chooseRoute({ id: 'rAbcd1234', seat: 1 }, rooms, helper) as BugRoute;
  const local = chooseRoute(null, rooms, { baseUrl: 'http://127.0.0.1:8643/', token: 'Pair_0123456789' }) as BugRoute;

  it('POSTs to the room with X-Room-Token and returns the server’s id', async () => {
    const calls: Call[] = [];
    const r = await sendReport(report, room, { fetch: fakeFetch(201, { ok: true, id: '20261007T153012Z-abc123', screenshot: true }, calls) });
    expect(r).toEqual({ ok: true, id: '20261007T153012Z-abc123', via: 'room', screenshot: true });
    expect(calls[0]!.url).toBe('https://pc.tail1.ts.net/room/rAbcd1234/bug');
    expect((calls[0]!.init.headers as Record<string, string>)['X-Room-Token']).toBe(TOKEN);
    expect(JSON.parse(String(calls[0]!.init.body)).clientId).toBe(report.clientId);
  });

  it('POSTs to the helper’s /bug with the pairing token header', async () => {
    const calls: Call[] = [];
    await sendReport(report, local, { fetch: fakeFetch(201, { ok: true, id: 'x' }, calls) });
    expect(calls[0]!.url).toBe('http://127.0.0.1:8643/bug');
    expect((calls[0]!.init.headers as Record<string, string>)['X-ForgeCoach-Token']).toBe('Pair_0123456789');
  });

  it('falls back with plain words: offline, an old helper or room (404), too large, rate-limited, full, refused', async () => {
    const offline = await sendReport(report, local, { fetch: async () => { throw new TypeError('Failed to fetch'); } });
    expect(offline).toMatchObject({ ok: false, status: 0, code: 'offline' });
    expect((await sendReport(report, local, { fetch: fakeFetch(404, { type: 'error', message: 'not found' }) })) as { message: string }).toMatchObject({ ok: false, status: 404 });
    expect(((await sendReport(report, local, { fetch: fakeFetch(404, {}) })) as { message: string }).message).toMatch(/update mtg-table/);
    expect(((await sendReport(report, room, { fetch: fakeFetch(404, { code: 'off' }) })) as { message: string }).message).toMatch(/room does not take/);
    expect(((await sendReport(report, room, { fetch: fakeFetch(413, 'too large') })) as { message: string }).message).toMatch(/too large/);
    expect(await sendReport(report, room, { fetch: fakeFetch(429, { code: 'slow', message: 'too many bug reports from this seat' }) })).toMatchObject({ ok: false, code: 'slow' });
    expect(await sendReport(report, local, { fetch: fakeFetch(507, { code: 'full', message: 'the bug folder is full' }) })).toMatchObject({ ok: false, code: 'full', message: 'the bug folder is full' });
    expect(((await sendReport(report, room, { fetch: fakeFetch(403, { code: 'token' }) })) as { message: string }).message).toMatch(/link/);
    expect(await sendReport(report, local, { fetch: fakeFetch(201, { ok: false }) })).toMatchObject({ ok: false });
  });

  it('gives up after its timeout', async () => {
    const hang = (_u: string, init?: RequestInit) =>
      new Promise<Response>((_, rej) => init?.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError'))));
    expect(await sendReport(report, local, { fetch: hang, timeoutMs: 20 })).toMatchObject({ ok: false, code: 'offline' });
  });

  it('the download is the same JSON under a safe name', () => {
    expect(downloadName(report)).toBe('forgecoach-bug-fc-20261007-153012-abcd.json');
    expect(JSON.parse(downloadText(report))).toEqual(JSON.parse(JSON.stringify(report)));
  });
});
