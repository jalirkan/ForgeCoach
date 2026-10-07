/*
 * ForgeCoach — play/tableLog.test.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * A table of two keeps its game's history when a page comes back to its seat
 * mid-game (play/tableLog.ts). The recordings are both seats of one real
 * two-person game (mtg-table tools/ws-two-humans.mjs `concede`, seed 7, on
 * mtg-table e6a0f59 with Forge 2.0.14: six turns, lands and attacks), each
 * seat's own bridge log, gzipped into ./testdata.
 *
 * The bug this holds (reported from a live two-person game): the Game Log
 * drawer said "T9 · Your turn · Nothing yet", 0 events. The bridge sends every
 * seat its §3.6 events, but a page that joins mid-game gets only the catch-up
 * snapshot (hello_ok, the latest state, table, input; M10, M59), so its log —
 * and the coach's turn facts, the win chance's history, the summary and the
 * film room — started at that turn.
 */
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { parseLog, type GameLog, type LoggedFrame } from '../log.ts';
import { gameEventLog, lineText } from '../eventLog.ts';
import type { GameStateBody } from '../protocol.ts';
import { connectSeat, type PlaySession, type SeatOptions, type SeatSocket } from './session.ts';
import { memoryTableLog, tableLogKey, type TableLogStore } from './tableLog.ts';

const SEATS = [0, 1].map((s) => parseLog(gunzipSync(readFileSync(new URL(`./testdata/friend-probe-7-seat${s}.jsonl.gz`, import.meta.url))).toString('utf8')));
const urlOf = (seat: number) => `ws://192.168.1.20:8644/ws?seat=Seat${seat}TokenAbCdEfGhIjKlMn`;

class FakeSocket implements SeatSocket {
  readyState = 0;
  onopen: SeatSocket['onopen'] = null;
  onmessage: SeatSocket['onmessage'] = null;
  onclose: SeatSocket['onclose'] = null;
  onerror: SeatSocket['onerror'] = null;
  readonly sent: LoggedFrame[] = [];
  constructor(readonly url: string) {}
  send(data: string) {
    this.sent.push(JSON.parse(data) as LoggedFrame);
  }
  close() {
    this.readyState = 3;
  }
  open() {
    this.readyState = 1;
    this.onopen?.({});
  }
  msg(f: LoggedFrame) {
    const { dir: _dir, ...wire } = f;
    this.onmessage?.({ data: JSON.stringify(wire) });
  }
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

/** A seat session with fake sockets; resolves once its first socket exists (a table session reads its store first). */
async function seat(url: string, opts: SeatOptions) {
  const sockets: FakeSocket[] = [];
  const session: PlaySession = connectSeat(url, {
    socketFactory: (u) => {
      const s = new FakeSocket(u);
      sockets.push(s);
      return s;
    },
    schedule: (fn) => fn(),
    pingMs: 0,
    ...opts,
  });
  for (let i = 0; i < 20 && sockets.length === 0; i++) await tick();
  const sock = sockets[sockets.length - 1]!;
  sock.open();
  return { session, sock, sockets };
}

const s2c = (rec: GameLog) => rec.frames.filter((f) => (f.dir ?? 's2c') === 's2c');
/** Where the page goes away: the first state of `turn`. */
const cutAt = (frames: LoggedFrame[], turn: number) => frames.findIndex((f) => f.type === 'state' && (f.body as GameStateBody).turn >= turn);
/** The bridge's catch-up on a connect (§2.1, M10, M59): its cached frames, verbatim, original seq and t. */
function catchUp(before: LoggedFrame[]): LoggedFrame[] {
  const last = (type: string) => [...before].reverse().find((f) => f.type === type);
  return ['hello_ok', 'state', 'table', 'input'].map(last).filter((f): f is LoggedFrame => !!f);
}
const lines = (log: GameLog | null) => (log ? gameEventLog(log).flatMap((t) => t.lines.map((l) => `T${t.turn} ${lineText(l)}`)) : []);

describe('a table seat that comes back mid-game keeps its log (both seats, a real game)', () => {
  for (const [i, rec] of SEATS.entries()) {
    it(`seat ${i}: the Game Log after a rejoin at turn 4 is the whole game's`, async () => {
      const frames = s2c(rec);
      const cut = cutAt(frames, 4);
      expect(cut).toBeGreaterThan(0);

      // The page that saw the whole game, for comparison.
      const whole = await seat(urlOf(i), { table: true, tableLog: memoryTableLog() });
      for (const f of frames) whole.sock.msg(f);
      const want = lines(whole.session.snapshot().log);
      expect(want.some((l) => /^T[123] .* played /.test(l))).toBe(true);
      expect(want.some((l) => /^T[123] You /.test(l)) && want.some((l) => /^T[123] (Ana|Ben) /.test(l))).toBe(true);

      // Turns 1-3 on one page, then the page goes (a reload, Back to the room, a phone that dropped the tab).
      const store = memoryTableLog();
      const first = await seat(urlOf(i), { table: true, tableLog: store });
      for (const f of frames.slice(0, cut)) first.sock.msg(f);
      first.session.close();
      await tick();

      // A new page at the same seat: the catch-up, then the rest of the game.
      const again = await seat(urlOf(i), { table: true, tableLog: store });
      for (const f of catchUp(frames.slice(0, cut))) again.sock.msg(f);
      for (const f of frames.slice(cut)) again.sock.msg(f);
      const snap = again.session.snapshot();
      expect(snap.state?.turn).toBe(([...frames].reverse().find((f) => f.type === 'state')!.body as GameStateBody).turn);
      expect(snap.over).not.toBeNull();
      expect(lines(snap.log)).toEqual(want);
      // The frames the catch-up repeated are not in the log twice.
      expect(snap.log!.frames.filter((f) => f.type === 'hello_ok')).toHaveLength(1);
      expect(snap.log!.frames.filter((f) => f.type === 'state')).toHaveLength(frames.filter((f) => f.type === 'state').length);
    });
  }

  it('the new page numbers its own frames after the kept ones: none is dropped as a repeat', async () => {
    const store = memoryTableLog();
    const frames = s2c(SEATS[0]!);
    const cut = cutAt(frames, 3);
    const first = await seat(urlOf(0), { table: true, tableLog: store });
    for (const f of frames.slice(0, cut)) first.sock.msg(f);
    first.session.resync();
    first.session.resync();
    first.session.close();
    await tick();
    const again = await seat(urlOf(0), { table: true, tableLog: store });
    for (const f of catchUp(frames.slice(0, cut))) again.sock.msg(f);
    again.session.resync();
    const c2s = again.session.snapshot().log!.frames.filter((f) => f.dir === 'c2s');
    expect(c2s.map((f) => f.seq)).toEqual([1, 2, 3]);
    expect(again.sock.sent.at(-1)!.seq).toBe(3);
  });

  it('a different game on the same seat URL starts a log of its own, and the kept frames are dropped', async () => {
    const store = memoryTableLog();
    const frames = s2c(SEATS[1]!);
    const cut = cutAt(frames, 3);
    const first = await seat(urlOf(1), { table: true, tableLog: store });
    for (const f of frames.slice(0, cut)) first.sock.msg(f);
    first.session.close();
    await tick();
    // An engine that started over under the same id: its hello_ok has another stamp (M10).
    const again = await seat(urlOf(1), { table: true, tableLog: store });
    const restarted = frames.slice(0, 4).map((f) => ({ ...f, t: f.t + 60_000 }));
    for (const f of restarted) again.sock.msg(f);
    expect(again.session.snapshot().log!.frames).toHaveLength(restarted.length);
    await tick();
    expect(await store.load(tableLogKey(urlOf(1)))).toHaveLength(restarted.length);
  });

  it('a slow store does not hold the seat: past the wait it connects, and late frames are not put after the catch-up', async () => {
    let release: (v: LoggedFrame[]) => void = () => {};
    const kept = s2c(SEATS[0]!).slice(0, 10);
    const slow: TableLogStore = { ...memoryTableLog(), load: () => new Promise((r) => (release = r)) };
    const sockets: FakeSocket[] = [];
    const session = connectSeat(urlOf(0), {
      socketFactory: (u) => {
        const s = new FakeSocket(u);
        sockets.push(s);
        return s;
      },
      schedule: (fn) => fn(),
      pingMs: 0,
      table: true,
      tableLog: slow,
      tableLogWaitMs: 5,
    });
    expect(sockets).toHaveLength(0);
    await new Promise((r) => setTimeout(r, 20));
    expect(sockets).toHaveLength(1);
    release(kept);
    await tick();
    expect(session.snapshot().log).toBeNull();
    session.close();
  });

  it('against the AI with keepLog (the board’s seat): a reload at turn 4 keeps the whole game’s log', async () => {
    const AI_URL = 'ws://127.0.0.1:8642/ws';
    const frames = s2c(SEATS[0]!);
    const cut = cutAt(frames, 4);
    const whole = await seat(AI_URL, { keepLog: true, tableLog: memoryTableLog() });
    for (const f of frames) whole.sock.msg(f);
    const want = lines(whole.session.snapshot().log);
    const store = memoryTableLog();
    const first = await seat(AI_URL, { keepLog: true, tableLog: store });
    for (const f of frames.slice(0, cut)) first.sock.msg(f);
    first.session.close();
    await tick();
    const again = await seat(AI_URL, { keepLog: true, tableLog: store });
    for (const f of catchUp(frames.slice(0, cut))) again.sock.msg(f);
    for (const f of frames.slice(cut)) again.sock.msg(f);
    expect(lines(again.session.snapshot().log)).toEqual(want);
    expect(again.session.snapshot().log!.frames.filter((f) => f.type === 'hello_ok')).toHaveLength(1);
  });

  it('against the AI with keepLog: the next match on the same seat URL starts a log of its own', async () => {
    const AI_URL = 'ws://127.0.0.1:8642/ws';
    const store = memoryTableLog();
    const frames = s2c(SEATS[0]!);
    const first = await seat(AI_URL, { keepLog: true, tableLog: store });
    for (const f of frames.slice(0, cutAt(frames, 3))) first.sock.msg(f);
    first.session.close();
    await tick();
    // POST /match: a new game id on the same seat.
    const next = frames.slice(0, 4).map((f) => (f.type === 'hello_ok' || f.type === 'state' ? { ...f, body: { ...(f.body as object), gameId: 'match-next' } } : f)) as LoggedFrame[];
    const again = await seat(AI_URL, { keepLog: true, tableLog: store });
    for (const f of next) again.sock.msg(f);
    const log = again.session.snapshot().log!;
    expect(log.hello?.gameId).toBe('match-next');
    expect(log.frames).toHaveLength(next.length);
    await tick();
    expect(await store.load(tableLogKey(AI_URL))).toHaveLength(next.length);
  });

  it('against the AI without keepLog nothing is kept and the socket opens at once, as before', () => {
    let loads = 0;
    const spy: TableLogStore = { ...memoryTableLog(), load: async () => (loads++, []), append: async () => void loads++ };
    const sockets: FakeSocket[] = [];
    const session = connectSeat('ws://127.0.0.1:8642/ws', {
      socketFactory: (u) => {
        const s = new FakeSocket(u);
        sockets.push(s);
        return s;
      },
      schedule: (fn) => fn(),
      pingMs: 0,
      tableLog: spy,
    });
    expect(sockets).toHaveLength(1);
    sockets[0]!.open();
    for (const f of s2c(SEATS[0]!).slice(0, 20)) sockets[0]!.msg(f);
    expect(session.snapshot().log!.frames.length).toBeGreaterThan(0);
    expect(loads).toBe(0);
    session.close();
  });
});

describe('tableLog store', () => {
  it('keeps appends in order per key, and forgets a key on clear', async () => {
    const s = memoryTableLog();
    const f = (seq: number) => ({ v: 1, seq, t: seq, type: 'state', body: {}, dir: 's2c' }) as unknown as LoggedFrame;
    await s.append('a', [f(1), f(2)]);
    await s.append('b', [f(9)]);
    await s.append('a', [f(3)]);
    expect((await s.load('a')).map((x) => x.seq)).toEqual([1, 2, 3]);
    await s.clear('a');
    expect(await s.load('a')).toEqual([]);
    expect((await s.load('b')).map((x) => x.seq)).toEqual([9]);
  });

  it('keys a seat URL without its token, one key per URL', () => {
    const k = tableLogKey(urlOf(0));
    expect(k).toMatch(/^t[0-9a-f]{16}$/);
    expect(k).not.toContain('Seat0Token');
    expect(tableLogKey(urlOf(1))).not.toBe(k);
    expect(tableLogKey(urlOf(0))).toBe(k);
  });
});
