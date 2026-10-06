/*
 * ForgeCoach — pwa/swRoutes.test.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The service worker's rules, under both bases: GitHub Pages (/ForgeCoach/)
 * and the engine serving the site at its root on a LAN address
 * (FORGECOACH_BASE=./), where the page's origin IS the engine.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cacheName, route, staleCaches, type RouteContext } from './swRoutes.ts';

const SITES: Array<{ name: string; ctx: RouteContext; at: string }> = [
  { name: 'GitHub Pages', ctx: { origin: 'https://jalirkan.github.io', base: '/ForgeCoach/' }, at: 'https://jalirkan.github.io/ForgeCoach/' },
  { name: 'Pages, scope URL', ctx: { origin: 'https://jalirkan.github.io', base: 'https://jalirkan.github.io/ForgeCoach/' }, at: 'https://jalirkan.github.io/ForgeCoach/' },
  { name: 'engine on the LAN', ctx: { origin: 'http://192.168.1.5:8642', base: './' }, at: 'http://192.168.1.5:8642/' },
  { name: 'engine, scope URL', ctx: { origin: 'http://192.168.1.5:8642', base: 'http://192.168.1.5:8642/' }, at: 'http://192.168.1.5:8642/' },
  { name: 'Tailscale serve', ctx: { origin: 'https://pc.tail1234.ts.net', base: './' }, at: 'https://pc.tail1234.ts.net/' },
  // mtg-table D400: the draft room's listener serves the site to a friend on the LAN.
  { name: 'draft room on the LAN', ctx: { origin: 'http://192.168.1.5:8644', base: './' }, at: 'http://192.168.1.5:8644/' },
];

const nav = (ctx: RouteContext): RouteContext => ({ ...ctx, mode: 'navigate' });

for (const { name, ctx, at } of SITES) {
  describe(`service worker routes: ${name}`, () => {
    const get = (path: string, c: RouteContext = ctx) => route(new URL(path, at).href, 'GET', c);

    it('loads the page network-first (a deploy shows up), whatever its query', () => {
      expect(get('', nav(ctx))).toBe('network-first');
      expect(get('index.html', nav(ctx))).toBe('network-first');
      expect(get('?token=abc123&coachPort=8650', nav(ctx))).toBe('network-first');
      expect(get('?skin=felt#lab', nav(ctx))).toBe('network-first');
      expect(get('')).toBe('network-first');
    });

    it('keeps hashed build output cache-first', () => {
      expect(get('assets/index-Bx12_aZ.js')).toBe('cache-first');
      expect(get('assets/index-C9f0.css')).toBe('cache-first');
      expect(get('assets/DeckApp-9a8b7c.js')).toBe('cache-first');
    });

    it('keeps unhashed static files network-first: cubes, samples, icons, manifest', () => {
      expect(get('cubes/vintage.md')).toBe('network-first');
      expect(get('cubes/vintage.meta.json')).toBe('network-first');
      expect(get('samples/human-auto-42.jsonl.gz')).toBe('network-first');
      expect(get('samples/human-auto-42.review.json')).toBe('network-first');
      expect(get('icons/icon-192.png')).toBe('network-first');
      expect(get('icons/icon.svg')).toBe('network-first');
      expect(get('manifest.webmanifest')).toBe('network-first');
    });

    it('never takes a non-GET request', () => {
      for (const m of ['POST', 'PUT', 'DELETE', 'HEAD', 'OPTIONS', 'PATCH']) {
        expect(route(new URL('', at).href, m, nav(ctx)), m).toBe('passthrough');
        expect(route(new URL('assets/index-abc.js', at).href, m, ctx), m).toBe('passthrough');
      }
    });

    it('never touches the seat or observe sockets, as ws, http or under the base', () => {
      const host = new URL(at).host;
      for (const u of [`ws://${host}/ws`, `wss://${host}/ws?token=x`, `ws://${host}/observe`, `ws://127.0.0.1:8642/ws`, `ws://127.0.0.1:8642/observe`]) {
        expect(route(u, 'GET', ctx), u).toBe('passthrough');
      }
      for (const p of ['/ws', '/ws?token=abc', '/observe', 'ws', 'observe', 'ws?token=abc']) {
        expect(get(p), p).toBe('passthrough');
        expect(get(p, nav(ctx)), p).toBe('passthrough');
      }
    });

    it("never takes the engine's or the helper's HTTP endpoints on the page's own origin", () => {
      for (const p of ['/health', '/match', '/review', '/review/abc', '/eval', '/coach', '/vision', '/engine/start', 'health', 'match', 'review/r1', 'eval', 'coach', 'engine/start', 'api/x']) {
        expect(get(p), p).toBe('passthrough');
        expect(get(p, nav(ctx)), p).toBe('passthrough');
      }
    });

    it("never takes the draft room's endpoints (D400), on the page's own origin or the room listener's", () => {
      for (const p of ['/room', '/room/rAbcdEFG1', '/room/rAbcdEFG1/events', '/room/rAbcdEFG1/join', '/room/rAbcdEFG1/pick', 'room/rAbcdEFG1', 'room/rAbcdEFG1/events']) {
        expect(get(p), p).toBe('passthrough');
        expect(get(p, nav(ctx)), p).toBe('passthrough');
        expect(route(new URL(p, at).href, 'POST', ctx), p).toBe('passthrough');
      }
      for (const u of ['http://127.0.0.1:8644/room/rAbcdEFG1/events', 'http://192.168.1.5:8644/room/rAbcdEFG1', 'https://draft.example.com/room/rAbcdEFG1/events', 'http://127.0.0.1:8643/room']) {
        if (new URL(u).origin === new URL(ctx.origin).origin) continue;
        expect(route(u, 'GET', ctx), u).toBe('passthrough');
      }
    });

    it('never takes a loopback host or the coach helper, even as the same origin', () => {
      for (const origin of ['http://127.0.0.1:8642', 'http://localhost:8642', 'http://[::1]:8642', 'http://127.0.0.1:4173', 'http://localhost', 'http://app.localhost:5173']) {
        const site = new URL(new URL(at).pathname, `${origin}/`);
        for (const p of ['', 'index.html', 'assets/index-abc.js', 'cubes/vintage.md', 'manifest.webmanifest']) {
          const c: RouteContext = { origin, base: site.href, mode: p ? undefined : 'navigate' };
          expect(route(new URL(p, site).href, 'GET', c), `${origin} ${p}`).toBe('passthrough');
        }
      }
      for (const u of ['http://127.0.0.1:8643/health', 'http://127.0.0.1:8643/coach', 'http://localhost:8643/eval', 'http://[::1]:8643/health', 'http://127.0.0.1:8642/health', 'http://127.0.0.1:8642/match']) {
        expect(route(u, 'GET', ctx), u).toBe('passthrough');
      }
      // the helper's port on the page's own host (play.sh --lan --coach-port)
      const helper = new URL(at);
      helper.port = '8643';
      expect(route(new URL('health', helper).href, 'GET', ctx)).toBe('passthrough');
      expect(route(helper.href, 'GET', { origin: helper.origin, base: './', mode: 'navigate' })).toBe('passthrough');
      expect(route(new URL('assets/index-abc.js', helper).href, 'GET', { origin: helper.origin, base: './' })).toBe('passthrough');
    });

    it('never takes Anthropic, Scryfall or any other origin', () => {
      for (const u of [
        'https://api.anthropic.com/v1/messages',
        'https://api.scryfall.com/cards/named?exact=Shock',
        'https://api.scryfall.com/cards/collection',
        'https://cards.scryfall.io/normal/front/a/b/ab.jpg',
        'https://svgs.scryfall.io/card-symbols/R.svg',
        'https://fonts.googleapis.com/css2?family=Inter',
        'https://fonts.gstatic.com/s/inter/v1.woff2',
        'https://example.com/ForgeCoach/assets/index-abc.js',
        'http://jalirkan.github.io/ForgeCoach/assets/index-abc.js',
      ]) {
        expect(route(u, 'GET', ctx), u).toBe('passthrough');
        expect(route(u, 'GET', nav(ctx)), u).toBe('passthrough');
      }
    });

    it("never takes the lab's live data, from the lab-status branch or the site", () => {
      for (const u of [
        'https://raw.githubusercontent.com/jalirkan/ForgeCoach/lab-status/status.json',
        'https://raw.githubusercontent.com/jalirkan/ForgeCoach/lab-status/ladder.json',
        'https://raw.githubusercontent.com/jalirkan/ForgeCoach/lab-status/warehouse.json',
        'https://raw.githubusercontent.com/jalirkan/ForgeCoach/lab-status/ledger.json',
      ]) {
        expect(route(u, 'GET', ctx), u).toBe('passthrough');
      }
      for (const p of ['status.json', 'ladder.json', 'warehouse.json', 'ledger.json', 'lab-status/status.json', 'cubes/status.json', 'samples/ladder.json', 'icons/ledger.json', 'samples/lab-status.json', 'lab-sample.json', 'ladder-sample.json', 'warehouse-sample.json']) {
        expect(get(p), p).toBe('passthrough');
      }
    });

    it('never takes a same-origin path outside the static list', () => {
      for (const p of ['forgecoach.sh', 'sw.js', 'favicon.ico', 'robots.txt', 'something/else.js', 'assets/', 'cubes/', 'icons/', 'cubes/vintage.md?v=2', 'assets/index-abc.js?x=1', 'assets/../health', 'cubes/%2e%2e/health', 'assets/a%2Fb.js']) {
        expect(get(p), p).toBe('passthrough');
      }
      // a navigation to any other page under the base is the network's
      expect(get('cubes/vintage.md', nav(ctx))).toBe('passthrough');
      expect(get('other.html', nav(ctx))).toBe('passthrough');
    });

    it('never takes non-http(s) URLs or garbage', () => {
      for (const u of ['data:text/plain,hi', 'blob:https://jalirkan.github.io/1234', 'chrome-extension://abc/x.js', 'not a url', '']) {
        expect(route(u, 'GET', ctx), u).toBe('passthrough');
      }
    });
  });
}

describe('service worker routes: outside the base', () => {
  const ctx: RouteContext = { origin: 'https://jalirkan.github.io', base: '/ForgeCoach/' };
  it('takes nothing of another site on the same origin', () => {
    for (const p of ['/', '/index.html', '/assets/index-abc.js', '/OtherSite/', '/OtherSite/assets/index-abc.js', '/ForgeCoachX/assets/a.js', '/ws', '/health']) {
      expect(route(`https://jalirkan.github.io${p}`, 'GET', ctx), p).toBe('passthrough');
      expect(route(`https://jalirkan.github.io${p}`, 'GET', { ...ctx, mode: 'navigate' }), p).toBe('passthrough');
    }
  });
});

describe('cache versions', () => {
  it('deletes only our caches of other versions', () => {
    const cur = cacheName('abc');
    expect(staleCaches(['forgecoach-old', cur, 'other-app', 'forgecoach-123'], cur)).toEqual(['forgecoach-old', 'forgecoach-123']);
  });
});

describe('the worker uses these rules', () => {
  const sw = readFileSync(new URL('./sw.ts', import.meta.url), 'utf8');
  it('imports route from swRoutes.ts and nothing else', () => {
    const imports = [...sw.matchAll(/^import .* from '([^']+)';$/gm)].map((m) => m[1]);
    expect(imports).toEqual(['./swRoutes.ts']);
    expect(sw).toMatch(/route\(req\.url, req\.method, \{ origin: self\.location\.origin, base: scope\(\), mode: req\.mode \}\)/);
  });
  it('returns without respondWith on passthrough', () => {
    expect(sw).toMatch(/if \(how === 'passthrough'\) return;\n\s*e\.respondWith/);
  });
});
