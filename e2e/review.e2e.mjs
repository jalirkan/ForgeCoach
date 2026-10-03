#!/usr/bin/env node
/*
 * ForgeCoach — e2e/review.e2e.mjs
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The engine review screen with the shipped sample report, no engine needed:
 *
 *   1. builds ForgeCoach and serves dist/ with `vite preview` on 127.0.0.1
 *      (or tests APP_URL);
 *   2. phone width (390 px): the start page's "Sample engine review" link
 *      opens the sample log's review; the timeline, the first key moment
 *      (verdict, option bars, the replay board at its state frame) and the
 *      coach's "explain the key moments" action are there; a chip selects
 *      another decision; the page never scrolls sideways;
 *   3. from the replay: the topbar's "Engine review" opens the load panel,
 *      "Open the sample review" shows the report;
 *   4. desktop width (1440 px): the two-column layout, no sideways scroll.
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
const log = (...a) => console.log(`[e2e review +${((Date.now() - t0) / 1000).toFixed(0)}s]`, ...a);
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
    // ---- phone
    const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await phone.goto(url);
    await phone.getByRole('button', { name: 'Sample engine review' }).click();
    await phone.locator('.rv-moment').waitFor({ timeout: 30_000 });
    check(await phone.locator('.rv-chip').count() >= 10, 'the timeline lists the graded decisions');
    check((await phone.locator('.rv-verdict').innerText()) === 'Close call', 'the first key moment (a close call) is open, worded as a close call');
    check(/includes zero/.test(await phone.locator('.rv-facts').innerText()), 'its regret interval is said to include zero');
    check(await phone.locator('.rv-bar').count() >= 2, 'the option bars are drawn');
    check((await phone.locator('.rv-mark-played').count()) === 1 && (await phone.locator('.rv-mark-best').count()) >= 1, 'the played and the best option are marked in words');
    check(await phone.locator('.rv-board .board').count() === 1, 'the replay board shows the moment');
    check(await phone.getByRole('button', { name: 'Coach: explain the key moments' }).isVisible(), 'the coach action is there');
    check(/cube pool/.test(await phone.locator('.rv-summary').innerText()), 'the knowledge line is shown');
    await phone.waitForTimeout(1200); // card art
    await noSideScroll(phone, 'phone review');
    await phone.screenshot({ path: path.join(OUT, 'review-phone-top.png') });
    await phone.locator('.rv-tl-box').scrollIntoViewIfNeeded();
    await phone.screenshot({ path: path.join(OUT, 'review-phone-timeline.png') });
    await phone.locator('.rv-moment').scrollIntoViewIfNeeded();
    await phone.evaluate(() => document.querySelector('.rv-moment')?.scrollIntoView({ block: 'start' }));
    await phone.evaluate(() => window.scrollBy(0, -60));
    await phone.screenshot({ path: path.join(OUT, 'review-phone-moment.png') });
    await phone.evaluate(() => document.querySelector('.rv-board')?.scrollIntoView({ block: 'start' }));
    await phone.evaluate(() => window.scrollBy(0, -60));
    await phone.screenshot({ path: path.join(OUT, 'review-phone-board.png') });
    await phone.evaluate(() => document.querySelector('.rv-coach')?.scrollIntoView({ block: 'end' }));
    await phone.screenshot({ path: path.join(OUT, 'review-phone-coach.png') });

    // A chip selects another decision: a tie (zero regret, not the best) reads as one.
    const tie = phone.locator('.rv-chip', { hasText: 'Tie' }).first();
    if (await tie.count()) {
      await tie.click();
      check((await phone.locator('.rv-verdict').innerText()) === 'Close call — a tie', 'a tie reads "Close call — a tie"');
      check(/within noise/.test(await phone.locator('.rv-facts').innerText()), 'a tie is worded as within noise');
    }
    // A leaf (triage) decision carries the short-horizon caveat.
    await phone.locator('.rv-chip.v-best', { hasText: 'Attacks' }).first().click();
    check(/not a win rate/.test(await phone.locator('.rv-facts').innerText()), 'a leaf measure is labelled as not a win rate');
    await noSideScroll(phone, 'phone after selecting');
    await phone.close();

    // ---- from the replay
    const replay = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await replay.goto(`${url}#sample=human-auto-42`);
    await replay.getByRole('button', { name: 'Engine review' }).click();
    await replay.getByRole('button', { name: 'Open the sample review' }).click();
    await replay.locator('.rv-moment').waitFor({ timeout: 30_000 });
    check(true, 'the replay opens the engine review, and the sample report loads');
    await replay.getByRole('button', { name: 'Close the engine review' }).click();
    await replay.locator('.game').waitFor();
    check(true, 'closing the review returns to the replay');
    await replay.close();

    // ---- desktop
    const desk = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await desk.goto(`${url}#sample=human-auto-42&review=1`);
    await desk.locator('.rv-moment').waitFor({ timeout: 30_000 });
    await desk.waitForTimeout(1500);
    await noSideScroll(desk, 'desktop review');
    await desk.screenshot({ path: path.join(OUT, 'review-desktop.png') });
    await desk.close();
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
