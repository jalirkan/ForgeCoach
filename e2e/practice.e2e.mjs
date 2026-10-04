#!/usr/bin/env node
/*
 * ForgeCoach — e2e/practice.e2e.mjs
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Practice puzzles (#practice) from the shipped samples, no engine needed:
 *
 *   1. builds ForgeCoach and serves dist/ with `vite preview` on 127.0.0.1
 *      (or tests APP_URL);
 *   2. for the classic and stack skins, at desktop (1440 px) and phone
 *      (390 px) widths: the start page's Practice tile opens the list; "Add
 *      the sample games" fills it; an engine-graded puzzle shows the replay
 *      board and its options; a pick is checked and the reveal shows the
 *      outcome (a close call is never called a mistake), the engine's table,
 *      the swing and the coach box; a derived puzzle reveals "as in the game"
 *      or "different"; the page never scrolls sideways.
 *
 * Screenshots go to OUT (default e2e/out/; the README's are in docs/screens/).
 * Environment: APP_URL, BUILD=0 (reuse dist/), HEADLESS=0, OUT.
 * Exit status: 0 pass, 1 fail, 2 could not start.
 */
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchBrowser, loadPlaywright, waitHttp } from './harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = process.env;
const OUT = path.resolve(env.OUT || path.join(ROOT, 'e2e', 'out'));
const HEADLESS = !/^(0|false|no)$/i.test(env.HEADLESS ?? '1');
const t0 = Date.now();
const log = (...a) => console.log(`[e2e practice +${((Date.now() - t0) / 1000).toFixed(0)}s]`, ...a);
class Fail extends Error {}
const check = (ok, msg) => {
  if (!ok) throw new Fail(msg);
  log(`ok: ${msg}`);
};

let preview = null;

async function appUrl() {
  if (env.APP_URL) return env.APP_URL.replace(/\/?$/, '/');
  if (!/^(0|false|no)$/i.test(env.BUILD ?? '1')) {
    log('building ForgeCoach (npm run build)');
    execFileSync('npm', ['run', 'build'], { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'] });
  }
  // A Vite port (src/play/seatUrl.ts DEV_PORTS): on any other the page takes itself for one the bridge served.
  let port = 0;
  for (const p of [4173, 4174, 5174, 5173]) {
    if (!(await waitHttp(`http://127.0.0.1:${p}/`, 300, { ok: () => true }))) {
      port = p;
      break;
    }
  }
  if (!port) throw new Error('ports 4173, 4174, 5174 and 5173 are all busy: set APP_URL, or free one');
  const bin = path.join(ROOT, 'node_modules', '.bin', 'vite');
  preview = spawn(bin, ['preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: ROOT, stdio: 'ignore' });
  const url = `http://127.0.0.1:${port}/`;
  if (await waitHttp(url, 60_000, { alive: () => preview.exitCode === null })) return url;
  throw new Error(`vite preview did not start on ${url}`);
}

async function noSideScroll(page, where) {
  const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  check(m.sw <= m.cw, `${where}: no horizontal scroll (scrollWidth ${m.sw} <= clientWidth ${m.cw})`);
}

async function shoot(page, name) {
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  log(`screenshot ${name}.png`);
}

async function run(browser, url, skin, phone) {
  const tag = `${skin}-${phone ? 'phone' : 'desktop'}`;
  const page = await browser.newPage(
    phone ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { viewport: { width: 1440, height: 900 } },
  );
  await page.goto(`${url}?skin=${skin}`);
  await page.locator('.lobby-tile', { hasText: 'Practice' }).click();
  await page.getByRole('button', { name: 'Add the sample games' }).click();
  await page.locator('.pz-item').first().waitFor({ timeout: 30_000 });
  const n = await page.locator('.pz-item').count();
  check(n >= 3, `${tag}: the samples make puzzles (${n})`);
  check((await page.locator('.pz-badge', { hasText: 'engine-graded' }).count()) >= 2, `${tag}: the reviewed sample's puzzles are engine-graded`);
  await noSideScroll(page, `${tag} list`);
  await shoot(page, `practice-${tag}-list`);

  // An engine-graded puzzle.
  await page.locator('.pz-item', { has: page.locator('.pz-badge', { hasText: 'engine-graded' }) }).first().click();
  await page.locator('.pz-board .board').waitFor({ timeout: 30_000 });
  check(await page.locator('.pz-opt').count() >= 2, `${tag}: the options are listed`);
  check((await page.locator('.pz-result').count()) === 0, `${tag}: nothing is revealed before the pick`);
  await page.waitForTimeout(1200); // card art
  await noSideScroll(page, `${tag} question`);
  await shoot(page, `practice-${tag}-question`);
  if (phone) {
    await page.evaluate(() => document.querySelector('.pz-q')?.scrollIntoView({ block: 'end' }));
    await shoot(page, `practice-${tag}-options`);
  }

  // Pick the first option, whatever it is.
  await page.locator('.pz-opt').first().click();
  await page.getByRole('button', { name: 'Check' }).click();
  await page.locator('.pz-result').waitFor();
  const headline = await page.locator('.pz-result-h').innerText();
  const detail = await page.locator('.pz-result-d').innerText();
  check(headline.length > 0, `${tag}: the outcome reads "${headline}"`);
  if (/close call/i.test(headline)) check(/includes zero/.test(detail) && /not a mistake/.test(detail), `${tag}: a close call says its interval includes zero, not a mistake`);
  check(!/^mistake/i.test(headline), `${tag}: the headline never says "mistake"`);
  check(await page.locator('.pz-table tr').count() >= 2, `${tag}: the engine's table is shown`);
  check(await page.locator('.pz-swing-n').isVisible(), `${tag}: the swing is shown`);
  check(await page.locator('.pz-coach').count() === 1, `${tag}: the coach box is there`);
  await noSideScroll(page, `${tag} reveal`);
  if (phone) await page.evaluate(() => document.querySelector('.pz-result')?.scrollIntoView({ block: 'start' }));
  if (phone) await page.evaluate(() => window.scrollBy(0, -60));
  await shoot(page, `practice-${tag}-reveal`);

  // A derived puzzle: never graded, only compared with the game.
  await page.getByRole('button', { name: 'Back to the puzzle list' }).click();
  await page.locator('.pz-item').first().waitFor();
  const derived = page.locator('.pz-item', { hasNot: page.locator('.pz-badge', { hasText: 'engine-graded' }) }).first();
  check((await derived.count()) > 0, `${tag}: a puzzle the engine did not grade is listed`);
  {
    await derived.click();
    await page.locator('.pz-opt').first().waitFor();
    await page.locator('.pz-opt').last().click();
    await page.getByRole('button', { name: 'Check' }).click();
    const h = await page.locator('.pz-result-h').innerText();
    check(/in the game/i.test(h), `${tag}: a puzzle the engine did not grade is only compared with the game ("${h}")`);
    check((await page.locator('.pz-table').count()) === 0, `${tag}: no engine table without the engine`);
  }
  await page.close();
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const pw = await loadPlaywright();
  let url;
  try {
    url = await appUrl();
  } catch (e) {
    console.error(String(e.message ?? e));
    return 2;
  }
  const browser = await launchBrowser(pw, { headless: HEADLESS });
  try {
    for (const skin of ['classic', 'stack']) for (const phone of [false, true]) await run(browser, url, skin, phone);
    log(`screenshots in ${OUT}`);
    return 0;
  } catch (e) {
    console.error(e instanceof Fail ? `FAIL: ${e.message}` : e);
    return 1;
  } finally {
    await browser.close();
    if (preview?.pid) preview.kill('SIGTERM');
  }
}

process.exit(await main());
