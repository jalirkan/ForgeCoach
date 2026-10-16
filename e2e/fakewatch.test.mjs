/*
 * ForgeCoach — e2e/fakewatch.test.mjs
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The e2e's fake /watch routes against ForgeCoach's own readers, on a fake
 * clock: every answer parses (watch/data.ts), match.json moves drafting →
 * playing → done as mtg-table's state machine allows, and live.ts's HTTP
 * follower rebuilds a game from the Range-polled log exactly as the real
 * route serves it (complete lines, 206 from the newline asked for).
 */
import { describe, expect, it } from 'vitest';
import { createFakeWatch } from './fakewatch.mjs';
import { parseWatchList, parseWatchState } from '../src/watch/data.ts';
import { defaultForm, watchCapsOf, watchRequest } from '../src/watch/choices.ts';
import { cubeMarkdown } from '../src/cube/custom.ts';
import { connectLive } from '../src/live.ts';

const clockAt = () => {
  let t = 1_000_000;
  return { now: () => t, go: (ms) => (t += ms) };
};

const state = (w, id) => {
  const r = w.handle('GET', `/watch/${id}`);
  expect(r.status).toBe(200);
  return parseWatchState(JSON.parse(r.body));
};

describe('the fake /watch', () => {
  it('a watch: 202, 409 while it runs, unknown fields 400, then drafting → draft → games → done 2–0', () => {
    const c = clockAt();
    const w = createFakeWatch({ now: c.now });
    expect(w.handle('POST', '/watch', '', {}, JSON.stringify({ cube: 'fair-fight-cube-180', drafterA: 'lab' })).status).toBe(400);
    const a = w.handle('POST', '/watch', '', {}, JSON.stringify({ cube: 'fair-fight-cube-180', games: 3, playerA: 'search', playerB: 'Reckless', pace: 0 }));
    expect(a.status).toBe(202);
    const id = JSON.parse(a.body).id;
    expect(w.handle('POST', '/watch', '', {}, JSON.stringify({ cube: 'pauper-cube-180' })).status).toBe(409);
    expect(w.health()).toEqual({ watch: 1, watchRunning: id });
    let s = state(w, id);
    expect(s.match?.status).toBe('drafting');
    expect(s.draft).toBeNull();
    c.go(1600);
    s = state(w, id);
    expect(s.draft?.picks).toHaveLength(36);
    expect(s.draftProblem).toBeNull();
    c.go(1000);
    s = state(w, id);
    expect(s.match?.status).toBe('playing');
    expect(s.match?.games.map((g) => g.status)).toEqual(['playing']);
    expect(w.handle('GET', `/watch/${id}/game/1`).status).toBe(404);
    c.go(20_000);
    s = state(w, id);
    expect(s.match).toMatchObject({ status: 'done', winner: 'A', wins: { A: 2, B: 0, draws: 0 } });
    expect(s.running).toBe(false);
    const l = parseWatchList(JSON.parse(w.handle('GET', '/watch').body));
    expect(l.running).toBeNull();
    expect(l.watches[0].id).toBe(id);
  });

  it('live.ts follows a game with Range polls to its over frame', async () => {
    const c = clockAt();
    const w = createFakeWatch({ now: c.now, draftMs: 0, gameStartMs: 0, bootMs: 0, gameMs: 4000 });
    const id = JSON.parse(w.handle('POST', '/watch', '', {}, JSON.stringify({ cube: 'fair-fight-cube-180', games: 1 })).body).id;
    const url = `http://127.0.0.1:8643/watch/${id}/game/1`;
    const statuses = new Set();
    let polls = 0;
    const done = new Promise((resolve) => {
      let last = null;
      connectLive(url, {
        onLog: (log) => (last = log),
        onStatus: (s, d) => {
          statuses.add(s);
          if (s === 'closed' && d === 'the game is over') resolve(last);
        },
      }, {
        pollMs: 1,
        throttleMs: 0,
        fetchImpl: async (u, init) => {
          polls++;
          c.go(250);
          const p = new URL(u);
          const r = w.handle('GET', p.pathname, p.search, init.headers);
          const body = typeof r.body === 'string' ? Buffer.from(r.body) : r.body;
          return { status: r.status, arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.length) };
        },
      });
    });
    const log = await done;
    expect(polls).toBeGreaterThan(5);
    expect(log.header.gameId).toBe(`${id}-g1`);
    expect(log.over).not.toBeNull();
    expect(log.frames.length).toBeGreaterThan(1000);
    expect(statuses.has('error')).toBe(false);
  });

  it('D443/D444: the lists on /health; ForgeCoach\'s own request with forge-ranks and a cube of yours is taken; the route\'s 400s and 413', () => {
    const c = clockAt();
    const w = createFakeWatch({ now: c.now, engine: 'd444' });
    const caps = watchCapsOf(w.health());
    expect(caps.players.map((o) => o.id)).toEqual(['Cautious', 'Default', 'Experimental', 'Reckless', 'search-v2']);
    expect(caps.custom && caps.sendsDrafters && caps.llmCap?.maxUsd === 1).toBe(true);
    const cards = 'Opt Brainstorm Ponder Preordain Counterspell Mana-Leak Daze Force-Spike Remand Impulse'.split(' ').map((n) => ({ name: n.replace('-', ' '), colors: 'U', type: 'Instant', mv: 1 }));
    const doc = cubeMarkdown({ title: 'Friday Cube', blurb: '', cards });
    const f = { ...defaultForm('my-friday-cube', caps), drafter: { A: 'lab', B: 'forge-ranks' }, player: { A: 'search-v2', B: 'Reckless' }, seed: '7' };
    const r = watchRequest(f, caps, { title: 'Friday Cube', doc });
    expect('body' in r).toBe(true);
    const post = (b) => w.handle('POST', '/watch', '', {}, JSON.stringify(b));
    // The route's refusals first (nothing runs yet).
    expect(post({ ...r.body, drafterA: 'forge-ranks' }).status).toBe(400);
    expect(post({ ...r.body, drafterB: 'llm:opus' }).status).toBe(400);
    expect(post({ ...r.body, playerB: 'llm:sonnet' }).status).toBe(400);
    expect(post({ ...r.body, cubeDoc: undefined }).status).toBe(400);
    expect(post({ ...r.body, cube: 'fair-fight-cube-180' }).status).toBe(400);
    const prose = post({ ...r.body, cubeDoc: { title: 'x', markdown: '# Just prose\n' } });
    expect([prose.status, JSON.parse(prose.body).message]).toEqual([400, expect.stringMatching(/the cube parser: no "## The list" section/)]);
    expect(post({ ...r.body, cubeDoc: { title: 'x', markdown: '#'.repeat(300 * 1024) } }).status).toBe(413);
    // Then ForgeCoach's own body: 202, and match.json says what it is from the first write.
    const a = post(r.body);
    expect(a.status).toBe(202);
    const id = JSON.parse(a.body).id;
    expect(id).toBe('watch-my-friday-cube-7');
    let s = state(w, id);
    expect(s.match).toMatchObject({ cubeTitle: 'Friday Cube', drafters: { A: 'lab', B: 'forge-ranks' }, cost: null });
    c.go(1600);
    s = state(w, id);
    expect(s.draft?.drafters).toEqual({ A: 'lab', B: 'forge-ranks' });
    expect(s.draft?.cube.title).toBe('Friday Cube');
  });
  it('D443: a Claude drafter\'s cost in match.json, moving while it drafts', () => {
    const c = clockAt();
    const w = createFakeWatch({ now: c.now, engine: 'd444' });
    const a = w.handle('POST', '/watch', '', {}, JSON.stringify({ cube: 'fair-fight-cube-180', drafterB: 'llm:sonnet', playerA: 'SEARCH', playerB: 'default' }));
    expect(a.status).toBe(202);
    const id = JSON.parse(a.body).id;
    expect(state(w, id).match?.cost).toMatchObject({ side: 'B', drafter: 'llm:sonnet', calls: 6 });
    c.go(1600);
    expect(state(w, id).match?.cost).toMatchObject({ calls: 18, decisions: 18, fallbacks: 0, usd: 0.2988 });
  });
});
