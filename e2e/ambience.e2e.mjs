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
 * Environment: PAIRS_DIR (a local pairs pack), or PAIRS_URL (a pairs pack by
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
    await page.goto(`${origin}/${pairs ? `?pairs=${encodeURIComponent(pairs)}` : ''}#ambience`);
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
  const scenes = await liveSceneKeys();
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
  log(`PASS: ${shape} ${seq.name}: ${seq.key} kept from the second land to the last, every colour on screen and named at every land (spec 1.19 a, b)`);
}

/** The caption under a side's header on a phone: at most two lines (the storyboard's sheet 9); logs whether the clamp cut it. */
async function captionLines(page) {
  const m = await page.$eval('[data-amb-bands="1"]', (el) => ({ h: el.getBoundingClientRect().height, full: el.scrollHeight, line: parseFloat(getComputedStyle(el).lineHeight) }));
  log(`phone caption: ${Math.round(m.h)} px shown of ${m.full} px, line ${m.line} px (${m.full > m.h + 1 ? 'clamped' : 'fits'})`);
  check(Number.isFinite(m.line) && m.h <= 2 * m.line + 1, `phone: the caption is taller than two lines (${m.h} px, line ${m.line} px)`);
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
    await page.goto(`${origin}/${pairs ? `?pairs=${encodeURIComponent(pairs)}` : ''}#ambience`);
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
    await page.goto(`${origin}/${pairs ? `?pairs=${encodeURIComponent(pairs)}` : ''}#ambience`);
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
