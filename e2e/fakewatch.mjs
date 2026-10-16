/*
 * ForgeCoach — e2e/fakewatch.mjs
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The coach helper's /watch routes (mtg-table D440, docs/watch-bots.md there)
 * for the e2e and the playtest, on a clock instead of an engine:
 *
 *   /health          "watch": 1, "watchRunning"
 *   POST /watch      202 {ok, id, seed, state, game}; 409 {code: "busy", running}; 400 unknown fields
 *   GET  /watch      {ok, running, watches}
 *   GET  /watch/<id> {ok, id, running, match, draft}: drafting → the draft → game 1, 2, … → done
 *   GET  /watch/<id>/game/<n>   a recorded frame log written a few lines at a time,
 *                    complete lines only, by ?from= or Range (206 / 416), 404 until it starts
 *   POST /watch/<id>/stop
 *
 * The draft is src/watch/testdata/watch-draft.json (made by
 * scripts/watch-fixture/make.ts); each game's log is a shipped sample
 * (public/samples/human-comfort-13.jsonl.gz) under the game's own gameId.
 * Drafter A wins every game, so a best of three ends 2–0. `handle()` is
 * transport-free: the playtest's helper serves it over HTTP, the seat e2e
 * through Playwright's routing.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIELDS = new Set(['cube', 'seed', 'games', 'playerA', 'playerB', 'pace']);
const PROFILES = ['Default', 'Cautious', 'Reckless', 'Experimental'];

export const WATCH_CORS_HEADERS = {
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-ForgeCoach-Token, Range',
  'Access-Control-Expose-Headers': 'X-Log-Next, X-Log-Size, Content-Range',
  'Access-Control-Allow-Private-Network': 'true',
};

/**
 * @param {object} o
 * @param {number} [o.draftMs]  when draft.json appears
 * @param {number} [o.gameStartMs]  when game 1 is listed (its log 404s for bootMs more)
 * @param {number} [o.bootMs]
 * @param {number} [o.gameMs]  how long each game's log takes to write
 * @param {() => number} [o.now]
 */
export function createFakeWatch({ draftMs = 1500, gameStartMs = 2500, bootMs = 800, gameMs = 5000, now = Date.now } = {}) {
  const draftRaw = JSON.parse(readFileSync(path.join(ROOT, 'src/watch/testdata/watch-draft.json'), 'utf8'));
  const sample = zlib.gunzipSync(readFileSync(path.join(ROOT, 'public/samples/human-comfort-13.jsonl.gz'))).toString('utf8').split('\n').filter(Boolean);
  const watches = new Map();
  let running = null;
  const posts = [];

  const logOf = (w, n) => {
    const [head, ...rest] = sample;
    const h = JSON.parse(head);
    h.gameId = `${w.id}-g${n}`;
    return Buffer.from([JSON.stringify(h), ...rest].map((l) => `${l}\n`).join(''));
  };

  /** The watch as of now: match.json, draft.json, and how much of each game's log is written. */
  const snapshot = (w) => {
    const t = now() - w.at;
    const need = Math.floor(w.req.games / 2) + 1;
    const draft = t >= draftMs ? { ...draftRaw, id: w.id } : null;
    const games = [];
    let wins = { A: 0, B: 0, draws: 0 };
    let status = t < gameStartMs ? 'drafting' : 'playing';
    let winner = null;
    for (let n = 1; n <= w.req.games; n++) {
      const start = gameStartMs + (n - 1) * (bootMs + gameMs);
      if (t < start || wins.A >= need) break;
      const end = start + bootMs + gameMs;
      const done = t >= end;
      games.push({
        n, file: `${w.id}-g${n}.jsonl`, seed: w.req.seed * 10 + n, status: done ? 'done' : 'playing',
        winner: done ? 'A' : null, reason: done ? 'AllOpponentsLost' : null, turns: done ? 14 : null,
        startedMs: start, endedMs: done ? end : null, redaction: done ? 'pass' : null,
      });
      if (done) wins = { ...wins, A: wins.A + 1 };
    }
    if (wins.A >= need) {
      status = 'done';
      winner = 'A';
    }
    if (w.stoppedAt) {
      status = 'stopped';
      for (const g of games) if (g.status === 'playing') Object.assign(g, { status: 'error', error: 'the watch process was stopped (SIGTERM)' });
    }
    const player = (p) => (p === 'search' ? { player: 'search', profile: 'Default', policy: 'search' } : { player: p, profile: p, policy: 'plain' });
    const match = {
      v: 1, kind: 'watch-match', id: w.id, status, startedAt: new Date(w.at).toISOString(), updatedAt: new Date(now()).toISOString(),
      cube: { title: draftRaw.cube.title, file: `cubes/${w.req.cube}.md` }, seed: w.req.seed, bestOf: w.req.games, need, paceMs: w.req.pace,
      view: { seat: 0, side: 'A' },
      players: { A: { ...player(w.req.playerA), deck: status === 'drafting' ? null : draftRaw.decks.A.name }, B: { ...player(w.req.playerB), deck: status === 'drafting' ? null : draftRaw.decks.B.name } },
      games, wins, winner, current: games.find((g) => g.status === 'playing')?.n ?? null,
      ...(w.stoppedAt ? { error: 'the watch process was stopped (SIGTERM)' } : {}),
    };
    if (running === w.id && (status === 'done' || status === 'stopped')) running = null;
    return { match, draft, t };
  };

  /** How many bytes of game n's log are written at t (whole lines; all once the game is done). */
  const written = (w, n, t) => {
    const start = gameStartMs + (n - 1) * (bootMs + gameMs) + bootMs;
    if (t < start) return -1;
    const log = w.logs.get(n) ?? w.logs.set(n, logOf(w, n)).get(n);
    const frac = Math.min(1, (t - start) / gameMs);
    // A few lines at once, cut back to the last newline: never half a line.
    const want = Math.floor(log.length * frac);
    const cut = log.lastIndexOf(0x0a, Math.max(0, want - 1));
    return frac >= 1 ? log.length : cut < 0 ? 0 : cut + 1;
  };

  const json = (status, body, headers = {}) => ({ status, headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });

  function handle(method, pathname, search = '', headers = {}, bodyText = '') {
    if (pathname === '/watch' && method === 'POST') {
      let q;
      try {
        q = JSON.parse(bodyText || '{}');
      } catch {
        return json(400, { ok: false, type: 'error', message: 'the body is JSON' });
      }
      posts.push(q);
      for (const k of Object.keys(q)) if (!FIELDS.has(k)) return json(400, { ok: false, type: 'error', message: `unknown field "${k}" (cube, seed, games, playerA, playerB, pace)` });
      if (!/^[a-z0-9-]+$/.test(q.cube ?? '')) return json(400, { ok: false, type: 'error', message: '"cube" is a cube id' });
      const ok = (p) => p === undefined || p === 'search' || PROFILES.includes(p);
      if (!ok(q.playerA) || !ok(q.playerB)) return json(400, { ok: false, type: 'error', message: '"playerA" and "playerB" are "search" or a profile' });
      if (running) {
        snapshot(watches.get(running));
        if (running) return json(409, { ok: false, type: 'error', code: 'busy', running, message: `a watch is running (${running})` });
      }
      const seed = q.seed ?? 4242;
      const req = { cube: q.cube, seed, games: q.games ?? 3, playerA: q.playerA ?? 'Default', playerB: q.playerB ?? 'Default', pace: q.pace ?? 600 };
      const id = `watch-${req.cube}-${seed}`;
      watches.set(id, { id, req, at: now(), logs: new Map(), stoppedAt: null });
      running = id;
      return json(202, { ok: true, id, seed, state: `/watch/${id}`, game: `/watch/${id}/game/<n>` });
    }
    if (pathname === '/watch' && method === 'GET') {
      const list = [...watches.values()].map((w) => {
        const { match } = snapshot(w);
        return { id: w.id, status: match.status, cube: match.cube.title, seed: match.seed, bestOf: match.bestOf, players: match.players, wins: match.wins, winner: match.winner, updatedAt: match.updatedAt };
      });
      return json(200, { ok: true, running, watches: list.reverse() });
    }
    const stop = /^\/watch\/([^/]+)\/stop$/.exec(pathname);
    if (stop && method === 'POST') {
      const w = watches.get(stop[1]);
      if (!w) return json(404, { ok: false, message: 'no such watch' });
      if (running !== w.id) return json(409, { ok: false, code: 'not-running', message: 'that watch is not running' });
      w.stoppedAt = now();
      running = null;
      return json(200, { ok: true, id: w.id, stopping: true });
    }
    const one = /^\/watch\/([^/]+)$/.exec(pathname);
    if (one && method === 'GET') {
      const w = watches.get(one[1]);
      if (!w) return json(404, { ok: false, type: 'error', message: 'no such watch' });
      const { match, draft } = snapshot(w);
      return json(200, { ok: true, id: w.id, running: running === w.id, match, draft });
    }
    const game = /^\/watch\/([^/]+)\/game\/([1-9])$/.exec(pathname);
    if (game && method === 'GET') {
      const w = watches.get(game[1]);
      const n = Number(game[2]);
      if (!w) return json(404, { ok: false, message: 'no such game' });
      const { match, t } = snapshot(w);
      const g = match.games.find((x) => x.n === n);
      const size = g ? written(w, n, w.stoppedAt ? w.stoppedAt - w.at : t) : -1;
      if (size < 0) return json(404, { ok: false, type: 'error', message: 'this game has not started (yet)' });
      const log = w.logs.get(n).subarray(0, size);
      const from = new URLSearchParams(search).get('from');
      const range = /^bytes=(\d+)-$/.exec(headers.range ?? headers.Range ?? '');
      const start = from !== null ? Number(from) : range ? Number(range[1]) : 0;
      const head = { 'X-Log-Next': String(size), 'X-Log-Size': String(size), 'Content-Type': 'application/x-ndjson' };
      if (start > size || (range && start >= size)) return json(416, { ok: false, message: 'past the end of the log' }, { ...head, 'Content-Range': `bytes */${size}` });
      const body = log.subarray(start);
      if (range) return { status: 206, headers: { ...head, ...(body.length ? { 'Content-Range': `bytes ${start}-${start + body.length - 1}/${size}` } : {}) }, body };
      return { status: 200, headers: head, body };
    }
    return null;
  }

  const health = () => ({ watch: 1, watchRunning: running });
  return { handle, health, posts, watches: () => [...watches.keys()] };
}
