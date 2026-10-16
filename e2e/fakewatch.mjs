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
 * With `engine: 'd444'` it is the helper after mtg-table D443/D444: `/health`
 * lists `watchDrafters` / `watchPlayers` (objects, the docs' example) and says
 * `watchLlmCap` and `watchCustom: 1`; `POST /watch` takes `drafterA`/`drafterB`
 * (at most one not `lab`), players by id (case-insensitive, `search` =
 * `search-v2`), and a `my-<slug>` cube with its `cubeDoc` (400 in the parser's
 * words, 413 past 256 KB); match.json carries `drafters` and, with a Claude
 * drafter, `cost`. Without it, the D440 helper as before.
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
const FIELDS_D444 = new Set([...FIELDS, 'drafterA', 'drafterB', 'cubeDoc']);
const PROFILES = ['Default', 'Cautious', 'Reckless', 'Experimental'];

/** mtg-table D443's lists, as docs/watch-bots.md shows them. */
export const D443_HEALTH = {
  watchDrafters: [
    { id: 'lab', label: 'Lab drafter (card ratings, themes and colours)' },
    { id: 'forge-ranks', label: "Forge's card ranks (no themes, commits early)" },
    { id: 'llm:haiku', label: 'Claude Haiku, asked once a pick', costNote: 'about $0.02 a draft at list price (measured $0.015); spends Claude usage through the logged-in Claude Code CLI, at most $1 and 40 calls a watch, and stops the watch if more than 25% of its picks fall back; asks for a confirm' },
    { id: 'llm:sonnet', label: 'Claude Sonnet, asked once a pick', costNote: 'about $0.30 a draft at list price; spends Claude usage through the logged-in Claude Code CLI, at most $1 and 40 calls a watch; asks for a confirm' },
  ],
  watchPlayers: [
    { id: 'Cautious', label: 'Forge AI (Cautious)' },
    { id: 'Default', label: 'Forge AI (Default)' },
    { id: 'Experimental', label: 'Forge AI (Experimental)' },
    { id: 'Reckless', label: 'Forge AI (Reckless)' },
    { id: 'search-v2', label: 'Search AI (search-v2: Forge AI plus a look-ahead search)' },
  ],
  watchLlmCap: { maxUsd: 1, maxCalls: 40, maxFallbackRate: 0.25 },
  watchCustom: 1,
};
const MAX_CUBE_DOC = 256 * 1024;
const MAX_WATCH_BODY = 600 * 1024;

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
export function createFakeWatch({ draftMs = 1500, gameStartMs = 2500, bootMs = 800, gameMs = 5000, now = Date.now, engine = 'd440' } = {}) {
  const d444 = engine === 'd444';
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

  /** match.json `cost` (D443): a Claude drafter's spend, 18 picks at about 1.7 cents. */
  const costOf = (req, drafted) => {
    const side = req.drafterA.startsWith('llm:') ? 'A' : req.drafterB.startsWith('llm:') ? 'B' : null;
    if (!side) return null;
    const n = drafted ? 18 : 6;
    const usd = req[`drafter${side}`] === 'llm:haiku' ? 0.0008 * n : 0.0166 * n;
    return { side, drafter: req[`drafter${side}`], caps: D443_HEALTH.watchLlmCap, calls: n, callErrors: 0, decisions: n, retries: 0, fallbacks: 0, tokensIn: 2 * n, cacheRead: 0, cacheCreate: 3200 * n, tokensOut: 360 * n, usd: Math.round(usd * 1e4) / 1e4, stopped: null, why: null };
  };

  /** The watch as of now: match.json, draft.json, and how much of each game's log is written. */
  const snapshot = (w) => {
    const t = now() - w.at;
    const need = Math.floor(w.req.games / 2) + 1;
    const cubeOf = w.req.cubeDoc ? { title: w.req.cubeDoc.title, file: `var/spectate/${w.id}/cube.md`, sha256: draftRaw.cube.sha256 } : draftRaw.cube;
    const draft = t >= draftMs ? { ...draftRaw, id: w.id, cube: cubeOf, drafters: { A: { drafter: w.req.drafterA }, B: { drafter: w.req.drafterB } } } : null;
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
    const player = (p) => (/^search(-v2)?$/i.test(p) ? { player: 'search', profile: 'Default', policy: 'search' } : { player: p, profile: p, policy: 'plain' });
    const match = {
      v: 1, kind: 'watch-match', id: w.id, status, startedAt: new Date(w.at).toISOString(), updatedAt: new Date(now()).toISOString(),
      cube: w.req.cubeDoc ? { title: w.req.cubeDoc.title, file: cubeOf.file } : { title: draftRaw.cube.title, file: `cubes/${w.req.cube}.md` }, seed: w.req.seed, bestOf: w.req.games, need, paceMs: w.req.pace,
      view: { seat: 0, side: 'A' },
      players: { A: { ...player(w.req.playerA), deck: status === 'drafting' ? null : draftRaw.decks.A.name }, B: { ...player(w.req.playerB), deck: status === 'drafting' ? null : draftRaw.decks.B.name } },
      games, wins, winner, current: games.find((g) => g.status === 'playing')?.n ?? null,
      ...(d444 ? { drafters: { A: { drafter: w.req.drafterA }, B: { drafter: w.req.drafterB } }, cost: costOf(w.req, !!draft) } : {}),
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
      const no = (message, status = 400) => json(status, { ok: false, type: 'error', message });
      if (d444 && Buffer.byteLength(bodyText) > MAX_WATCH_BODY) return no(`the body is at most ${MAX_WATCH_BODY / 1024} KB`, 413);
      const fields = d444 ? FIELDS_D444 : FIELDS;
      for (const k of Object.keys(q)) if (!fields.has(k)) return no(`unknown field "${k}" (${[...fields].join(', ')})`);
      if (!/^[a-z0-9-]+$/.test(q.cube ?? '')) return no('"cube" is a cube id');
      let players = ['search', ...PROFILES].map((p) => p.toLowerCase());
      let drafterA = 'lab';
      let drafterB = 'lab';
      let cubeDoc = null;
      if (d444) {
        const listed = D443_HEALTH.watchPlayers.map((p) => p.id.toLowerCase());
        players = [...listed, 'search'];
        const ids = D443_HEALTH.watchDrafters.map((d) => d.id);
        for (const k of ['drafterA', 'drafterB']) if (q[k] !== undefined && !ids.includes(q[k])) return no(`"${k}" is one of ${ids.join(', ')}`);
        drafterA = q.drafterA ?? 'lab';
        drafterB = q.drafterB ?? 'lab';
        if (drafterA !== 'lab' && drafterB !== 'lab') return no('at most one drafter that is not "lab"');
        const custom = q.cube.startsWith('my-');
        if (q.cubeDoc !== undefined) {
          if (!/^my-[a-z0-9-]{1,60}$/.test(q.cube)) return no('with "cubeDoc", "cube" is your cube\'s id: "my-" and then 1-60 lowercase letters, digits and dashes');
          const d = q.cubeDoc;
          if (!d || typeof d !== 'object' || Array.isArray(d) || Object.keys(d).some((k) => k !== 'title' && k !== 'markdown')) return no('"cubeDoc" is {"title": "...", "markdown": "..."}');
          // eslint-disable-next-line no-control-regex
          if (typeof d.title !== 'string' || /[\u0000-\u001f\u007f]/.test(d.title) || !d.title.trim() || [...d.title.trim()].length > 80) return no('"cubeDoc.title" is a line of text, 1-80 characters');
          if (typeof d.markdown !== 'string' || !d.markdown) return no('"cubeDoc.markdown" is the cube document (markdown), as a string');
          const bytes = Buffer.byteLength(d.markdown);
          if (bytes > MAX_CUBE_DOC) return no(`"cubeDoc.markdown" is ${Math.ceil(bytes / 1024)} KB; at most ${MAX_CUBE_DOC / 1024} KB`, 413);
          const names = new Set(d.markdown.split('\n').filter((l) => l && !/^#|^\*|^-/.test(l) && !l.startsWith('Forge')).flatMap((l) => l.replace(/^[WUBRG]{2}: /, '').split(' · ')).map((x) => x.split(' — ')[0].trim()).filter(Boolean));
          if (!/^## The list/m.test(d.markdown) || !/^### .+ \(\d+\)$/m.test(d.markdown) || names.size < 9) return no(`the cube document lists ${/^## The list/m.test(d.markdown) ? names.size : 0} different cards; a grid draft needs at least 9 (the cube parser: no "## The list" section with "### Section (N)" headings found)`);
          cubeDoc = { title: d.title.trim().replace(/\s+/g, ' '), markdown: d.markdown };
        } else if (custom) return no('a "my-" cube comes with its "cubeDoc"');
      }
      const ok = (p) => p === undefined || players.includes(p.toLowerCase());
      if (!ok(q.playerA) || !ok(q.playerB)) return no(`"playerA" and "playerB" are one of ${players.join(', ')}`);
      if (running) {
        snapshot(watches.get(running));
        if (running) return json(409, { ok: false, type: 'error', code: 'busy', running, message: `a watch is running (${running})` });
      }
      const seed = q.seed ?? 4242;
      const req = { cube: q.cube, seed, games: q.games ?? 3, playerA: q.playerA ?? 'Default', playerB: q.playerB ?? 'Default', pace: q.pace ?? 600, drafterA, drafterB, cubeDoc };
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

  const health = () => ({ watch: 1, watchRunning: running, ...(d444 ? D443_HEALTH : {}) });
  return { handle, health, posts, watches: () => [...watches.keys()] };
}
