#!/usr/bin/env node
/*
 * ForgeCoach — e2e/pwa.e2e.mjs
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The installable site on a production build (`npm run test:pwa`):
 *
 *   1. builds ForgeCoach (BUILD=0 reuses dist/) and serves dist/ from a small
 *      static server here, which also answers the engine's paths (/health,
 *      /ws, /observe, /match) with 404s and logs every request it gets;
 *   2. on 127.0.0.1 (a loopback host, where the worker must cache nothing):
 *      the manifest loads and parses, its icons are served at the sizes they
 *      claim, the worker registers and activates, and its caches stay empty;
 *   3. on a non-loopback name for the same server (forgecoach.test, mapped to
 *      127.0.0.1 and treated as a secure origin, like a phone on Tailscale):
 *      the worker precaches the shell; the engine's paths and other origins
 *      are not answered by the worker (Playwright's fromServiceWorker) and
 *      reach the server; hashed assets are; the theme colour follows the
 *      skin; Settings shows "Install" only after beforeinstallprompt;
 *   4. with the server stopped: the page reloads from the cache, and /health
 *      fails instead of coming from it.
 *
 * Environment: BUILD=0 (reuse dist/), HEADLESS=0, BROWSER_PATH. Needs full
 * Chromium (`npx playwright-core install chromium`), not only the headless shell.
 * Exit status: 0 pass, 1 a check failed, 2 could not start. Screenshots go to
 * e2e/out/ (pwa-*.png).
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, statSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { freePort, loadPlaywright } from './harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const OUT = path.join(ROOT, 'e2e', 'out');
const env = process.env;
const HEADLESS = !/^(0|false|no)$/i.test(env.HEADLESS ?? '1');
const HOST = 'forgecoach.test';
const TIMEOUT = 15_000;

class Fail extends Error {}
const check = (ok, msg) => {
  if (!ok) throw new Fail(msg);
};
const log = (m) => console.log(`[e2e pwa] ${m}`);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.md': 'text/markdown; charset=utf-8',
  '.gz': 'application/gzip',
  '.sh': 'text/plain; charset=utf-8',
};

/** dist/ over HTTP, plus 404s for the engine's paths; every request is logged. */
function startServer(port) {
  const seen = [];
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    seen.push(`${req.method} ${u.pathname}`);
    res.setHeader('Access-Control-Allow-Origin', '*');
    let file = path.normalize(path.join(DIST, decodeURIComponent(u.pathname)));
    if (!file.startsWith(DIST)) file = '';
    try {
      if (file && statSync(file).isDirectory()) file = path.join(file, 'index.html');
      const body = readFileSync(file);
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(body);
    } catch {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found', path: u.pathname, n: seen.length }));
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
        seen,
        stop: () =>
          new Promise((r) => {
            server.close(() => r());
            for (const s of sockets) s.destroy();
          }),
      }),
    ),
  );
}

async function launch(pw, port) {
  const args = [`--host-resolver-rules=MAP ${HOST} 127.0.0.1`, `--unsafely-treat-insecure-origin-as-secure=http://${HOST}:${port}`];
  const proxy = env.HTTPS_PROXY || env.https_proxy;
  if (proxy) args.push(`--proxy-server=${proxy}`, `--proxy-bypass-list=<-loopback>;127.0.0.1;localhost;${HOST}`);
  // Full Chromium (the 'chromium' channel, new headless): the headless shell ignores
  // --unsafely-treat-insecure-origin-as-secure, so it would offer no service worker on forgecoach.test.
  const opts = { headless: HEADLESS, args, channel: 'chromium' };
  if (env.BROWSER_PATH) return pw.chromium.launch({ ...opts, executablePath: env.BROWSER_PATH });
  try {
    return await pw.chromium.launch(opts);
  } catch (e) {
    console.error(`e2e: no full Chromium for Playwright (${String(e.message).split('\n')[0]}). Run \`npx playwright-core install chromium\` (not --only-shell), or set BROWSER_PATH.`);
    process.exit(2);
  }
}

/** Nothing off the machine: Google Fonts get empty CSS, everything else is refused. */
async function isolate(context, origins) {
  await context.route(
    (url) => !origins.includes(url.origin),
    (route) => {
      const u = new URL(route.request().url());
      if (u.hostname === 'fonts.googleapis.com') return route.fulfill({ status: 200, contentType: 'text/css', body: '' });
      return route.abort('connectionrefused');
    },
  );
}

/** Waits until the page is controlled by an activated worker; returns its scope. */
async function controlled(page) {
  return page.evaluate(async (ms) => {
    const reg = await Promise.race([navigator.serviceWorker.ready, new Promise((_, rej) => setTimeout(() => rej(new Error('no worker became ready')), ms))]);
    if (!navigator.serviceWorker.controller) {
      await new Promise((resolve, reject) => {
        navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true });
        setTimeout(() => reject(new Error('the worker never took control')), ms);
      });
    }
    // clients.claim() runs inside activate, so control can come a moment before "activated".
    const w = reg.active;
    if (w && w.state !== 'activated') {
      await new Promise((resolve, reject) => {
        w.addEventListener('statechange', () => w.state === 'activated' && resolve());
        setTimeout(() => reject(new Error(`the worker stayed ${w.state}`)), ms);
      });
    }
    return { scope: reg.scope, state: reg.active?.state, script: reg.active?.scriptURL };
  }, TIMEOUT);
}

/** Every entry in this origin's caches, by cache name. */
function cacheContents(page) {
  return page.evaluate(async () => {
    const out = {};
    for (const k of await caches.keys()) out[k] = (await (await caches.open(k)).keys()).map((r) => r.url);
    return out;
  });
}

/** Fetches `url` from the page; returns {status, body, sw} where sw says whether the worker answered it. */
async function fetchFromPage(page, url) {
  const abs = new URL(url, page.url()).href;
  const resp = page.waitForResponse((r) => r.url() === abs, { timeout: TIMEOUT }).catch(() => null);
  const res = await page.evaluate(async (u) => {
    try {
      const r = await fetch(u, { cache: 'no-store' });
      return { status: r.status, body: (await r.text()).slice(0, 200) };
    } catch (e) {
      return { error: String(e) };
    }
  }, abs);
  const r = await resp;
  return { ...res, sw: r ? r.fromServiceWorker() : null };
}

/** PNG width × height from its IHDR. */
function pngSize(buf) {
  check(buf.subarray(1, 4).toString('latin1') === 'PNG', 'an icon is not a PNG');
  return `${buf.readUInt32BE(16)}x${buf.readUInt32BE(20)}`;
}

async function main() {
  if (!/^(0|false|no)$/i.test(env.BUILD ?? '1')) {
    log('building ForgeCoach (npm run build)');
    execFileSync('npm', ['run', 'build'], { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'] });
  }
  mkdirSync(OUT, { recursive: true });
  const pw = await loadPlaywright();
  const port = await freePort();
  const server = await startServer(port);
  const loop = `http://127.0.0.1:${port}/`;
  const named = `http://${HOST}:${port}/`;
  const browser = await launch(pw, port);
  try {
    // --- 1. Loopback: manifest, icons, the worker active, nothing cached.
    {
      const context = await browser.newContext({ viewport: { width: 1200, height: 800 } });
      await isolate(context, [new URL(loop).origin]);
      const page = await context.newPage();
      await page.goto(loop);
      await page.locator('#root > *').first().waitFor({ timeout: TIMEOUT });

      const href = await page.getAttribute('link[rel="manifest"]', 'href');
      const manifestUrl = new URL(href, loop).href;
      const mres = await context.request.get(manifestUrl);
      check(mres.ok(), `manifest: HTTP ${mres.status()}`);
      const manifest = JSON.parse(await mres.text());
      check(manifest.display === 'standalone', `manifest display ${manifest.display}`);
      check(new URL(manifest.start_url, manifestUrl).href === loop, `start_url resolves to ${new URL(manifest.start_url, manifestUrl).href}`);
      check(Array.isArray(manifest.icons) && manifest.icons.length >= 4, 'manifest has icons');
      check(manifest.icons.some((i) => i.type === 'image/svg+xml' && i.sizes === 'any'), 'manifest has an SVG icon (sizes any)');
      check(manifest.icons.some((i) => i.purpose === 'maskable'), 'manifest has a maskable icon');
      const touch = await page.getAttribute('link[rel="apple-touch-icon"]', 'href');
      for (const icon of [...manifest.icons, { src: touch, type: 'image/png', sizes: '180x180' }]) {
        const r = await context.request.get(new URL(icon.src, manifestUrl).href);
        check(r.ok(), `icon ${icon.src}: HTTP ${r.status()}`);
        check(r.headers()['content-type'].startsWith(icon.type), `icon ${icon.src}: ${r.headers()['content-type']}`);
        if (icon.type === 'image/png') check(pngSize(await r.body()) === icon.sizes, `icon ${icon.src} is not ${icon.sizes}`);
        else check((await r.text()).includes('<svg'), `icon ${icon.src} is not SVG`);
      }
      log(`manifest: ${manifest.icons.length} icons, all served at their sizes`);

      const sw = await controlled(page);
      check(sw.state === 'activated', `worker state ${sw.state}`);
      check(sw.scope === loop && sw.script === `${loop}sw.js`, `worker at ${sw.script}, scope ${sw.scope}`);
      await page.reload();
      await page.locator('#root > *').first().waitFor({ timeout: TIMEOUT });
      const asset = await page.evaluate(() => document.querySelector('script[type="module"][src]')?.getAttribute('src'));
      const a = await fetchFromPage(page, asset);
      check(a.status === 200 && a.sw === false, `loopback: an asset was answered by the worker (${JSON.stringify(a)})`);
      const caches = await cacheContents(page);
      check(Object.values(caches).every((list) => list.length === 0), `loopback: the worker cached ${JSON.stringify(caches)}`);
      log(`127.0.0.1: worker ${sw.state} at ${sw.scope}, nothing cached, nothing answered by it`);
      await context.close();
    }

    // --- 2. A non-loopback origin (a phone on Tailscale): the shell cached, the engine's paths not.
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await isolate(context, [new URL(named).origin, new URL(loop).origin]);
    const page = await context.newPage();
    await page.goto(`${named}?skin=felt`);
    await page.locator('#root > *').first().waitFor({ timeout: TIMEOUT });
    const sw = await controlled(page);
    check(sw.state === 'activated' && sw.scope === named, `worker ${sw.state} at ${sw.scope}`);
    const theme = await page.getAttribute('meta[name="theme-color"]', 'content');
    check(theme === '#1a312b', `felt theme-color ${theme}`);

    const cached = await cacheContents(page);
    const names = Object.keys(cached);
    check(names.length === 1 && /^forgecoach-[0-9a-f]{12}$/.test(names[0]), `caches ${names.join(', ')}`);
    const shell = cached[names[0]];
    const entry = await page.evaluate(() => document.querySelector('script[type="module"][src]')?.getAttribute('src'));
    for (const want of [named, `${named}manifest.webmanifest`, `${named}icons/icon-192.png`, new URL(entry, named).href]) check(shell.includes(want), `precache lacks ${want}: ${shell.join(', ')}`);
    log(`${HOST}: precached ${shell.length} files in ${names[0]}`);

    const before = server.seen.length;
    for (const p of ['/health', '/ws', '/observe', '/match', '/review', '/eval', '/coach', `http://127.0.0.1:${port}/health`]) {
      const r = await fetchFromPage(page, p);
      check(r.status === 404 && r.sw === false, `${p} went through the worker or did not reach the server: ${JSON.stringify(r)}`);
      check(/not found/.test(r.body), `${p}: not the server's 404 (${r.body})`);
    }
    const reached = server.seen.slice(before);
    for (const p of ['/health', '/ws', '/observe', '/match']) check(reached.some((l) => l === `GET ${p}`), `the server never saw ${p}`);
    const lab = await fetchFromPage(page, '/lab-sample.json');
    check(lab.status === 200 && lab.sw === false, `lab-sample.json went through the worker: ${JSON.stringify(lab)}`);
    const hashed = await fetchFromPage(page, entry);
    check(hashed.status === 200 && hashed.sw === true, `the entry chunk was not answered by the worker: ${JSON.stringify(hashed)}`);
    log('engine paths, the lab data and the loopback origin reach the server untouched; hashed assets come from the worker');

    // Install: nothing in Settings until the browser offers it.
    await page.getByRole('button', { name: 'Settings' }).first().click();
    await page.getByRole('heading', { name: 'Settings' }).first().waitFor({ timeout: TIMEOUT }).catch(() => {});
    await page.waitForTimeout(300);
    check((await page.locator('[data-testid="install-field"]').count()) === 0, 'Install shown without beforeinstallprompt');
    await page.keyboard.press('Escape');
    await page.evaluate(() => {
      const ev = new Event('beforeinstallprompt', { cancelable: true });
      window.__prompted = 0;
      ev.prompt = () => {
        window.__prompted++;
        return Promise.resolve();
      };
      ev.userChoice = Promise.resolve({ outcome: 'dismissed' });
      window.dispatchEvent(ev);
    });
    await page.getByRole('button', { name: 'Settings' }).first().click();
    const install = page.getByRole('button', { name: 'Install ForgeCoach' });
    await install.waitFor({ timeout: TIMEOUT });
    await install.scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(OUT, 'pwa-settings-install.png') });
    await install.click();
    await page.waitForFunction(() => window.__prompted === 1, null, { timeout: TIMEOUT });
    await page.locator('[data-testid="install-field"]').waitFor({ state: 'detached', timeout: TIMEOUT });
    log('Settings: Install appears only after beforeinstallprompt, calls prompt(), then goes');
    await page.keyboard.press('Escape');

    // --- 3. Offline: the shell from the cache, the engine's paths fail.
    await server.stop();
    await page.goto(named);
    await page.locator('#root > *').first().waitFor({ timeout: TIMEOUT });
    check((await page.title()) === 'ForgeCoach', 'offline: the page did not come from the cache');
    await page.screenshot({ path: path.join(OUT, 'pwa-offline.png') });
    const health = await fetchFromPage(page, '/health');
    check(!!health.error && health.sw !== true, `offline: /health was answered (${JSON.stringify(health)})`);
    log('offline: the page reloads from the cache; /health fails instead of coming from it');

    await context.close();
    log(`PASS (screenshots in ${OUT})`);
    return 0;
  } catch (e) {
    console.error(e instanceof Fail ? `FAIL: ${e.message}` : e);
    return 1;
  } finally {
    await browser.close();
    await server.stop().catch(() => {});
  }
}

process.exit(await main());
