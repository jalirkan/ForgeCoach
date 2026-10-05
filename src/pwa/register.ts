/*
 * ForgeCoach — pwa/register.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Registers the service worker (sw.js, pwa/sw.ts) in a production build only,
 * at the site's base: /ForgeCoach/ on GitHub Pages, or the folder the page was
 * opened from when the build's base is relative (FORGECOACH_BASE=./, the
 * engine serving the site). Browsers offer service workers only on secure
 * origins (https, or localhost); elsewhere this does nothing.
 * Must not import pwa/swRoutes.ts: the worker's chunk has to stand alone.
 */

/** The worker's script URL and scope for a base (import.meta.env.BASE_URL) and the page's URL. */
export function workerUrls(base: string, pageHref: string): { script: string; scope: string } {
  const scope = new URL(base || './', pageHref);
  scope.search = '';
  scope.hash = '';
  scope.pathname = scope.pathname.replace(/[^/]*$/, '');
  return { script: new URL('sw.js', scope).href, scope: scope.href };
}

interface Env {
  prod: boolean;
  base: string;
}

type Nav = { serviceWorker?: { register(url: string, opts: { scope: string }): Promise<unknown> } };

export function registerServiceWorker(env: Env, win: { navigator: Nav; location: { href: string }; addEventListener(t: 'load', fn: () => void): void; document?: { readyState: string } }): void {
  if (!env.prod) return;
  const sw = win.navigator.serviceWorker;
  if (!sw) return;
  const { script, scope } = workerUrls(env.base, win.location.href);
  const go = () => {
    sw.register(script, { scope }).catch(() => {
      /* not allowed here (private window, blocked storage): the site works without it */
    });
  };
  if (win.document?.readyState === 'complete') go();
  else win.addEventListener('load', go);
}
