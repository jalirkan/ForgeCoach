#!/usr/bin/env node
/*
 * ForgeCoach — e2e/ambience.e2e.mjs
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Spec 1.16.1 on the `#ambience` preview, in a real browser on a production
 * build (`npm run e2e:ambience`):
 *
 *   1. builds ForgeCoach (BUILD=0 reuses dist/) and serves dist/ from a small
 *      static server; with PAIRS_DIR, that folder too, at /pairs-pack/ (a
 *      pairs pack on disk, e.g. ~/scenery-packs/panoramas-v1/serve/pairs-v5
 *      before its tags are cut);
 *   2. opens `/?pairfull=1#ambience` at a desktop size (the flag's own
 *      pairs, pairs-v6 on jsDelivr; `&pairs=<pairs>` only with PAIRS_DIR or
 *      PAIRS_URL), with ForgeCoach's own pack (from jsDelivr), Pieces →
 *      Placeholders (so a
 *      1.14 cut-out exists for every colour) and Pieces → Three colours
 *      (SYSTEM.md's worked example: Plateau, Plains, Island);
 *   3. checks that your half draws island+plains whole with red PAINTED IN on
 *      plains's ground -- the sided picture `s2+RR-panorama.webp` --, that no
 *      cut-out element is drawn over it, and that the caption says
 *      "R painted in";
 *   4. spec 1.17 (draft), only when the pairs manifest has a seam `grid`
 *      (pairs-v6-draft, by PAIRS_DIR or PAIRS_URL): with the Lands sliders,
 *      island 4 | swamp 3 draws the cell `4x3` unmirrored, a fourth Swamp
 *      steps one half (`4x4`), island 6 | swamp 2 clamps the lighter half
 *      (`6x5`), and forest 2 | swamp 3 draws swamp+forest's `3x2` MIRRORED
 *      (the geography puts the swamp left); each checked on the panel, its
 *      picture and the caption, a screenshot each (e2e/out/grid-*.png). A
 *      cell the manifest does not have yet is skipped, and says so. Then the
 *      pair FORMING: island 3 alone, then a first Swamp -- the half's first
 *      pair picture is the cell `3x2` (warmed ahead), never the whole-place
 *      panorama for a moment before it (the #201 follow-up);
 *   5. with a grid, a PHONE (390 × 844): island 4 | swamp 3 draws the stage
 *      panorama's phone picture, names no cell, fetches no seam picture, and
 *      the caption says "whole half" and no "seam" (e2e/out/grid-phone.png).
 *
 * Environment: PAIRS_DIR (a local pairs pack), or PAIRS_URL (a pairs pack by
 * URL, e.g. https://cdn.jsdelivr.net/gh/jalirkan/forgecoach-scenery@pairs-v6-draft/;
 * with neither, no `?pairs=`: the flag's default, the pairs-v6 tag on
 * jsDelivr); BUILD=0, HEADLESS=0, BROWSER_PATH. Needs the network for
 * ForgeCoach's pack (jsDelivr). Exit status: 0 pass, 1 a check
 * failed, 2 could not start. A screenshot goes to e2e/out/ambience-three.png.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, statSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { freePort, launchBrowser, loadPlaywright } from './harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const OUT = path.join(ROOT, 'e2e', 'out');
const env = process.env;
const HEADLESS = !/^(0|false|no)$/i.test(env.HEADLESS ?? '1');
const PAIRS_DIR = env.PAIRS_DIR ? path.resolve(env.PAIRS_DIR) : null;
const TIMEOUT = 30_000;

class Fail extends Error {}
const check = (ok, msg) => {
  if (!ok) throw new Fail(msg);
};
const log = (m) => console.log(`[e2e ambience] ${m}`);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

/** dist/ over HTTP, and PAIRS_DIR at /pairs-pack/ when given; the picture requests are kept. */
function startServer(port) {
  const pictures = [];
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const p = decodeURIComponent(u.pathname);
    res.setHeader('Access-Control-Allow-Origin', '*');
    let root = DIST;
    let rel = p;
    if (PAIRS_DIR && p.startsWith('/pairs-pack/')) {
      root = PAIRS_DIR;
      rel = p.slice('/pairs-pack'.length);
      if (rel.endsWith('.webp')) pictures.push(rel);
    }
    let file = path.normalize(path.join(root, rel));
    if (!file.startsWith(root)) file = '';
    try {
      if (file && statSync(file).isDirectory()) file = path.join(file, 'index.html');
      const body = readFileSync(file);
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(body);
    } catch {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found', path: p }));
    }
  });
  const sockets = new Set();
  server.on('connection', (s) => {
    sockets.add(s);
    s.on('close', () => sockets.delete(s));
  });
  return new Promise((resolve) =>
    server.listen(port, '127.0.0.1', () =>
      resolve({
        pictures,
        stop: () =>
          new Promise((r) => {
            server.close(() => r());
            for (const s of sockets) s.destroy();
          }),
      }),
    ),
  );
}

async function main() {
  if (env.BUILD !== '0') {
    log('building');
    execFileSync('npm', ['run', 'build'], { cwd: ROOT, stdio: 'inherit' });
  }
  const port = await freePort();
  const server = await startServer(port);
  const origin = `http://127.0.0.1:${port}`;
  // No ?pairs= by default: under ?pairfull=1 ForgeCoach's pack brings FORGECOACH_PAIRS_FULL_URL (pairs-v6).
  const pairs = PAIRS_DIR ? `${origin}/pairs-pack/` : (env.PAIRS_URL || null);
  log(`pairs: ${pairs ?? 'the flag’s default (no ?pairs=)'}`);
  const pw = await loadPlaywright();
  const browser = await launchBrowser(pw, { headless: HEADLESS });
  let failed = false;
  try {
    const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`${origin}/?pairfull=1${pairs ? `&pairs=${encodeURIComponent(pairs)}` : ''}#ambience`);
    // The pack and its pairs: the pairs line names a pairs-vN pack.
    await page.waitForSelector('[data-amb-pairs]', { timeout: TIMEOUT });
    const pairsLine = await page.textContent('[data-amb-pairs]');
    log(`pairs line: ${pairsLine?.slice(0, 120)}`);
    // pairs-v6 by default; a local or named pack (PAIRS_DIR / PAIRS_URL) may be another (pairs-v6-draft).
    check((pairs ? /pairs-v\d/ : /pairs-v6/).test(pairsLine ?? ''), `the pairs pack did not load as ${pairs ? 'a pairs-vN pack' : 'pairs-v6'}: ${pairsLine}`);
    await page.click('[data-pieces-toggle="builtin"]');
    await page.click('[data-pieces-three]');
    // The load gate draws the painted picture once it has loaded.
    const panel = await page.waitForSelector('[data-pairfull-painted="R"]', { timeout: TIMEOUT });
    const side = await panel.getAttribute('data-pairfull-painted-side');
    const key = await panel.getAttribute('data-pairfull');
    const stage = await panel.getAttribute('data-pairfull-stage');
    const mirrored = await panel.evaluate((el) => el.classList.contains('is-mirrored'));
    const srcs = await panel.$$eval('img', (imgs) => imgs.map((i) => i.getAttribute('src')));
    log(`panel: ${key}, stage ${stage}, side ${side}, mirrored ${mirrored}, img ${srcs.join(' ')}`);
    check(key === 'island+plains' && stage === '2', `expected island+plains at pair stage 2, got ${key} at ${stage}`);
    check(side === 'right', `expected the right (plains) side, got ${side}`);
    check(mirrored, 'the board has plains | island: the picture should be mirrored');
    // Settled: the base panorama has faded out (reduced motion off: the cross-fade runs over growth.seconds).
    await page.waitForFunction(() => [...document.querySelectorAll('[data-pairfull-painted="R"] img')].every((i) => /s2\+RR-panorama\.webp$/.test(i.getAttribute('src') ?? '')), null, { timeout: TIMEOUT });
    const img = await page.$('[data-pairfull-painted="R"] img');
    const loaded = await img.evaluate((i) => i.complete && i.naturalWidth);
    check(loaded === 3277, `the painted picture did not load at 3277 px wide (naturalWidth ${loaded})`);
    // No cut-out element over a painted picture, on either half.
    const cutOuts = await page.$$eval('[data-pc="element"]', (els) => els.length);
    check(cutOuts === 0, `${cutOuts} cut-out element(s) drawn over the painted picture`);
    const caption = await page.textContent('[data-amb-bands="1"]');
    log(`caption: ${caption}`);
    check(/R painted in, on plains's ground/.test(caption ?? ''), `the caption does not say red is painted in: ${caption}`);
    if (PAIRS_DIR) {
      const painted = server.pictures.filter((p) => p.includes('+'));
      log(`painted pictures fetched: ${painted.join(', ')}`);
      // Both sides may be fetched (pairPictures warms both, so a flip of the balance is warm); the right one is what is drawn.
      check(painted.includes('/pairs/island-plains/s2+RR-panorama.webp'), 'the right side was never fetched');
    }
    check(errors.length === 0, `page errors: ${errors.join('; ')}`);
    mkdirSync(OUT, { recursive: true });
    // Let the empty table's dissolve and the fades settle before the picture is taken.
    await page.waitForTimeout(3000);
    await page.screenshot({ path: path.join(OUT, 'ambience-three.png') });
    log('PASS: the worked example draws R painted in on plains’s ground (s2+RR), mirrored, with no cut-out');
    if (pairs) {
      const ran = await gridChecks(page, pairs, errors);
      if (ran) await phoneCheck(browser, origin, pairs);
    }
  } catch (e) {
    failed = true;
    if (e instanceof Fail) console.error(`[e2e ambience] FAIL: ${e.message}`);
    else console.error(e);
  } finally {
    await browser.close();
    await server.stop();
  }
  process.exit(failed ? 1 : 0);
}

/** Sets one Lands slider of your side (React listens for `input`). */
async function setLands(page, biome, n) {
  await page.evaluate(
    ({ biome, n }) => {
      const side = document.querySelector('[data-count-side]')?.getAttribute('data-count-side');
      const el = document.querySelector(`[data-count="${side}:${biome}"]`);
      if (!el) throw new Error(`no slider for ${biome}`);
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, String(n));
      el.dispatchEvent(new Event('input', { bubbles: true }));
    },
    { biome, n },
  );
}

/**
 * Spec 1.17 (draft): the seam grid on your half, when the pairs manifest has one. `cases`: the lands in the order
 * they are played (the board's order), the cell expected, whether it is clamped and mirrored, the caption's words.
 */
async function gridChecks(page, pairs, errors) {
  const manifest = await (await fetch(new URL('pairs.json', pairs.endsWith('/') ? pairs : `${pairs}/`))).json();
  const gridOf = (key) => manifest.pairs?.[key]?.grid ?? null;
  if (!gridOf('island+swamp') && !gridOf('forest+swamp')) {
    log('no seam grid in this pairs manifest: 1.17 checks skipped');
    return false;
  }
  const cases = [
    { name: 'grid-4x3', key: 'island+swamp', lands: [['island', 4], ['swamp', 3]], cell: '4x3', dir: 'island-swamp', mirrored: false, caption: 'island s4 | swamp s3, seam 4x3' },
    { name: 'grid-4x4', key: 'island+swamp', keep: true, lands: [['swamp', 4]], cell: '4x4', dir: 'island-swamp', mirrored: false, caption: 'island s4 | swamp s4, seam 4x4' },
    { name: 'grid-6x5-clamped', key: 'island+swamp', lands: [['island', 6], ['swamp', 2]], cell: '6x5', dir: 'island-swamp', mirrored: false, clamped: true, caption: 'island s6 | swamp s2→s5, seam 6x5 (clamped)' },
    { name: 'grid-3x2-mirrored', key: 'forest+swamp', lands: [['forest', 2], ['swamp', 3]], cell: '3x2', dir: 'swamp-forest', mirrored: true, caption: 'swamp s3 | forest s2, seam 3x2' },
  ];
  let ran = 0;
  for (const c of cases) {
    if (!gridOf(c.key)?.[c.cell]) {
      log(`SKIP ${c.name}: ${c.key} has no cell ${c.cell} yet`);
      continue;
    }
    if (!c.keep) {
      const reset = await page.$('[data-amb-reset]:not([disabled])');
      if (reset) await reset.click();
    }
    for (const [biome, n] of c.lands) await setLands(page, biome, n);
    const sel = `[data-pairfull="${c.key}"][data-pairfull-cell="${c.cell}"]`;
    const panel = await page.waitForSelector(sel, { timeout: TIMEOUT });
    const want = new RegExp(`/seams/${c.dir}/s${c.cell}-panorama\\.webp$`);
    // Settled: the previous picture has faded out.
    await page.waitForFunction(({ sel, src }) => [...document.querySelectorAll(`${sel} img`)].every((i) => new RegExp(src).test(i.getAttribute('src') ?? '')), { sel, src: want.source }, { timeout: TIMEOUT });
    const mirrored = await panel.evaluate((el) => el.classList.contains('is-mirrored') && !!el.querySelector('.scn-pairfull-flip.is-mirrored'));
    const clamped = (await panel.getAttribute('data-pairfull-clamped')) === 'yes';
    const width = await panel.$eval('img', (i) => i.complete && i.naturalWidth);
    const caption = await page.textContent('[data-amb-bands="1"]');
    log(`${c.name}: ${c.key} cell ${c.cell}, mirrored ${mirrored}, clamped ${clamped}, ${width} px; caption: ${caption}`);
    check(mirrored === c.mirrored, `${c.name}: expected mirrored ${c.mirrored}`);
    check(clamped === !!c.clamped, `${c.name}: expected clamped ${!!c.clamped}`);
    check(width === 3277, `${c.name}: the cell did not load at 3277 px wide (${width})`);
    check((caption ?? '').includes(c.caption), `${c.name}: the caption does not say "${c.caption}": ${caption}`);
    check(errors.length === 0, `page errors: ${errors.join('; ')}`);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(OUT, `${c.name}.png`) });
    ran++;
  }
  log(`PASS: spec 1.17's seam grid, ${ran} of ${cases.length} cases (the rest skipped: cells not painted yet)`);
  if (gridOf('island+swamp')?.['3x2']) await formingCheck(page, errors);
  else log('SKIP the pair forming: island+swamp has no cell 3x2 yet');
  return !!gridOf('island+swamp')?.['4x3'];
}

/**
 * The pair forming (the #201 follow-up): island 3 alone, then a first Swamp. Every picture the pair panel draws is
 * recorded from before the Swamp arrives; the first is the cell 3x2 (island s3 | swamp s1, clamped), and the
 * whole-place panorama (`pairs/island-swamp/s<k>-panorama.webp`) is never among them.
 */
async function formingCheck(page, errors) {
  const reset = await page.$('[data-amb-reset]:not([disabled])');
  if (reset) await reset.click();
  await setLands(page, 'island', 3);
  // The cell is warmed while the half is one colour (pairPictures), before its second colour arrives.
  await page.waitForFunction(() => performance.getEntriesByType('resource').some((e) => e.name.endsWith('/seams/island-swamp/s3x2-panorama.webp')), null, { timeout: TIMEOUT });
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    const seen = (window.__pairSrcs = []);
    const note = () => {
      for (const i of document.querySelectorAll('[data-amb-player="1"] [data-pairfull] img')) {
        const s = i.getAttribute('src');
        if (s && seen[seen.length - 1] !== s && !seen.includes(s)) seen.push(s);
      }
    };
    note();
    new MutationObserver(note).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['src'] });
  });
  await setLands(page, 'swamp', 1);
  await page.waitForSelector('[data-pairfull="island+swamp"][data-pairfull-cell="3x2"]', { timeout: TIMEOUT });
  await page.waitForTimeout(1500);
  const seen = await page.evaluate(() => window.__pairSrcs);
  log(`the pair forming: pictures drawn ${seen.map((s) => s.replace(/^.*\/(seams|pairs)\//, '$1/')).join(' → ')}`);
  check(seen.length > 0 && /\/seams\/island-swamp\/s3x2-panorama\.webp$/.test(seen[0]), `the pair's first picture is not its cell 3x2: ${seen[0]}`);
  check(!seen.some((s) => /\/pairs\/island-swamp\/s\d-panorama\.webp$/.test(s)), `the whole-place panorama was drawn while the pair formed: ${seen.join(', ')}`);
  check(errors.length === 0, `page errors: ${errors.join('; ')}`);
  await page.screenshot({ path: path.join(OUT, 'grid-forming.png') });
  log('PASS: the pair forming draws its first cell (3x2) first, no whole-place panorama between');
}

/**
 * A phone (390 × 844): the cells are 5:1 desktop panoramas, so a phone-width screen keeps the stage panorama's phone
 * picture. island 4 | swamp 3 names no cell, fetches no seam picture, and the caption says "whole half", no "seam".
 */
async function phoneCheck(browser, origin, pairs) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const errors = [];
  const seams = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('request', (r) => {
    if (r.url().includes('/seams/')) seams.push(r.url());
  });
  try {
    await page.goto(`${origin}/?pairfull=1&pairs=${encodeURIComponent(pairs)}#ambience`);
    await page.waitForSelector('[data-amb-pairs]', { timeout: TIMEOUT });
    await setLands(page, 'island', 4);
    await setLands(page, 'swamp', 3);
    const panel = await page.waitForSelector('[data-amb-player="1"] [data-pairfull="island+swamp"]', { timeout: TIMEOUT });
    await page.waitForFunction(() => [...document.querySelectorAll('[data-amb-player="1"] [data-pairfull] img')].every((i) => /-panorama-phone\.webp$/.test(i.getAttribute('src') ?? '')), null, { timeout: TIMEOUT });
    const cellAttr = await panel.getAttribute('data-pairfull-cell');
    const src = await panel.$eval('img', (i) => i.getAttribute('src'));
    const caption = (await page.textContent('[data-amb-bands="1"]')) ?? '';
    log(`phone: cell ${cellAttr ?? 'none'}, img ${src}; caption: ${caption}; seam pictures fetched: ${seams.length}`);
    check(cellAttr === null, `phone: a cell is named (${cellAttr})`);
    check(/\/pairs\/island-swamp\/s\d-panorama-phone\.webp$/.test(src ?? ''), `phone: not the stage panorama's phone picture: ${src}`);
    check(caption.includes('whole half') && !/seam/.test(caption), `phone: the caption names a seam or no whole half: ${caption}`);
    check(seams.length === 0, `phone: ${seams.length} seam picture(s) fetched: ${seams.join(', ')}`);
    check(errors.length === 0, `phone: page errors: ${errors.join('; ')}`);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(OUT, 'grid-phone.png') });
    log('PASS: a phone draws the stage panorama, names no seam and fetches no cell');
  } finally {
    await ctx.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
