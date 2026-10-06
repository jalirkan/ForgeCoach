/*
 * ForgeCoach — play/friendReview.test.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * mtg-table D407: this seat's own review and log of a game with a friend, read
 * from the room with this seat's token; the seat found in the saved rooms.
 */
import { describe, expect, it } from 'vitest';
import { fetchSeatLog, fetchSeatReview, savedRoomSeat } from './friendReview.ts';
import { FRIEND_ROOMS_KEY } from './friendTable.ts';

const store = (rooms: unknown) => ({ getItem: (k: string) => (k === FRIEND_ROOMS_KEY ? JSON.stringify(rooms) : null) });
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } });

describe('a seat review from the room (mtg-table D407)', () => {
  it('finds the seat this browser holds in a room, and only that seat', () => {
    const s = store([{ id: 'rAbCdEfGh', seat: 1, base: 'http://192.168.1.5:8644', token: 't'.repeat(22) }, { id: 'rOther123', seat: 0, base: 'x', token: 'u' }]);
    expect(savedRoomSeat('rAbCdEfGh', 1, s)).toEqual({ base: 'http://192.168.1.5:8644', id: 'rAbCdEfGh', token: 't'.repeat(22) });
    expect(savedRoomSeat('rAbCdEfGh', 0, s)).toBeNull();
    expect(savedRoomSeat('rNope0000', 1, s)).toBeNull();
    expect(savedRoomSeat('rAbCdEfGh', 1, { getItem: () => 'not json' })).toBeNull();
  });

  it('reads the review (a report only when done) and the log, behind this seat\'s token', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const f = async (url: string, init: RequestInit = {}) => {
      calls.push({ url, init });
      if (url.endsWith('/review/m1791307365620')) return json({ ok: true, matchId: 'm1791307365620', match: 1, game: 2, state: 'done', report: { kind: 'game-review' } });
      if (url.endsWith('/review/m1791307365621')) return json({ ok: true, matchId: 'm1791307365621', match: 1, game: 1, state: 'off', why: 'you did not agree to recording this game', report: { kind: 'x' } });
      if (url.endsWith('/log/m1791307365620')) return new Response('line\n');
      return json({ ok: false, code: 'game', message: 'no finished game of this room has that id' }, 404);
    };
    const h = { base: 'http://192.168.1.5:8644/', id: 'rAbCdEfGh', token: 't'.repeat(22) };
    const done = await fetchSeatReview(h, 'm1791307365620', f);
    expect([done.state, done.game, done.report]).toEqual(['done', 2, { kind: 'game-review' }]);
    expect(calls[0]!.url).toBe('http://192.168.1.5:8644/room/rAbCdEfGh/review/m1791307365620');
    expect((calls[0]!.init.headers as Record<string, string>)['X-Room-Token']).toBe('t'.repeat(22));
    const off = await fetchSeatReview(h, 'm1791307365621', f);
    expect([off.state, off.report, off.why]).toEqual(['off', null, 'you did not agree to recording this game']);
    await expect(fetchSeatReview(h, 'm1791307365629', f)).rejects.toMatchObject({ code: 'game', status: 404 });
    expect(await fetchSeatLog(h, 'm1791307365620', f)).toBe('line\n');
    await expect(fetchSeatReview(h, 'm1791307365620', () => Promise.reject(new Error('down')))).rejects.toMatchObject({ code: 'offline' });
  });
});
