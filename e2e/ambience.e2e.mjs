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
 *   2. opens `/?pairfull=1&pairs=<pairs>#ambience` at a desktop size, with
 *      ForgeCoach's own pack (from jsDelivr), Pieces → Placeholders (so a
 *      1.14 cut-out exists for every colour) and Pieces → Three colours
 *      (SYSTEM.md's worked example: Plateau, Plains, Island);
 *   3. checks that your half draws island+plains whole with red PAINTED IN on
 *      plains's ground -- the sided picture `s2+RR-panorama.webp` --, that no
 *      cut-out element is drawn over it, and that the caption says
 *      "R painted in".
 *
 * Environment: PAIRS_DIR (a local pairs pack), or PAIRS_URL (default the
 * pairs-v5 tag on jsDelivr); BUILD=0, HEADLESS=0, BROWSER_PATH. Needs the
 * network for ForgeCoach's pack (jsDelivr). Exit status: 0 pass, 1 a check
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
  const pairs = PAIRS_DIR ? `${origin}/pairs-pack/` : (env.PAIRS_URL ?? 'https://cdn.jsdelivr.net/gh/jalirkan/forgecoach-scenery@pairs-v5/');
  log(`pairs: ${pairs}`);
  const pw = await loadPlaywright();
  const browser = await launchBrowser(pw, { headless: HEADLESS });
  let failed = false;
  try {
    const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`${origin}/?pairfull=1&pairs=${encodeURIComponent(pairs)}#ambience`);
    // The pack and its pairs: the pairs line names pairs-v5.
    await page.waitForSelector('[data-amb-pairs]', { timeout: TIMEOUT });
    const pairsLine = await page.textContent('[data-amb-pairs]');
    log(`pairs line: ${pairsLine?.slice(0, 120)}`);
    check(/pairs-v5/.test(pairsLine ?? ''), `the pairs pack did not load as pairs-v5: ${pairsLine}`);
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

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
