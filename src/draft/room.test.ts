/*
 * ForgeCoach — draft/room.test.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Draft with a friend (mtg-table D400): the golden grid draft both
 * implementations must reproduce, reading the server's state, links, the
 * calls with an injected fetch, the event stream and its reconnects, the
 * room as the pick screen's GridDraft, the end-of-draft replay, storage.
 */
import { describe, expect, it } from 'vitest';
import golden from './testdata/grid-golden.json';
import { apply, legalLines, newDraft, toAct, type GridDraft } from './draft.ts';
import {
  cleanName, createRoom, cubeHash, forgetRoom, friendLinks, joinLink, lastOpponentEvent, loadRooms, ownerRoomBase, parseCreated, parseJoinHash,
  parseRoomState, replayMatches, RoomClient, RoomError, roomSupport, saveRoom, sseParser, toGridDraft, type RoomState, type SavedRoom,
} from './room.ts';

interface GoldenCase {
  cube: 'big' | 'small';
  seed: number;
  firstSeat: 0 | 1;
  grids: number;
  dealt: string[];
  log: Array<{ n: number; seat: 0 | 1; grid: number; line: number; cards: string[] }>;
  picks: [string[], string[]];
}
const G = golden as unknown as { cubes: Record<string, string[]>; cases: GoldenCase[] };

describe('the golden grid draft (mtg-table tools/draft-room.mjs reproduces the same file)', () => {
  it.each(G.cases.map((c) => [`${c.cube} seed ${c.seed} first ${c.firstSeat}`, c] as const))('%s: draft.ts deals and drafts it exactly', (_, c) => {
    let d = newDraft({ cubeId: 'golden', format: 'grid', cube: [...G.cubes[c.cube]!], seed: c.seed, youFirst: c.firstSeat === 0, now: 0 }) as GridDraft;
    expect(d.dealt).toEqual(c.dealt);
    expect(d.grids).toBe(c.grids);
    while (!d.done) {
      const legal = legalLines(d);
      d = apply(d, { kind: 'line', line: legal[(d.log.length * 5 + d.g) % legal.length]! }, 0) as GridDraft;
    }
    expect(d.log.map((e) => ({ n: e.n, seat: e.who === 'you' ? 0 : 1, grid: e.at, line: e.line, cards: e.cards }))).toEqual(c.log);
    expect([d.picks.you, d.picks.ai]).toEqual(c.picks);
  });
  it('covers seeds past 32 bits, both openers and a short cube', () => {
    expect(G.cases.some((c) => c.seed > 2 ** 32)).toBe(true);
    expect(new Set(G.cases.map((c) => c.firstSeat))).toEqual(new Set([0, 1]));
    expect(G.cases.some((c) => c.grids < 18)).toBe(true);
  });
});

/** A room state like the server's, from a draft.ts GridDraft (seat 0 = 'you'). */
function stateOf(d: GridDraft, you: 0 | 1, version: number, extra: Partial<RoomState> = {}): RoomState {
  return {
    v: 1, id: 'rAbcdEFG1', version, you, format: 'grid',
    cube: { id: 'synergy', title: 'Synergy Cube', hash: 'h', size: 200 },
    grids: d.grids, g: d.done ? d.grids : d.g, slots: [...d.slots], firstLine: d.firstLine, firstSeat: d.youFirst ? 0 : 1,
    toAct: d.done ? null : toAct(d) === 'you' ? 0 : 1, done: d.done,
    seats: [{ name: 'Justin', joined: true, online: true, picks: [...d.picks.you] }, { name: 'Sam', joined: true, online: false, picks: [...d.picks.ai] }],
    log: d.log.map((e) => ({ n: e.n, seat: e.who === 'you' ? 0 : 1, grid: e.at, line: e.line!, cards: e.cards })),
    createdAt: '2026-10-06T10:00:00.000Z', expiresAt: '2026-10-07T10:00:00.000Z', seed: d.done ? d.seed : null,
    ...extra,
  };
}
const CUBE = G.cubes.big!;
const fresh = () => newDraft({ cubeId: 'synergy', format: 'grid', cube: [...CUBE], seed: 42, youFirst: true, now: 0 }) as GridDraft;

describe('reading the server', () => {
  it('accepts a real state and refuses broken ones', () => {
    const s = stateOf(fresh(), 1, 3);
    expect(parseRoomState(JSON.parse(JSON.stringify(s)))).not.toBeNull();
    for (const bad of [
      { ...s, v: 2 }, { ...s, id: '../x' }, { ...s, you: 2 }, { ...s, slots: s.slots.slice(1) }, { ...s, firstLine: 6 },
      { ...s, seats: [s.seats[0]] }, { ...s, log: [{ n: 1, seat: 0, grid: 1, line: 9, cards: [] }] }, { ...s, cube: null }, null, 'x',
    ]) expect(parseRoomState(bad)).toBeNull();
  });
  it('reads POST /room', () => {
    const ok = { ok: true, id: 'rAbcdEFG1', seat: 0, token: 'a'.repeat(22), friendToken: 'b'.repeat(22), roomPort: 8644, bases: { local: 'http://127.0.0.1:8644', lan: ['http://192.168.1.5:8644'], public: null }, cube: {}, grids: 18, expiresAt: '' };
    expect(parseCreated(ok)?.id).toBe('rAbcdEFG1');
    expect(parseCreated({ ...ok, friendToken: 'short' })).toBeNull();
    expect(parseCreated({ ...ok, bases: { local: 'x', lan: 'y', public: null } })).toBeNull();
  });
});

describe('links', () => {
  it('a join link carries the seat token in the fragment and round-trips', () => {
    const l = joinLink('http://192.168.1.5:8644/', 'rAbcdEFG1', 'b'.repeat(22));
    expect(l).toBe(`http://192.168.1.5:8644/#draft/friend/join?room=rAbcdEFG1&t=${'b'.repeat(22)}`);
    expect(parseJoinHash(new URL(l).hash)).toEqual({ room: 'rAbcdEFG1', token: 'b'.repeat(22), server: null });
    expect(parseJoinHash('#draft/friend/join?room=rAbcdEFG1&t=short')).toBeNull();
    expect(parseJoinHash('#draft/friend/join?room=../../x&t=' + 'b'.repeat(22))).toBeNull();
    expect(parseJoinHash(`#draft/friend/join?room=rAbcdEFG1&t=${'b'.repeat(22)}&s=javascript:alert(1)`)?.server).toBeNull();
    expect(parseJoinHash(`#draft/friend/join?room=rAbcdEFG1&t=${'b'.repeat(22)}&s=https://draft.example.com/`)?.server).toBe('https://draft.example.com');
  });
  it('friend links: Wi-Fi first, then the internet, then this computer', () => {
    const ls = friendLinks({ id: 'rAbcdEFG1', friendToken: 'b'.repeat(22), bases: { local: 'http://127.0.0.1:8644', lan: ['http://192.168.1.5:8644'], public: 'https://draft.example.com' } });
    expect(ls.map((x) => x.label)).toEqual(['On your Wi-Fi', 'Over the internet', 'On this computer (another browser)']);
    expect(ls[1]!.url.startsWith('https://draft.example.com/#draft/friend/join?')).toBe(true);
  });
  it('where the owner reaches the room listener', () => {
    const loc = (origin: string) => {
      const u = new URL(origin);
      return { protocol: u.protocol, hostname: u.hostname, host: u.host, port: u.port, origin: u.origin, search: '' };
    };
    expect(ownerRoomBase(loc('https://jalirkan.github.io'), 8644)).toBe('http://127.0.0.1:8644');
    expect(ownerRoomBase(loc('http://127.0.0.1:5173'), 8644)).toBe('http://127.0.0.1:8644');
    expect(ownerRoomBase(loc('http://192.168.1.5:8642'), 8644)).toBe('http://192.168.1.5:8644');
    expect(ownerRoomBase(loc('http://192.168.1.5:8644'), 8644)).toBe('http://192.168.1.5:8644');
  });
  it('names', () => {
    expect(cleanName('  Sam   Q ')).toBe('Sam Q');
    expect(cleanName('')).toBeNull();
    expect(cleanName('x'.repeat(25))).toBeNull();
  });
});

/** A fake fetch: records calls, answers from a handler. */
function fakeFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const f = async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    return handler(url, init);
  };
  return { f, calls };
}
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } });

describe('the calls', () => {
  it('roomSupport reads /health', async () => {
    const on = fakeFetch(() => json({ ok: true, draftRoom: 1, roomPort: 8644 }));
    expect(await roomSupport({ fetch: on.f, target: { baseUrl: 'http://127.0.0.1:8643', token: null } })).toEqual({ on: true, roomPort: 8644 });
    const off = fakeFetch(() => json({ ok: true }));
    expect((await roomSupport({ fetch: off.f, target: { baseUrl: 'http://127.0.0.1:8643', token: null } })).on).toBe(false);
    const down = fakeFetch(() => Promise.reject(new Error('refused')));
    expect((await roomSupport({ fetch: down.f, target: { baseUrl: 'http://127.0.0.1:8643', token: null } })).reason).toMatch(/no coach helper/);
  });
  it('createRoom posts to the helper, with the LAN token when the page has one', async () => {
    const created = { ok: true, id: 'rAbcdEFG1', seat: 0, token: 'a'.repeat(22), friendToken: 'b'.repeat(22), roomPort: 8644, bases: { local: 'http://127.0.0.1:8644', lan: [], public: null }, cube: { id: 'synergy', title: 'S', hash: 'h', size: 9 }, grids: 1, expiresAt: '' };
    const ff = fakeFetch(() => json(created, 201));
    const c = await createRoom({ cubeId: 'synergy', cubeTitle: 'Synergy Cube', cards: CUBE, name: 'Justin' }, { fetch: ff.f, target: { baseUrl: 'http://192.168.1.5:8643', token: 'pair' } });
    expect(c.friendToken).toBe('b'.repeat(22));
    expect(ff.calls[0]!.url).toBe('http://192.168.1.5:8643/room');
    expect((ff.calls[0]!.init.headers as Record<string, string>)['X-ForgeCoach-Token']).toBe('pair');
    expect(JSON.parse(ff.calls[0]!.init.body as string).cards).toHaveLength(CUBE.length);
    await expect(createRoom({ cubeId: 'x', cubeTitle: 'x', cards: [], name: 'J' }, { fetch: fakeFetch(() => json({ type: 'error', message: 'not found' }, 404)).f })).rejects.toMatchObject({ code: 'off' });
    await expect(createRoom({ cubeId: 'x', cubeTitle: 'x', cards: [], name: 'J' }, { fetch: fakeFetch(() => json({ ok: false, code: 'full', message: 'full' }, 429)).f })).rejects.toMatchObject({ code: 'full', status: 429 });
    await expect(createRoom({ cubeId: 'x', cubeTitle: 'x', cards: [], name: 'J' }, { fetch: fakeFetch(() => Promise.reject(new Error('x'))).f })).rejects.toMatchObject({ code: 'offline' });
  });
  it('the seat token goes in the X-Room-Token header, never the URL; a stale pick carries the current state', async () => {
    const s = stateOf(fresh(), 0, 4);
    const ff = fakeFetch((url, init) => {
      if (url.endsWith('/pick')) {
        const b = JSON.parse(init.body as string) as { expect: number };
        return b.expect === 4 ? json(s) : json({ ok: false, code: 'stale', message: 'moved on', state: s }, 409);
      }
      return json(s);
    });
    const c = new RoomClient('http://127.0.0.1:8644/', 'rAbcdEFG1', 'a'.repeat(22), ff.f);
    expect((await c.get()).version).toBe(4);
    await c.join('Sam');
    await c.pick(3, 4);
    for (const call of ff.calls) {
      expect(call.url).not.toContain('a'.repeat(22));
      expect((call.init.headers as Record<string, string>)['X-Room-Token']).toBe('a'.repeat(22));
    }
    expect(ff.calls.map((x) => x.url)).toEqual(['http://127.0.0.1:8644/room/rAbcdEFG1', 'http://127.0.0.1:8644/room/rAbcdEFG1/join', 'http://127.0.0.1:8644/room/rAbcdEFG1/pick']);
    const err = await c.pick(3, 3).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RoomError);
    expect((err as RoomError).code).toBe('stale');
    expect((err as RoomError).state?.version).toBe(4);
  });
});

describe('Phase 2: decks and the game (mtg-table D404)', () => {
  const T = 'c'.repeat(22);
  const done = () => {
    let d = fresh();
    while (!d.done) d = apply(d, { kind: 'line', line: legalLines(d)[0]! }, 0) as GridDraft;
    return d;
  };
  const d404 = (game: unknown, extra: Partial<RoomState> = {}) =>
    stateOf(done(), 0, 60, {
      decks: [{ ready: true, name: 'Mine', cards: 40 }, { ready: false, name: null, cards: null }],
      yourDeck: { name: 'Mine', main: [[17, 'Island'], [23, 'Opt']], sideboard: [] },
      game: game as RoomState['game'],
      ...extra,
    });

  it('reads decks, yourDeck and game; a room server before D404 sends none of them', () => {
    expect(parseRoomState(JSON.parse(JSON.stringify(stateOf(done(), 0, 60))))?.game).toBeUndefined();
    const ready = parseRoomState(JSON.parse(JSON.stringify(d404({ n: 1, state: 'ready', error: null, matchId: 'm1791307365620', tablePort: 8646, token: T }))));
    expect(ready?.game).toEqual({ n: 1, state: 'ready', error: null, matchId: 'm1791307365620', tablePort: 8646, token: T });
    expect(ready?.decks?.[1]).toEqual({ ready: false, name: null, cards: null });
    // A starting game carries no token key at all on the wire: it reads as null.
    expect(parseRoomState(JSON.parse(JSON.stringify(d404({ n: 2, state: 'starting', error: null, matchId: null, tablePort: null }))))?.game?.token).toBeNull();
    for (const bad of [
      d404({ n: 1, state: 'playing', error: null, matchId: null, tablePort: null, token: null }),
      d404({ n: 1, state: 'ready', error: null, matchId: null, tablePort: 70000, token: T }),
      d404({ n: 1, state: 'ready', error: null, matchId: null, tablePort: 8646, token: 'short' }),
      d404(null, { decks: [{ ready: true, name: 'x', cards: 40 }] as never }),
      d404(null, { yourDeck: { name: 'x', main: [['17', 'Island']], sideboard: [] } as never }),
    ]) expect(parseRoomState(JSON.parse(JSON.stringify(bad)))).toBeNull();
  });

  it('submitDeck posts the deck to /deck behind the seat token; a refused deck carries every problem', async () => {
    const after = d404(null);
    const ff = fakeFetch((_url, init) => {
      const b = JSON.parse(init.body as string) as { name: string };
      if (b.name === 'Bad') return json({ ok: false, code: 'deck', message: 'Opt: you drafted it 1 time', problems: ['Opt: you drafted it 1 time', '39 main-deck cards'], state: after }, 400);
      return json(after);
    });
    const c = new RoomClient('http://192.168.1.5:8644', 'rAbcdEFG1', 'a'.repeat(22), ff.f);
    const s = await c.submitDeck({ name: 'Mine', main: [[17, 'Island'], [23, 'Opt']], sideboard: [] });
    expect(s.yourDeck?.name).toBe('Mine');
    expect(ff.calls[0]!.url).toBe('http://192.168.1.5:8644/room/rAbcdEFG1/deck');
    expect(ff.calls[0]!.init.method).toBe('POST');
    expect((ff.calls[0]!.init.headers as Record<string, string>)['X-Room-Token']).toBe('a'.repeat(22));
    expect(JSON.parse(ff.calls[0]!.init.body as string)).toEqual({ name: 'Mine', main: [[17, 'Island'], [23, 'Opt']] });
    const err = (await c.submitDeck({ name: 'Bad', main: [[1, 'Opt']], sideboard: [[1, 'Bolt']] }).catch((e: unknown) => e)) as RoomError;
    expect(err.code).toBe('deck');
    expect(err.problems).toEqual(['Opt: you drafted it 1 time', '39 main-deck cards']);
    expect(err.state?.version).toBe(60);
    expect(JSON.parse(ff.calls[1]!.init.body as string).sideboard).toEqual([[1, 'Bolt']]);
  });
});

describe('the event stream', () => {
  it('parses server-sent events across chunk boundaries, comments and CRLF', () => {
    const got: Array<[string, string]> = [];
    const p = sseParser((e, d) => got.push([e, d]));
    p.push(': ping\n\nevent: state\nda');
    p.push('ta: {"a":1}\n\nevent: gone\r\ndata: {}\r\n\r\n');
    p.push(new TextEncoder().encode('data: plain\n\n'));
    expect(got).toEqual([['state', '{"a":1}'], ['gone', '{}'], ['message', 'plain']]);
  });

  function streamResponse(chunks: string[], end = true): Response {
    const enc = new TextEncoder();
    let i = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(ctrl) {
        if (i < chunks.length) ctrl.enqueue(enc.encode(chunks[i++]!));
        else if (end) ctrl.close();
      },
    });
    return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  }
  const timers = () => {
    const pending: Array<{ f: () => void; ms: number }> = [];
    return { pending, t: { setTimeout: (f: () => void, ms: number) => { pending.push({ f, ms }); return pending.length; }, clearTimeout: () => {} } };
  };

  it('delivers states, reconnects with backoff when the stream drops, and says gone on 404', async () => {
    const s1 = stateOf(fresh(), 0, 1);
    const s2 = stateOf(fresh(), 0, 2);
    let n = 0;
    const ff = fakeFetch(() => {
      n++;
      if (n === 1) return streamResponse([`event: state\ndata: ${JSON.stringify(s1)}\n\n`]);
      if (n === 2) return Promise.reject(new Error('offline'));
      if (n === 3) return streamResponse([`event: state\ndata: ${JSON.stringify(s2)}\n\n`], false);
      return json({ ok: false, code: 'gone', message: 'expired' }, 404);
    });
    const { pending, t } = timers();
    const states: number[] = [];
    const statuses: string[] = [];
    const c = new RoomClient('http://h:8644', 'rAbcdEFG1', 'a'.repeat(22), ff.f);
    const stop = c.stream((s) => states.push(s.version), (st) => statuses.push(st), t);
    await new Promise((r) => setTimeout(r, 20));
    expect(states).toEqual([1]);
    expect(statuses).toEqual(['live', 'reconnecting']);
    expect(pending.map((p) => p.ms)).toEqual([1000]);
    pending.shift()!.f();
    await new Promise((r) => setTimeout(r, 20));
    expect(pending.map((p) => p.ms)).toEqual([2000]);
    pending.shift()!.f();
    await new Promise((r) => setTimeout(r, 20));
    expect(states).toEqual([1, 2]);
    expect(statuses.at(-1)).toBe('live');
    stop();
    // A wrong or expired link: gone, and no more retries.
    const gone = fakeFetch(() => json({ ok: false, code: 'gone', message: 'this room does not exist or has expired' }, 404));
    const st2: string[] = [];
    const tt = timers();
    new RoomClient('http://h:8644', 'rAbcdEFG1', 'a'.repeat(22), gone.f).stream(() => {}, (st, why) => st2.push(`${st}:${why}`), tt.t);
    await new Promise((r) => setTimeout(r, 20));
    expect(st2).toEqual(['gone:this room does not exist or has expired']);
    expect(tt.pending).toEqual([]);
  });
});

describe('the room as the pick screen sees it', () => {
  it('seat 1 is "you"; the other seat is the opponent; turns and picks line up with draft.ts', () => {
    let d = fresh();
    d = apply(d, { kind: 'line', line: 4 }, 0) as GridDraft;
    const s = stateOf(d, 1, 2);
    const g = toGridDraft(s);
    expect(g.picks.you).toEqual(s.seats[1].picks);
    expect(g.picks.ai).toEqual(s.seats[0].picks);
    expect(g.youFirst).toBe(false);
    expect(toAct(g)).toBe('you');
    expect(g.log[0]).toMatchObject({ who: 'ai', kind: 'line', at: 1, line: 4 });
    expect(legalLines(g)).toEqual(legalLines(d));
    expect(lastOpponentEvent(s)?.seat).toBe(0);
    expect(lastOpponentEvent(stateOf(d, 0, 2))).toBeNull();
  });
  it('replays a finished draft from the revealed seed; a doctored log fails', () => {
    let d = fresh();
    while (!d.done) d = apply(d, { kind: 'line', line: legalLines(d)[d.log.length % legalLines(d).length]! }, 0) as GridDraft;
    const s = stateOf(d, 0, 40);
    expect(replayMatches(s, CUBE)).toBe(true);
    expect(replayMatches({ ...s, seed: null }, CUBE)).toBeNull();
    const bad = JSON.parse(JSON.stringify(s)) as RoomState;
    bad.log[3]!.cards = ['Not A Card'];
    expect(replayMatches(bad, CUBE)).toBe(false);
    expect(replayMatches({ ...s, seed: (s.seed ?? 0) + 1 }, CUBE)).toBe(false);
  });
  it('the cube hash is the server\'s (sha256 of the de-duplicated names, newline-joined)', async () => {
    // mtg-table draft-room.mjs cubeHash(['A', 'B', 'A']): createHash('sha256').update('A\\nB').digest('hex')
    expect(await cubeHash(['A', 'B', 'A'])).toBe('23519a43c66b4c342f25b32e09797ec5f3fc0be388cd8243fb3449afbdce4013');
  });
});

describe('the rooms this browser holds', () => {
  it('saves, lists newest first, keeps a seat per room, forgets', () => {
    const m = new Map<string, string>();
    const kv = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
    const r = (id: string, seat: 0 | 1): SavedRoom => ({ id, base: 'http://h:8644', token: 'a'.repeat(22), seat, cubeId: 'synergy', cubeTitle: 'S', hints: true, side: [], savedAt: 1 });
    saveRoom(r('rAAAAAAAA', 0), kv);
    saveRoom(r('rBBBBBBBB', 1), kv);
    saveRoom(r('rAAAAAAAA', 1), kv);
    expect(loadRooms(kv).map((x) => `${x.id}/${x.seat}`)).toEqual(['rAAAAAAAA/1', 'rBBBBBBBB/1', 'rAAAAAAAA/0']);
    forgetRoom('rAAAAAAAA', kv);
    expect(loadRooms(kv).map((x) => x.id)).toEqual(['rBBBBBBBB']);
    m.set('forgecoach.friendRooms.v1', '[{"id":"../x"}, 5]');
    expect(loadRooms(kv)).toEqual([]);
  });
});

describe('the friend’s name in place of the AI', () => {
  it('describeEvent and the pick prompt name the friend; Draft vs AI is unchanged', async () => {
    const { describeEvent } = await import('./draft.ts');
    const { buildPickPrompt, PICK_SYSTEM, PICK_SYSTEM_FRIEND } = await import('./pickPrompt.ts');
    const { context, loadRealMeta } = await import('../cube/testdata/load.ts');
    const ctx = context('synergy', loadRealMeta('synergy'));
    const names = ctx.cube.cards.map((c) => c.name);
    let d = newDraft({ cubeId: 'synergy', format: 'grid', cube: names, seed: 5, youFirst: false, now: 1 }) as GridDraft;
    d = apply(d, { kind: 'line', line: 0 }, 1) as GridDraft;
    const e = d.log[0]!;
    expect(describeEvent(e, d)).toBe('AI took the top row (3 cards)');
    expect(describeEvent(e, d, 'Sam')).toBe('Sam took the top row (3 cards)');
    const ai = buildPickPrompt({ ctx, draft: d, infos: new Map() });
    expect(ai.system).toBe(PICK_SYSTEM);
    const fr = buildPickPrompt({ ctx, draft: d, infos: new Map(), opponent: 'Sam' });
    expect(fr.system).toBe(PICK_SYSTEM_FRIEND);
    expect(fr.system).toContain('against another person');
    expect(fr.system).not.toMatch(/\bthe AI\b|AI drafter/);
    expect(fr.user.split('\n')[0]).toMatch(/Grid draft vs Sam \(a person\)$/);
    expect(fr.user).toContain('; Sam holds 3.');
    expect(fr.user).toContain("## Sam's picks (3, all face up)");
    expect(fr.user).not.toMatch(/the AI/);
    for (const n of d.picks.ai) expect(fr.user).toContain(n);
  });
});
