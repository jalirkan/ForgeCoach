/*
 * ForgeCoach — pwa/swRoutes.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The service worker's routing rules, as one pure function: the worker
 * (pwa/sw.ts, built into sw.js by pwa/vitePlugin.ts) and the tests both call
 * this, so what is tested is what runs.
 *
 * The worker caches only the app shell and static, same-origin files under the
 * site's base: Vite's hashed build output (assets/), the cube documents
 * and their data (cubes/: the lab's .meta.json, 17Lands' .human.json), the
 * sample logs (samples/), the icons and the manifest. Everything else is
 * `passthrough` — the worker does not call respondWith at all, so the
 * request goes to the network exactly as without a worker. That includes, and
 * the tests pin each one down:
 *   - any non-GET request, and anything that is not http(s) (ws:, wss:);
 *   - any cross-origin request: Anthropic's API, Scryfall (cards.ts keeps its
 *     own IndexedDB cache), the lab-status branch on raw.githubusercontent.com,
 *     Google Fonts, the coach helper (127.0.0.1:8643), the local engine;
 *   - any page on a loopback host (127.0.0.1, localhost, [::1]) or on the coach
 *     helper's port 8643, even same-origin: those are the player's own machine;
 *   - the engine's endpoints when the engine serves the site itself and the
 *     page's origin IS the engine (/ws, /observe, /health, /match, /review,
 *     /eval, /coach, /vision, /engine/…): same-origin, but not on the list;
 *   - the draft room's endpoints (mtg-table D400: /room, /room/<id>/events,
 *     /join, /pick) on the room listener's own origin, which serves the site
 *     to a friend on the LAN (port 8644), and from any other page;
 *   - anything naming the lab's live data (lab-status, status.json,
 *     ladder.json, warehouse.json, ledger.json), wherever it is served from;
 *   - same-origin paths outside the base, and any file not on the static list.
 */

export type SwRoute = 'network-first' | 'cache-first' | 'passthrough';

export interface RouteContext {
  /** The page's (and the worker's) origin, like `self.location.origin`. */
  origin: string;
  /** The site's base: the worker's scope URL, or a path (`/ForgeCoach/`, `./`) resolved against `origin`. */
  base: string;
  /** The request's mode (`navigate` for a page load). */
  mode?: string;
}

/** Hosts that are the player's own machine: never cached. */
const LOOPBACK = /^(localhost|.*\.localhost|127(?:\.\d{1,3}){3}|\[::1\]|::1|0\.0\.0\.0)$/i;

/** The coach helper's port (mtg-table's `play.sh`). */
const HELPER_PORT = '8643';

/** The lab's live, numbers-only data: always fresh from the network. */
const LAB_DATA = /lab-status|(?:^|[/=])(?:status|ladder|warehouse|ledger)\.json(?:$|[?#&])/i;

/** First path segments under the base that belong to the engine or the helper, never to the site. */
const ENGINE_PATHS = new Set(['ws', 'observe', 'health', 'match', 'review', 'eval', 'coach', 'vision', 'engine', 'room', 'api', 'sw.js']);

/** The static folders under the base whose files are not content-hashed. */
const STATIC_DIRS = ['cubes/', 'samples/', 'icons/'];

/** A plain relative file path: no traversal, no encoded separators. */
const SAFE_PATH = /^[A-Za-z0-9._~\-/]+$/;

export function route(url: string, method: string, ctx: RouteContext): SwRoute {
  if (method.toUpperCase() !== 'GET') return 'passthrough';
  let u: URL;
  let base: URL;
  try {
    u = new URL(url);
    base = new URL(ctx.base, ctx.origin.replace(/\/?$/, '/'));
  } catch {
    return 'passthrough';
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return 'passthrough';
  if (u.origin !== new URL(ctx.origin).origin || u.origin !== base.origin) return 'passthrough';
  if (LOOPBACK.test(u.hostname) || u.port === HELPER_PORT) return 'passthrough';
  if (LAB_DATA.test(u.href)) return 'passthrough';
  const basePath = base.pathname.replace(/[^/]*$/, '');
  if (!u.pathname.startsWith(basePath)) return 'passthrough';
  const rel = u.pathname.slice(basePath.length);
  if (!SAFE_PATH.test(rel) && rel !== '') return 'passthrough';
  if (rel.split('/').some((seg) => seg === '..' || seg === '.')) return 'passthrough';
  if (ENGINE_PATHS.has(rel.split('/')[0]!.toLowerCase())) return 'passthrough';

  // The page itself: the network first, so a deploy shows up; the cache when offline.
  if (rel === '' || rel === 'index.html') return 'network-first';
  if (ctx.mode === 'navigate') return 'passthrough';
  if (u.search) return 'passthrough';
  // Vite's content-hashed build output: a name never changes its bytes.
  if (rel.startsWith('assets/') && rel.length > 'assets/'.length) return 'cache-first';
  // Unhashed static files: fresh when online, still there offline.
  if (rel === 'manifest.webmanifest') return 'network-first';
  if (STATIC_DIRS.some((d) => rel.startsWith(d) && rel.length > d.length && !rel.endsWith('/'))) return 'network-first';
  return 'passthrough';
}

/** Every cache this site's worker makes starts with this; activate deletes those of other versions. */
export const CACHE_PREFIX = 'forgecoach-';

/** The cache name for one build (the version is a hash of the precache list). */
export function cacheName(version: string): string {
  return `${CACHE_PREFIX}${version}`;
}

/** The caches activate deletes: ours, from other versions. Other sites' caches on the origin are left alone. */
export function staleCaches(keys: readonly string[], current: string): string[] {
  return keys.filter((k) => k.startsWith(CACHE_PREFIX) && k !== current);
}
