/*
 * ForgeCoach — e2e/playtest/fakehelper.mjs
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * A coach helper that answers at once (mtg-table's tools/coach-helper.mjs
 * contract as coachHelper.ts reads it: GET /health, POST /coach streaming
 * NDJSON `text` lines and a `done`). The playtest points the page at it with
 * `?coach=<url>` and counts the questions per game and turn: auto-coach's
 * cadence, and whether the panel ever goes blank, are read against it.
 * `/health` carries no `engine` key, so the page's Play vs Forge takes the
 * seat at once (an older helper: "running").
 */
import http from 'node:http';

export function startFakeHelper({ port = 0, answerMs = 50 } = {}) {
  const asks = [];
  const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-ForgeCoach-Token');
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      return res.end();
    }
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, helper: 1, claude: 'fake (playtest)', models: ['opus', 'sonnet', 'haiku'], queue: { running: 0, waiting: 0 }, thinking: ['default', 'low', 'off'] }));
    }
    if (url.pathname === '/coach' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        let j = {};
        try {
          j = JSON.parse(body);
        } catch {
          /* counted anyway */
        }
        const at = Date.now();
        asks.push({ at, supersedes: j.supersedes ?? null, userLen: (j.user ?? '').length, head: String(j.user ?? '').slice(0, 400) });
        res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
        const text = '**Answer:** Pass and keep your mana up.\n\n**Rule:** hold up interaction when you are ahead.\n\n**Confidence:** medium — a fake helper said so.';
        setTimeout(() => {
          res.write(JSON.stringify({ type: 'text', text }) + '\n');
          res.end(JSON.stringify({ type: 'done', stopReason: 'end_turn', model: 'fake' }) + '\n');
        }, answerMs);
      });
      return;
    }
    res.writeHead(404);
    res.end();
  });
  return new Promise((resolve) =>
    server.listen(port, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${server.address().port}`, asks, close: () => server.close() })),
  );
}
