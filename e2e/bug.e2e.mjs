#!/usr/bin/env node
/*
 * ForgeCoach — e2e/bug.e2e.mjs
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * "Report a bug" (mtg-table D410) through the real app: the fake engine
 * (e2e/fake-engine.mjs) for the play board, a sample for the replay, and a
 * fake coach helper that records each POST /bug. `npm run e2e:bug`.
 *
 *   1. the play board: Shift+B opens the panel and does NOT pass priority (B
 *      is the board's "pass until before my turn"); keys typed in the panel
 *      never reach the board; the screenshot is taken; Send reaches the
 *      helper with the game, the frames, the screenshot and no token; the
 *      panel shows the helper's id;
 *   2. the replay: the top bar's button; a helper without the route (404)
 *      says so, and Download report saves the same JSON;
 *   3. a phone: the ⋯ menu's "Report a bug";
 *   4. Draft with a friend: the corner button.
 *
 * Environment: BUILD=0 (reuse dist/), HEADLESS=0, ONLY=<substring>.
 */
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startFakeEngine } from './fake-engine.mjs';
import { freePort, launchBrowser, loadPlaywright, waitHttp } from './harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'e2e', 'out');
const env = process.env;
const HEADLESS = !/^(0|false|no)$/i.test(env.HEADLESS ?? '1');
const STEP_MS = 15_000;

class Fail extends Error {}
const check = (ok, msg) => {
  if (!ok) throw new Fail(msg);
};

let preview = null;
async function appUrl() {
  if (!/^(0|false|no)$/i.test(env.BUILD ?? '1')) {
    console.log('[e2e bug] building ForgeCoach (npm run build)');
    execFileSync('npm', ['run', 'build'], { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'] });
  }
  let port = 0;
  for (const p of [4173, 5174, 5173]) {
    if (!(await waitHttp(`http://127.0.0.1:${p}/`, 300, { ok: () => true }))) {
      port = p;
      break;
    }
  }
  if (!port) throw new Error('ports 4173, 5174 and 5173 are all busy');
  preview = spawn(path.join(ROOT, 'node_modules', '.bin', 'vite'), ['preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: ROOT, stdio: 'ignore' });
  const url = `http://127.0.0.1:${port}/`;
  if (await waitHttp(url, 60_000, { alive: () => preview.exitCode === null })) return url;
  throw new Error(`vite preview did not start on ${url}`);
}

/** A coach helper that only knows POST /bug: `mode` 'ok' (201) or 'old' (404, a helper from before D410). */
async function fakeHelper() {
  const port = await freePort();
  const h = { port, url: `http://127.0.0.1:${port}`, mode: 'ok', bugs: [] };
  const cors = (req) => ({ 'Access-Control-Allow-Origin': req.headers.origin ?? '*', Vary: 'Origin' });
  h.server = http.createServer((req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { ...cors(req), 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, X-ForgeCoach-Token', 'Access-Control-Allow-Private-Network': 'true' });
      res.end();
      return;
    }
    if (req.url === '/bug' && req.method === 'POST' && h.mode === 'ok') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        h.bugs.push({ body: JSON.parse(body), headers: req.headers });
        const id = `20261007T153012Z-e2e${String(h.bugs.length).padStart(3, '0')}`;
        res.writeHead(201, { ...cors(req), 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, id, screenshot: !!JSON.parse(body).screenshot }));
      });
      return;
    }
    res.writeHead(404, { ...cors(req), 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ type: 'error', message: 'not found' }));
  });
  await new Promise((r) => h.server.listen(port, '127.0.0.1', r));
  return h;
}

async function isolate(context, appOrigin, helper) {
  await context.route('**/*', (route) => {
    const u = new URL(route.request().url());
    if (u.origin === appOrigin || u.origin === helper.url) return route.continue();
    if (u.hostname === 'fonts.googleapis.com') return route.fulfill({ status: 200, contentType: 'text/css', body: '' });
    if (u.hostname === 'api.scryfall.com') return route.fulfill({ status: 404, contentType: 'application/json', body: '{"object":"error","code":"not_found","status":404,"details":"e2e"}' });
    return route.abort('connectionrefused');
  });
}

const panel = (page) => page.locator('.bug-sheet');

async function fillAndWaitShot(page, title) {
  await panel(page).waitFor({ timeout: STEP_MS });
  await panel(page).locator('input[type="text"]').fill(title);
  await panel(page).locator('textarea').fill('I pressed OK and nothing happened.\nExpected the spell to resolve.');
  await panel(page).locator('.bug-thumb').waitFor({ timeout: 20_000 });
}

const scenarios = [
  {
    name: 'the play board: Shift+B, no priority passed, sent to the helper with the game and a screenshot',
    engine: { scene: 'main3' },
    async run({ page, app, engine, helper }) {
      await page.goto(`${app}?play=1&seat=${encodeURIComponent(engine.seatUrl)}&coach=${encodeURIComponent(helper.url)}`);
      await page.locator('.game.play .board').first().waitFor({ timeout: STEP_MS });
      await page.locator('.game.play.mode-main, .game.play.mode-priority').first().waitFor({ timeout: STEP_MS }).catch(() => {});
      const before = engine.acts().length;
      await page.locator('body').click({ position: { x: 5, y: 5 } }).catch(() => {});
      await page.keyboard.press('Shift+B');
      await panel(page).waitFor({ timeout: STEP_MS });
      check(engine.acts().length === before, `Shift+B sent an act: ${JSON.stringify(engine.acts().slice(before))}`);
      await fillAndWaitShot(page, 'Pass did nothing');
      // Keys typed in the panel stay in the panel: P (pass priority) and E (pass to end of turn) on a focused button.
      await panel(page).locator('.bug-sev-opt', { hasText: 'major' }).click();
      await page.keyboard.press('p');
      await page.keyboard.press('e');
      await page.waitForTimeout(300);
      check(engine.acts().length === before, `a key typed in the panel reached the board: ${JSON.stringify(engine.acts().slice(before))}`);
      await panel(page).getByRole('button', { name: 'Send' }).click();
      await panel(page).locator('.bug-sent').waitFor({ timeout: STEP_MS });
      const id = await panel(page).locator('.bug-id').textContent();
      check(id === '20261007T153012Z-e2e001', `the panel shows the helper's id (${id})`);
      check(helper.bugs.length === 1, `the helper got one report (${helper.bugs.length})`);
      const b = helper.bugs[0].body;
      check(b.kind === 'forgecoach-bug' && b.schema === 1, 'kind and schema');
      check(b.title === 'Pass did nothing' && b.severity === 'major' && /nothing happened/.test(b.details), 'title, severity and details');
      check(b.surface === 'play', `surface play (${b.surface})`);
      check(b.game && b.game.gameId && Number.isInteger(b.game.turn) && b.game.phase && b.game.seat !== null, `the game's facts (${JSON.stringify(b.game)})`);
      check(b.log && b.log.frames.length > 0 && b.log.frames.length <= 300, `the log's frames (${b.log?.frames.length})`);
      check(b.screenshot && b.screenshot.mediaType === 'image/jpeg' && b.screenshot.how === 'dom' && b.screenshot.data.length > 1000, 'a DOM screenshot came');
      check(b.thumbnail && b.thumbnail.data.length < 300 * 1024, 'and its thumbnail');
      check(b.client && b.client.viewport.w === 1440 && typeof b.client.build === 'string', 'the client facts');
      check(!JSON.stringify(b).includes(engine.seatUrl) || !/token=/.test(engine.seatUrl), 'no seat URL with a token');
      check(engine.acts().length === before, 'still no act sent');
      await panel(page).getByRole('button', { name: 'Done' }).click();
      await panel(page).waitFor({ state: 'detached', timeout: STEP_MS });
      // The control: with the panel closed, plain B is still the board's "pass until before my turn".
      await page.keyboard.press('b');
      await engine.waitFor(() => engine.acts().length > before, 'plain B to reach the board as an act');
      check(engine.acts().slice(before).some((a) => a.action === 'yieldTo'), `plain B sent ${JSON.stringify(engine.acts().slice(before))}`);
    },
  },
  {
    name: 'the replay: the top-bar button; an old helper says so; Download report saves the JSON',
    async run({ page, app, helper }) {
      helper.mode = 'old';
      await page.goto(`${app}?coach=${encodeURIComponent(helper.url)}#sample=human-auto-42&d=6`);
      await page.locator('.game .board').first().waitFor({ timeout: STEP_MS });
      await page.locator('.topbar .bug-btn').click();
      await fillAndWaitShot(page, 'Replay shows the wrong life');
      await panel(page).getByRole('button', { name: 'Send' }).click();
      await panel(page).locator('.bug-error').waitFor({ timeout: STEP_MS });
      const err = await panel(page).locator('.bug-error').first().textContent();
      check(/does not take bug reports/.test(err ?? ''), `the old helper is named (${err})`);
      const [dl] = await Promise.all([page.waitForEvent('download', { timeout: STEP_MS }), panel(page).getByRole('button', { name: 'Download report' }).click()]);
      check(/^forgecoach-bug-fc-\d{8}-\d{6}-[a-z2-9]{4}\.json$/.test(dl.suggestedFilename()), `the file's name (${dl.suggestedFilename()})`);
      const file = path.join(OUT, dl.suggestedFilename());
      mkdirSync(OUT, { recursive: true });
      await dl.saveAs(file);
      const j = JSON.parse(readFileSync(file, 'utf8'));
      check(j.kind === 'forgecoach-bug' && j.surface === 'replay' && j.game?.frameIndex > 0, `the downloaded report is the replay's (${j.surface}, frame ${j.game?.frameIndex})`);
      check(j.log.from + j.log.frames.length === j.game.frameIndex + 1, 'its frames end at the moment shown');
      check(!!j.screenshot, 'with its screenshot');
    },
  },
  {
    name: 'a phone: the ⋯ menu opens the panel',
    engine: { scene: 'main3' },
    viewport: { width: 390, height: 844 },
    async run({ page, app, engine, helper }) {
      await page.goto(`${app}?play=1&seat=${encodeURIComponent(engine.seatUrl)}&coach=${encodeURIComponent(helper.url)}`);
      await page.locator('.game.play .board').first().waitFor({ timeout: STEP_MS });
      await page.locator('.top-more').click();
      await page.getByRole('menuitem', { name: 'Report a bug' }).click();
      await panel(page).waitFor({ timeout: STEP_MS });
      await page.keyboard.press('Escape');
      await panel(page).waitFor({ state: 'detached', timeout: STEP_MS });
    },
  },
  {
    name: 'Draft with a friend: the corner button',
    async run({ page, app, helper }) {
      await page.goto(`${app}?coach=${encodeURIComponent(helper.url)}#draft/friend`);
      await page.locator('.bug-fab').click({ timeout: STEP_MS });
      await panel(page).waitFor({ timeout: STEP_MS });
    },
  },
];

async function runOne(browser, app, s) {
  const engine = await startFakeEngine({ ...(s.engine ?? {}) });
  const helper = await fakeHelper();
  const appOrigin = new URL(app).origin;
  const context = await browser.newContext({ viewport: s.viewport ?? { width: 1440, height: 900 }, acceptDownloads: true });
  await isolate(context, appOrigin, helper);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`page error: ${e.message}`));
  const t = Date.now();
  try {
    await s.run({ page, engine, app, helper });
    check(errors.length === 0, errors.join('\n'));
    return { ok: true, ms: Date.now() - t };
  } catch (e) {
    mkdirSync(OUT, { recursive: true });
    const shot = path.join(OUT, `bug-${scenarios.indexOf(s)}.png`);
    await page.screenshot({ path: shot }).catch(() => {});
    return { ok: false, ms: Date.now() - t, error: `${e instanceof Fail ? e.message : e.stack ?? e}${errors.length ? `\n${errors.join('\n')}` : ''}\n  screenshot ${shot}` };
  } finally {
    await context.close().catch(() => {});
    await engine.close().catch(() => {});
    helper.server.close();
  }
}

async function main() {
  const pw = await loadPlaywright();
  let app;
  try {
    app = await appUrl();
  } catch (e) {
    console.error(`[e2e bug] ${e.message ?? e}`);
    return 2;
  }
  const browser = await launchBrowser(pw, { headless: HEADLESS });
  let failed = 0;
  try {
    for (const s of scenarios.filter((x) => !env.ONLY || x.name.includes(env.ONLY))) {
      const r = await runOne(browser, app, s);
      console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${(r.ms / 1000).toFixed(1).padStart(5)}s  ${s.name}`);
      if (!r.ok) {
        failed++;
        console.log(`      ${r.error.replace(/\n/g, '\n      ')}`);
      }
    }
  } finally {
    await browser.close().catch(() => {});
    preview?.kill('SIGTERM');
  }
  return failed ? 1 : 0;
}

process.exit(await main());
