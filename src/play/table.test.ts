/*
 * ForgeCoach — play/table.test.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * A table of two (mtg-table M59, D402/D403/D404) from the client's side: the
 * seat session fed seat 1's own recording of a real two-person game
 * (mtg-table tools/ws-two-humans.mjs `concede`, seed 5: Ana on Pacho SHIELD
 * as seat 0, Ben on Doom Legion as seat 1, gzipped into ./testdata), the
 * `table` frame, the 4002 takeover, claimWin, the room-page detection, the
 * table's seat URL, the banner's words and the coach's opponent.
 */
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import { parseLog, type LoggedFrame } from '../log.ts';
import { extractDecisions } from '../decisions.ts';
import { opponentIsHuman, type ActBody, type AnswerBody, type TableBody } from '../protocol.ts';
import { buildCoachPrompt, coachSystem } from '../prompt.ts';
import { AI_OPPONENT_PHRASE, HUMAN_OPPONENT_PHRASE, systemFor } from '../opponent.ts';
import { seatDisplayName } from './aiName.ts';
import * as A from './acts.ts';
import { connectSeat, REPLACED_DETAIL, SEAT_REPLACED_CLOSE_CODE, TABLE_UNREACHABLE_DETAIL, type SeatSocket } from './session.ts';
import { DEFAULT_SEAT_URL, defaultSeatUrl, isFunnelHost, redactSeatUrl, servedByEngine, servedByRoom, servedByTunnel, tableSeatUrl } from './seatUrl.ts';
import { clock, LOW_CLOCK_MS, tableLines } from './tableView.ts';
import { FRIEND_ROOMS_KEY, FRIEND_TABLE_KEY, loadFriendTable, saveFriendTable, savedRoomBases, tableFromRoom } from './friendTable.ts';

const REC = parseLog(gunzipSync(readFileSync(new URL('./testdata/friend-concede-5-seat1.jsonl.gz', import.meta.url))).toString('utf8'));
const TOKEN = 'AbCdEfGhIjKlMnOpQrStUv';
const TABLE_URL = `ws://192.168.1.20:8644/ws?seat=${TOKEN}`;

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
  msg(f: object) {
    this.onmessage?.({ data: JSON.stringify(f) });
  }
  drop(code = 1006, reason = '') {
    this.readyState = 3;
    this.onclose?.({ code, reason });
  }
}

function harness(now = () => 1_791_307_366_000) {
  const sockets: FakeSocket[] = [];
  const session = connectSeat(TABLE_URL, {
    socketFactory: (u) => {
      const s = new FakeSocket(u);
      sockets.push(s);
      return s;
    },
    schedule: (fn) => fn(),
    pingMs: 0,
    table: true,
    tableLog: null,
    now,
  });
  return { session, sockets, sock: () => sockets[sockets.length - 1]! };
}

const wire = (f: LoggedFrame) => {
  const { dir: _dir, ...rest } = f;
  return rest;
};

describe('the seat session at a table of two (seat 1, a real recording)', () => {
  it('plays seat 1 through to the result: every act and answer the recorded seat sent passes the guard', () => {
    const h = harness();
    h.sock().open();
    const refused: string[] = [];
    for (const f of REC.frames) {
      if (f.dir === 'c2s') {
        if (f.type === 'act' && !h.session.act(f.body as ActBody)) refused.push(JSON.stringify(f.body));
        if (f.type === 'answer') {
          const b = f.body as AnswerBody;
          if (!h.session.answer(b.askId, b.value)) refused.push(b.askId);
        }
      } else h.sock().msg(wire(f));
    }
    expect(refused).toEqual([]);
    const s = h.session.snapshot();
    expect(s.seat).toBe(1);
    expect(s.hello?.you).toBe(1);
    expect(opponentIsHuman(s.hello)).toBe(true);
    expect(s.over?.winner).toBe(0);
    // The table frame is kept, the latest one wins, and the log carries every one of them.
    expect(s.table?.you).toBe(1);
    expect(s.table?.seats.map((x) => x.name)).toEqual(['Ana', 'Ben']);
    expect(s.log!.frames.filter((f) => f.type === 'table')).toHaveLength(REC.frames.filter((f) => f.type === 'table').length);
    // Seat 1's own decisions, with seat 1's state.
    const ds = extractDecisions(s.log!);
    expect(ds.length).toBeGreaterThan(3);
    expect(ds.every((d) => d.state.players.some((p) => p.id === 1))).toBe(true);
  });

  it('names the other person as they named themselves, never "Forge AI"', () => {
    const hello = REC.hello!;
    expect(seatDisplayName(hello, hello.players[0], 'Your opponent')).toBe('Ana');
    expect(seatDisplayName(hello, hello.players[1])).toBe('Ben');
  });

  it('keeps the bridge clock offset with the table frame', () => {
    const h = harness(() => 1_791_307_366_000);
    h.sock().open();
    const t = REC.frames.find((f) => f.type === 'table' && (f.body as TableBody).seats[0]!.deciding)!;
    h.sock().msg(wire(t));
    const s = h.session.snapshot();
    expect(s.table).toEqual(t.body);
    expect(s.tableSkewMs).toBe(t.t - 1_791_307_366_000);
  });

  it('close 4002 (the seat opened elsewhere) is terminal and says so', () => {
    vi.useFakeTimers();
    try {
      const h = harness();
      h.sock().open();
      h.sock().drop(SEAT_REPLACED_CLOSE_CODE, 'replaced');
      expect(h.session.snapshot().status).toBe('refused');
      expect(h.session.snapshot().detail).toBe(REPLACED_DETAIL);
      vi.advanceTimersByTime(60_000);
      expect(h.sockets).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('an unreachable table speaks of the friend’s game, never shows the token, and never says to start an engine here', () => {
    vi.useFakeTimers();
    try {
      const h = harness();
      h.sock().drop(1006);
      const d = h.session.snapshot().detail ?? '';
      expect(d).toContain(TABLE_UNREACHABLE_DETAIL);
      expect(d).not.toContain(TOKEN);
      expect(d).not.toContain('play.sh');
    } finally {
      vi.useRealTimers();
    }
  });

  it('claimWin goes wherever concede goes: even with a question open, never after the end', () => {
    const view = { status: 'open', ask: { askId: 'a1' }, over: null, inputSeen: false };
    expect(A.whyNotAct(view, A.claimWin())).toBeNull();
    expect(A.whyNotAct(view, A.ok())).not.toBeNull();
    expect(A.whyNotAct({ ...view, over: { winner: 0, reason: 'Conceded', matchOver: true } }, A.claimWin())).toBe('the game is over');
    expect(A.whyNotAct({ ...view, status: 'error' }, A.claimWin())).toMatch(/not connected/);
  });
});

describe('room page vs bridge page (seatUrl)', () => {
  it('the draft room’s port is the room, not the bridge: no seat on its origin', () => {
    const room = { protocol: 'http:', host: '192.168.1.20:8644', search: '' };
    expect(servedByRoom(room)).toBe(true);
    expect(servedByEngine(room)).toBe(false);
    expect(defaultSeatUrl(room)).toBe(DEFAULT_SEAT_URL);
  });
  it('a room on another port is known by the rooms this browser holds a seat in', () => {
    const loc = { protocol: 'http:', host: 'room.example.net:9644', search: '' };
    expect(servedByEngine(loc)).toBe(true);
    expect(servedByEngine(loc, ['http://room.example.net:9644/'])).toBe(false);
    expect(servedByRoom(loc, ['http://other.example.net:9644'])).toBe(false);
  });
  it('a tunnel page (https, not GitHub Pages, not loopback) is the room from its first load, never the bridge (mtg-table D408)', () => {
    const loc = { protocol: 'https:', host: 'room.example.net', search: '' };
    expect(servedByTunnel(loc)).toBe(true);
    expect(servedByRoom(loc)).toBe(true);
    expect(servedByEngine(loc)).toBe(false);
    expect(defaultSeatUrl(loc)).toBe(DEFAULT_SEAT_URL);
    for (const host of ['jalirkan.github.io', 'localhost:5173', '127.0.0.1:8644', 'localhost', 'x.localhost', '[::1]:8643', 'intranet']) {
      expect(servedByTunnel({ protocol: 'https:', host }), host).toBe(false);
    }
    expect(servedByTunnel({ protocol: 'http:', host: 'room.example.net' })).toBe(false);
  });
  it('a Tailscale Funnel page (https://<machine>.<tailnet>.ts.net, mtg-table D409) is a tunnel page: the room, its seat on wss://<name>/ws', () => {
    const loc = { protocol: 'https:', host: 'pc.tail1234.ts.net', search: '' };
    expect(servedByTunnel(loc)).toBe(true);
    expect(servedByRoom(loc)).toBe(true);
    expect(servedByEngine(loc)).toBe(false);
    expect(isFunnelHost(loc.host)).toBe(true);
    expect(isFunnelHost('PC.tail1234.ts.net:443')).toBe(true);
    for (const host of ['play.example.com', 'ts.net', 'evil.ts.net.example.com', 'x.ts.network']) expect(isFunnelHost(host), host).toBe(false);
    expect(tableSeatUrl('https://pc.tail1234.ts.net', TOKEN)).toBe(`wss://pc.tail1234.ts.net/ws?seat=${TOKEN}`);
  });
  it('the bridge on its own port is still the bridge', () => {
    const loc = { protocol: 'http:', host: '192.168.1.20:8642', search: '?token=x' };
    expect(servedByRoom(loc, ['http://192.168.1.20:8644'])).toBe(false);
    expect(servedByEngine(loc, ['http://192.168.1.20:8644'])).toBe(true);
  });
  it('the table’s seat: /ws on the room’s own origin (never the table port by number), the token as ?seat=, hidden on screen', () => {
    expect(tableSeatUrl('http://192.168.1.20:8644', TOKEN)).toBe(TABLE_URL);
    // A Cloudflare tunnel (mtg-table D405): one hostname, no port, wss.
    expect(tableSeatUrl('https://play.example.com', TOKEN)).toBe(`wss://play.example.com/ws?seat=${TOKEN}`);
    expect(tableSeatUrl('https://play.example.com/', TOKEN)).toBe(`wss://play.example.com/ws?seat=${TOKEN}`);
    expect(tableSeatUrl('http://[::1]:8644', TOKEN)).toBe(`ws://[::1]:8644/ws?seat=${TOKEN}`);
    expect(tableSeatUrl('file:///x', TOKEN)).toBeNull();
    expect(tableSeatUrl('nonsense', TOKEN)).toBeNull();
    expect(redactSeatUrl(TABLE_URL)).toBe('ws://192.168.1.20:8644/ws?seat=…');
    expect(redactSeatUrl('ws://h/ws?token=a&seat=b')).toBe('ws://h/ws?token=…&seat=…');
  });
});

describe('the friend table this browser holds (friendTable)', () => {
  const store = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m };
  };
  const room = (game: unknown) => ({ id: 'rAbCdEfGh', you: 1 as const, seats: [{ name: 'Ana' }, { name: 'Ben' }], game: game as never });

  it('a ready game with this seat’s token is a table; anything else is not', () => {
    const t = tableFromRoom('http://192.168.1.20:8644', room({ n: 2, state: 'ready', tablePort: 8646, token: TOKEN }), '#draft/friend/r/rAbCdEfGh/1', 5);
    expect(t).toEqual({ room: 'rAbCdEfGh', seat: 1, game: 2, url: TABLE_URL, opponent: 'Ana', back: '#draft/friend/r/rAbCdEfGh/1', savedAt: 5, matchId: null, gameNo: null });
    // mtg-table D406: a room server that runs a best of three says the game's match id and its number in the match.
    const t3 = tableFromRoom('http://192.168.1.20:8644', room({ n: 4, state: 'ready', tablePort: 8646, token: TOKEN, matchId: 'm1791307365620', game: 2 }), '#x', 5);
    expect([t3?.matchId, t3?.gameNo, t3?.game]).toEqual(['m1791307365620', 2, 4]);
    expect(tableFromRoom('http://h:8644', room({ n: 1, state: 'starting', tablePort: null, token: null }), '#x')).toBeNull();
    expect(tableFromRoom('http://h:8644', room({ n: 1, state: 'ready', tablePort: 8646, token: null }), '#x')).toBeNull();
    expect(tableFromRoom('https://play.example.com', room({ n: 1, state: 'ready', tablePort: 8646, token: TOKEN }), '#x')?.url).toBe(`wss://play.example.com/ws?seat=${TOKEN}`);
    expect(tableFromRoom('http://h:8644', room(null), '#x')).toBeNull();
    expect(tableFromRoom('http://h:8644', room(undefined), '#x')).toBeNull();
  });

  it('round-trips through storage, and refuses what is not a table seat', () => {
    const s = store();
    expect(loadFriendTable(s)).toBeNull();
    const t = tableFromRoom('http://192.168.1.20:8644', room({ n: 1, state: 'ready', tablePort: 8646, token: TOKEN }), '#draft/friend/r/rAbCdEfGh/1', 5)!;
    saveFriendTable(t, s);
    expect(loadFriendTable(s)).toEqual(t);
    saveFriendTable({ ...t, over: true }, s);
    expect(loadFriendTable(s)?.over).toBe(true);
    s.setItem(FRIEND_TABLE_KEY, JSON.stringify({ ...t, url: 'ws://evil/ws' }));
    expect(loadFriendTable(s)).toBeNull();
    s.setItem(FRIEND_TABLE_KEY, JSON.stringify({ ...t, back: 'javascript:alert(1)' }));
    expect(loadFriendTable(s)?.back).toBe('#draft/friend');
    s.setItem(FRIEND_TABLE_KEY, '{nope');
    expect(loadFriendTable(s)).toBeNull();
  });

  it('reads the room bases this browser holds seats on', () => {
    const s = store();
    expect(savedRoomBases(s)).toEqual([]);
    s.setItem(FRIEND_ROOMS_KEY, JSON.stringify([{ base: 'http://192.168.1.20:8644' }, { nope: 1 }, null]));
    expect(savedRoomBases(s)).toEqual(['http://192.168.1.20:8644']);
  });
});

describe('the table line (tableView)', () => {
  const T0 = 1_000_000;
  const table = (over: Partial<TableBody> = {}, them: object = {}, me: object = {}): TableBody => ({
    you: 1,
    seats: [
      { seat: 0, playerId: 0, name: 'Ana', connected: true, deciding: false, decisionDeadline: null, awaySince: null, ...them },
      { seat: 1, playerId: 1, name: 'Ben', connected: true, deciding: false, decisionDeadline: null, awaySince: null, ...me },
    ],
    decisionTimeoutMs: 180_000,
    graceMs: 120_000,
    claimWinAt: null,
    canClaimWin: false,
    ...over,
  });

  it('clock', () => {
    expect(clock(0)).toBe('0:00');
    expect(clock(-5)).toBe('0:00');
    expect(clock(61_001)).toBe('1:02');
    expect(clock(3_600_000)).toBe('1:00:00');
  });
  it('says nothing against the AI or while nobody decides', () => {
    expect(tableLines(null, 0, T0)).toEqual([]);
    expect(tableLines(table(), 0, T0)).toEqual([]);
  });
  it('the other person thinking, on the bridge’s clock', () => {
    const l = tableLines(table({}, { deciding: true, decisionDeadline: T0 + 100_000 }), 10_000, T0);
    expect(l).toEqual([{ who: 'them', tone: 'thinking', canClaim: false, text: 'Ana is thinking · 1:30 left' }]);
  });
  it('the other person away: the game waits, the claim comes after the grace', () => {
    const away = tableLines(table({ claimWinAt: T0 + 90_000 }, { connected: false, deciding: true, awaySince: T0 - 30_000 }), 0, T0);
    expect(away).toEqual([{ who: 'them', tone: 'away', canClaim: false, text: 'Ana is away (0:30). The game waits for their decision; you can claim the win in 1:30.' }]);
    const claim = tableLines(table({ canClaimWin: true, claimWinAt: T0 - 1 }, { connected: false, awaySince: T0 - 125_000 }), 0, T0);
    expect(claim[0]!.canClaim).toBe(true);
    expect(claim[0]!.text).toMatch(/^Ana has been away for 2:05/);
  });
  it('this seat’s own clock, urgent under thirty seconds', () => {
    expect(tableLines(table({}, {}, { deciding: true, decisionDeadline: T0 + 170_000 }), 0, T0)).toEqual([{ who: 'you', tone: 'clock', canClaim: false, text: 'Your decision · 2:50 left' }]);
    // A one-way skew estimate never shows more than the full clock.
    expect(tableLines(table({}, {}, { deciding: true, decisionDeadline: T0 + 180_400 }), 0, T0)[0]!.text).toBe('Your decision · 3:00 left');
    const low = tableLines(table({}, {}, { deciding: true, decisionDeadline: T0 + LOW_CLOCK_MS - 1 }), 0, T0);
    expect(low[0]!.tone).toBe('low');
  });
});

describe('the coach knows its player is up against a person', () => {
  it('against the AI every system prompt is byte for byte as before', () => {
    expect(systemFor(coachSystem(), null)).toBe(coachSystem());
    expect(coachSystem()).toContain(AI_OPPONENT_PHRASE);
  });
  it('at a table of two the coach is told it is a friend, not the AI', () => {
    const d = extractDecisions(REC)[2]!;
    const p = buildCoachPrompt(REC, d, new Map());
    expect(p.system).toContain(HUMAN_OPPONENT_PHRASE);
    expect(p.system).not.toContain(AI_OPPONENT_PHRASE);
    expect(p.user).toContain('## YOU — Ben');
    expect(p.user).toContain('## OPPONENT — Ana');
  });
});
