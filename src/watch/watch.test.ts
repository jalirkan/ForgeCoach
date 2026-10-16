// SPDX-License-Identifier: GPL-3.0-or-later
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LINES } from '../draft/draft.ts';
import {
  BASE_PLAYERS,
  canStart,
  costlyPicks,
  defaultForm,
  drafterLabel,
  playerLabel,
  seedOf,
  watchCapsOf,
  watchRequest,
  type WatchForm,
} from './choices.ts';
import { gameLogUrl, getWatch, startWatch, stopWatch, watchCaps, type WatchFetch } from './client.ts';
import { gameToFollow, lineHolds, parseWatchDraft, parseWatchList, parseWatchMatch, parseWatchState, WatchDataError } from './data.ts';
import { atDecks, replayReducer, replayView, startReplay, stepCount, stepDelay, lineWords } from './replay.ts';

const RAW = JSON.parse(readFileSync(new URL('./testdata/watch-draft.json', import.meta.url), 'utf8'));
const clone = () => JSON.parse(JSON.stringify(RAW));
const problems = (raw: unknown): string[] => {
  try {
    parseWatchDraft(raw);
    return [];
  } catch (e) {
    return e instanceof WatchDataError ? e.problems : [String(e)];
  }
};

const MATCH = {
  v: 1, kind: 'watch-match', id: 'watch-fair-fight-cube-180-4242', status: 'playing',
  startedAt: '2026-10-16T03:25:28.796Z', updatedAt: '2026-10-16T03:26:36.000Z',
  cube: { title: 'The Fair Fight Cube', file: 'cubes/fair-fight-cube-180.md' },
  seed: 4242, bestOf: 3, need: 2, paceMs: 150, view: { seat: 0, side: 'A' },
  players: {
    A: { player: 'Reckless', profile: 'Reckless', policy: 'plain', deck: 'Drafter A (UG+w)' },
    B: { player: 'search', profile: 'Default', policy: 'search', deck: 'Drafter B (WU+g)' },
  },
  games: [
    { n: 1, file: 'g1.jsonl', seed: 42421, status: 'done', winner: 'B', reason: 'AllOpponentsLost', turns: 20, startedMs: 4369, endedMs: 67026, redaction: 'pass' },
    { n: 2, file: 'g2.jsonl', seed: 42422, status: 'playing', winner: null, reason: null, turns: null, startedMs: 67186, endedMs: null, redaction: null },
  ],
  wins: { A: 0, B: 1, draws: 0 }, winner: null, current: 2,
};

describe('draft.json', () => {
  it('reads the recorded draft: 36 picks over 18 grids, pools, 40-card decks', () => {
    const d = parseWatchDraft(RAW);
    expect(d.id).toBe('watch-fair-fight-cube-180-440');
    expect(d.grids).toBe(18);
    expect(d.picks).toHaveLength(36);
    expect(d.picks[0]!.order).toBe(1);
    expect(d.picks[1]!.order).toBe(2);
    expect(d.picks[0]!.seat).not.toBe(d.picks[1]!.seat);
    expect(d.decks.A.cards).toBe(40);
    expect(d.decks.B.main.reduce((n, [c]) => n + c, 0)).toBe(40);
    expect(d.pools.A.length + d.pools.B.length).toBe(d.picks.reduce((n, p) => n + p.took.length, 0));
    expect(d.drafters).toEqual({ A: 'lab', B: 'lab' });
    expect(d.decks.A.why?.curve.length).toBeGreaterThan(0);
  });
  it('every pick took what its line held, and the second pick saw what the opener left', () => {
    const d = parseWatchDraft(RAW);
    for (const p of d.picks) expect(lineHolds(p.slots, p.line)).toEqual(p.took);
    for (let i = 1; i < d.picks.length; i += 2) {
      const a = d.picks[i - 1]!;
      const b = d.picks[i]!;
      expect(b.slots.filter((s, k) => s === null && LINES[a.line]!.includes(k)).length).toBe(3);
    }
  });
  it('refuses another kind, a hidden-information shape or a non-grid draft whole', () => {
    expect(problems({ ...clone(), kind: 'watch-match' })).toHaveLength(1);
    expect(problems({ ...clone(), faceUp: false })).toHaveLength(1);
    expect(problems({ ...clone(), format: 'winston' })).toHaveLength(1);
    expect(problems(null)).toHaveLength(1);
  });
  it('refuses a pick whose took is not its line', () => {
    const r = clone();
    r.picks[4].took = [...r.picks[4].took].reverse();
    expect(problems(r).join()).toMatch(/pick 5: took is not what the line holds/);
  });
  it('refuses a second pick on a grid the opener did not leave, or on the opener’s line', () => {
    const r = clone();
    r.picks[3].slots[r.picks[3].slots.findIndex((s: string | null) => s !== null)] = 'Black Lotus';
    expect(problems(r).join()).toMatch(/not the grid the opener left/);
    const s = clone();
    s.picks[1].line = s.picks[0].line;
    expect(problems(s).join()).toMatch(/opener's own line|line taken is empty/);
  });
  it('refuses pools that are not the sum of the picks, and decks that are not 40', () => {
    const r = clone();
    r.pools.A.pop();
    expect(problems(r).join()).toMatch(/pool A is not the sum/);
    const s = clone();
    s.decks.B.cards = 39;
    expect(problems(s).join()).toMatch(/deck B has 39 cards/);
    const t = clone();
    t.decks.A.main[0][0] = 5;
    expect(problems(t).join()).toMatch(/deck A/);
  });
  it('refuses missing picks or numbering out of order', () => {
    const r = clone();
    r.picks.pop();
    expect(problems(r).join()).toMatch(/35 picks for 18 grids/);
    const s = clone();
    s.picks[2].n = 9;
    expect(problems(s).join()).toMatch(/pick 3: numbered out of order/);
  });
  it('cleans names (control characters) and ignores unknown fields', () => {
    const r = clone();
    r.extra = { anything: 1 };
    r.decks.A.name = 'Drafter A\u0007 (WB)';
    expect(parseWatchDraft(r).decks.A.name).toBe('Drafter A (WB)');
  });
  it('a Forge-built deck has no why', () => {
    const r = clone();
    r.decks.B.builder = 'forge';
    r.decks.B.labErrors = ['too few playables'];
    const d = parseWatchDraft(r);
    expect(d.decks.B.why).toBeNull();
    expect(d.decks.B.labErrors).toEqual(['too few playables']);
  });
});

describe('match.json', () => {
  it('reads the contract’s example', () => {
    const m = parseWatchMatch(MATCH);
    expect(m.status).toBe('playing');
    expect(m.players?.B.policy).toBe('search');
    expect(m.wins).toEqual({ A: 0, B: 1, draws: 0 });
    expect(gameToFollow(m)).toBe(2);
  });
  it('recounts the wins from the finished games', () => {
    expect(parseWatchMatch({ ...MATCH, wins: { A: 5, B: 0, draws: 0 } }).wins).toEqual({ A: 0, B: 1, draws: 0 });
  });
  it('reads the runner’s short last word for a killed watch', () => {
    const m = parseWatchMatch({ v: 1, kind: 'watch-match', id: 'watch-pauper-cube-180-2', status: 'stopped', error: 'the watch process was stopped (SIGTERM)', games: [], current: null });
    expect(m.status).toBe('stopped');
    expect(m.players).toBeNull();
    expect(m.error).toMatch(/SIGTERM/);
    expect(gameToFollow(m)).toBeNull();
  });
  it('refuses an unknown status, two games playing, or games out of order', () => {
    expect(() => parseWatchMatch({ ...MATCH, status: 'paused' })).toThrow(WatchDataError);
    expect(() => parseWatchMatch({ ...MATCH, games: [{ ...MATCH.games[1], n: 1 }, MATCH.games[1]] })).toThrow(/two games playing/);
    expect(() => parseWatchMatch({ ...MATCH, games: [MATCH.games[1]] })).toThrow(/numbered/);
  });
  it('GET /watch/<id>: nulls until written; a bad draft is refused apart from the match', () => {
    const s = parseWatchState({ ok: true, id: MATCH.id, running: true, match: MATCH, draft: null });
    expect(s.draft).toBeNull();
    expect(s.match?.games).toHaveLength(2);
    const bad = parseWatchState({ ok: true, id: MATCH.id, running: false, match: MATCH, draft: { ...clone(), picks: [] } });
    expect(bad.draft).toBeNull();
    expect(bad.draftProblem).toMatch(/0 picks for 18 grids/);
    expect(bad.match).not.toBeNull();
  });
  it('GET /watch: the running id and well-formed rows', () => {
    const l = parseWatchList({ ok: true, running: 'watch-a-1', watches: [{ id: 'watch-a-1', status: 'playing', cube: 'A cube', seed: 1, bestOf: 3, players: MATCH.players, wins: { A: 1, B: 0, draws: 0 }, winner: null, updatedAt: 'x' }, { id: '../etc' }] });
    expect(l.running).toBe('watch-a-1');
    expect(l.watches).toHaveLength(1);
    expect(l.watches[0]!.players).toEqual({ A: 'Reckless', B: 'search' });
  });
});

describe('replay', () => {
  const d = parseWatchDraft(RAW);
  it('steps a pick at a time, then the decks', () => {
    expect(stepCount(d)).toBe(37);
    let s = startReplay();
    expect(s.playing).toBe(true);
    s = replayReducer(s, { kind: 'tick' }, d);
    expect(s.i).toBe(1);
    for (let k = 0; k < 100; k++) s = replayReducer(s, { kind: 'tick' }, d);
    expect(s.i).toBe(36);
    expect(atDecks(s, d)).toBe(true);
    expect(s.playing).toBe(false);
  });
  it('pause, step, back, skip to decks, play again from the start', () => {
    let s = startReplay();
    s = replayReducer(s, { kind: 'pause' }, d);
    expect(replayReducer(s, { kind: 'tick' }, d).i).toBe(0);
    s = replayReducer(s, { kind: 'next' }, d);
    s = replayReducer(s, { kind: 'next' }, d);
    expect(s.i).toBe(2);
    s = replayReducer(s, { kind: 'prev' }, d);
    expect(s.i).toBe(1);
    expect(replayReducer({ ...s, i: 0 }, { kind: 'prev' }, d).i).toBe(0);
    s = replayReducer(s, { kind: 'decks' }, d);
    expect(s.i).toBe(36);
    expect(replayReducer(s, { kind: 'next' }, d).i).toBe(36);
    s = replayReducer(s, { kind: 'play' }, d);
    expect(s).toMatchObject({ i: 0, playing: true });
    expect(replayReducer(s, { kind: 'toggle' }, d).playing).toBe(false);
    expect(replayReducer(s, { kind: 'seek', i: 99 }, d).i).toBe(36);
  });
  it('speed sets the pace', () => {
    const s = startReplay();
    expect(stepDelay(s)).toBe(1600);
    expect(stepDelay(replayReducer(s, { kind: 'speed', speed: 4 }, d))).toBe(400);
  });
  it('the view: the grid as that drafter saw it, the pools including this pick', () => {
    const v0 = replayView(d, 0);
    expect(v0.board?.slots).toEqual(d.picks[0]!.slots);
    expect(v0.board?.firstLine).toBeNull();
    expect(v0.pools[d.picks[0]!.seat]).toEqual(d.picks[0]!.took);
    expect(v0.label).toBe('Pick 1 of 36');
    const v1 = replayView(d, 1);
    expect(v1.board?.firstLine).toBe(d.picks[0]!.line);
    expect(v1.pools.A.length + v1.pools.B.length).toBe(d.picks[0]!.took.length + d.picks[1]!.took.length);
    const end = replayView(d, 36);
    expect(end.pick).toBeNull();
    expect([...end.pools.A].sort()).toEqual([...d.pools.A].sort());
    expect([...end.pools.B].sort()).toEqual([...d.pools.B].sort());
    expect(lineWords(4)).toBe('the middle column');
  });
});

describe('who drafts, who plays', () => {
  const caps = watchCapsOf({ ok: true, watch: 1, watchRunning: null });
  it('the route’s own options: the lab drafter, the search AI and the four profiles; no Claude', () => {
    expect(caps.watch).toBe(true);
    expect(caps.drafters.map((o) => o.id)).toEqual(['lab']);
    expect(caps.players.map((o) => o.id)).toEqual(['search', 'Default', 'Cautious', 'Reckless', 'Experimental']);
    expect(caps.players.some((o) => o.costly)).toBe(false);
    expect(caps.sendsDrafters).toBe(false);
  });
  it('no watch without "watch": 1', () => {
    expect(watchCapsOf({ ok: true, watch: 0 }).watch).toBe(false);
    expect(watchCapsOf(null).watch).toBe(false);
    expect(watchCapsOf({ watch: true }).watch).toBe(false);
  });
  it('defaults: lab drafter, the search AI (D414) on both sides, best of 3, pace 600 — never a Claude seat', () => {
    const rich = watchCapsOf({ watch: 1, watchDrafters: ['llm:sonnet', 'lab', 'forge-ranks'], watchPlayers: ['llm:sonnet'] });
    const f = defaultForm('fair-fight-cube-180', rich);
    expect(f).toMatchObject({ drafter: { A: 'lab', B: 'lab' }, player: { A: 'search', B: 'search' }, bestOf: 3, paceMs: 600, costOk: false });
    expect(costlyPicks(f, rich)).toHaveLength(0);
  });
  it('maps the form to exactly the route’s fields', () => {
    const f = defaultForm('fair-fight-cube-180', caps);
    const r = watchRequest({ ...f, player: { A: 'Reckless', B: 'search' }, bestOf: 5, paceMs: 150, seed: ' 4242 ' }, caps);
    expect(r).toEqual({ body: { cube: 'fair-fight-cube-180', games: 5, playerA: 'Reckless', playerB: 'search', pace: 150, seed: 4242 } });
    const random = watchRequest(f, caps);
    expect('body' in random && 'seed' in random.body).toBe(false);
    expect('body' in random && Object.keys(random.body).sort()).toEqual(['cube', 'games', 'pace', 'playerA', 'playerB']);
  });
  it('refuses what the route would: a bad seed, an unknown player, a drafter it does not take, no watch', () => {
    const f = defaultForm('fair-fight-cube-180', caps);
    expect(seedOf('0')).toHaveProperty('problem');
    expect(seedOf('800000000')).toHaveProperty('problem');
    expect(seedOf('12a')).toHaveProperty('problem');
    expect(seedOf('')).toEqual({ seed: null });
    expect(watchRequest({ ...f, seed: '-3' }, caps)).toHaveProperty('problem');
    expect(watchRequest({ ...f, player: { A: 'Grandmaster', B: 'search' } }, caps)).toHaveProperty('problem');
    expect(watchRequest({ ...f, drafter: { A: 'forge-ranks', B: 'lab' } }, caps)).toHaveProperty('problem');
    expect(watchRequest({ ...f, player: { A: 'llm:sonnet', B: 'search' } }, caps)).toHaveProperty('problem');
    expect(watchRequest({ ...f, cube: '../etc' }, caps)).toHaveProperty('problem');
    expect(watchRequest(f, { ...caps, watch: false })).toHaveProperty('problem');
  });
  it('a Claude seat (only when the helper lists one) carries a cost note and needs the confirm box', () => {
    const rich = watchCapsOf({ watch: 1, watchDrafters: ['lab', 'forge-ranks', 'llm:sonnet', 'llm:gpt'], watchPlayers: ['llm:sonnet', 'bogus'] });
    expect(rich.drafters.map((o) => o.id)).toEqual(['lab', 'forge-ranks', 'llm:sonnet']);
    expect(rich.players.map((o) => o.id)).toEqual([...BASE_PLAYERS.map((o) => o.id), 'llm:sonnet']);
    const f: WatchForm = { ...defaultForm('vintage-cube-180', rich), drafter: { A: 'llm:sonnet', B: 'lab' } };
    const costly = costlyPicks(f, rich);
    expect(costly).toHaveLength(1);
    expect(costly[0]!.cost).toMatch(/\$0\.30 a draft/);
    expect(canStart(f, rich)).toBe(false);
    expect(watchRequest(f, rich)).toEqual({ problem: expect.stringMatching(/Tick the box/) });
    expect(canStart({ ...f, costOk: true }, rich)).toBe(true);
    expect(watchRequest({ ...f, costOk: true }, rich)).toEqual({ body: expect.objectContaining({ drafterA: 'llm:sonnet', drafterB: 'lab' }) });
    // A Claude player too.
    const g: WatchForm = { ...defaultForm('vintage-cube-180', rich), player: { A: 'search', B: 'llm:sonnet' } };
    expect(canStart(g, rich)).toBe(false);
    expect(canStart({ ...g, costOk: true }, rich)).toBe(true);
    // Forge ranks costs nothing.
    expect(canStart({ ...defaultForm('vintage-cube-180', rich), drafter: { A: 'forge-ranks', B: 'lab' } }, rich)).toBe(true);
  });
  it('labels', () => {
    expect(playerLabel('search')).toBe('Search AI');
    expect(playerLabel('Reckless')).toBe('Reckless');
    expect(drafterLabel('lab')).toBe('Lab drafter');
    expect(drafterLabel('llm:haiku:thinking=low')).toBe('Haiku 5.5');
  });
});

describe('the client', () => {
  const target = { baseUrl: 'http://127.0.0.1:8643', token: null };
  const reply = (status: number, body: unknown): WatchFetch => async () => ({ ok: status < 300, status, json: async () => body });
  it('reads /health', async () => {
    expect((await watchCaps({ target, fetch: reply(200, { ok: true, watch: 1, watchRunning: 'watch-x-1' }) })).running).toBe('watch-x-1');
    expect((await watchCaps({ target, fetch: async () => Promise.reject(new Error('down')) })).watch).toBe(false);
  });
  it('POST /watch: 202, 409 busy, 400, unreachable', async () => {
    const sent: Array<{ url: string; init?: RequestInit }> = [];
    const f: WatchFetch = async (url, init) => {
      sent.push({ url, init });
      return { ok: true, status: 202, json: async () => ({ ok: true, id: 'watch-fair-fight-cube-180-7', seed: 7, state: '/watch/watch-fair-fight-cube-180-7' }) };
    };
    const body = { cube: 'fair-fight-cube-180', games: 3 as const, playerA: 'search', playerB: 'Default', pace: 600 };
    expect(await startWatch(body, { target, fetch: f })).toEqual({ ok: true, id: 'watch-fair-fight-cube-180-7', seed: 7 });
    expect(sent[0]!.url).toBe('http://127.0.0.1:8643/watch');
    expect(JSON.parse(String(sent[0]!.init?.body))).toEqual(body);
    expect(await startWatch(body, { target, fetch: reply(409, { ok: false, code: 'busy', running: 'watch-pauper-cube-180-5' }) })).toMatchObject({ ok: false, busy: 'watch-pauper-cube-180-5' });
    expect(await startWatch(body, { target, fetch: reply(400, { ok: false, message: '"cube" is one of a, b' }) })).toMatchObject({ ok: false, status: 400, message: '"cube" is one of a, b' });
    expect(await startWatch(body, { target, fetch: async () => Promise.reject(new Error('x')) })).toMatchObject({ ok: false, status: 0 });
  });
  it('GET /watch/<id> and stop; the token header on a LAN page; the game URL', async () => {
    const seen: Array<Record<string, string>> = [];
    const f: WatchFetch = async (_u, init) => {
      seen.push((init?.headers ?? {}) as Record<string, string>);
      return { ok: true, status: 200, json: async () => ({ ok: true, id: MATCH.id, running: true, match: MATCH, draft: RAW }) };
    };
    const lan = { baseUrl: 'http://192.168.1.5:8643', token: 'T0K' };
    const r = await getWatch(MATCH.id, { target: lan, fetch: f });
    expect(r.ok && r.state.draft?.picks.length).toBe(36);
    expect(seen[0]!['X-ForgeCoach-Token']).toBe('T0K');
    expect((await getWatch('../x', { target, fetch: f })).ok).toBe(false);
    expect((await getWatch(MATCH.id, { target, fetch: reply(404, {}) })).ok).toBe(false);
    expect(await stopWatch(MATCH.id, { target, fetch: reply(409, { code: 'not-running' }) })).toEqual({ ok: true, message: 'It had already ended.' });
    expect(gameLogUrl(MATCH.id, 2, target)).toBe('http://127.0.0.1:8643/watch/watch-fair-fight-cube-180-4242/game/2');
    expect(gameLogUrl(MATCH.id, 1, lan)).toBe('http://192.168.1.5:8643/watch/watch-fair-fight-cube-180-4242/game/1?token=T0K');
  });
});
