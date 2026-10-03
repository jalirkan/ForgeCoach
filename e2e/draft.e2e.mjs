#!/usr/bin/env node
/*
 * ForgeCoach — e2e/draft.e2e.mjs
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * End-to-end: draft vs AI → build → Begin the duel → the board, against the
 * real Forge engine and mtg-table's match launcher (docs/match-launcher.md,
 * D303), using only what a user clicks:
 *
 *   1. starts `./scripts/play.sh --engine-only` in an mtg-table checkout (the
 *      coach helper, and with it /match, on), unless SEAT_URL points at a
 *      running one;
 *   2. builds ForgeCoach and serves dist/ with `vite preview` on 127.0.0.1;
 *   3. drafts a seeded Grid draft to the end (the page's Math.random is
 *      seeded, so the deal and the coin toss replay from SEED);
 *   4. "Suggest a build", basics up to 40 if needed, Submit;
 *   5. Bo1, Begin the duel, and waits for POST /match → 200;
 *   6. the page takes the seat again (?play=1): the next hello_ok must be the
 *      NEW match (gameId match-<id>, yourDeck named as sent, the AI's deck
 *      named by its archetype), and the board must reach keep/mulligan or
 *      play/draw;
 *   7. the AI's decklist is never in the DOM while playing: no card of its
 *      deck that isn't also in yours, and that the engine hasn't shown, is in
 *      the page's HTML.
 *
 * Environment:
 *   MTG_TABLE      the mtg-table checkout          (default ../mtg-table)
 *   FORGE_JAR      Forge's fat jar, passed to play.sh (default: mtg-table's config.json)
 *   WS_PORT        the engine's port               (default 8642)
 *   COACH_PORT     the helper's port               (default 8643)
 *   SEAT_URL       use an engine already running here instead of starting one
 *                  (its helper must be at COACH_URL, default http://127.0.0.1:8643)
 *   APP_URL        a running ForgeCoach to test    (default: build + vite preview)
 *   SEED           the draft's seed                (default 7)
 *   HEADLESS       0 to watch                      (default 1)
 *   OUT            screenshots and logs            (default e2e/out/)
 *
 * Exit status: 0 pass, 1 fail, 2 could not start. Every process it starts
 * (play.sh, and through it the JVM and the helper; vite preview) is stopped
 * by PID on the way out.
 */
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { healthUrl, launchBrowser, loadPlaywright, waitHttp } from './harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = process.env;
const OUT = path.resolve(env.OUT || path.join(ROOT, 'e2e', 'out'));
const HEADLESS = !/^(0|false|no)$/i.test(env.HEADLESS ?? '1');
const SEED = Number(env.SEED || 7);
const WS_PORT = Number(env.WS_PORT || 8642);
const COACH_PORT = Number(env.COACH_PORT || 8643);
const OWN_ENGINE = !env.SEAT_URL;
const SEAT_URL = env.SEAT_URL || `ws://127.0.0.1:${WS_PORT}/ws`;
const COACH_URL = env.COACH_URL || `http://127.0.0.1:${COACH_PORT}`;
const MTG_TABLE = path.resolve(env.MTG_TABLE || path.join(ROOT, '..', 'mtg-table'));
const BASICS = new Set(['Plains', 'Island', 'Swamp', 'Mountain', 'Forest', 'Wastes']);

class Fail extends Error {}
const t0 = Date.now();
const log = (...a) => console.log(`[e2e draft +${((Date.now() - t0) / 1000).toFixed(0)}s]`, ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Processes

const children = [];
function track(name, child) {
  children.push({ name, child });
  return child;
}
function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
/** SIGTERM, then SIGKILL after `ms`; by PID only. */
async function stopPid(pid, ms = 15_000) {
  if (!pid || !alive(pid)) return;
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    return;
  }
  const deadline = Date.now() + ms;
  while (Date.now() < deadline && alive(pid)) await sleep(200);
  if (alive(pid)) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      /* gone */
    }
  }
}

let engineOut = '';
/** The bridge PIDs play.sh printed ("pid N · log …"): stopped too, should play.sh leave one. */
const bridgePids = new Set();

async function startEngine() {
  if (!existsSync(path.join(MTG_TABLE, 'scripts', 'play.sh'))) {
    console.error(`e2e: no mtg-table checkout at ${MTG_TABLE} (set MTG_TABLE).`);
    process.exit(2);
  }
  for (const [p, what] of [
    [WS_PORT, 'engine'],
    [COACH_PORT, 'helper'],
  ]) {
    if (await waitHttp(`http://127.0.0.1:${p}/health`, 500, { ok: () => true })) {
      console.error(`e2e: something already answers on port ${p} (the ${what} port). Set WS_PORT/COACH_PORT, or SEAT_URL to use it.`);
      process.exit(2);
    }
  }
  const args = ['--engine-only', '--no-open', '--port', String(WS_PORT), '--coach-port', String(COACH_PORT)];
  log(`starting ${MTG_TABLE}/scripts/play.sh ${args.join(' ')}`);
  const child = track(
    'play.sh',
    spawn(path.join(MTG_TABLE, 'scripts', 'play.sh'), args, { cwd: MTG_TABLE, stdio: ['ignore', 'pipe', 'pipe'], env: { ...env } }),
  );
  const onData = (d) => {
    const s = d.toString();
    engineOut += s;
    for (const m of s.matchAll(/^pid (\d+) · log/gm)) bridgePids.add(Number(m[1]));
  };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  // A cold build and boot on a busy machine: generous.
  const deadline = Date.now() + 15 * 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) break;
    if (/Engine ready on ws:/.test(engineOut)) {
      log(`engine ready (${engineOut.match(/^Match launcher:.*$/m)?.[0] ?? 'no match launcher line'})`);
      return;
    }
    await sleep(500);
  }
  console.error(`e2e: play.sh did not get ready:\n${engineOut.slice(-3000)}`);
  throw new Error('engine did not start');
}

async function startPreview() {
  if (!/^(0|false|no)$/i.test(env.BUILD ?? '1')) {
    log('building ForgeCoach (npm run build)');
    execFileSync('npm', ['run', 'build'], { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'] });
  }
  // A Vite port (src/play/seatUrl.ts DEV_PORTS): on any other port the page
  // takes itself for one the bridge served (phone play) and goes straight to the seat.
  let port = 0;
  for (const p of [4173, 4174, 5174, 5173]) {
    if (!(await waitHttp(`http://127.0.0.1:${p}/`, 300, { ok: () => true }))) {
      port = p;
      break;
    }
  }
  if (!port) throw new Error('ports 4173, 4174, 5174 and 5173 are all busy: set APP_URL, or free one');
  const bin = path.join(ROOT, 'node_modules', '.bin', 'vite');
  const child = track('vite preview', spawn(bin, ['preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] }));
  let out = '';
  child.stdout.on('data', (d) => (out += d));
  child.stderr.on('data', (d) => (out += d));
  const url = `http://127.0.0.1:${port}/`;
  if (await waitHttp(url, 60_000, { alive: () => child.exitCode === null })) return url;
  throw new Error(`vite preview did not start on ${url}:\n${out}`);
}

async function cleanup() {
  for (const { name, child } of children.reverse()) {
    if (child.pid && alive(child.pid)) {
      log(`stopping ${name} (pid ${child.pid})`);
      // play.sh stops its bridge and its helper itself on SIGTERM.
      await stopPid(child.pid, name === 'play.sh' ? 30_000 : 5_000);
    }
  }
  for (const pid of bridgePids) {
    if (alive(pid)) {
      log(`stopping a bridge play.sh left behind (pid ${pid})`);
      await stopPid(pid, 5_000);
    }
  }
}

// ---------------------------------------------------------------------------
// The flow

async function main() {
  const pw = await loadPlaywright();
  mkdirSync(OUT, { recursive: true });
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, () => void cleanup().then(() => process.exit(130)));
  }
  let code = 1;
  let page = null;
  let browser = null;
  const consoleLog = [];
  try {
    if (OWN_ENGINE) await startEngine();
    else if (!(await waitHttp(healthUrl(SEAT_URL), 5000))) throw new Error(`no engine at ${SEAT_URL}`);
    const health = await (await fetch(`${COACH_URL}/health`)).json().catch(() => ({}));
    if (health.match !== 1) throw new Fail(`the helper at ${COACH_URL} has no match launcher (/health: ${JSON.stringify(health)})`);

    const appUrl = env.APP_URL || (await startPreview());
    browser = await launchBrowser(pw, { headless: HEADLESS });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true });
    // Seeded Math.random: the draft's seed (newSeed) and the coin toss replay from SEED.
    await context.addInitScript((seed) => {
      let a = seed >>> 0;
      Math.random = () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }, SEED);
    page = await context.newPage();
    page.setDefaultTimeout(30_000);
    const errors = [];
    const origin = new URL(appUrl).origin;
    page.on('console', (m) => {
      consoleLog.push(`[${m.type()}] ${m.text()}`);
      if (m.type() !== 'error') return;
      const where = m.location()?.url ?? '';
      // Scryfall (card data) through the proxy, and the seat socket while the engine restarts, are not app bugs.
      if (/Failed to load resource|WebSocket connection to/i.test(m.text()) && (!where || !where.startsWith(origin) || /ws:\/\//.test(m.text()))) return;
      errors.push(`console error: ${m.text()} (${where})`);
    });
    page.on('pageerror', (e) => errors.push(`page error: ${e.message}`));

    // The seat's frames, as the page receives them (across the reload).
    const frames = [];
    page.on('websocket', (ws) => {
      if (!/\/ws(\?|$)/.test(ws.url())) return;
      ws.on('framereceived', (f) => {
        try {
          frames.push(JSON.parse(typeof f.payload === 'string' ? f.payload : f.payload.toString()));
        } catch {
          /* not JSON */
        }
      });
    });

    const u = new URL(appUrl);
    u.searchParams.set('seat', SEAT_URL);
    u.searchParams.set('coach', COACH_URL);
    log(`app ${u}  seed ${SEED}`);
    await page.goto(u.toString());

    // ---- the lobby → Draft vs AI
    await page.locator('.lobby-tile', { hasText: 'Draft vs AI' }).click();
    await page.getByRole('radio', { name: 'Grid' }).click();
    await page.locator('.adv-toggle').click();
    await page.getByRole('radiogroup', { name: 'First pick' }).getByRole('radio', { name: 'You' }).click();
    await page.locator('.setup .btn-begin').click();
    await page.locator('.pk.is-grid').waitFor({ timeout: 60_000 });
    log('grid draft started');

    // ---- the draft: the hinted line when there is one, else the first legal one
    let picks = 0;
    const draftDeadline = Date.now() + 10 * 60_000;
    while (!(await page.locator('.de').count())) {
      if (Date.now() > draftDeadline) throw new Fail('the draft did not finish in 10 minutes');
      if (errors.length) throw new Fail(errors.join('\n'));
      const legal = page.locator('.garrow:not([disabled])');
      if (!(await legal.count())) {
        await sleep(250);
        continue;
      }
      const hinted = page.locator('.garrow.is-hint:not([disabled])');
      const arrow = (await hinted.count()) ? hinted.first() : legal.first();
      const label = await arrow.getAttribute('aria-label');
      const before = await page.locator('.pk-mono').innerText().catch(() => '');
      try {
        await arrow.click({ timeout: 3000 });
        await page.locator('.pk-primary:not([disabled])').click({ timeout: 3000 });
      } catch {
        continue; // the AI moved first, or the screen changed: look again
      }
      picks++;
      log(`pick ${picks}: ${label?.replace('Select the ', '')}`);
      await page.waitForFunction((b) => document.querySelector('.de') || document.querySelector('.pk-mono')?.textContent !== b, before, { timeout: 15_000 }).catch(() => {});
    }
    log(`draft complete after ${picks} picks`);
    await page.screenshot({ path: path.join(OUT, 'draft-1-build.png') });

    // ---- the build: Suggest a build, then basics to 40
    await page.locator('.de-suggest').click();
    await page.waitForFunction(() => !!document.querySelector('.de-note'), null, { timeout: 30_000 });
    const count = async () => Number(await page.locator('.de-count b').innerText());
    let n = await count();
    log(`suggested build: ${(await page.locator('.de-note-t').innerText()).trim()} · ${n} cards`);
    while (n < 40) {
      // One more of the basic the build already uses most (else Plains).
      const rows = page.locator('.basic-row');
      let best = 0;
      let bestN = -1;
      for (let i = 0; i < (await rows.count()); i++) {
        const k = Number(await rows.nth(i).locator('.basic-n').innerText());
        if (k > bestN) [best, bestN] = [i, k];
      }
      await rows.nth(best).getByRole('button', { name: /One more/ }).click();
      n = await count();
    }
    log(`deck at ${n} cards`);
    await page.locator('.de-submit').click();

    // ---- the match set-up: Bo1, Begin
    await page.locator('.setup.match').waitFor();
    await page.getByRole('radiogroup', { name: 'Match' }).getByRole('radio', { name: 'Bo1' }).click();
    await page.waitForFunction(() => !document.querySelector('.match .btn-begin')?.hasAttribute('disabled'), null, { timeout: 30_000 });
    await page.screenshot({ path: path.join(OUT, 'draft-2-match.png') });
    const matchReq = page.waitForRequest((r) => r.url() === `${COACH_URL}/match` && r.method() === 'POST', { timeout: 30_000 });
    const matchRes = page.waitForResponse((r) => r.url() === `${COACH_URL}/match` && r.request().method() === 'POST', { timeout: 240_000 });
    await page.locator('.match .btn-begin').click();
    const sent = JSON.parse((await matchReq).postData() ?? '{}');
    log(`POST /match: you "${sent.deck?.name}" (${sum(sent.deck?.main)}), AI "${sent.aiDeck?.name}" (${sum(sent.aiDeck?.main)}), games ${sent.games}`);
    const res = await matchRes;
    const body = await res.json().catch(() => ({}));
    if (res.status() !== 200 || body.ok !== true) throw new Fail(`POST /match → ${res.status()}: ${JSON.stringify(body)}`);
    log(`POST /match → 200 in ${body.ms} ms: ${JSON.stringify({ yourDeck: body.yourDeck, aiDeck: body.aiDeck, games: body.games, warnings: body.warnings })}`);
    const id = /var\/match\/(m\d+)\//.exec(body.yourDeck?.path ?? '')?.[1];
    if (!id) throw new Fail(`no match id in yourDeck.path ${body.yourDeck?.path}`);

    // ---- the board takes the seat again: the next hello_ok is the new match
    const helloDeadline = Date.now() + 120_000;
    let hello = null;
    while (!hello && Date.now() < helloDeadline) {
      hello = frames.find((f) => f.type === 'hello_ok')?.body ?? null;
      if (!hello) await sleep(250);
    }
    if (!hello) {
      if (body.warnings?.length) await page.getByRole('button', { name: 'Take your seat' }).click();
      throw new Fail('no hello_ok within 2 minutes of the 200');
    }
    if (!page.url().includes('play=1')) throw new Fail(`the page did not reload into ?play=1 (${page.url()})`);
    const expectId = `match-${id}`;
    log(`hello_ok gameId ${hello.gameId}, match ${JSON.stringify(hello.match)}`);
    const problems = [];
    if (hello.gameId !== expectId) problems.push(`hello_ok.gameId ${hello.gameId}, expected ${expectId}`);
    if (hello.match?.yourDeck?.name !== sent.deck.name) problems.push(`hello_ok.match.yourDeck.name "${hello.match?.yourDeck?.name}" ≠ the drafted deck "${sent.deck.name}"`);
    if (hello.match?.aiDeck?.name !== sent.aiDeck.name) problems.push(`hello_ok.match.aiDeck.name "${hello.match?.aiDeck?.name}" ≠ sent "${sent.aiDeck.name}"`);
    if (!/^AI Drafter - [A-Za-z0-9]/.test(sent.aiDeck.name)) problems.push(`the AI deck's name "${sent.aiDeck.name}" is not its archetype ("AI Drafter - <archetype>")`);
    const aiNames = [...new Set([...(sent.aiDeck.main ?? []), ...(sent.aiDeck.sideboard ?? [])].map(([, c]) => c))];
    if (aiNames.some((c) => sent.aiDeck.name.includes(c))) problems.push(`the AI deck's name "${sent.aiDeck.name}" names a card in it`);
    if (problems.length) throw new Fail(problems.join('\n'));

    // ---- keep/mulligan or play/draw on screen
    const opening = page.locator('.ask-dialog').filter({ has: page.getByRole('button', { name: /^(Keep|Play|Draw|Mulligan)\b/ }) });
    await opening.first().waitFor({ timeout: 180_000 });
    const top = await page.locator('body').innerText();
    if (!top.includes(sent.deck.name)) problems.push(`the board does not show your deck's name "${sent.deck.name}"`);
    const what = (await opening.first().locator('.ask-title').first().innerText().catch(() => '')).trim();
    log(`board shows the opening decision: ${what || '(untitled)'}`);
    await page.screenshot({ path: path.join(OUT, 'draft-3-opening.png') });

    // ---- the AI's list is never in the DOM while playing
    const yours = new Set((sent.deck.main ?? []).concat(sent.deck.sideboard ?? []).map(([, c]) => c));
    const secret = aiNames.filter((c) => !BASICS.has(c) && !yours.has(c));
    const leaks = async (when) => {
      const shown = new Set();
      for (const f of frames) if (f.type === 'state' || f.type === 'event' || f.type === 'events') for (const m of JSON.stringify(f.body).matchAll(/"name":"((?:[^"\\]|\\.)*)"/g)) shown.add(JSON.parse(`"${m[1]}"`));
      const html = await page.evaluate(() => document.documentElement.outerHTML);
      const found = secret.filter((c) => !shown.has(c) && html.includes(c.replace(/&/g, '&amp;').replace(/"/g, '&quot;')));
      if (found.length) problems.push(`${when}: the AI's cards are in the DOM: ${found.join(', ')}`);
      log(`${when}: ${secret.length} AI-only card names checked, ${found.length} in the DOM`);
    };
    await leaks('at the opening');
    // Through the opening decisions to the first main phase, checking again.
    for (let i = 0; i < 4; i++) {
      const d = page.locator('.ask-dialog');
      if (!(await d.count())) break;
      const keep = d.getByRole('button', { name: /^(Keep|Play)\b/ });
      if (!(await keep.count())) break;
      await keep.first().click().catch(() => {});
      await sleep(2500);
    }
    await page.locator('.actionbar').waitFor({ timeout: 120_000 }).catch(() => {});
    await leaks('after the opening');
    await page.screenshot({ path: path.join(OUT, 'draft-4-board.png') });
    if (errors.length) problems.push(...errors);
    if (problems.length) throw new Fail(problems.join('\n'));
    log('PASS');
    code = 0;
  } catch (e) {
    console.error(`[e2e draft] FAIL: ${e instanceof Fail ? e.message : e.stack}`);
    if (page) {
      const shot = path.join(OUT, 'draft-fail.png');
      await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
      console.error(`[e2e draft] screenshot ${shot}`);
    }
    code = 1;
  } finally {
    writeFileSync(path.join(OUT, 'draft-console.txt'), consoleLog.join('\n') + '\n');
    if (engineOut) writeFileSync(path.join(OUT, 'draft-engine.txt'), engineOut);
    await browser?.close().catch(() => {});
    await cleanup();
  }
  process.exit(code);
}

function sum(entries) {
  return (entries ?? []).reduce((s, [n]) => s + n, 0);
}

main().catch(async (e) => {
  console.error(e);
  await cleanup();
  process.exit(2);
});
