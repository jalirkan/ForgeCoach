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
 *
 * Plan mode (the live coach's default, mtg-table D419): a question whose system
 * prompt is the plan format's is answered in that format — keep at the opening
 * hand, "choose play" at the coin toss, the first listed answer of an engine
 * question, else pass — so the steps check out and no correction is asked.
 * Its `type` is "moment <first line>", which the cadence check counts per game.
 */
import http from 'node:http';

/** A plan-mode reply (PLAN:, STEPS:, END) that the page's check accepts at any moment. */
export function planAnswer(user) {
  const q = String(user).split('\n')[0] ?? '';
  let step = 'pass';
  if (/Do you keep it\?/.test(q)) step = 'keep';
  else if (/play first or draw first/.test(q)) step = 'choose play';
  else if (/^The engine asks you:/.test(q)) {
    const choices = /^(?:Choices|Legal targets): (.*)\.$/m.exec(user)?.[1] ?? '';
    const pick = choices.replace(/\s*\(choose .*\)$/, '').split('; ')[0]?.replace(/ \((yours|the opponent's)\)$/, '');
    if (pick) step = `${/^Legal targets/m.test(user) ? 'target' : 'choose'} ${pick}`;
  } else if (/^It is your turn/.test(q)) step = 'hold';
  return `A fake coach: nothing to add.\nPLAN: Nothing new for now; keep your mana up.\nSTEPS:\n1. ${step}\nEND`;
}

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
        const user = String(j.user ?? '');
        const planMode = /^REPLY FORMAT\./.test(String(j.system ?? ''));
        const first = user.split('\n')[0] ?? '';
        const type = planMode ? `moment ${first.slice(0, 120)}` : (/^Decision type: (.+)$/m.exec(user)?.[1] ?? null);
        asks.push({ at, supersedes: j.supersedes ?? null, userLen: user.length, type, thinking: j.thinking ?? null, model: j.model ?? null });
        res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
        const text = planMode
          ? planAnswer(user)
          : '**Answer:** Pass and keep your mana up.\n\n**Rule:** hold up interaction when you are ahead.\n\n**Confidence:** medium — a fake helper said so.';
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
