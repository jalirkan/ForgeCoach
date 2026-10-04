/*
 * ForgeCoach — play/session.test.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The seat session against a fake WebSocket fed from real mtg-table
 * recordings (fixtures/games/human-ability-42 and human-amount-7, copied
 * gzipped into ./testdata, and public/samples/human-auto-42): every s2c frame
 * is delivered as the bridge sent it, and every c2s frame the recorded seat
 * sent is re-sent through the session's own act()/answer() — so the guard is
 * held against every act a real seat made, and the log the session grows is
 * compared line for line with the recording.
 */
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseLog, type GameLog, type LoggedFrame } from '../log.ts';
import { extractDecisions } from '../decisions.ts';
import type { ActBody, AnswerBody, AnyCard, AskBody, GameStateBody, OverBody } from '../protocol.ts';
import {
  AI_DECK_WARNING_REDACTED,
  connectSeat,
  REFUSED_DETAIL,
  SEAT_REFUSED_CLOSE_CODE,
  type PlaySnapshot,
  type SeatOptions,
  type SeatSocket,
} from './session.ts';
import * as A from './acts.ts';

function load(url: URL): GameLog {
  return parseLog(gunzipSync(readFileSync(url)).toString('utf8'));
}
const RECORDINGS: Record<string, GameLog> = {
  'human-ability-42': load(new URL('./testdata/human-ability-42.jsonl.gz', import.meta.url)),
  'human-amount-7': load(new URL('./testdata/human-amount-7.jsonl.gz', import.meta.url)),
  'human-auto-42': load(new URL('../../public/samples/human-auto-42.jsonl.gz', import.meta.url)),
};

class FakeSocket implements SeatSocket {
  readyState = 0;
  onopen: SeatSocket['onopen'] = null;
  onmessage: SeatSocket['onmessage'] = null;
  onclose: SeatSocket['onclose'] = null;
  onerror: SeatSocket['onerror'] = null;
  readonly sent: LoggedFrame[] = [];
  closed: number | null = null;
  constructor(readonly url: string) {}
  send(data: string) {
    this.sent.push(JSON.parse(data) as LoggedFrame);
  }
  close(code = 1000) {
    this.closed = code;
    this.readyState = 3;
  }
  open() {
    this.readyState = 1;
    this.onopen?.({});
  }
  msg(f: object) {
    this.onmessage?.({ data: JSON.stringify(f) });
  }
  drop(code = 1006, reason = '') {
    this.readyState = 3;
    this.onclose?.({ code, reason });
  }
  sentOf(type: string) {
    return this.sent.filter((f) => f.type === type);
  }
}

function harness(opts: SeatOptions = {}) {
  const sockets: FakeSocket[] = [];
  const queue: (() => void)[] = [];
  const session = connectSeat('ws://127.0.0.1:8642/ws', {
    socketFactory: (u) => {
      const s = new FakeSocket(u);
      sockets.push(s);
      return s;
    },
    schedule: (fn) => queue.push(fn),
    pingMs: 0,
    ...opts,
  });
  const flush = () => {
    while (queue.length) queue.shift()!();
  };
  return { session, sockets, sock: () => sockets[sockets.length - 1]!, queue, flush };
}

/** A recorded s2c line as it was on the wire (no `dir`). */
const wire = (f: LoggedFrame) => {
  const { dir: _dir, ...rest } = f;
  return rest;
};

/** Feeds a recording through the session; returns what was refused. */
function replay(h: ReturnType<typeof harness>, rec: GameLog, gameId?: string) {
  const refused: string[] = [];
  for (const f of rec.frames) {
    if (f.dir === 'c2s') {
      if (f.type === 'act') {
        if (!h.session.act(f.body as ActBody)) refused.push(`act ${JSON.stringify(f.body)}`);
      } else if (f.type === 'answer') {
        const b = f.body as AnswerBody;
        if (!h.session.answer(b.askId, b.value)) refused.push(`answer ${b.askId}`);
      } else if (f.type === 'resync') {
        h.session.resync();
      }
    } else {
      const w = wire(f) as LoggedFrame;
      if (gameId !== undefined) {
        // Re-id a recording as another game of the same match (M38).
        const body = w.body as { gameId?: string };
        if (typeof body.gameId === 'string') w.body = { ...body, gameId } as typeof w.body;
      }
      h.sock().msg(w);
    }
  }
  return refused;
}

const key = (f: LoggedFrame) => `${f.dir}:${f.type}:${JSON.stringify(f.body)}`;

describe('connectSeat — replaying real recordings through a fake bridge', () => {
  for (const [name, rec] of Object.entries(RECORDINGS)) {
    it(`${name}: every recorded act/answer passes the guard and the log matches the recording`, () => {
      const h = harness();
      expect(h.session.snapshot().status).toBe('connecting');
      h.sock().open();
      expect(h.session.snapshot().status).toBe('open');
      // A first connect sends nothing: no handshake from the client, no resync (§2.1, ws.ts).
      expect(h.sock().sent).toEqual([]);

      const refused = replay(h, rec);
      expect(refused).toEqual([]);

      // What went out is exactly what the recorded seat sent, numbered from 1.
      const recC2s = rec.frames.filter((f) => f.dir === 'c2s');
      expect(h.sock().sent.map((f) => `${f.type}:${JSON.stringify(f.body)}`)).toEqual(
        recC2s.map((f) => `${f.type}:${JSON.stringify(f.body)}`),
      );
      expect(h.sock().sent.map((f) => f.seq)).toEqual(recC2s.map((_, i) => i + 1));
      expect(h.sock().sent.every((f) => f.v === 1 && typeof f.t === 'number')).toBe(true);

      const s = h.session.snapshot();
      expect(s.over).toEqual(rec.over);
      expect(s.ask).toBeNull();
      expect(s.seat).toBe(rec.seat);
      expect(s.hello?.gameId).toBe(rec.hello?.gameId);
      const log = s.log!;
      expect(log.header.kind).toBe('session');
      expect(log.header.recordedBy).toBe('client');
      expect(log.header.seat).toBe(rec.seat);
      expect(log.frames.map(key)).toEqual(rec.frames.map(key));

      // The coach reads the live log exactly as it reads the file.
      const strip = (d: ReturnType<typeof extractDecisions>) =>
        d.map((x) => ({ kind: x.kind, label: x.label, actions: x.actions, frameIndex: x.frameIndex }));
      expect(strip(extractDecisions(log))).toEqual(strip(extractDecisions(rec)));
    });
  }

  it('an ask is cleared by our own answer, and a second answer is never sent', () => {
    const rec = RECORDINGS['human-ability-42']!;
    const h = harness();
    h.sock().open();
    const firstAsk = rec.frames.findIndex((f) => f.type === 'ask');
    for (const f of rec.frames.slice(0, firstAsk + 1)) {
      if (f.dir === 's2c') h.sock().msg(wire(f));
      else if (f.type === 'act') h.session.act(f.body as ActBody);
      else if (f.type === 'answer') h.session.answer((f.body as AnswerBody).askId, (f.body as AnswerBody).value);
    }
    const ask = h.session.snapshot().ask as AskBody;
    expect(ask).not.toBeNull();

    // The board is modal while the question is open; concede stays reachable (§5.4).
    expect(h.session.act(A.ok())).toBe(false);
    expect(h.session.snapshot().notices.at(-1)).toMatchObject({ source: 'client', title: 'Not sent' });
    expect(h.session.answer('nope', null)).toBe(false);

    const before = h.sock().sent.length;
    expect(h.session.answer(ask.askId, null)).toBe(true);
    expect(h.session.snapshot().ask).toBeNull();
    expect(h.session.answer(ask.askId, null)).toBe(false);
    expect(h.sock().sent.length).toBe(before + 1);

    // A verbatim re-delivery of the answered ask (a resync, M10) does not reopen it.
    h.sock().msg(wire(rec.frames[firstAsk]!));
    expect(h.session.snapshot().ask).toBeNull();
    expect(h.session.act(A.ok())).toBe(true);
  });
});

describe('connectSeat — guard', () => {
  const hello = { v: 1, seq: 1, t: 1, type: 'hello_ok', body: { gameId: 'g', you: 0, seed: 1, forgeVersion: 'x', forgeJarSha256: 'y', unsupportedCards: [], players: [] } };
  const input = { v: 1, seq: 3, t: 3, type: 'input', body: { prompt: 'p', focusCardId: null, focusCard: null, buttons: { ok: { label: 'OK', enabled: true }, cancel: { label: 'Cancel', enabled: false } }, selectable: { cardIds: [], min: 0, max: 0, mode: 'none' }, highlighted: [], weak: [], openZones: [] } };

  it('drops acts before the first input (M42), except concede; newGame only after over', () => {
    const h = harness();
    expect(h.session.act(A.ok())).toBe(false); // not connected
    h.sock().open();
    h.sock().msg(hello);
    expect(h.session.snapshot().inputSeen).toBe(false);
    expect(h.session.act(A.clickCard(5))).toBe(false);
    expect(h.session.act(A.newGame('continue'))).toBe(false);
    h.sock().msg(input);
    expect(h.session.act(A.clickCard(5))).toBe(true);
    expect(h.session.act(A.newGame('continue'))).toBe(false);
    h.sock().msg({ v: 1, seq: 4, t: 4, type: 'over', body: { winner: 0, reason: 'AllOpponentsLost', matchOver: false } });
    expect(h.session.act(A.ok())).toBe(false);
    expect(h.session.act(A.newGameAfter(h.session.snapshot().over as OverBody))).toBe(true);
    expect(h.sock().sentOf('act').map((f) => f.body)).toEqual([
      { action: 'clickCard', cardId: 5 },
      { action: 'newGame', mode: 'continue' },
    ]);
    // The newGame after `over` is not written into the finished game's log (§8.4).
    expect(h.session.snapshot().log!.frames.at(-1)!.type).toBe('over');
  });

  it('builders spell every act as §2.2 does', () => {
    expect(A.yieldTo('marker', 'END_OF_TURN', 'opp')).toEqual({ action: 'yieldTo', kind: 'marker', phase: 'END_OF_TURN', turn: 'opp' });
    expect(A.yieldTo('endOfTurn')).toEqual({ action: 'yieldTo', kind: 'endOfTurn' });
    expect(A.setPhaseStop('MAIN1', 'own', true)).toEqual({ action: 'setPhaseStop', phase: 'MAIN1', turn: 'own', stop: true });
    expect(A.clickAbility(3, 7)).toEqual({ action: 'clickAbility', cardId: 3, abilityId: 7 });
    expect(A.newGameAfter({ winner: 1, reason: null, matchOver: true })).toEqual({ action: 'newGame', mode: 'restart' });
    expect([A.ok(), A.cancel(), A.pass(), A.undo(), A.alphaStrike(), A.concede(), A.nextGame()].map((a) => a.action)).toEqual([
      'buttonOk', 'buttonCancel', 'passPriority', 'undo', 'alphaStrike', 'concede', 'nextGame',
    ]);
  });
});

describe('connectSeat — connection', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('answers ping with pong, which is never logged', () => {
    const h = harness();
    h.sock().open();
    h.sock().msg({ v: 1, seq: 1, t: 1, type: 'hello_ok', body: { gameId: 'g', you: 0, seed: 1, forgeVersion: 'x', forgeJarSha256: 'y', unsupportedCards: [], players: [] } });
    h.sock().msg({ v: 1, seq: 0, t: 2, type: 'ping', body: {} });
    expect(h.sock().sentOf('pong')).toHaveLength(1);
    h.sock().msg({ v: 1, seq: 0, t: 3, type: 'pong', body: {} });
    expect(h.session.snapshot().log!.frames.map((f) => f.type)).toEqual(['hello_ok']);
  });

  it('keeps the newest state and input when frames arrive out of seq order', () => {
    const h = harness();
    h.sock().open();
    h.sock().msg({ v: 1, seq: 1, t: 1, type: 'hello_ok', body: { gameId: 'g', you: 0, seed: 1, forgeVersion: 'x', forgeJarSha256: 'y', unsupportedCards: [], players: [] } });
    const st = (seq: number, turn: number) => ({ v: 1, seq, t: seq, type: 'state', body: { gameId: 'g', turn } });
    const inp = (seq: number, prompt: string) => ({ v: 1, seq, t: seq, type: 'input', body: { prompt } });
    h.sock().msg(st(5, 3));
    h.sock().msg(st(3, 2));
    h.sock().msg(inp(6, 'newer'));
    h.sock().msg(inp(4, 'older'));
    h.flush();
    const s = h.session.snapshot();
    expect(s.state?.turn).toBe(3);
    expect(s.input?.prompt).toBe('newer');
    expect(s.log!.frames.filter((f) => f.type === 'state')).toHaveLength(2);
  });

  it('sends keepalive pings while open', () => {
    const h = harness({ pingMs: 1000 });
    h.sock().open();
    vi.advanceTimersByTime(3500);
    expect(h.sock().sentOf('ping')).toHaveLength(3);
    h.sock().drop(1006);
    vi.advanceTimersByTime(100);
    expect(h.sockets[0]!.sentOf('ping')).toHaveLength(3);
  });

  it('close 4001 is "refused" with the board-tab explanation and is not retried', () => {
    const h = harness();
    h.sock().open();
    h.sock().drop(SEAT_REFUSED_CLOSE_CODE, 'another client is connected');
    const s = h.session.snapshot();
    expect(s.status).toBe('refused');
    expect(s.detail).toBe(REFUSED_DETAIL);
    vi.advanceTimersByTime(60_000);
    expect(h.sockets).toHaveLength(1);
    h.session.reconnect();
    expect(h.sockets).toHaveLength(2);
    expect(h.session.snapshot().status).toBe('connecting');
  });

  it('an unreachable engine explains how to start it, retries with backoff, and gives up', () => {
    const h = harness();
    h.sock().drop(1006);
    let s = h.session.snapshot();
    expect(s.status).toBe('error');
    expect(s.detail).toMatch(/\.\/scripts\/play\.sh --engine-only/);
    expect(s.detail).toMatch(/scripts\/play\.sh/);
    expect(s.detail).toMatch(/local network/);
    expect(s.detail).toMatch(/Retrying in 0\.3 s/);
    const waits: number[] = [];
    for (let i = 0; i < 20 && h.session.snapshot().status === 'error'; i++) {
      const n = h.sockets.length;
      let t = 0;
      while (h.sockets.length === n) {
        vi.advanceTimersByTime(50);
        t += 50;
      }
      waits.push(t);
      expect(h.session.snapshot().status).toBe('connecting');
      h.sock().drop(1006);
    }
    expect(waits.slice(0, 6)).toEqual([250, 500, 1000, 2000, 4000, 5000]);
    s = h.session.snapshot();
    expect(s.status).toBe('closed');
    expect(h.sockets).toHaveLength(12);
    expect(s.detail).toMatch(/Gave up after 12 attempts/);
  });

  it('reconnects after a drop, resyncs, and does not duplicate re-delivered frames', () => {
    const rec = RECORDINGS['human-amount-7']!;
    const h = harness();
    h.sock().open();
    const cut = rec.frames.findIndex((f, i) => i > 50 && f.type === 'state');
    replay(h, { ...rec, frames: rec.frames.slice(0, cut + 1) });
    const sentBefore = h.sock().sent.length;
    h.sock().drop(1006);
    expect(h.session.snapshot().status).toBe('error');
    expect(h.session.act(A.ok())).toBe(false); // never queued across a disconnect
    vi.advanceTimersByTime(250);
    expect(h.sockets).toHaveLength(2);
    h.sock().open();
    // §2.4: a RE-connect sends resync.
    expect(h.sock().sent.map((f) => f.type)).toEqual(['resync']);
    expect(h.sock().sent[0]!.seq).toBe(sentBefore + 1);
    // The bridge re-delivers hello_ok and the last state verbatim (M10).
    const lastState = rec.frames[cut]!;
    h.sock().msg(wire(rec.frames[0]!));
    h.sock().msg(wire(lastState));
    const log = h.session.snapshot().log!;
    expect(log.frames.filter((f) => f.type === 'hello_ok')).toHaveLength(1);
    expect(log.frames.filter((f) => f.seq === lastState.seq && f.type === 'state')).toHaveLength(1);
    expect(log.frames.at(-1)).toMatchObject({ dir: 'c2s', type: 'resync' });
    // Continue the game on the new socket to the end.
    const refused = replay(h, { ...rec, frames: rec.frames.slice(cut + 1) });
    expect(refused).toEqual([]);
    expect(h.session.snapshot().over).toEqual(rec.over);
    // The server closing after `over` is the end, not a hiccup.
    h.sock().drop(1000, 'game over');
    expect(h.session.snapshot().status).toBe('closed');
    vi.advanceTimersByTime(60_000);
    expect(h.sockets).toHaveLength(2);
  });

  it('a new game in the match starts a new log and keeps the finished one', () => {
    const g1 = RECORDINGS['human-ability-42']!;
    const g2 = RECORDINGS['human-amount-7']!;
    const h = harness();
    h.sock().open();
    replay(h, g1);
    expect(h.session.act(A.newGame('continue'))).toBe(true);
    replay(h, { ...g2, frames: g2.frames.slice(0, 40) }, 'rerec-ability-42-g2');
    const s = h.session.snapshot();
    expect(s.previousLogs).toHaveLength(1);
    expect(s.previousLogs[0]!.over).toEqual(g1.over);
    expect(s.previousLogs[0]!.frames.length).toBe(g1.frames.length);
    expect(s.hello?.gameId).toBe('rerec-ability-42-g2');
    expect(s.over).toBeNull();
    expect(s.log!.header.gameId).toBe('rerec-ability-42-g2');
    expect(s.log!.frames[0]!.type).toBe('hello_ok');
    expect(s.state?.gameId).toBe('rerec-ability-42-g2');
  });

  it('an engine restarted under the seat (POST /match) is a new match: the old game is archived, nothing of it shows', () => {
    const g1 = RECORDINGS['human-ability-42']!;
    const h = harness({ backoffMs: 1 });
    h.sock().open();
    replay(h, { ...g1, frames: g1.frames.slice(0, 60) });
    const before = h.session.snapshot();
    expect(before.state).not.toBeNull();
    // The launcher stops the engine: 1006, no close frame; then the new engine answers.
    vi.useFakeTimers();
    h.sock().drop(1006);
    vi.advanceTimersByTime(10);
    vi.useRealTimers();
    h.sock().open();
    const hello = g1.frames.find((f) => f.type === 'hello_ok')!;
    h.sock().msg({ ...wire(hello), seq: 1, body: { ...(hello.body as object), gameId: 'match-m1791019697368', match: { yourDeck: { name: 'Practice draft - Boros', cards: 40 }, aiDeck: { name: 'AI Drafter - Simic - Artifacts', cards: 40 }, aiProfile: 'Default', games: 1 } } });
    // A stale state of the old game, re-delivered by nothing, must not show either.
    const st = g1.frames.find((f) => f.type === 'state')!;
    h.sock().msg({ ...wire(st), seq: 2 });
    const s = h.session.snapshot();
    expect(s.hello?.gameId).toBe('match-m1791019697368');
    expect(s.hello?.match?.yourDeck?.name).toBe('Practice draft - Boros');
    expect(s.state).toBeNull();
    expect(s.input).toBeNull();
    expect(s.ask).toBeNull();
    expect(s.previousLogs).toHaveLength(1);
    expect(s.log!.header.gameId).toBe('match-m1791019697368');
  });

  it('an engine restarted with the SAME game id (a bare play.sh is always seed 0) is a new session, not a reconnect', () => {
    const g1 = RECORDINGS['human-ability-42']!;
    const h = harness({ backoffMs: 1 });
    h.sock().open();
    replay(h, g1); // to the end: over
    expect(h.session.snapshot().over).not.toBeNull();
    // The engine is stopped and started again (Ctrl-C, ./scripts/play.sh): same game id, a fresh seq series.
    h.sock().drop(1000, 'game over');
    expect(h.session.snapshot().status).toBe('closed');
    h.session.reconnect();
    h.sock().open();
    const hello = g1.frames.find((f) => f.type === 'hello_ok')!;
    const t0 = hello.t + 3_600_000;
    h.sock().msg({ ...wire(hello), seq: 1, t: t0 });
    const st = g1.frames.find((f) => f.type === 'state')!;
    h.sock().msg({ ...wire(st), seq: 2, t: t0 + 5 });
    const inp = g1.frames.find((f) => f.type === 'input')!;
    h.sock().msg({ ...wire(inp), seq: 3, t: t0 + 6 });
    h.flush();
    const s = h.session.snapshot();
    expect(s.over).toBeNull();
    expect(s.previousLogs).toHaveLength(1);
    expect(s.previousLogs[0]!.over).toEqual(g1.over);
    expect(s.state).toEqual(st.body);
    expect(s.input).toEqual(inp.body);
    expect(s.log!.frames.filter((f) => f.dir === 's2c').map((f) => `${f.type}@${f.seq}`)).toEqual(['hello_ok@1', 'state@2', 'input@3']);
    expect(h.session.act(A.ok())).toBe(true);
  });

  it('a mid-game drop to an engine restarted with the same game id shows the new game, not the old frozen one', () => {
    const g1 = RECORDINGS['human-ability-42']!;
    const h = harness({ backoffMs: 1 });
    h.sock().open();
    replay(h, { ...g1, frames: g1.frames.slice(0, 120) });
    vi.useFakeTimers();
    h.sock().drop(1006);
    vi.advanceTimersByTime(10);
    vi.useRealTimers();
    h.sock().open();
    const hello = g1.frames.find((f) => f.type === 'hello_ok')!;
    h.sock().msg({ ...wire(hello), seq: 1, t: hello.t + 60_000 });
    const st = g1.frames.find((f) => f.type === 'state')!;
    h.sock().msg({ ...wire(st), seq: 2, t: hello.t + 60_001 });
    const s = h.session.snapshot();
    expect(s.state).toEqual(st.body);
    expect(s.previousLogs).toHaveLength(1);
    expect(s.log!.frames.filter((f) => f.dir === 's2c')).toHaveLength(2);
  });

  it('an ask open when the socket dropped is gone after the reconnect unless the bridge re-sends it (M19: a drop cancels parked asks)', () => {
    const rec = RECORDINGS['human-ability-42']!;
    const firstAsk = rec.frames.findIndex((f) => f.type === 'ask');
    const lastBefore = (type: string) => [...rec.frames.slice(0, firstAsk)].reverse().find((f) => f.type === type && f.dir === 's2c')!;
    for (const resent of [false, true]) {
      const h = harness({ backoffMs: 1 });
      h.sock().open();
      for (const f of rec.frames.slice(0, firstAsk + 1)) {
        if (f.dir === 's2c') h.sock().msg(wire(f));
        else if (f.type === 'act') h.session.act(f.body as ActBody);
        else if (f.type === 'answer') h.session.answer((f.body as AnswerBody).askId, (f.body as AnswerBody).value);
      }
      const ask = h.session.snapshot().ask as AskBody;
      expect(ask).not.toBeNull();
      vi.useFakeTimers();
      h.sock().drop(1006);
      vi.advanceTimersByTime(10);
      vi.useRealTimers();
      h.sock().open();
      // The bridge's catch-up: the same hello_ok and state (M10), a fresh input, and the ask only if it still waits.
      h.sock().msg(wire(rec.frames.find((f) => f.type === 'hello_ok')!));
      h.sock().msg(wire(lastBefore('state')));
      h.sock().msg({ ...wire(lastBefore('input')), seq: rec.frames[firstAsk]!.seq + 1 });
      if (resent) h.sock().msg(wire(rec.frames[firstAsk]!));
      h.flush();
      const s = h.session.snapshot();
      if (resent) {
        expect(s.ask?.askId).toBe(ask.askId);
        expect(h.session.act(A.ok())).toBe(false);
        expect(h.session.answer(ask.askId, null)).toBe(true);
      } else {
        expect(s.ask).toBeNull();
        expect(h.session.act(A.ok())).toBe(true);
      }
    }
  });

  it('Forge’s “AI can’t play these cards well” reveal is answered at once and never shows or logs the AI’s cards', () => {
    const h = harness();
    h.sock().open();
    const g1 = RECORDINGS['human-ability-42']!;
    h.sock().msg(wire(g1.frames.find((f) => f.type === 'hello_ok')!));
    h.sock().msg({
      v: 1,
      seq: 4,
      t: 1,
      type: 'ask',
      body: { askId: 'a1', kind: 'choose_list', timeoutMs: 120000, prompt: "AI can't play these cards well from Forge AI's  Deck", options: [{ id: 0, label: '=== Main Deck ===', kind: 'text' }, { id: 1, label: 'Chromatic Star (BRR)', kind: 'other' }], preselected: [], min: -1, max: -1, reveal: true },
    });
    const answers = h.sock().sentOf('answer');
    expect(answers).toHaveLength(1);
    expect(answers[0]!.body).toEqual({ askId: 'a1', value: [] });
    const s = h.session.snapshot();
    expect(s.ask).toBeNull();
    expect(JSON.stringify(s.log)).not.toContain('Chromatic Star');
    expect(JSON.stringify(s.log)).toContain(AI_DECK_WARNING_REDACTED);
    // Any other reveal is the player's to read.
    h.sock().msg({ v: 1, seq: 5, t: 2, type: 'ask', body: { askId: 'a2', kind: 'choose_list', timeoutMs: 0, prompt: 'Revealed', options: [{ id: 0, label: 'Opt', kind: 'card' }], preselected: [], min: -1, max: -1, reveal: true } });
    expect(h.session.snapshot().ask?.askId).toBe('a2');
    expect(h.sock().sentOf('answer')).toHaveLength(1);
  });

  it('notifies subscribers once per scheduled flush, with a stable snapshot', () => {
    const rec = RECORDINGS['human-amount-7']!;
    const h = harness();
    const seen: PlaySnapshot[] = [];
    h.session.subscribe((s) => seen.push(s));
    h.sock().open();
    for (const f of rec.frames.slice(0, 30)) if (f.dir === 's2c') h.sock().msg(wire(f));
    expect(seen).toHaveLength(0);
    expect(h.queue).toHaveLength(1);
    h.flush();
    expect(seen).toHaveLength(1);
    expect(h.session.snapshot()).toBe(seen[0]);
    expect(h.session.snapshot()).toBe(h.session.snapshot());
  });

  it('reconnect() opens the new seat only after the old socket has closed (one seat, M13)', () => {
    const h = harness();
    h.sock().open();
    h.session.reconnect();
    const old = h.sockets[0]!;
    expect(old.closed).toBe(1000);
    expect(h.sockets).toHaveLength(1);
    old.onclose?.({ code: 1000 });
    expect(h.sockets).toHaveLength(2);
    h.sock().open();
    expect(h.sock().sent.map((f) => f.type)).toEqual(['resync']);
    // …and does not wait forever for a close event that never comes.
    h.session.reconnect();
    expect(h.sockets).toHaveLength(2);
    vi.advanceTimersByTime(1000);
    expect(h.sockets).toHaveLength(3);
  });

  it('close() shuts the socket and stops retrying', () => {
    const h = harness();
    h.sock().open();
    h.session.close();
    expect(h.sockets[0]!.closed).toBe(1000);
    expect(h.session.snapshot().status).toBe('closed');
    vi.advanceTimersByTime(60_000);
    expect(h.sockets).toHaveLength(1);
  });
});

describe('connectSeat — an opponent’s face-down permanent never shows its face (mtg-table D371)', () => {
  it('drops alt from the board state and the log; keeps the viewer’s own', () => {
    const rec = RECORDINGS['human-auto-42']!;
    const h = harness();
    h.sock().open();
    const elves = { name: 'Llanowar Elves', manaCost: '{G}', types: 'Creature - Elf Druid', power: '1', toughness: '1' };
    let planted = 0;
    for (const f of rec.frames) {
      if (f.dir === 'c2s') continue;
      const w = structuredClone(wire(f)) as LoggedFrame;
      if (w.type === 'state') {
        const s = w.body as GameStateBody;
        for (const p of s.players) {
          const proto = p.zones.battlefield.cards.find((c) => !('hidden' in c && c.hidden));
          if (!proto) continue;
          p.zones.battlefield.cards.push({ ...proto, id: 99000 + p.id, name: '', faceDown: true, alt: { ...elves } } as AnyCard);
          planted++;
        }
      }
      h.sock().msg(w);
    }
    expect(planted).toBeGreaterThan(10);
    const snap = h.session.snapshot();
    const seat = rec.seat;
    const at = (s: GameStateBody | null, id: number) =>
      s?.players.flatMap((p) => p.zones.battlefield.cards).find((c) => c.id === id) as { alt: unknown } | undefined;
    const theirs = 99000 + (seat === 0 ? 1 : 0);
    const mine = 99000 + seat;
    expect(at(snap.state, theirs)?.alt).toBeNull();
    expect(at(snap.state, mine)?.alt).toEqual(elves);
    for (const f of snap.log!.frames) {
      if (f.type === 'state') expect(at(f.body as GameStateBody, theirs)?.alt ?? null).toBeNull();
    }
  });
});
