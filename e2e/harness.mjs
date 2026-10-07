/*
 * ForgeCoach — e2e/harness.mjs
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * What the e2e scripts share: finding playwright-core (never a dependency of
 * ForgeCoach), launching Chromium (through the machine's HTTPS proxy when one
 * is set, loopback bypassed), free ports, a seeded generator, and waiting for
 * an HTTP endpoint.
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import net from 'node:net';

/**
 * playwright-core: the normal resolution first, then PLAYWRIGHT_CORE (a directory holding it,
 * e.g. a global install on the PC), the global npm root, and the sandbox's tool dir.
 */
export async function loadPlaywright() {
  const require = createRequire(import.meta.url);
  const candidates = ['playwright-core'];
  if (process.env.PLAYWRIGHT_CORE) candidates.push(process.env.PLAYWRIGHT_CORE);
  try {
    const root = execFileSync('npm', ['root', '-g'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (root) candidates.push(`${root}/playwright-core`);
  } catch {
    /* no npm on PATH */
  }
  candidates.push('/opt/node-tools/node_modules/playwright-core');
  for (const c of candidates) {
    try {
      const resolved = require.resolve(c);
      const mod = await import(resolved.startsWith('/') ? `file://${resolved}` : resolved);
      return mod.default ?? mod;
    } catch {
      /* next */
    }
  }
  console.error(
    [
      'e2e: playwright-core is not installed.',
      'It is deliberately not a dependency of ForgeCoach. Install it once, outside the project or globally:',
      '  npm install --no-save playwright-core && npx playwright-core install chromium',
      'or set BROWSER_PATH to a Chrome/Chromium executable after installing playwright-core.',
    ].join('\n'),
  );
  process.exit(2);
}

/**
 * Chromium, headless or not. Behind an HTTPS proxy (Scryfall's card data goes
 * through it) the proxy is used for everything but loopback, where the app,
 * the engine and the helper live.
 */
export async function launchBrowser(pw, { headless = true, env = process.env } = {}) {
  const opts = { headless };
  const proxy = env.HTTPS_PROXY || env.https_proxy;
  if (proxy) opts.args = [`--proxy-server=${proxy}`, '--proxy-bypass-list=<-loopback>;127.0.0.1;localhost'];
  if (env.BROWSER_PATH) return pw.chromium.launch({ ...opts, executablePath: env.BROWSER_PATH });
  try {
    return await pw.chromium.launch(opts);
  } catch (e) {
    try {
      return await pw.chromium.launch({ ...opts, channel: 'chrome' });
    } catch {
      console.error(`e2e: no browser for Playwright (${String(e.message).split('\n')[0]}).`);
      console.error('Run `npx playwright-core install chromium`, or set BROWSER_PATH to a Chrome/Chromium executable.');
      process.exit(2);
    }
  }
}

export function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.unref();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

/** mulberry32: "random" choices that replay from a seed. */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The bridge's GET /health for a seat URL (ws://host:port/ws → http://host:port/health). */
export function healthUrl(seat) {
  const u = new URL(seat);
  u.protocol = u.protocol === 'wss:' ? 'https:' : 'http:';
  u.pathname = '/health';
  u.search = '';
  return u.toString();
}

/** Poll `url` until it answers 2xx (or `ok(res)` says so), or `ms` passes. Resolves to the response or null. */
export async function waitHttp(url, ms, { ok = (r) => r.ok, every = 300, alive = () => true } = {}) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (!alive()) return null;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (await ok(res)) return res;
    } catch {
      /* not yet */
    }
    await new Promise((r) => setTimeout(r, every));
  }
  return null;
}
