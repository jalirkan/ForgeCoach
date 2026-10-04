/*
 * ForgeCoach — pwa.test.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The home-screen app: the manifest and index.html's links are relative, so the
 * one build installs from GitHub Pages (/ForgeCoach/) and from the engine
 * serving the site itself at its root (play.sh --lan, FORGECOACH_BASE=./), and
 * every icon they name exists at the size it claims.
 */
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const root = new URL('../', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root));
const manifest = JSON.parse(read('public/manifest.webmanifest').toString('utf8')) as {
  id?: string;
  start_url: string;
  scope: string;
  display: string;
  theme_color: string;
  background_color: string;
  icons: { src: string; sizes: string; type: string; purpose?: string }[];
};
const html = read('index.html').toString('utf8');

/** Where the site is served: Pages, and the engine on a LAN address. */
const BASES = ['https://jalirkan.github.io/ForgeCoach/', 'http://192.168.1.20:8642/'];

/** The href of `<link rel="…">` or the content of `<meta name="…">` in index.html. */
function linkHref(rel: string): string | null {
  const m = html.match(new RegExp(`<link[^>]*rel="${rel}"[^>]*href="([^"]+)"`));
  return m ? m[1]! : null;
}
function meta(name: string): string | null {
  const m = html.match(new RegExp(`<meta[^>]*name="${name}"[^>]*content="([^"]+)"`));
  return m ? m[1]! : null;
}

/** Width × height from a PNG's IHDR chunk. */
function pngSize(path: string): string {
  const b = read(path);
  expect(b.subarray(1, 4).toString('latin1')).toBe('PNG');
  return `${b.readUInt32BE(16)}x${b.readUInt32BE(20)}`;
}

const isRelative = (u: string) => !/^[a-z][a-z0-9+.-]*:/i.test(u) && !u.startsWith('/');

describe('web app manifest', () => {
  it('opens full-screen', () => {
    expect(manifest.display).toBe('standalone');
  });

  it('uses only relative URLs', () => {
    for (const u of [manifest.start_url, manifest.scope, manifest.id ?? '.', ...manifest.icons.map((i) => i.src)]) expect(isRelative(u), u).toBe(true);
  });

  for (const base of BASES) {
    it(`starts and stays inside the site served at ${base}`, () => {
      const manifestUrl = new URL(linkHref('manifest')!, base).href;
      expect(manifestUrl).toBe(`${base}manifest.webmanifest`);
      const start = new URL(manifest.start_url, manifestUrl).href;
      const scope = new URL(manifest.scope, manifestUrl).href;
      expect(start).toBe(base);
      expect(scope).toBe(base);
      expect(new URL(manifest.id ?? manifest.start_url, start).href).toBe(base);
      for (const icon of manifest.icons) expect(new URL(icon.src, manifestUrl).href.startsWith(scope)).toBe(true);
    });
  }

  it('names icons that exist at the sizes they claim, with a maskable one', () => {
    for (const icon of manifest.icons) {
      expect(existsSync(new URL(`public/${icon.src}`, root)), icon.src).toBe(true);
      expect(pngSize(`public/${icon.src}`)).toBe(icon.sizes);
      expect(icon.type).toBe('image/png');
    }
    expect(manifest.icons.some((i) => i.purpose === 'maskable')).toBe(true);
    expect(manifest.icons.some((i) => i.sizes === '512x512' && i.purpose !== 'maskable')).toBe(true);
    expect(manifest.icons.some((i) => i.sizes === '192x192')).toBe(true);
  });

  it('starts in the colour index.html paints before the skin loads', () => {
    expect(manifest.theme_color.toLowerCase()).toBe(meta('theme-color')!.toLowerCase());
    expect(manifest.background_color.toLowerCase()).toBe(manifest.theme_color.toLowerCase());
  });
});

describe('index.html for phones', () => {
  it('links the manifest and a 180px apple-touch-icon by relative paths', () => {
    expect(isRelative(linkHref('manifest')!)).toBe(true);
    const touch = linkHref('apple-touch-icon')!;
    expect(isRelative(touch)).toBe(true);
    expect(pngSize(`public/${touch.replace(/^\.\//, '')}`)).toBe('180x180');
  });

  it('has the iOS home-screen tags', () => {
    expect(meta('apple-mobile-web-app-capable')).toBe('yes');
    expect(meta('mobile-web-app-capable')).toBe('yes');
    expect(meta('apple-mobile-web-app-title')).toBe('ForgeCoach');
    expect(meta('apple-mobile-web-app-status-bar-style')).toBe('black-translucent');
    expect(meta('format-detection')).toBe('telephone=no');
  });

  it('draws under the notch (the CSS pads with safe-area insets) and resizes for the keyboard', () => {
    const vp = meta('viewport')!;
    expect(vp).toContain('viewport-fit=cover');
    expect(vp).toContain('interactive-widget=resizes-content');
    // never blocks pinch-zoom
    expect(vp).not.toMatch(/user-scalable\s*=\s*no|maximum-scale/);
  });
});
