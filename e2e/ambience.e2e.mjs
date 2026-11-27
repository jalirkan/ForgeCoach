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
 *   2. opens a bare `/#ambience` at a desktop size -- no `?pairfull=1`: spec
 *      1.15 is the default since pairs-v8 (2026-11-06) -- (its own pairs,
 *      pairs-v8 on jsDelivr; `?pairs=<pairs>` only with PAIRS_DIR or
 *      PAIRS_URL), with ForgeCoach's own pack (pack-v10 from jsDelivr, its
 *      pieces spec 1.19 d's), Pieces → Placeholders (so a
 *      1.14 cut-out exists for every colour) and Pieces → Three colours
 *      (SYSTEM.md's worked example: Plateau, Plains, Island);
 *   3. checks that your half draws mountain+plains whole (spec 1.19 b: the
 *      pair showing stays the base, so the Island no longer re-keys it to
 *      island+plains): on a grid pack with nothing painted in (pairs-v8, the
 *      default) its plain cell, mirrored, with blue's cut-out and the caption
 *      "island as an element" (spec 1.19 a); on a cell or a 1.16 pair with
 *      blue PAINTED IN on plains's ground, the sided picture, no cut-out
 *      element over it, and the caption "U painted in";
 *   4. spec 1.17 (draft), only when the pairs manifest has a seam `grid`
 *      (pairs-v8 by default, or a grid pack by PAIRS_DIR or PAIRS_URL): with the Lands sliders,
 *      island 4 | swamp 3 draws the cell `4x3` unmirrored, a fourth Swamp
 *      steps one half (`4x4`), island 6 | swamp 2 -- no cell `6x2` -- is the
 *      two mono pictures apart (spec 1.19 c: no clamp; "no seam cell"), and
 *      forest 2 | swamp 3 draws swamp+forest's `3x2` MIRRORED
 *      (the geography puts the swamp left); each checked on the panel, its
 *      picture and the caption, a screenshot each (e2e/out/grid-*.png). A
 *      cell the manifest does not have yet is skipped, and says so. Then the
 *      pair FORMING: island 2 alone, then a first Swamp -- the half's first
 *      pair picture is the cell `2x1` (warmed ahead), never the whole-place
 *      panorama for a moment before it (the #201 follow-up);
 *   5. with a grid, a PHONE (390 × 844): island 4 | swamp 3 draws the stage
 *      panorama's phone picture, names no cell, fetches no seam picture, and
 *      the caption says "whole half" and no "seam" (e2e/out/grid-phone.png)
 *      -- unless the cell 4x3 carries a `phone` picture (spec 1.18): then the
 *      phone draws that cell's phone picture, names the cell, fetches no
 *      desktop seam picture, and the caption names the seam; then (spec
 *      1.18.1) the worked example on the phone, with Placeholders (their
 *      elements have phone pieces): blue's cut-out -- its phone piece -- on
 *      the plains' ground over mountain+plains' plain phone cell, captioned
 *      "island as an element", where the cell has no blue painted picture
 *      (pairs-v8) or one with no phone picture (pairs-v7.1's); the painted
 *      phone picture and no cut-out where it has one
 *      (e2e/out/grid-phone-three.png).
 *
 *   6. Spec 1.19 a and b (the owner's rules after the storyboard of 2026-11-02), with the pack's own pieces
 *      (pack-v10's, at `@pieces-v1` as pack-v9.2's were), on the desktop and on the phone, land by land: Island, Swamp, Mountain, Mountain, Island,
 *      Swamp, Forest ×3 (the storyboard's sequence 5) keeps island+swamp from the second land to the last -- the
 *      pair showing stays the base while both its colours are among the three heaviest; the old rule went to
 *      island+mountain at the second Mountain and to island+forest at the third Forest -- and W U B R G ×2, Forest,
 *      Island (sequence 6, the five-colour soup) keeps island+plains; at every land every colour with lands is on
 *      screen (the pair picture, a colour painted in, or a cut-out that has loaded) and named in the caption, which
 *      names no dual nobody played. On the phone (5), the caption is at most two lines
 *      (e2e/out/seq-*.png).
 *
 *   7. Spec 1.21, the nearest scene, on a page WITH the scenes (ForgeCoach's own, scenes-v1.4), on the desktop and
 *      the phone, land by land: Island, Swamp, Mountain, Forest, Plains (the owner's island 1, swamp 1, mountain 1 at
 *      the third land, which has no scene of its own; a four- and a five-colour state after it), then the storyboard's
 *      sequences 5 and 6 -- at every land from the second on, your half is exactly one scene slot whose picture has
 *      loaded, naming the state (`data-scene-for`, or `data-scene` when it is the state's own), the key drawn a scene
 *      of the live manifest or one colour's own picture (`data-scene-mono`), no colour that is not on the board, no
 *      pair picture, no seam cell and no cut-out element; the caption "Scene · … — nearest painting: …" where it
 *      stands in (e2e/out/nearest-*.png).
 *
 *   8. Spec 1.22, places, on a bare page (ForgeCoach's default draws them), the places manifest and every place
 *      picture served from disk (PLACES_DIR, default ~/scenery-packs/scenes-v1/pack-<the places tag>, pack-places-v6: `index/places.json`
 *      and `places/<slug>/<d|p>/…`) through the browser context's routing, never the network; on the desktop and the
 *      phone, land by land (Cartagena's four, a homeland from stage 1, the storyboard's 5 and 6, a land destroyed):
 *      your half is exactly one place panel for the half's colours (`data-place`) and state (`data-scene`), its base
 *      (the phone base on a phone) and every live land's piece at its stage loaded, each piece at its box in the
 *      base's frame to a pixel; a stage step fades the land's new piece in over the old (both on screen, the old
 *      beneath) and leaves the base and the other pieces the same elements; a new colour cross-fades the whole half;
 *      the caption is "<place>: Island 2, Swamp 1, …"; scenes.json is never fetched (e2e/out/places-*.png). A state
 *      whose colours have no place on disk is skipped and said so (while the pack is being built).
 *      Spec 1.23 (`places-camera`: Plains, Mountain, Island -- Cusco, then Sicily; `places-camera-hawaii`: Forest ×4,
 *      Mountain ×5, Island -- Araucanía at forest 4 + mountain 5, then Hawaii): the place change is a camera move:
 *      mid-move the panel's `data-camera` is the map this script computes from the manifest on disk for the shape
 *      drawn, the moving frames are on screen and each tracked land's centre in the new frame lies on its centre in the
 *      old one (to a few pixels), over the new place at its settled position, which covers every corner of the half,
 *      opaque, untransformed and unmasked; settled, `data-camera` is gone and the frame carries no transform and no mask.
 *
 *   Steps 2–6 run with `?scenes=off` (spec 1.21: no scenes for the page; it turns the places off too): with scenes
 *   or places loaded a half of two or more colours never draws the pair logic they check, which still draws for a
 *   pack with neither. Step 7 runs with `?places=off`, so the scenes are fetched and drawn.
 *
 *   Spec 1.18 likewise on the worked example: on a grid pair whose cell has
 *   blue painted in (`elements.U`), the cell's painted picture is drawn and
 *   captioned, still with no cut-out; without one, spec 1.19 a's cut-out over
 *   the plain cell. The flag's default, pairs-v8, paints nothing in and has a
 *   phone picture on every cell, so a default run must take the cut-out
 *   branch of the worked example and of the phone, and the phone cell (it
 *   fails if the manifest it loads has a painted-in cell or a cell with no
 *   phone picture); a PAIRS_DIR / PAIRS_URL pack takes whichever its cells
 *   call for (pairs-v7.1: 1.18's painted cells, pairs-v6: no phone cells).
 *
 * Environment: PLACES_DIR (the places pack on disk, step 8), PAIRS_DIR (a local pairs pack), or PAIRS_URL (a pairs pack by
 * URL, e.g. https://cdn.jsdelivr.net/gh/jalirkan/forgecoach-scenery@pairs-v6/;
 * with neither, no `?pairs=`: the default, the pairs-v8 tag on
 * jsDelivr, checked by the pairs line's name and the URL the page fetched its
 * manifest from); BUILD=0, HEADLESS=0, BROWSER_PATH.
 * Needs the network for ForgeCoach's pack (jsDelivr). Exit status: 0 pass, 1 a check
 * failed, 2 could not start. A screenshot goes to e2e/out/ambience-three.png.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, statSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { freePort, launchBrowser, loadPlaywright } from './harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const OUT = path.join(ROOT, 'e2e', 'out');
const env = process.env;
const HEADLESS = !/^(0|false|no)$/i.test(env.HEADLESS ?? '1');
const PAIRS_DIR = env.PAIRS_DIR ? path.resolve(env.PAIRS_DIR) : null;
/** What a bare page loads with no `?pairs=` (spec 1.15 on by default): src/ambience/prefs.ts's FORGECOACH_PAIRS_FULL_URL (an .mjs cannot import it). */
const DEFAULT_PAIRS_FULL_URL = 'https://cdn.jsdelivr.net/gh/jalirkan/forgecoach-scenery@pairs-v8/';
const TIMEOUT = 30_000;
/**
 * The page's query: `?pairs=` when given, (spec 1.21) `scenes=off` for the checks of the 1.15–1.19 halves (it turns the
 * places off too), and (spec 1.22) `places=off` for the checks of 1.21's scenes.
 */
const queryOf = (pairs, scenesOff = true, placesOff = false) => {
  const q = [pairs ? `pairs=${encodeURIComponent(pairs)}` : null, scenesOff ? 'scenes=off' : null, placesOff && !scenesOff ? 'places=off' : null].filter(Boolean);
  return q.length ? `?${q.join('&')}` : '';
};

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
  // No ?pairs= and no ?pairfull=1 by default: on a bare page ForgeCoach's pack brings FORGECOACH_PAIRS_FULL_URL (pairs-v8).
  const pairs = PAIRS_DIR ? `${origin}/pairs-pack/` : (env.PAIRS_URL || null);
  // The manifest the page really loads: a pairs= of yours, or the default (prefs.ts's FORGECOACH_PAIRS_FULL_URL,
  // whose value is kept here by hand), so a default run checks the grid, the pair forming, the third colour's cut-out and
  // the phone cell on pairs-v8 too.
  const manifestPairs = pairs ?? DEFAULT_PAIRS_FULL_URL;
  log(`pairs: ${pairs ?? `the default (no ?pairs=; ${DEFAULT_PAIRS_FULL_URL})`}`);
  const pw = await loadPlaywright();
  const browser = await launchBrowser(pw, { headless: HEADLESS });
  let failed = false;
  try {
    const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`${origin}/${queryOf(pairs)}#ambience`);
    // The pack and its pairs: the pairs line names a pairs-vN pack.
    await page.waitForSelector('[data-amb-pairs]', { timeout: TIMEOUT });
    const pairsLine = await page.textContent('[data-amb-pairs]');
    log(`pairs line: ${pairsLine?.slice(0, 120)}`);
    // pairs-v8 by default, by its name on the pairs line and by the URL its manifest came from; a local or named
    // pack (PAIRS_DIR / PAIRS_URL) may be another (pairs-v7.1, pairs-v6), known by its URL.
    check((pairs ? /pairs-v\d/ : /pairs-v8\b/).test(pairsLine ?? ''), `the pairs pack did not load as ${pairs ? 'a pairs-vN pack' : 'pairs-v8'}: ${pairsLine}`);
    const fetched = await page.evaluate(() => performance.getEntriesByType('resource').map((e) => e.name).filter((n) => /\/pairs\.json(\?|$)/.test(n)));
    log(`pairs manifest fetched: ${fetched.join(' ')}`);
    const wantManifest = new URL('pairs.json', manifestPairs.endsWith('/') ? manifestPairs : `${manifestPairs}/`).href;
    check(fetched.some((u) => u.split('?')[0] === wantManifest), `the page did not fetch ${wantManifest}: ${fetched.join(', ')}`);
    if (!pairs) check(/@pairs-v8\/pairs\.json$/.test(wantManifest), `the default is not pairs-v8: ${wantManifest}`);
    await page.click('[data-pieces-toggle="builtin"]');
    await page.click('[data-pieces-three]');
    // Spec 1.17: on a pair with a seam grid the worked example draws the grid cell, and its third colour nothing
    // (pairs-v6), and since 1.19 a its cut-out (pairs-v8, the default); spec 1.18: the cell with red painted in where
    // it has one (pairs-v7.1); the painted-in picture (1.16) is what a pair without a grid draws (pairs-v5).
    const manifest = await (await fetch(wantManifest)).json();
    if (!pairs) {
      // The default (pairs-v8) paints no cell -- a third colour is its cut-out -- and has a phone picture on every cell,
      // island+swamp's 4x3 among them.
      const cells = Object.values(manifest.pairs ?? {}).flatMap((p) => Object.values(p.grid ?? {}));
      check(cells.length === 160 && cells.every((c) => !c.elements && c.phone), 'the default (pairs-v8) is not 160 cells, each with a phone picture and nothing painted in');
      check(!!manifest.pairs?.['island+swamp']?.grid?.['4x3']?.phone, 'the default (pairs-v8) has no phone picture on island+swamp’s 4x3');
    }
    if (manifest.pairs?.['island+plains']?.grid) {
      await workedExampleOnGrid(page, manifest);
    } else {
      await workedExamplePainted(page, pairs, server);
    }
    check(errors.length === 0, `page errors: ${errors.join('; ')}`);
    mkdirSync(OUT, { recursive: true });
    // Let the empty table's dissolve and the fades settle before the picture is taken.
    await page.waitForTimeout(3000);
    await page.screenshot({ path: path.join(OUT, 'ambience-three.png') });
    const ran = await gridChecks(page, manifestPairs, errors);
    for (const seq of SEQUENCES) await sequenceCheck(page, seq, errors, 'desktop');
    if (ran) await phoneCheck(browser, origin, pairs, manifest);
    // Spec 1.21: the nearest scene, with the scenes loaded (no `?scenes=off`; `?places=off`), on a desktop and a phone.
    await nearestCheck(browser, origin, pairs, 'desktop');
    await nearestCheck(browser, origin, pairs, 'phone');
    // Spec 1.22: places, on a bare page (ForgeCoach's default draws them), the manifest and pictures served from disk.
    await placesCheck(browser, origin, pairs, 'desktop');
    await placesCheck(browser, origin, pairs, 'phone');
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

/**
 * The worked example on a pair with a seam grid (1.17): Plateau, Plains, Island. Spec 1.19 b: the pair showing
 * (mountain+plains, from the Plateau) stays the base -- the Island is its third colour, no longer a re-key to
 * island+plains. The cell is mountain+plains' (the board has mountain | plains, the geography plains | mountain:
 * mirrored). Spec 1.18: with blue painted into the cell, that picture and no cut-out; without (pairs-v6), spec 1.19 a:
 * blue's cut-out over the plain cell (1.17 drew nothing).
 */
async function workedExampleOnGrid(page, manifest) {
  const panel = await page.waitForSelector('[data-pairfull="mountain+plains"][data-pairfull-cell]', { timeout: TIMEOUT });
  const cell = await panel.getAttribute('data-pairfull-cell');
  if (manifest.pairs['mountain+plains'].grid[cell]?.elements?.U) return workedExampleOnPaintedCell(page, cell);
  const mirrored = await panel.evaluate((el) => el.classList.contains('is-mirrored'));
  check(/^[1-6]x[1-6]$/.test(cell ?? ''), `expected a grid cell on mountain+plains, got ${cell}`);
  check(mirrored, 'the board has mountain | plains and the geography puts the plains left: the cell should be mirrored');
  await page.waitForFunction((c) => [...document.querySelectorAll('[data-pairfull="mountain+plains"] img')].every((i) => new RegExp(`seams/plains-mountain/s${c}-panorama\\.webp$`).test(i.getAttribute('src') ?? '')), cell, { timeout: TIMEOUT });
  const img = await page.$('[data-pairfull="mountain+plains"] img');
  const loaded = await img.evaluate((i) => i.complete && i.naturalWidth);
  check(loaded === 3277, `the cell did not load at 3277 px wide (naturalWidth ${loaded})`);
  const painted = await page.$$eval('[data-pairfull-painted]', (els) => els.length);
  check(painted === 0, `${painted} painted-in picture(s) drawn on a grid pair`);
  const el = await page.waitForSelector('[data-amb-player="1"] [data-pc="element"][data-pc-colour="U"]', { timeout: TIMEOUT });
  check(!!el, 'spec 1.19 a: no cut-out of blue over a cell with nothing painted');
  const caption = await page.textContent('[data-amb-bands="1"]');
  log(`panel: mountain+plains cell ${cell}, mirrored ${mirrored}; caption: ${caption}`);
  check(new RegExp(`seam ${cell}; island as an element`).test(caption ?? '') && !/painted in/.test(caption ?? ''), `the caption should name the seam and the island as an element: ${caption}`);
  log(`PASS: the worked example on a grid pair draws mountain+plains' cell ${cell}, mirrored, the island its cut-out (spec 1.19 a)`);
}

/** Spec 1.18: the worked example on a cell with blue painted in: the heavier half's picture, mirrored, captioned, no cut-out. */
async function workedExampleOnPaintedCell(page, cell) {
  const panel = await page.waitForSelector(`[data-pairfull="mountain+plains"][data-pairfull-cell="${cell}"][data-pairfull-painted="U"]`, { timeout: TIMEOUT });
  const side = await panel.getAttribute('data-pairfull-painted-side');
  const mirrored = await panel.evaluate((el) => el.classList.contains('is-mirrored'));
  // The plains (heavier, 1.5 to the mountain's ½) is the geography's left: the cell's left side.
  check(side === 'left', `blue should be painted on the plains' side, the cell's left: ${side}`);
  check(mirrored, 'the board has mountain | plains and the geography puts the plains left: the cell should be mirrored');
  const want = `seams/plains-mountain/s${cell}\\+UL-panorama\\.webp$`;
  await page.waitForFunction((src) => [...document.querySelectorAll('[data-pairfull="mountain+plains"] img')].every((i) => new RegExp(src).test(i.getAttribute('src') ?? '')), want, { timeout: TIMEOUT });
  const cutOuts = await page.$$eval('[data-pc="element"]', (els) => els.length);
  check(cutOuts === 0, `${cutOuts} cut-out element(s) drawn over the painted cell`);
  const caption = await page.textContent('[data-amb-bands="1"]');
  log(`panel: mountain+plains cell ${cell}, U painted on the cell's ${side}, mirrored ${mirrored}; caption: ${caption}`);
  check(new RegExp(`seam ${cell}; U painted in, on plains's ground`).test(caption ?? ''), `the caption should name the cell and blue painted in: ${caption}`);
  log(`PASS: the worked example on a grid pair draws mountain+plains' cell ${cell} with U painted in (spec 1.18), no cut-out`);
}

/** The worked example on a pair without a grid (1.16), spec 1.19 b's pair: U painted in on plains's ground, s2+UR, no cut-out. */
async function workedExamplePainted(page, pairs, server) {
  // The load gate draws the painted picture once it has loaded.
  const panel = await page.waitForSelector('[data-pairfull-painted="U"]', { timeout: TIMEOUT });
  const side = await panel.getAttribute('data-pairfull-painted-side');
  const key = await panel.getAttribute('data-pairfull');
  const stage = await panel.getAttribute('data-pairfull-stage');
  const mirrored = await panel.evaluate((el) => el.classList.contains('is-mirrored'));
  const srcs = await panel.$$eval('img', (imgs) => imgs.map((i) => i.getAttribute('src')));
  log(`panel: ${key}, stage ${stage}, side ${side}, mirrored ${mirrored}, img ${srcs.join(' ')}`);
  check(key === 'mountain+plains' && stage === '2', `expected mountain+plains at pair stage 2, got ${key} at ${stage}`);
  check(side === 'right', `expected the right (plains) side, got ${side}`);
  check(!mirrored, 'the board has mountain | plains, the key\'s order: the picture should not be mirrored');
  // Settled: the base panorama has faded out (reduced motion off: the cross-fade runs over growth.seconds).
  await page.waitForFunction(() => [...document.querySelectorAll('[data-pairfull-painted="U"] img')].every((i) => /s2\+UR-panorama\.webp$/.test(i.getAttribute('src') ?? '')), null, { timeout: TIMEOUT });
  const img = await page.$('[data-pairfull-painted="U"] img');
  const loaded = await img.evaluate((i) => i.complete && i.naturalWidth);
  check(loaded === 3277, `the painted picture did not load at 3277 px wide (naturalWidth ${loaded})`);
  // No cut-out element over a painted picture, on either half.
  const cutOuts = await page.$$eval('[data-pc="element"]', (els) => els.length);
  check(cutOuts === 0, `${cutOuts} cut-out element(s) drawn over the painted picture`);
  const caption = await page.textContent('[data-amb-bands="1"]');
  log(`caption: ${caption}`);
  check(/U painted in, on plains's ground/.test(caption ?? ''), `the caption does not say blue is painted in: ${caption}`);
  if (PAIRS_DIR && pairs) {
    // With a local pack the server saw the fetches: the right side's painted picture is among them (both sides may be warmed).
    const painted = server.pictures.filter((p) => p.includes('+'));
    log(`painted pictures fetched: ${painted.join(', ')}`);
    check(painted.includes('/pairs/mountain-plains/s2+UR-panorama.webp'), 'the right side was never fetched');
  }
  log('PASS: the worked example draws U painted in on plains’s ground (s2+UR), with no cut-out');
}

/** The storyboard's sequences (pc-results scenery/STORYBOARD.md): the lands in play order, and the pair spec 1.19 b keeps. */
const SEQUENCES = [
  // Sequence 5, Justin's four. The old rule: island+mountain at the second Mountain, island+swamp again at the second
  // Swamp (a tie), island+forest at the third Forest. 1.19 b: island+swamp throughout -- a pair colour never leaves the
  // three heaviest (U2 B2 R2 G3 at the end: one colour, the forest, outweighs them).
  { name: 'seq-5-justin-four', lands: 'I S M M I S F F F', key: 'island+swamp' },
  // Sequence 6, the five-colour soup: W U B R G twice, then Forest, Island. 1.19 b: island+plains throughout (the old
  // rule went to plains+forest at the third Forest and to island+forest at the third Island).
  { name: 'seq-6-five-soup', lands: 'P I S M F P I S M F F I', key: 'island+plains' },
];
const BIOME_OF = { I: 'island', S: 'swamp', P: 'plains', F: 'forest', M: 'mountain' };
const COLOUR_OF = { island: 'U', swamp: 'B', plains: 'W', forest: 'G', mountain: 'R' };

/** The colours your half has on screen: the pair picture's (or a pair apart's), a colour painted in, a panel, a cut-out that has loaded. */
async function shownColours(page) {
  return page.evaluate((B) => {
    const root = document.querySelector('[data-amb-player="1"]');
    const out = new Set();
    const pairs = [];
    for (const el of root.querySelectorAll('[data-pairfull]')) {
      pairs.push(el.getAttribute('data-pairfull'));
      for (const b of el.getAttribute('data-pairfull').split('+')) out.add(B[b]);
      const p = el.getAttribute('data-pairfull-painted');
      if (p) out.add(p);
    }
    for (const el of root.querySelectorAll('.scn-slot[data-biome]')) {
      if (el.classList.contains('is-withered')) continue;
      out.add(B[el.getAttribute('data-biome')]);
      if (el.getAttribute('data-apart')) pairs.push(el.getAttribute('data-apart'));
    }
    const cuts = [];
    for (const img of root.querySelectorAll('[data-pc="element"] img')) {
      if (!(img.complete && img.naturalWidth > 0)) continue;
      const host = img.closest('[data-pc="element"]');
      cuts.push(`${host.getAttribute('data-pc-colour')}:${host.getAttribute('data-pc-ground')} ${host.getAttribute('data-pc-slot')}`);
      out.add(host.getAttribute('data-pc-colour'));
    }
    const sceneEl = root.querySelector('[data-scene] img');
    const scene = sceneEl && sceneEl.complete && sceneEl.naturalWidth > 0 ? sceneEl.closest('[data-scene]').getAttribute('data-scene') : null;
    return { colours: [...out].sort(), pairs: [...new Set(pairs)], cuts, scene };
  }, COLOUR_OF);
}

/** Spec 1.20: the live scenes manifest's keys (ForgeCoach's own scenes URL, read from prefs.ts), fetched once; a state with a scene draws it and nothing else. */
let sceneKeys = null;
async function liveSceneKeys() {
  if (sceneKeys) return sceneKeys;
  const prefs = readFileSync(new URL('../src/ambience/prefs.ts', import.meta.url), 'utf8');
  const url = /FORGECOACH_SCENES_URL = '([^']+)'/.exec(prefs)?.[1];
  if (!url) throw new Fail('FORGECOACH_SCENES_URL not found in src/ambience/prefs.ts');
  const r = await fetch(`${url}scenes.json`);
  if (!r.ok) throw new Fail(`scenes manifest ${url}scenes.json: HTTP ${r.status}`);
  const j = await r.json();
  sceneKeys = new Set(Object.keys(j.scenes ?? {}));
  log(`scenes manifest fetched: ${url}scenes.json (${sceneKeys.size} scenes)`);
  return sceneKeys;
}
const GEOGRAPHY = ['island', 'swamp', 'plains', 'forest', 'mountain'];
/** The scene key of a half's lands: each biome at its stage (its count, 6 at most) in the geography's order. */
function sceneKeyOf(counts) {
  return GEOGRAPHY.filter((b) => counts[b]).map((b) => `${b}${Math.min(counts[b], 6)}`).join('+');
}

/**
 * Spec 1.19 a and b, land by land, with the pack's own pieces (pack-v10's elements, their phone pieces on a phone):
 * after each land, once the half has settled, the pair is the one kept and every colour with lands is on screen and
 * named in the caption (by its biome, or "<C> painted in"), which names no dual (none was played). A land whose exact
 * state has a scene (spec 1.20) draws that painting alone: no pair, no cut-out; the caption names every land in it.
 */
async function sequenceCheck(page, seq, errors, shape) {
  // Spec 1.21: these pages run with `?scenes=off` (with scenes, a half of two or more colours is always a scene: see
  // nearestCheck), so no state draws one here.
  const scenes = new Set();
  const line = (await page.textContent('[data-amb-scenes]')) ?? '';
  check(/scenes=off/.test(line), `${shape} ${seq.name}: the page should have no scenes (?scenes=off): ${line}`);
  await page.click('[data-pieces-toggle="pack"]');
  const reset = await page.$('[data-amb-reset]:not([disabled])');
  if (reset) await reset.click();
  const counts = {};
  const lands = seq.lands.split(' ');
  for (let i = 0; i < lands.length; i++) {
    const biome = BIOME_OF[lands[i]];
    counts[biome] = (counts[biome] ?? 0) + 1;
    await setLands(page, biome, counts[biome]);
    const want = Object.keys(counts).map((b) => COLOUR_OF[b]).sort();
    const key = i === 0 ? null : seq.key;
    const scene = scenes.has(sceneKeyOf(counts)) ? sceneKeyOf(counts) : null;
    try {
      await page.waitForFunction(
        ({ want, key, scene, B }) => {
          const root = document.querySelector('[data-amb-player="1"]');
          if (scene) {
            const img = root.querySelector(`[data-scene="${scene}"] img`);
            return !!img && img.complete && img.naturalWidth > 0 && !root.querySelector('[data-pairfull]') && !root.querySelector('[data-pc="element"]');
          }
          const out = new Set();
          const pairs = new Set();
          for (const el of root.querySelectorAll('[data-pairfull]')) {
            pairs.add(el.getAttribute('data-pairfull'));
            for (const b of el.getAttribute('data-pairfull').split('+')) out.add(B[b]);
            const p = el.getAttribute('data-pairfull-painted');
            if (p) out.add(p);
          }
          for (const el of root.querySelectorAll('.scn-slot[data-biome]')) {
            if (el.classList.contains('is-withered')) continue;
            out.add(B[el.getAttribute('data-biome')]);
            if (el.getAttribute('data-apart')) pairs.add(el.getAttribute('data-apart'));
          }
          for (const img of root.querySelectorAll('[data-pc="element"] img')) if (img.complete && img.naturalWidth > 0) out.add(img.closest('[data-pc="element"]').getAttribute('data-pc-colour'));
          const okPair = key ? pairs.size === 1 && pairs.has(key) : pairs.size === 0;
          return okPair && want.every((c) => out.has(c));
        },
        { want, key, scene, B: COLOUR_OF },
        { timeout: TIMEOUT },
      );
    } catch {
      const s = await shownColours(page);
      throw new Fail(`${shape} ${seq.name}, land ${i + 1} (${lands.slice(0, i + 1).join(' ')}): expected ${scene ? `the scene ${scene} alone` : `the pair ${key ?? 'none'} and ${want.join('')} on screen`}, saw the pair ${s.pairs.join(', ') || 'none'}, the scene ${s.scene ?? 'none'} and ${s.colours.join('')} (cut-outs ${s.cuts.join(', ') || 'none'})`);
    }
    const s = await shownColours(page);
    // A side of one colour has no caption.
    const caption = (await page.$('[data-amb-bands="1"]')) ? ((await page.textContent('[data-amb-bands="1"]')) ?? '') : '';
    log(`${shape} ${seq.name} ${i + 1}: ${lands.slice(0, i + 1).join(' ')} -> ${s.scene ? `scene ${s.scene}` : s.pairs.join(', ') || 'mono'}; on screen ${s.colours.join('')}; cut-outs ${s.cuts.join(', ') || 'none'}; caption: ${caption}`);
    if (key) {
      const named = new Set([...caption.matchAll(/\b(island|swamp|plains|forest|mountain)\b/g)].map((m) => COLOUR_OF[m[1]]));
      for (const m of caption.matchAll(/\b([WUBRG]) painted in\b/g)) named.add(m[1]);
      const missing = want.filter((c) => !named.has(c));
      check(missing.length === 0, `${shape} ${seq.name}, land ${i + 1}: the caption does not name ${missing.join('')}: ${caption}`);
      check(!/Tundra|Hallowed Fountain|Underground Sea|Watery Grave|Volcanic Island|Steam Vents|Tropical Island|Breeding Pool|Bayou|Overgrown Tomb|Badlands|Blood Crypt|Plateau|Sacred Foundry|Savannah|Temple Garden|Scrubland|Godless Shrine|Taiga|Stomping Ground/.test(caption), `${shape} ${seq.name}: the caption names a dual nobody played: ${caption}`);
    }
  }
  check(errors.length === 0, `page errors: ${errors.join('; ')}`);
  if (shape === 'phone') await captionLines(page);
  await page.waitForTimeout(1000);
  await (await page.$('[data-amb-player="1"]')).screenshot({ path: path.join(OUT, `${seq.name}-${shape}.png`) });
  log(`PASS: ${shape} ${seq.name}: ${seq.key} kept from the second land to the last (or a scene drawn alone, spec 1.20), every colour on screen and named at every land (spec 1.19 a, b)`);
}

/** Spec 1.21: the owner's sequence -- island 1, swamp 1, mountain 1 at the third land (no scene of its own), then a fourth and a fifth colour. */
const NEAREST_SEQUENCES = [{ name: 'seq-nearest-owner', lands: 'I S M F P' }, ...SEQUENCES];

/**
 * Spec 1.21 on a page with the scenes: after each land from the second on, your half is exactly one scene slot with
 * its picture loaded -- the state's own scene, or the nearest standing in for it (`data-scene-for`) -- and no pair
 * picture, seam cell, panel or cut-out element; the key drawn is a scene of the live manifest or one colour's own
 * picture, with no colour the board does not have; the caption names the state and, standing in, the painting drawn.
 */
async function nearestCheck(browser, origin, pairs, shape) {
  const scenes = await liveSceneKeys();
  const viewport = shape === 'phone' ? { width: 390, height: 844 } : { width: 1600, height: 1000 };
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: shape === 'phone' ? 2 : 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  // With scenes loaded no pair picture is drawn, so none is fetched: no pairs-v* picture, no seam cell (the pairs
  // manifest itself still loads, for the fallback).
  const pairRequests = [];
  page.on('request', (r) => {
    const u = r.url();
    if (/\/seams\/|\/pairs\/|@pairs-v[^/]*\/.*\.(webp|png|jpe?g)(\?|$)/.test(u)) pairRequests.push(u);
  });
  try {
    await page.goto(`${origin}/${queryOf(pairs, false, true)}#ambience`);
    await page.waitForSelector('[data-amb-pairs]', { timeout: TIMEOUT });
    await page.waitForFunction(() => /scenes-v[\d.]+.*\d+ scenes/.test(document.querySelector('[data-amb-scenes]')?.textContent ?? ''), null, { timeout: TIMEOUT });
    log(`${shape} scenes line: ${((await page.textContent('[data-amb-scenes]')) ?? '').slice(0, 140)}`);
    await page.click('[data-pieces-toggle="pack"]');
    for (const seq of NEAREST_SEQUENCES) {
      const reset = await page.$('[data-amb-reset]:not([disabled])');
      if (reset) await reset.click();
      const counts = {};
      const lands = seq.lands.split(' ');
      let standIns = 0;
      for (let i = 0; i < lands.length; i++) {
        const biome = BIOME_OF[lands[i]];
        counts[biome] = (counts[biome] ?? 0) + 1;
        await setLands(page, biome, counts[biome]);
        if (i === 0) continue;
        const asked = sceneKeyOf(counts);
        let got;
        try {
          await page.waitForFunction(
            (asked) => {
              const root = document.querySelector('[data-amb-player="1"]');
              const slots = root.querySelectorAll('.scn-slot');
              const el = root.querySelector('.scn-slot.scn-scene');
              if (!el || slots.length !== 1) return false;
              if ((el.getAttribute('data-scene-for') ?? el.getAttribute('data-scene')) !== asked) return false;
              const imgs = [...el.querySelectorAll('img')];
              return imgs.length > 0 && imgs.every((img) => img.complete && img.naturalWidth > 0) && !root.querySelector('[data-pairfull]') && !root.querySelector('[data-pc="element"]');
            },
            asked,
            { timeout: TIMEOUT },
          );
          got = await page.evaluate(() => {
            const root = document.querySelector('[data-amb-player="1"]');
            const el = root.querySelector('.scn-slot.scn-scene');
            return {
              slots: root.querySelectorAll('.scn-slot').length,
              scene: el.getAttribute('data-scene'),
              sceneFor: el.getAttribute('data-scene-for'),
              mono: el.getAttribute('data-scene-mono'),
              src: el.querySelector('img').getAttribute('src'),
              width: el.querySelector('img').naturalWidth,
              pairs: root.querySelectorAll('[data-pairfull], [data-band], [data-apart]').length,
              elements: root.querySelectorAll('[data-pc="element"]').length,
            };
          });
        } catch {
          const s = await shownColours(page);
          throw new Fail(`${shape} ${seq.name}, land ${i + 1} (${lands.slice(0, i + 1).join(' ')} = ${asked}): expected one scene slot for ${asked} with its picture loaded and no element, saw the scene ${s.scene ?? 'none'}, the pair ${s.pairs.join(', ') || 'none'}, cut-outs ${s.cuts.join(', ') || 'none'}`);
        }
        const caption = (await page.$('[data-amb-bands="1"]')) ? ((await page.textContent('[data-amb-bands="1"]')) ?? '') : '';
        const drawnColours = got.scene.split('+').map((k) => k.replace(/\d$/, ''));
        const standIn = got.scene !== asked;
        if (standIn) standIns++;
        log(`${shape} ${seq.name} ${i + 1}: ${asked} -> ${standIn ? `nearest ${got.scene}${got.mono ? ' (its own picture)' : ''}` : 'its own scene'}; ${got.src.replace(/^.*@/, '@')} (${got.width} px); caption: ${caption}`);
        check(got.slots === 1 && got.pairs === 0 && got.elements === 0, `${shape} ${seq.name}, land ${i + 1}: ${got.slots} slots, ${got.pairs} pair pictures, ${got.elements} elements`);
        check(drawnColours.every((b) => counts[b]), `${shape} ${seq.name}, land ${i + 1}: ${got.scene} draws a colour ${asked} does not have`);
        if (scenes.has(asked)) check(!standIn, `${shape} ${seq.name}, land ${i + 1}: ${asked} has a scene of its own, drew ${got.scene}`);
        if (standIn) check(scenes.has(got.scene) || (drawnColours.length === 1 && got.mono === '1'), `${shape} ${seq.name}, land ${i + 1}: ${got.scene} is neither a scene of the manifest nor one colour's own picture`);
        if (asked === 'island1+swamp1+mountain1') check(got.scene === 'island1+swamp1+mountain2', `${shape}: the owner's island 1, swamp 1, mountain 1 should draw island1+swamp1+mountain2 at scenes-v1.4, drew ${got.scene}`);
        check(caption.startsWith('Scene · ') && (standIn ? caption.includes(' — nearest painting: ') : caption.endsWith(' — one painting')), `${shape} ${seq.name}, land ${i + 1}: the caption should say the scene${standIn ? ' and the nearest painting' : ''}: ${caption}`);
        if (i === 2 && seq.name === 'seq-nearest-owner') await (await page.$('[data-amb-player="1"]')).screenshot({ path: path.join(OUT, `nearest-owner-${shape}.png`) });
      }
      check(errors.length === 0, `${shape}: page errors: ${errors.join('; ')}`);
      if (shape === 'phone') await captionLines(page);
      await (await page.$('[data-amb-player="1"]')).screenshot({ path: path.join(OUT, `nearest-${seq.name}-${shape}.png`) });
      log(`PASS: ${shape} ${seq.name}: one scene slot, its picture loaded and no element, at every land from the second (${standIns} stood in by the nearest, spec 1.21)`);
    }
    check(pairRequests.length === 0, `${shape}: ${pairRequests.length} pair or seam picture(s) fetched with scenes loaded: ${pairRequests.slice(0, 5).join(', ')}`);
    log(`PASS: ${shape}: no pairs-v* or seam picture fetched with the scenes loaded (spec 1.21)`);
  } finally {
    await ctx.close();
  }
}

/** The caption under a side's header on a phone: at most two lines (the storyboard's sheet 9); logs whether the clamp cut it. */
async function captionLines(page) {
  const m = await page.$eval('[data-amb-bands="1"]', (el) => ({ h: el.getBoundingClientRect().height, full: el.scrollHeight, line: parseFloat(getComputedStyle(el).lineHeight) }));
  log(`phone caption: ${Math.round(m.h)} px shown of ${m.full} px, line ${m.line} px (${m.full > m.h + 1 ? 'clamped' : 'fits'})`);
  check(Number.isFinite(m.line) && m.h <= 2 * m.line + 1, `phone: the caption is taller than two lines (${m.h} px, line ${m.line} px)`);
}

/** Sets one Lands slider of your side (React listens for `input`). */
// ---------------------------------------------------------------------------
// Spec 1.22: places

/**
 * The places pack on disk (the manifest jsDelivr serves at FORGECOACH_PLACES_URL's tag, and every place's pictures):
 * PLACES_DIR, else the owner's folder for that tag, ~/scenery-packs/scenes-v1/pack-<tag> (pack-places-v1 to pack-places-v6).
 */
const PLACES_DIR = path.resolve(env.PLACES_DIR ?? path.join(os.homedir(), 'scenery-packs', 'scenes-v1', `pack-${/@(places-v[^/]+)\//.exec(placesUrl())?.[1] ?? 'places-v1'}`));
/** ForgeCoach's places URL, read from prefs.ts (an .mjs cannot import it). */
function placesUrl() {
  const prefs = readFileSync(new URL('../src/ambience/prefs.ts', import.meta.url), 'utf8');
  const url = /FORGECOACH_PLACES_URL = '([^']+)'/.exec(prefs)?.[1];
  if (!url) throw new Fail('FORGECOACH_PLACES_URL not found in src/ambience/prefs.ts');
  return url;
}
let placesManifest = null;
function diskPlaces() {
  if (!placesManifest) placesManifest = JSON.parse(readFileSync(path.join(PLACES_DIR, 'index', 'places.json'), 'utf8'));
  return placesManifest;
}

/**
 * Route the places manifest and every place picture to disk, never the network: places.json at the places URL from
 * `index/places.json`, and any `forgecoach-scenery@places-v<n>*` URL under `places/` from the folder's `places/`. Every
 * picture served is kept; one not on disk answers 404 (so a missing file shows as a failed piece, never a fetch).
 */
async function routePlaces(ctx) {
  const served = [];
  const base = placesUrl();
  await ctx.route(`${base}places.json`, (route) => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: readFileSync(path.join(PLACES_DIR, 'index', 'places.json')) }));
  await ctx.route(/^https:\/\/cdn\.jsdelivr\.net\/gh\/jalirkan\/forgecoach-scenery@places-v\d[^/]*\/places\//, (route) => {
    const rel = decodeURIComponent(new URL(route.request().url()).pathname.replace(/^.*?@places-v\d[^/]*\//, ''));
    const file = path.normalize(path.join(PLACES_DIR, rel));
    if (!file.startsWith(path.join(PLACES_DIR, 'places'))) return route.fulfill({ status: 404, body: '' });
    try {
      const body = readFileSync(file);
      served.push(rel);
      return route.fulfill({ status: 200, contentType: 'image/webp', headers: { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'max-age=600' }, body });
    } catch {
      return route.fulfill({ status: 404, body: '' });
    }
  });
  return served;
}

/** Land sequences for the places: Cartagena's four land by land, a homeland from stage 1, the storyboard's 5 and 6, and a land destroyed. */
const PLACE_SEQUENCES = [
  { name: 'places-cartagena', lands: 'I S P M P P I I' },
  { name: 'places-homeland', lands: 'F F F' },
  { name: 'places-seq-5', lands: 'I S M M I S F F F' },
  { name: 'places-seq-6', lands: 'P I S M F P I S M F F I' },
  { name: 'places-alexandria', lands: 'I S P I I', down: 'island' },
  // Spec 1.23: Cusco (plains+mountain) -> Sicily (island+plains+mountain), and Araucanía at forest 4 + mountain 5 ->
  // Hawaii (one Island: the sea opens on the left), camera moves on places-v6 with every shared land tracked.
  { name: 'places-camera', lands: 'P M I', camera: 2 },
  { name: 'places-camera-hawaii', lands: 'F F F F M M M M M I', camera: 9 },
];

/**
 * Spec 1.23's map, from the manifest on disk (placeCamera.ts `placeCamera`, again here: an .mjs cannot import it): each
 * land's box the union of its six pieces at the shape; the map fitted on the first subset of the shared lands in one
 * left-to-right order (largest first, then most width in A, then geography) whose scale is in [0.5, 2], the rest
 * untracked: two or more the least-squares line through their centres, one the ratio of
 * its widths; the horizon of A to B's (null 0.5); null when refused.
 */
function cameraOf(a, b, shape) {
  const box = (p, land) => {
    let x0 = Infinity;
    let x1 = -Infinity;
    for (const st of p.layers[land] ?? []) {
      const pc = st[shape];
      if (!pc) continue;
      x0 = Math.min(x0, pc.x);
      x1 = Math.max(x1, pc.x + pc.w);
    }
    return x1 > x0 ? { cx: (x0 + x1) / 2, w: x1 - x0, x0, x1 } : null;
  };
  const shared = [];
  for (const land of GEOGRAPHY) {
    if (!a.layers[land] || !b.layers[land]) continue;
    const ba = box(a, land);
    const bb = box(b, land);
    if (ba && bb) shared.push({ land, a: ba, b: bb });
  }
  if (!shared.length) return null;
  // The subsets in one left-to-right order in both, largest first (then the most width covered in A, then the
  // geography's order); the first whose scale is inside [0.5, 2] is tracked.
  const cover = (xs) => {
    let total = 0;
    let end = -Infinity;
    for (const [x0, x1] of xs.map((x) => [x.a.x0, x.a.x1]).sort((p, q) => p[0] - q[0])) {
      if (x1 <= end) continue;
      total += x1 - Math.max(x0, end);
      end = x1;
    }
    return total;
  };
  const cands = [];
  for (let mask = 1; mask < 1 << shared.length; mask++) {
    const sub = shared.filter((_, i) => mask & (1 << i));
    if (sub.every((p, i) => sub.every((q, j) => j <= i || (p.a.cx - q.a.cx) * (p.b.cx - q.b.cx) > 0))) cands.push({ sub, cover: cover(sub), mask });
  }
  const geo = (p, q) => (p & ((p ^ q) & -(p ^ q)) ? -1 : 1);
  cands.sort((p, q) => q.sub.length - p.sub.length || (Math.abs(q.cover - p.cover) > 1e-12 ? q.cover - p.cover : p.mask === q.mask ? 0 : geo(p.mask, q.mask)));
  const fit = (xs) => {
    if (xs.length === 1) {
      const s = xs[0].b.w / xs[0].a.w;
      return { s, tx: xs[0].b.cx - s * xs[0].a.cx };
    }
    const ma = xs.reduce((t, x) => t + x.a.cx, 0) / xs.length;
    const mb = xs.reduce((t, x) => t + x.b.cx, 0) / xs.length;
    const sab = xs.reduce((t, x) => t + (x.a.cx - ma) * (x.b.cx - mb), 0);
    const saa = xs.reduce((t, x) => t + (x.a.cx - ma) ** 2, 0);
    return saa > 0 ? { s: sab / saa, tx: mb - (sab / saa) * ma } : null;
  };
  let s;
  let tx;
  let tracked = null;
  for (const c of cands) {
    const f = fit(c.sub);
    if (f && f.s >= 0.5 - 1e-9 && f.s <= 2 + 1e-9) {
      ({ s, tx } = f);
      tracked = c.sub;
      break;
    }
  }
  if (!tracked) return null;
  shared.splice(0, shared.length, ...tracked);
  const hz = (p) => (shape === 'phone' ? p.half.phone.horizon : p.half.horizon) ?? 0.5;
  const ty = hz(b) - s * hz(a);
  return { s, tx, ty, shared, mark: [s, tx, ty].map((n) => n.toFixed(3)).join(',') };
}

/**
 * Spec 1.23 in the browser: the change from `a` to `b` is running as a camera move -- `data-camera` is the map for the
 * shape drawn, both frames are on screen, and every tracked land's centre in the new frame lies on its centre in the
 * old frame (each frame's on-screen box is its transformed box) -- then it settles with no transform and no mask.
 */
async function cameraCheck(page, label, a, b) {
  const art = await page.evaluate(() => document.querySelector('[data-amb-player="1"] [data-place]')?.getAttribute('data-art'));
  const cam = cameraOf(a, b, art === 'phone' ? 'phone' : 'half');
  if (!cam) throw new Fail(`${label}: ${a.slug} -> ${b.slug} should be a camera move on this pack, but the map is refused`);
  let seen;
  try {
    await page.waitForFunction(
      (mark) => {
        const el = document.querySelector('[data-amb-player="1"] [data-place]');
        return el?.getAttribute('data-camera') === mark && el.querySelector('[data-camera-frame="from"]') && el.querySelector('[data-camera-frame="to"]');
      },
      cam.mark,
      { timeout: 12_000, polling: 'raf' },
    );
    // Measured once the old frame has gone at least 40% of the way to its end scale (the eased transition is under
    // way, not at its first frame), in the same frame as both boxes are read.
    seen = await (
      await page.waitForFunction(
        ({ shared, s }) => {
          const el = document.querySelector('[data-amb-player="1"] [data-place]');
          const from = el?.querySelector('[data-camera-frame="from"]');
          const to = el?.querySelector('[data-camera-frame="to"]');
          if (!from || !to) return { gone: true };
          const tf = getComputedStyle(from).transform;
          const a = tf === 'none' ? 1 : new DOMMatrixReadOnly(tf).a;
          if (Math.abs(a - 1) < 0.4 * Math.abs(s - 1)) return false;
          const ra = from.getBoundingClientRect();
          const rb = to.getBoundingClientRect();
          // Beneath both: the new place at its settled position, untransformed, unmasked and opaque, covering the half.
          const under = el.querySelector('[data-camera-frame="under"]');
          const half = el.getBoundingClientRect();
          const ru = under?.getBoundingClientRect();
          let op = 1;
          for (let n = under; n && n !== el; n = n.parentElement) op *= +getComputedStyle(n).opacity;
          return {
            under: under
              ? {
                  covers: ru.left <= half.left + 0.5 && ru.top <= half.top + 0.5 && ru.right >= half.right - 0.5 && ru.bottom >= half.bottom - 0.5,
                  opacity: op,
                  transform: getComputedStyle(under).transform,
                  mask: getComputedStyle(under).maskImage || getComputedStyle(under).webkitMaskImage || 'none',
                  below: !!(under.compareDocumentPosition(to) & Node.DOCUMENT_POSITION_FOLLOWING) && !!(under.compareDocumentPosition(from) & Node.DOCUMENT_POSITION_FOLLOWING),
                }
              : null,
            camera: el.getAttribute('data-camera'),
            progress: (a - 1) / (s - 1),
            fromTransform: tf,
            offs: shared.map((x) => ({ land: x.land, off: Math.abs(rb.x + x.b.cx * rb.width - (ra.x + x.a.cx * ra.width)) })),
          };
        },
        { shared: cam.shared, s: cam.s },
        { timeout: 12_000, polling: 'raf' },
      )
    ).jsonValue();
    if (seen?.gone) seen = null;
    // What the move looks like part way (e2e/out/places-camera-mid-<from>-<to>-<shape>.png).
    if (seen) await (await page.$('[data-amb-player="1"]')).screenshot({ path: path.join(OUT, `places-camera-mid-${a.slug}-${b.slug}-${label.split(' ')[0]}.png`) });
  } catch {
    throw new Fail(`${label}: no camera move ${cam.mark} seen from ${a.slug} to ${b.slug}`);
  }
  check(!!seen, `${label}: the move ended before it could be measured`);
  if (!seen) return;
  log(`${label}: ${a.slug} -> ${b.slug}: data-camera ${seen.camera}; at ${Math.round(seen.progress * 100)}% of the move the shared lands are ${seen.offs.map((o) => `${o.land} ${o.off.toFixed(1)} px`).join(', ')} apart (the old frame ${seen.fromTransform})`);
  check(seen.fromTransform !== 'none', `${label}: the old frame carries no transform mid-move`);
  const u = seen.under;
  check(!!u, `${label}: no settled frame of ${b.slug} beneath the move (data-camera-frame="under")`);
  if (u) {
    log(`${label}: beneath the move, ${b.slug} settled: covers every corner of the half ${u.covers}, opacity ${u.opacity}, transform ${u.transform}, mask ${u.mask}, drawn below both moving frames ${u.below}`);
    check(u.covers, `${label}: mid-move the settled frame of ${b.slug} does not cover every corner of the half`);
    check(u.opacity === 1, `${label}: mid-move the settled frame of ${b.slug} is at opacity ${u.opacity}, not opaque`);
    check(u.transform === 'none' && u.mask === 'none', `${label}: the settled frame beneath the move carries a transform (${u.transform}) or a mask (${u.mask})`);
    check(u.below, `${label}: the settled frame is not beneath both moving frames`);
  }
  for (const o of seen.offs) check(o.off <= 3, `${label}: mid-move the ${o.land} of ${b.slug} is ${o.off.toFixed(1)} px from the ${o.land} of ${a.slug}`);
  try {
    await page.waitForFunction(
      () => {
        const el = document.querySelector('[data-amb-player="1"] [data-place]');
        const frames = el?.querySelectorAll('.scn-frame') ?? [];
        return !!el && !el.hasAttribute('data-camera') && frames.length === 1 && getComputedStyle(frames[0]).transform === 'none' && !frames[0].style.transform && !frames[0].style.maskImage && !frames[0].style.webkitMaskImage && !frames[0].hasAttribute('data-camera-frame');
      },
      null,
      { timeout: 12_000, polling: 50 },
    );
  } catch {
    throw new Fail(`${label}: the camera move from ${a.slug} to ${b.slug} never settled (data-camera gone, one frame, no transform, no mask)`);
  }
  log(`${label}: settled -- no data-camera, one frame, no transform, no mask`);
}
const cap = (b) => b.charAt(0).toUpperCase() + b.slice(1);

/**
 * Spec 1.22 on a bare page (no `?scenes=off`): ForgeCoach's default draws a place for every state. Land by land, your
 * half is exactly one place panel -- `data-place` the place of the half's colours, `data-scene` the state -- whose base
 * (the phone base on a phone) and every live land's piece at its stage have loaded, each piece at its box in the base's
 * frame (left x, top y, width w, height h of it, to a pixel); a stage's null piece draws nothing. No scene, pair, cell
 * or cut-out; scenes.json is never fetched and no pair or seam picture either. A stage step: the land's new piece fades
 * in over its old one (both on screen at once, the old beneath), then the old goes; the base and the other lands'
 * pieces stay the same elements. A new colour: the whole half cross-fades (two bases on screen during the fade). The
 * caption: "<name>: Island 2, Swamp 1, …". States whose colours have no place in the manifest on disk are skipped
 * (said so): with places-v6's 31 none is.
 */
async function placesCheck(browser, origin, pairs, shape) {
  const manifest = diskPlaces();
  const keys = Object.keys(manifest.places ?? {});
  log(`${shape} places on disk: ${PLACES_DIR} (${keys.length} places)`);
  const viewport = shape === 'phone' ? { width: 390, height: 844 } : { width: 1600, height: 1000 };
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: shape === 'phone' ? 2 : 1 });
  const served = await routePlaces(ctx);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const forbidden = [];
  page.on('request', (r) => {
    const u = r.url();
    if (/\/seams\/|\/pairs\/|@pairs-v[^/]*\/.*\.(webp|png|jpe?g)(\?|$)|@scenes-v[^/]*\/.*\.(webp|png|jpe?g)(\?|$)/.test(u)) forbidden.push(u);
  });
  // scenes.json is started beside places.json (a failing places file must not hold the scenes back) and cancelled
  // once every place has loaded clean: it may be requested, never used (no scene picture, the scenes line says so).
  const scenesManifest = { asked: 0, cancelled: 0 };
  page.on('request', (r) => /\/scenes\.json(\?|$)/.test(r.url()) && scenesManifest.asked++);
  page.on('requestfailed', (r) => /\/scenes\.json(\?|$)/.test(r.url()) && scenesManifest.cancelled++);
  let skipped = 0;
  try {
    await page.goto(`${origin}/${queryOf(pairs, false)}#ambience`);
    await page.waitForSelector('[data-amb-places]', { timeout: TIMEOUT });
    await page.waitForFunction(() => /Places \(spec 1\.22\): .*\d+ places?/.test(document.querySelector('[data-amb-places]')?.textContent ?? ''), null, { timeout: TIMEOUT });
    const line = (await page.textContent('[data-amb-places]')) ?? '';
    log(`${shape} places line: ${line.slice(0, 160)}`);
    check(new RegExp(`\\b${keys.length} places?\\b`).test(line), `${shape}: the places line should count ${keys.length}: ${line}`);
    check(/not loaded -- the places are drawn instead/.test((await page.textContent('[data-amb-scenes]')) ?? ''), `${shape}: the scenes line should say the places are drawn instead`);
    await page.click('[data-pieces-toggle="pack"]');
    for (const seq of PLACE_SEQUENCES) {
      const reset = await page.$('[data-amb-reset]:not([disabled])');
      if (reset) await reset.click();
      const counts = {};
      const steps = seq.lands.split(' ').map((l) => ({ biome: BIOME_OF[l], delta: 1 }));
      if (seq.down) steps.push({ biome: seq.down, delta: -1 });
      let prevPlace = null;
      let checkedStep = false;
      let checkedFade = false;
      let checkedCamera = false;
      for (let i = 0; i < steps.length; i++) {
        const { biome, delta } = steps[i];
        const before = { ...counts };
        counts[biome] = (counts[biome] ?? 0) + delta;
        const placeKey = GEOGRAPHY.filter((b) => counts[b]).join('+');
        const place = manifest.places[placeKey];
        const state = sceneKeyOf(counts);
        if (!place) {
          await setLands(page, biome, counts[biome]);
          skipped++;
          log(`${shape} ${seq.name} ${i + 1}: ${state} -- no place for ${placeKey} on disk; skipped`);
          prevPlace = null;
          continue;
        }
        const sameStep = prevPlace === place.slug;
        const changedLand = sameStep ? biome : null;
        // Before a step inside the place: tag the base and the other lands' pieces, to see they are the same elements after.
        if (sameStep)
          await page.evaluate((changed) => {
            const el = document.querySelector('[data-amb-player="1"] [data-place]');
            for (const img of el.querySelectorAll('img')) {
              const land = (img.getAttribute('data-piece') ?? '').replace(/\d$/, '');
              if (!land || land !== changed) img.dataset.e2eKeep = '1';
            }
          }, changedLand);
        await setLands(page, biome, counts[biome]);
        // What the half should hold, at each of the base's two shapes (the manifest's own files and boxes: a phone piece
        // may be the desktop piece's file at another box, places-v2 and v3). Which base is drawn: the phone base on a phone; on a
        // desktop, layout.ts's shape rule (a desktop half narrower than the cut-over draws the phone base) -- read from
        // the panel's `data-art`, and every piece then checked against that shape's.
        const wantAt = (key) =>
          GEOGRAPHY.filter((b) => counts[b]).map((b) => {
            const st = Math.min(counts[b], 6);
            return { biome: b, stage: st, piece: place.layers[b][st - 1][key] };
          });
        const wantBoth = { half: wantAt('half'), phone: wantAt('phone') };
        const want = wantBoth[shape === 'phone' ? 'phone' : 'half'];
        // A stage step: the new piece fades in over the old one, the old kept beneath, both on screen at once.
        if (sameStep && !checkedFade) {
          const old = `${biome}${Math.min(before[biome], 6)}`;
          const nu = `${biome}${Math.min(counts[biome], 6)}`;
          const nuPiece = want.find((w) => w.biome === biome).piece;
          const oldPiece = place.layers[biome][Math.min(before[biome], 6) - 1][shape === 'phone' ? 'phone' : 'half'];
          // (On a desktop drawing the phone base, the same step's pieces are the phone's: both exist or neither, in places-v1 and v2.)
          if (nuPiece && oldPiece) {
            try {
              await page.waitForFunction(
                ({ old, nu }) => {
                  const el = document.querySelector('[data-amb-player="1"] [data-place]');
                  const o = el?.querySelector(`[data-piece="${old}"]`);
                  const n = el?.querySelector(`[data-piece="${nu}"]`);
                  return !!o && !!n && (o.getAttribute('data-piece-role') === 'under' || o.getAttribute('data-piece-role') === 'out') && n.getAttribute('data-piece-role') === 'in' && o.compareDocumentPosition(n) & Node.DOCUMENT_POSITION_FOLLOWING;
                },
                { old, nu },
                { timeout: 3000, polling: 30 },
              );
              checkedFade = true;
              log(`${shape} ${seq.name} ${i + 1}: ${old} -> ${nu}: the new piece fading in over the old, the old beneath`);
            } catch {
              throw new Fail(`${shape} ${seq.name}, step ${i + 1}: no fade from ${old} to ${nu} seen (the new piece in on top, the old beneath)`);
            }
          }
        }
        // Spec 1.23: the camera step of the sequence.
        if (seq.camera === i && prevPlace) {
          await cameraCheck(page, `${shape} ${seq.name} ${i + 1}`, Object.values(manifest.places).find((p) => p.slug === prevPlace), place);
          checkedCamera = true;
        }
        // A new colour: the whole half cross-fades (two bases in the panel at once; three under a 1.23 camera move).
        else if (!sameStep && prevPlace && !checkedStep) {
          try {
            await page.waitForFunction(() => document.querySelector('[data-amb-player="1"] [data-place]')?.querySelectorAll('.scn-half-img').length >= 2, null, { timeout: 12_000, polling: 30 });
            checkedStep = true;
            log(`${shape} ${seq.name} ${i + 1}: ${prevPlace} -> ${place.slug}: the whole half cross-fading (two bases; three under a camera move)`);
          } catch {
            throw new Fail(`${shape} ${seq.name}, step ${i + 1}: no cross-fade from ${prevPlace} to ${place.slug} seen`);
          }
        }
        let got;
        try {
          await page.waitForFunction(
            ({ slug, state, wantBoth, bases: baseOf }) => {
              const root = document.querySelector('[data-amb-player="1"]');
              if (root.querySelectorAll('.scn-slot').length !== 1) return false;
              const el = root.querySelector('.scn-slot[data-place]');
              if (!el || el.getAttribute('data-place') !== slug || el.getAttribute('data-scene') !== state) return false;
              const art = el.getAttribute('data-art');
              const want = wantBoth[art];
              const base = baseOf[art];
              if (!want) return false;
              const bases = el.querySelectorAll('.scn-half-img');
              if (bases.length !== 1 || bases[0].getAttribute('src') !== base || !bases[0].complete || !(bases[0].naturalWidth > 0)) return false;
              const pieces = [...el.querySelectorAll('img[data-piece]')];
              const live = want.filter((w) => w.piece);
              if (pieces.length !== live.length) return false;
              return live.every((w, i) => pieces[i].getAttribute('data-piece') === `${w.biome}${w.stage}` && pieces[i].getAttribute('src') === w.piece.src && pieces[i].complete && pieces[i].naturalWidth > 0 && pieces[i].getAttribute('data-piece-role') === 'cur' && getComputedStyle(pieces[i]).opacity === '1');
            },
            { slug: place.slug, state, wantBoth, bases: { half: place.half.src, phone: place.half.phone.src } },
            { timeout: TIMEOUT },
          );
          got = await page.evaluate(() => {
            const root = document.querySelector('[data-amb-player="1"]');
            const el = root.querySelector('.scn-slot[data-place]');
            const frame = el.querySelector('.scn-frame').getBoundingClientRect();
            return {
              art: el.getAttribute('data-art'),
              frame: { x: frame.x, y: frame.y, w: frame.width, h: frame.height },
              pieces: [...el.querySelectorAll('img[data-piece]')].map((img) => {
                const r = img.getBoundingClientRect();
                return { piece: img.getAttribute('data-piece'), x: r.x, y: r.y, w: r.width, h: r.height, kept: img.dataset.e2eKeep === '1' };
              }),
              baseKept: el.querySelector('.scn-half-img').dataset.e2eKeep === '1',
              others: root.querySelectorAll('[data-pairfull], [data-band], [data-apart], [data-pc="element"], [data-scene-for]').length,
            };
          });
        } catch {
          const seen = await page.evaluate(() => {
            const el = document.querySelector('[data-amb-player="1"] .scn-slot[data-place]');
            return el ? `${el.getAttribute('data-place')} ${el.getAttribute('data-scene')} [${[...el.querySelectorAll('img')].map((i) => `${i.getAttribute('data-piece') ?? 'base'}:${i.getAttribute('data-piece-role') ?? ''}:${i.complete && i.naturalWidth > 0 ? 'ok' : 'loading'}`).join(' ')}]` : `no place (${document.querySelectorAll('[data-amb-player="1"] .scn-slot').length} slots)`;
          });
          throw new Fail(`${shape} ${seq.name}, step ${i + 1} (${state}): expected ${place.slug} composed for ${state}, its base and ${want.filter((w) => w.piece).map((w) => `${w.biome}${w.stage}`).join(' ')} loaded; saw ${seen}`);
        }
        if (shape === 'phone') check(got.art === 'phone', `${shape} ${seq.name}, step ${i + 1}: a phone drew the ${got.art} base`);
        const drawnWant = wantBoth[got.art];
        check(got.others === 0, `${shape} ${seq.name}, step ${i + 1}: something else drawn on the place half (${got.others})`);
        // Each piece at its box in the base's frame, to a pixel.
        const live = drawnWant.filter((w) => w.piece);
        live.forEach((w, k) => {
          const g = got.pieces[k];
          const exp = { x: got.frame.x + w.piece.x * got.frame.w, y: got.frame.y + w.piece.y * got.frame.h, w: w.piece.w * got.frame.w, h: w.piece.h * got.frame.h };
          const off = Math.max(Math.abs(g.x - exp.x), Math.abs(g.y - exp.y), Math.abs(g.w - exp.w), Math.abs(g.h - exp.h));
          check(off <= 1.5, `${shape} ${seq.name}, step ${i + 1}: ${g.piece} is ${off.toFixed(1)} px off its box`);
        });
        if (sameStep) {
          check(got.baseKept, `${shape} ${seq.name}, step ${i + 1}: the base was replaced by a stage step`);
          for (const g of got.pieces) if (!g.piece.startsWith(changedLand)) check(g.kept, `${shape} ${seq.name}, step ${i + 1}: ${g.piece} was replaced though only the ${changedLand} changed`);
        }
        const caption = (await page.$('[data-amb-bands="1"]')) ? ((await page.textContent('[data-amb-bands="1"]')) ?? '') : '';
        const wantCaption = `${place.name}: ${want.map((w) => `${cap(w.biome)} ${w.stage}`).join(', ')}`;
        check(caption === wantCaption, `${shape} ${seq.name}, step ${i + 1}: the caption should be "${wantCaption}", is "${caption}"`);
        log(`${shape} ${seq.name} ${i + 1}: ${state} -> ${place.slug} (${place.name}), the ${got.art} base; pieces ${got.pieces.map((g) => g.piece).join(' ') || 'none (the base is stage 1)'}; caption: ${caption}`);
        prevPlace = place.slug;
      }
      check(errors.length === 0, `${shape}: page errors: ${errors.join('; ')}`);
      // (A sequence every step of which was skipped may end on a side with no caption.)
      if (shape === 'phone' && (await page.$('[data-amb-bands="1"]'))) await captionLines(page);
      await (await page.$('[data-amb-player="1"]')).screenshot({ path: path.join(OUT, `${seq.name}-${shape}.png`) });
      if (seq.camera !== undefined) check(checkedCamera, `${shape} ${seq.name}: the camera step was not reached`);
      log(`PASS: ${shape} ${seq.name}: the place composed for the state at every land${checkedFade ? ', a stage step faded over the old piece' : ''}${checkedStep ? ', a new colour cross-faded the half' : ''}${checkedCamera ? ', a new colour moved the camera' : ''}`);
    }
    // A state with no place on disk is drawn by the 1.15–1.19 rules (no scenes are fetched): its pair pictures then load.
    const scenesFetched = forbidden.filter((u) => /@scenes-v/.test(u));
    check(scenesFetched.length === 0, `${shape}: scene pictures fetched with places loaded: ${scenesFetched.slice(0, 5).join(', ')}`);
    log(`${shape}: scenes.json requested ${scenesManifest.asked}×, cancelled ${scenesManifest.cancelled}× (started beside places.json, unused)`);
    if (skipped === 0) check(forbidden.length === 0, `${shape}: ${forbidden.length} pair or seam file(s) fetched with every state a place: ${forbidden.slice(0, 5).join(', ')}`);
    else log(`${shape}: ${forbidden.length} pair or seam picture(s) fetched for the ${skipped} step(s) with no place on disk`);
    check(served.length > 0, `${shape}: no place picture was served from disk`);
    log(`PASS: ${shape}: places drawn (${served.length} pictures served from ${PLACES_DIR}; ${skipped} step(s) skipped, no place on disk); no scene picture fetched${skipped ? '' : ', no pair or seam picture'}`);
  } finally {
    await ctx.close();
  }
}

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
 * they are played (the board's order), the cell expected (or, spec 1.19 c, `apart`: no cell), whether it is mirrored, the caption's words.
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
    { name: 'grid-6x2-apart', key: 'island+swamp', lands: [['island', 6], ['swamp', 2]], cell: '6x2', apart: true, caption: 'island s6 | swamp s2, no seam cell' },
    { name: 'grid-3x2-mirrored', key: 'forest+swamp', lands: [['forest', 2], ['swamp', 3]], cell: '3x2', dir: 'swamp-forest', mirrored: true, caption: 'swamp s3 | forest s2, seam 3x2' },
  ];
  let ran = 0;
  for (const c of cases) {
    if (c.apart ? gridOf(c.key)?.[c.cell] : !gridOf(c.key)?.[c.cell]) {
      log(`SKIP ${c.name}: ${c.key} ${c.apart ? 'has a cell' : 'has no cell'} ${c.cell}`);
      continue;
    }
    if (!c.keep) {
      const reset = await page.$('[data-amb-reset]:not([disabled])');
      if (reset) await reset.click();
    }
    for (const [biome, n] of c.lands) await setLands(page, biome, n);
    if (c.apart) {
      await apartCheck(page, c, errors);
      ran++;
      continue;
    }
    const sel = `[data-pairfull="${c.key}"][data-pairfull-cell="${c.cell}"]`;
    const panel = await page.waitForSelector(sel, { timeout: TIMEOUT });
    const want = new RegExp(`/seams/${c.dir}/s${c.cell}-panorama\\.webp$`);
    // Settled: the previous picture has faded out.
    await page.waitForFunction(({ sel, src }) => [...document.querySelectorAll(`${sel} img`)].every((i) => new RegExp(src).test(i.getAttribute('src') ?? '')), { sel, src: want.source }, { timeout: TIMEOUT });
    const mirrored = await panel.evaluate((el) => el.classList.contains('is-mirrored') && !!el.querySelector('.scn-pairfull-flip.is-mirrored'));
    const width = await panel.$eval('img', (i) => i.complete && i.naturalWidth);
    const caption = await page.textContent('[data-amb-bands="1"]');
    log(`${c.name}: ${c.key} cell ${c.cell}, mirrored ${mirrored}, ${width} px; caption: ${caption}`);
    check(mirrored === c.mirrored, `${c.name}: expected mirrored ${c.mirrored}`);
    check(width === 3277, `${c.name}: the cell did not load at 3277 px wide (${width})`);
    check((caption ?? '').includes(c.caption), `${c.name}: the caption does not say "${c.caption}": ${caption}`);
    check(errors.length === 0, `page errors: ${errors.join('; ')}`);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(OUT, `${c.name}.png`) });
    ran++;
  }
  log(`PASS: spec 1.17's seam grid, ${ran} of ${cases.length} cases (the rest skipped: cells not painted yet)`);
  if (gridOf('island+swamp')?.['2x1']) await formingCheck(page, errors);
  else log('SKIP the pair forming: island+swamp has no cell 2x1 yet');
  return !!gridOf('island+swamp')?.['4x3'];
}

/**
 * Spec 1.19 c: island 6 | swamp 2 has no cell 6x2 (pairs-v8, like pairs-v7.1, has cells where |i − j| ≤ 1), and there is no clamp: your half is
 * the island's own stage-6 picture and the swamp's own stage-2 picture side by side at the split (the island 75%), the
 * plain 1.10 seam between them -- no pair picture, no band -- and the caption says "no seam cell".
 */
async function apartCheck(page, c, errors) {
  await page.waitForSelector(`[data-amb-player="1"] [data-apart="${c.key}"][data-apart-cell="${c.cell}"]`, { timeout: TIMEOUT });
  const slots = await page.$$eval('[data-amb-player="1"] .scn-slot', (els) => els.map((e) => ({ biome: e.getAttribute('data-biome'), stage: e.getAttribute('data-stage'), apart: e.getAttribute('data-apart'), grow: e.style.flexGrow, afterBand: e.classList.contains('is-after-band') })));
  const pairPictures = await page.$$eval('[data-amb-player="1"] [data-pairfull], [data-amb-player="1"] [data-band]', (els) => els.length);
  const caption = (await page.textContent('[data-amb-bands="1"]')) ?? '';
  log(`${c.name}: panels ${slots.map((s) => `${s.biome} s${s.stage} (${s.grow})`).join(' | ')}; caption: ${caption}`);
  check(slots.length === 2 && slots.every((s) => s.apart === c.key), `${c.name}: expected the two colours' own panels, apart: ${JSON.stringify(slots)}`);
  check(slots[0].biome === 'island' && slots[0].stage === '6' && slots[1].biome === 'swamp' && slots[1].stage === '2', `${c.name}: expected island s6 | swamp s2, each its own stage: ${JSON.stringify(slots)}`);
  check(Math.abs(Number(slots[0].grow) - 0.75) < 0.01, `${c.name}: the island should take the split, 75%: ${slots[0].grow}`);
  check(!slots[1].afterBand, `${c.name}: the seam should be the plain mist, not a band's`);
  check(pairPictures === 0, `${c.name}: ${pairPictures} pair picture(s) or band(s) drawn on a pair apart`);
  check(caption.includes(c.caption), `${c.name}: the caption does not say "${c.caption}": ${caption}`);
  check(errors.length === 0, `page errors: ${errors.join('; ')}`);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(OUT, `${c.name}.png`) });
}

/**
 * The pair forming (the #201 follow-up): island 2 alone, then a first Swamp. Every picture the pair panel draws is
 * recorded from before the Swamp arrives; the first is the cell 2x1 (island s2 | swamp s1), and the whole-place
 * panorama (`pairs/island-swamp/s<k>-panorama.webp`) is never among them. (Island 3, the case before spec 1.19 c, has no
 * cell 3x1: the pair forms apart.)
 */
async function formingCheck(page, errors) {
  const reset = await page.$('[data-amb-reset]:not([disabled])');
  if (reset) await reset.click();
  await setLands(page, 'island', 2);
  // The cell is warmed while the half is one colour (pairPictures), before its second colour arrives.
  await page.waitForFunction(() => performance.getEntriesByType('resource').some((e) => e.name.endsWith('/seams/island-swamp/s2x1-panorama.webp')), null, { timeout: TIMEOUT });
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
  await page.waitForSelector('[data-pairfull="island+swamp"][data-pairfull-cell="2x1"]', { timeout: TIMEOUT });
  await page.waitForTimeout(1500);
  const seen = await page.evaluate(() => window.__pairSrcs);
  log(`the pair forming: pictures drawn ${seen.map((s) => s.replace(/^.*\/(seams|pairs)\//, '$1/')).join(' → ')}`);
  check(seen.length > 0 && /\/seams\/island-swamp\/s2x1-panorama\.webp$/.test(seen[0]), `the pair's first picture is not its cell 2x1: ${seen[0]}`);
  check(!seen.some((s) => /\/pairs\/island-swamp\/s\d-panorama\.webp$/.test(s)), `the whole-place panorama was drawn while the pair formed: ${seen.join(', ')}`);
  check(errors.length === 0, `page errors: ${errors.join('; ')}`);
  await page.screenshot({ path: path.join(OUT, 'grid-forming.png') });
  log('PASS: the pair forming draws its first cell (2x1) first, no whole-place panorama between');
}

/**
 * A phone (390 × 844): the cells are 5:1 desktop panoramas, so a phone-width screen keeps the stage panorama's phone
 * picture. island 4 | swamp 3 names no cell, fetches no seam picture, and the caption says "whole half", no "seam".
 * Spec 1.18: when the cell 4x3 carries a `phone` picture, the phone draws that instead, names the cell and the seam,
 * and fetches no desktop seam picture.
 */
async function phoneCheck(browser, origin, pairs, manifest) {
  if (manifest.pairs?.['island+swamp']?.grid?.['4x3']?.phone) return phoneCellCheck(browser, origin, pairs, manifest);
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const errors = [];
  const seams = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('request', (r) => {
    if (r.url().includes('/seams/')) seams.push(r.url());
  });
  try {
    await page.goto(`${origin}/${queryOf(pairs)}#ambience`);
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
    await captionLines(page);
    check(seams.length === 0, `phone: ${seams.length} seam picture(s) fetched: ${seams.join(', ')}`);
    check(errors.length === 0, `phone: page errors: ${errors.join('; ')}`);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(OUT, 'grid-phone.png') });
    log('PASS: a phone draws the stage panorama (the cell 4x3 has no phone picture), names no seam and fetches no cell');
  } finally {
    await ctx.close();
  }
}

/**
 * Spec 1.18: a phone on a cell with a phone picture: island 4 | swamp 3 draws `s4x3-panorama-phone.webp` and names it.
 * Then spec 1.18.1, the worked example on the phone (Placeholders, whose elements have phone pieces as pack-v10's do).
 */
async function phoneCellCheck(browser, origin, pairs, manifest) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const errors = [];
  const seams = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('request', (r) => {
    if (r.url().includes('/seams/')) seams.push(r.url());
  });
  try {
    await page.goto(`${origin}/${queryOf(pairs)}#ambience`);
    await page.waitForSelector('[data-amb-pairs]', { timeout: TIMEOUT });
    await setLands(page, 'island', 4);
    await setLands(page, 'swamp', 3);
    const panel = await page.waitForSelector('[data-amb-player="1"] [data-pairfull="island+swamp"][data-pairfull-cell="4x3"]', { timeout: TIMEOUT });
    await page.waitForFunction(() => [...document.querySelectorAll('[data-amb-player="1"] [data-pairfull] img')].every((i) => /\/seams\/island-swamp\/s4x3-panorama-phone\.webp$/.test(i.getAttribute('src') ?? '')), null, { timeout: TIMEOUT });
    const src = await panel.$eval('img', (i) => i.getAttribute('src'));
    const caption = (await page.textContent('[data-amb-bands="1"]')) ?? '';
    const desktop = seams.filter((u) => !/-phone\.webp$/.test(u));
    log(`phone: cell 4x3, img ${src}; caption: ${caption}; seam pictures fetched: ${seams.length}, ${desktop.length} desktop`);
    check(caption.includes('island s4 | swamp s3, seam 4x3'), `phone: the caption does not name the cell: ${caption}`);
    await captionLines(page);
    check(desktop.length === 0, `phone: ${desktop.length} desktop seam picture(s) fetched: ${desktop.join(', ')}`);
    check(errors.length === 0, `phone: page errors: ${errors.join('; ')}`);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(OUT, 'grid-phone.png') });
    log('PASS: a phone draws the cell 4x3 from its phone picture (spec 1.18) and fetches no desktop cell');
    await phoneThirdCheck(page, manifest, errors);
  } finally {
    await ctx.close();
  }
}

/**
 * Spec 1.18.1: the worked example (Plateau, Plains, Island) on the phone -- spec 1.19 b's pair, mountain+plains (the
 * Plateau's), with the island its third colour. mountain+plains' cell has blue painted in on the plains' half (the
 * cell's left: the geography puts the plains left), or -- on pairs-v8, the default -- nothing painted in. A painted
 * picture with its own phone picture is drawn as 1.18 says, with no cut-out; with none (pairs-v8), or one without a
 * phone picture (pairs-v7.1's, all 660), the blue cut-out -- the element's PHONE piece -- stands on the plain cell's
 * phone picture, on the plains' ground (the board's right: it has mountain | plains), and the caption says "island as
 * an element". Then the storyboard's sequences on the phone (spec 1.19 a and b).
 */
async function phoneThirdCheck(page, manifest, errors) {
  await page.click('[data-pieces-toggle="builtin"]');
  await page.click('[data-pieces-three]');
  const panel = await page.waitForSelector('[data-amb-player="1"] [data-pairfull="mountain+plains"][data-pairfull-cell]', { timeout: TIMEOUT });
  const cell = await panel.getAttribute('data-pairfull-cell');
  const entry = manifest.pairs['mountain+plains'].grid[cell]?.elements?.U;
  const pic = entry ? (entry.left ?? entry.src ?? null) : null;
  const picture = pic && typeof pic === 'object' ? pic : pic ? { src: pic } : null;
  if (picture?.phone) {
    await page.waitForSelector(`[data-amb-player="1"] [data-pairfull="mountain+plains"][data-pairfull-cell="${cell}"][data-pairfull-painted="U"]`, { timeout: TIMEOUT });
    await page.waitForFunction((c) => [...document.querySelectorAll('[data-amb-player="1"] [data-pairfull] img')].every((i) => new RegExp(`s${c}\\+UL-panorama-phone\\.webp$`).test(i.getAttribute('src') ?? '')), cell, { timeout: TIMEOUT });
    await page.waitForTimeout(1500);
    const cutOuts = await page.$$eval('[data-amb-player="1"] [data-pc="element"]', (els) => els.length);
    check(cutOuts === 0, `phone: ${cutOuts} cut-out(s) drawn over the cell ${cell}'s painted phone picture`);
    log(`PASS: a phone draws the cell ${cell} with blue painted in from its own phone picture (spec 1.18), no cut-out`);
  } else {
    // 1.18.1 / 1.19 a: the plain cell's phone picture, the cut-out over it (pairs-v8 paints nothing in: this is its path).
    await page.waitForFunction((c) => [...document.querySelectorAll('[data-amb-player="1"] [data-pairfull] img')].every((i) => new RegExp(`/seams/plains-mountain/s${c}-panorama-phone\\.webp$`).test(i.getAttribute('src') ?? '')), cell, { timeout: TIMEOUT });
    const el = await page.waitForSelector('[data-amb-player="1"] [data-pc="element"][data-pc-colour="U"] img', { timeout: TIMEOUT });
    const src = decodeURIComponent((await el.getAttribute('src')) ?? '');
    const side = await page.getAttribute('[data-amb-player="1"] [data-pc="element"]', 'data-pc-side');
    const element = await page.getAttribute('[data-amb-player="1"] [data-pairfull="mountain+plains"]', 'data-pairfull-element');
    const painted = await page.$$eval('[data-amb-player="1"] [data-pairfull-painted]', (els) => els.length);
    const caption = (await page.textContent('[data-amb-bands="1"]')) ?? '';
    log(`phone, three colours: cell ${cell}, element ${element}, cut-out on the ${side} (${/phone/.test(src) ? 'its phone piece' : 'NOT its phone piece'}), painted ${painted}; caption: ${caption}`);
    check(/U element placeholder/.test(src) && /phone/.test(src), `phone: the cut-out is not blue's phone piece: ${src.slice(0, 120)}`);
    check(side === 'right', `phone: the board has mountain | plains, so the plains' (heavier) ground is the right; the cut-out is on the ${side}`);
    check(element === 'island', `phone: the pair panel names no element (${element})`);
    check(painted === 0, `phone: ${painted} painted picture(s) drawn with no phone picture of their own`);
    check(new RegExp(`seam ${cell}; island as an element`).test(caption) && !/painted in/.test(caption), `phone: the caption does not say "island as an element": ${caption}`);
    check(errors.length === 0, `phone: page errors: ${errors.join('; ')}`);
    await page.waitForTimeout(1500);
    // Your half, scrolled into view (the Pieces buttons clicked above sit far below it on a phone).
    await (await page.$('[data-amb-player="1"]')).screenshot({ path: path.join(OUT, 'grid-phone-three.png') });
    log(`PASS: a phone draws blue's cut-out (its phone piece) on mountain+plains' cell ${cell}, ${picture ? 'whose painted picture has no phone picture (spec 1.18.1)' : 'with nothing painted in (spec 1.19 a)'}`);
  }
  for (const seq of SEQUENCES) await sequenceCheck(page, seq, errors, 'phone');
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
