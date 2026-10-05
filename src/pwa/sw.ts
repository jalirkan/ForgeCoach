/*
 * ForgeCoach — pwa/sw.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The service worker, hand-written (no Workbox). pwa/vitePlugin.ts bundles
 * this file with pwa/swRoutes.ts into the build's sw.js and fills in the
 * precache list (the shell: index.html, the entry script and stylesheet, the
 * manifest, the icons) and a version from its hash.
 *
 * Every request goes through swRoutes.ts `route`: `passthrough` returns
 * without respondWith, so the browser handles it as if there were no worker
 * (the seat and observe sockets, the engine, the coach helper, Anthropic,
 * Scryfall, the lab's data, anything cross-origin or on a loopback host).
 * The page: network first, the cached shell offline. Hashed assets: cache
 * first. Other static files: network first, the cache offline.
 */
import { cacheName, route, staleCaches, type SwRoute } from './swRoutes.ts';

/* The few worker types used here (tsconfig's lib is the page's DOM). */
interface ExtendableEvent extends Event {
  waitUntil(p: Promise<unknown>): void;
}
interface FetchEvent extends ExtendableEvent {
  readonly request: Request;
  respondWith(r: Response | Promise<Response>): void;
}
interface WorkerScope {
  readonly location: Location;
  readonly registration: { readonly scope: string };
  readonly clients: { claim(): Promise<void> };
  skipWaiting(): Promise<void>;
  addEventListener(type: 'install' | 'activate', fn: (e: ExtendableEvent) => void): void;
  addEventListener(type: 'fetch', fn: (e: FetchEvent) => void): void;
}
declare const self: WorkerScope;

/** Filled in at build time (pwa/vitePlugin.ts); the strings stay as they are in a dev build, which never registers. */
const VERSION: string = '__FORGECOACH_SW_VERSION__';
const PRECACHE: string[] = JSON.parse('__FORGECOACH_SW_PRECACHE__');

const CACHE = cacheName(VERSION);
const scope = () => self.registration.scope;

function routeOf(req: Request): SwRoute {
  if (req.headers.has('range')) return 'passthrough';
  return route(req.url, req.method, { origin: self.location.origin, base: scope(), mode: req.mode });
}

self.addEventListener('install', (e) => {
  // Only what the routes would cache anyway: on a loopback host that is nothing.
  const urls = PRECACHE.map((p) => new URL(p, scope()).href).filter((u) => route(u, 'GET', { origin: self.location.origin, base: scope() }) !== 'passthrough');
  e.waitUntil(
    (async () => {
      if (urls.length) await (await caches.open(CACHE)).addAll(urls);
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    (async () => {
      await Promise.all(staleCaches(await caches.keys(), CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (e) => {
  const how = routeOf(e.request);
  if (how === 'passthrough') return;
  e.respondWith(how === 'cache-first' ? cacheFirst(e.request) : networkFirst(e.request));
});

/** The page's own URL in the cache: the scope, whatever query (a seat token) or index.html it was opened with. */
function cacheKey(req: Request): string {
  const u = new URL(req.url);
  const base = new URL(scope());
  if (u.pathname === base.pathname || u.pathname === `${base.pathname}index.html`) return base.href;
  return req.url;
}

function cacheable(res: Response): boolean {
  return res.ok && res.status === 200 && res.type === 'basic';
}

async function networkFirst(req: Request): Promise<Response> {
  const key = cacheKey(req);
  try {
    const res = await fetch(req);
    if (cacheable(res)) {
      const copy = res.clone();
      void caches.open(CACHE).then((c) => c.put(key, copy)).catch(() => {});
    }
    return res;
  } catch (err) {
    const hit = await caches.match(key, { cacheName: CACHE });
    if (hit) return hit;
    throw err;
  }
}

async function cacheFirst(req: Request): Promise<Response> {
  const hit = await caches.match(req, { cacheName: CACHE });
  if (hit) return hit;
  const res = await fetch(req);
  if (cacheable(res)) {
    const copy = res.clone();
    void caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
  }
  return res;
}
