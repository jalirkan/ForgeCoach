/*
 * ForgeCoach — pwa/app.test.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The icons drawn in code, the build step's precache list and placeholders,
 * where the worker registers, the install offer, and each skin's theme colour.
 */
import { readFileSync } from 'node:fs';
import { inflateSync, deflateSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ANVIL_POINTS, ICON_BG, ICON_FG, ICONS, anvilPoints, crc32, encodePng, iconSvg, inPolygon, rasterIcon, renderIcon } from './icons.ts';
import { fillWorker, precacheList } from './vitePlugin.ts';
import { registerServiceWorker, workerUrls } from './register.ts';
import { captureInstallPrompt, installOffer, isIosSafari, isStandalone, onInstallChange, promptInstall, resetInstallForTests, type InstallPromptEvent } from './install.ts';
import { THEME_COLOR } from '../ui/skin.ts';

const deflate = (b: Uint8Array) => new Uint8Array(deflateSync(b));

describe('icons', () => {
  it('walks the favicon path into the anvil outline', () => {
    expect(anvilPoints('M3 9h13l2-3h3v3l-3 2v2H8l-1 2h4v3H5v-3l1-2-3-1z')).toEqual([
      [3, 9], [16, 9], [18, 6], [21, 6], [21, 9], [18, 11], [18, 13], [8, 13], [7, 15], [11, 15], [11, 18], [5, 18], [5, 15], [6, 13], [3, 12],
    ]);
    expect(inPolygon(10, 11, ANVIL_POINTS)).toBe(true); // the anvil's face
    expect(inPolygon(8, 16.5, ANVIL_POINTS)).toBe(true); // its foot
    expect(inPolygon(12, 4, ANVIL_POINTS)).toBe(false);
    expect(inPolygon(14, 16, ANVIL_POINTS)).toBe(false); // beside the waist
  });

  it('keeps the maskable anvil inside the safe zone (radius 40% of the box)', () => {
    const svg = iconSvg('maskable');
    const m = /translate\(([\d.]+) ([\d.]+)\) scale\(([\d.]+)\)/.exec(svg)!;
    const [tx, ty, s] = [Number(m[1]), Number(m[2]), Number(m[3])];
    for (const [x, y] of ANVIL_POINTS) expect(Math.hypot(tx + x * s - 12, ty + y * s - 12)).toBeLessThanOrEqual(24 * 0.4);
    expect(svg).toContain(`<rect width="24" height="24" fill="${ICON_BG}"/>`); // full bleed
    expect(iconSvg('any')).toContain('rx="6"');
  });

  it('draws PNGs a decoder reads back: the right size, the anvil gold, the background dark', () => {
    const png = encodePng(32, 32, rasterIcon('maskable', 32), deflate);
    const b = Buffer.from(png);
    expect(b.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    expect(b.readUInt32BE(16)).toBe(32);
    expect(b.readUInt32BE(20)).toBe(32);
    // every chunk's CRC checks
    let o = 8;
    const chunks: string[] = [];
    let idat = Buffer.alloc(0);
    while (o < b.length) {
      const len = b.readUInt32BE(o);
      const type = b.subarray(o + 4, o + 8).toString('latin1');
      expect(b.readUInt32BE(o + 8 + len)).toBe(crc32(b.subarray(o + 4, o + 8 + len)));
      if (type === 'IDAT') idat = Buffer.concat([idat, b.subarray(o + 8, o + 8 + len)]);
      chunks.push(type);
      o += 12 + len;
    }
    expect(chunks).toEqual(['IHDR', 'IDAT', 'IEND']);
    const raw = inflateSync(idat);
    expect(raw.length).toBe(32 * (32 * 4 + 1));
    const px = (x: number, y: number) => [...raw.subarray(y * 129 + 1 + x * 4, y * 129 + 1 + x * 4 + 4)];
    const hex = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
    expect(px(0, 0)).toEqual([...hex(ICON_BG), 255]); // maskable: full bleed
    expect(px(14, 14)).toEqual([...hex(ICON_FG), 255]); // inside the anvil's face
  });

  it("leaves the favicon-shaped icon's corners transparent and fills the apple one", () => {
    expect(rasterIcon('any', 48)[3]).toBe(0);
    expect(rasterIcon('apple', 48)[3]).toBe(255);
  });

  it('fills exactly the pixels whose centre is inside the anvil (scanline = point-in-polygon)', () => {
    const size = 40;
    const px = rasterIcon('apple', size, 1);
    const fgR = parseInt(ICON_FG.slice(1, 3), 16);
    const pts = ANVIL_POINTS.map(([x, y]) => [12 + (x - 12) * 0.76, 12 + (y - 12) * 0.76] as const);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const inside = inPolygon(((x + 0.5) * 24) / size, ((y + 0.5) * 24) / size, pts);
        expect(px[(y * size + x) * 4] === fgR, `${x},${y}`).toBe(inside);
      }
    }
  });

  it('renders every icon the site names', () => {
    for (const icon of ICONS) {
      const { body, type } = renderIcon(icon, deflate);
      expect(body.length, icon.path).toBeGreaterThan(100);
      expect(type).toBe(icon.path.endsWith('.svg') ? 'image/svg+xml' : 'image/png');
    }
  });
});

describe('build step', () => {
  const bundle = {
    'assets/index-abc.js': { type: 'chunk', fileName: 'assets/index-abc.js', isEntry: true, imports: ['assets/vendor-1.js'], viteMetadata: { importedCss: new Set(['assets/index-abc.css']) } },
    'assets/vendor-1.js': { type: 'chunk', fileName: 'assets/vendor-1.js', imports: [] },
    'assets/DeckApp-9.js': { type: 'chunk', fileName: 'assets/DeckApp-9.js', imports: ['assets/vendor-1.js'] },
    'sw.js': { type: 'chunk', fileName: 'sw.js', isEntry: true, imports: [] },
    'index.html': { type: 'asset', fileName: 'index.html' },
  };

  it('precaches the shell: the page, the entry and its static imports and CSS, the manifest, the icons; not lazy pages or the worker', () => {
    const list = precacheList(bundle);
    expect(list).toEqual(expect.arrayContaining(['./', 'manifest.webmanifest', 'assets/index-abc.js', 'assets/index-abc.css', 'assets/vendor-1.js', ...ICONS.map((i) => i.path)]));
    expect(list).not.toContain('assets/DeckApp-9.js');
    expect(list).not.toContain('sw.js');
  });

  it('fills the placeholders, whatever quotes the minifier kept, with a version that follows the list', () => {
    const code = `const v="__FORGECOACH_SW_VERSION__",p=JSON.parse('__FORGECOACH_SW_PRECACHE__');`;
    const a = fillWorker(code, ['./', 'assets/a.js']);
    const b = fillWorker(code, ['./', 'assets/b.js']);
    expect(a).not.toContain('__FORGECOACH');
    const run = (src: string) => new Function(`${src} return [v, p];`)() as [string, string[]];
    expect(run(a)[1]).toEqual(['./', 'assets/a.js']);
    expect(run(a)[0]).toMatch(/^[0-9a-f]{12}$/);
    expect(run(a)[0]).not.toBe(run(b)[0]);
    expect(() => fillWorker('const v = "__FORGECOACH_SW_OTHER__"', [])).toThrow();
  });
});

describe('registering the worker', () => {
  it('puts sw.js and its scope at the base, on Pages and when the engine serves the site', () => {
    expect(workerUrls('/ForgeCoach/', 'https://jalirkan.github.io/ForgeCoach/?skin=felt#lab')).toEqual({
      script: 'https://jalirkan.github.io/ForgeCoach/sw.js',
      scope: 'https://jalirkan.github.io/ForgeCoach/',
    });
    expect(workerUrls('./', 'http://192.168.1.5:8642/?token=secret')).toEqual({ script: 'http://192.168.1.5:8642/sw.js', scope: 'http://192.168.1.5:8642/' });
    expect(workerUrls('./', 'https://pc.ts.net/forge/index.html')).toEqual({ script: 'https://pc.ts.net/forge/sw.js', scope: 'https://pc.ts.net/forge/' });
    expect(workerUrls('/', 'http://127.0.0.1:4173/')).toEqual({ script: 'http://127.0.0.1:4173/sw.js', scope: 'http://127.0.0.1:4173/' });
  });

  type Register = (url: string, opts: { scope: string }) => Promise<unknown>;
  const fakeWin = (sw?: { register: Register }) => ({
    navigator: { serviceWorker: sw },
    location: { href: 'https://jalirkan.github.io/ForgeCoach/' },
    document: { readyState: 'complete' },
    addEventListener: vi.fn(),
  });

  it('registers only in a production build, and only where the browser has service workers', () => {
    const register = vi.fn<Register>(() => Promise.resolve());
    registerServiceWorker({ prod: false, base: '/ForgeCoach/' }, fakeWin({ register }));
    expect(register).not.toHaveBeenCalled();
    registerServiceWorker({ prod: true, base: '/ForgeCoach/' }, fakeWin());
    registerServiceWorker({ prod: true, base: '/ForgeCoach/' }, fakeWin({ register }));
    expect(register).toHaveBeenCalledWith('https://jalirkan.github.io/ForgeCoach/sw.js', { scope: 'https://jalirkan.github.io/ForgeCoach/' });
  });

  it('waits for load when the page is still loading, and swallows a refusal', async () => {
    const register = vi.fn<Register>(() => Promise.reject(new Error('SecurityError')));
    const w = { ...fakeWin({ register }), document: { readyState: 'loading' } };
    registerServiceWorker({ prod: true, base: './' }, w);
    expect(register).not.toHaveBeenCalled();
    const [type, fn] = w.addEventListener.mock.calls[0]! as [string, () => void];
    expect(type).toBe('load');
    fn();
    expect(register).toHaveBeenCalledTimes(1);
    await Promise.resolve();
  });

  it('never pulls the worker rules into the page (sw.js must stay one chunk)', () => {
    for (const f of ['../main.tsx', './register.ts', './install.ts', '../ui/SettingsDialog.tsx']) {
      expect(readFileSync(new URL(f, import.meta.url), 'utf8'), f).not.toMatch(/^import .*(swRoutes|\/sw(\.ts)?')/m);
    }
  });
});

describe('install offer', () => {
  afterEach(() => resetInstallForTests());

  const CHROME_ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36';
  const IOS_SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
  const IOS_CHROME = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0 Mobile/15E148 Safari/604.1';
  const FIREFOX = 'Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0';

  function win(ua: string, { standalone = false, navStandalone }: { standalone?: boolean; navStandalone?: boolean } = {}) {
    const handlers: Record<string, (e: Event) => void> = {};
    return {
      handlers,
      addEventListener: (t: string, fn: (e: Event) => void) => void (handlers[t] = fn),
      matchMedia: (q: string) => ({ matches: standalone && q.includes('standalone') }),
      navigator: { userAgent: ua, standalone: navStandalone, maxTouchPoints: 0, platform: '' },
    };
  }

  function promptEvent(outcome: 'accepted' | 'dismissed') {
    const ev = new Event('beforeinstallprompt', { cancelable: true }) as InstallPromptEvent;
    const prompt = vi.fn(() => Promise.resolve());
    Object.assign(ev, { prompt, userChoice: Promise.resolve({ outcome }) });
    return { ev, prompt };
  }

  it('offers nothing where the browser has no install prompt (Firefox, iOS Chrome)', () => {
    for (const ua of [FIREFOX, IOS_CHROME, CHROME_ANDROID]) {
      const w = win(ua);
      captureInstallPrompt(w);
      expect(installOffer(), ua).toBeNull();
    }
  });

  it("keeps Chromium's prompt for the Settings button, and hides it once installed", async () => {
    const w = win(CHROME_ANDROID);
    captureInstallPrompt(w);
    const seen = vi.fn();
    onInstallChange(seen);
    const { ev, prompt } = promptEvent('accepted');
    w.handlers.beforeinstallprompt!(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(installOffer()).toBe('prompt');
    expect(await promptInstall()).toBe('accepted');
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(installOffer()).toBeNull();
    expect(seen).toHaveBeenCalled();
    expect(await promptInstall()).toBe('unavailable');
  });

  it('hides the offer on appinstalled, and inside the installed app', () => {
    const w = win(CHROME_ANDROID);
    captureInstallPrompt(w);
    w.handlers.beforeinstallprompt!(promptEvent('dismissed').ev);
    w.handlers.appinstalled!(new Event('appinstalled'));
    expect(installOffer()).toBeNull();
    expect(installOffer(win(CHROME_ANDROID, { standalone: true }), promptEvent('dismissed').ev, false)).toBeNull();
    expect(installOffer(win(IOS_SAFARI, { navStandalone: true }), null, false)).toBeNull();
  });

  it('gives iOS Safari the Share → Add to Home Screen line', () => {
    captureInstallPrompt(win(IOS_SAFARI));
    expect(installOffer()).toBe('ios');
    expect(isIosSafari(IOS_SAFARI)).toBe(true);
    expect(isIosSafari(IOS_CHROME)).toBe(false);
    // iPadOS reports a Mac
    expect(isIosSafari('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15', 5, 'MacIntel')).toBe(true);
    expect(isIosSafari('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15', 0, 'MacIntel')).toBe(false);
    expect(isStandalone(win(IOS_SAFARI, { navStandalone: true }))).toBe(true);
  });
});

describe('theme colour per skin', () => {
  const css = (f: string) => readFileSync(new URL(`../ui/${f}`, import.meta.url), 'utf8');
  /** The first `--bg` inside the first block whose selector is exactly `sel`. */
  const bgOf = (text: string, sel: string) => {
    const i = text.indexOf(`${sel} {`);
    expect(i, sel).toBeGreaterThanOrEqual(0);
    return /--bg:\s*(#[0-9a-f]{6})/i.exec(text.slice(i, text.indexOf('}', i)))![1]!.toLowerCase();
  };

  it("is each skin's page background token", () => {
    expect(THEME_COLOR.classic).toBe(bgOf(css('styles.css'), ':root'));
    expect(THEME_COLOR.stack).toBe(bgOf(css('skins.css'), ":root[data-skin='stack']"));
    expect(THEME_COLOR.felt).toBe(bgOf(css('skins.css'), ":root[data-skin='felt']"));
  });

  it('changes the meta tag when the skin changes', async () => {
    const meta = { content: '', setAttribute(_n: string, v: string) { this.content = v; } };
    vi.stubGlobal('document', { querySelector: (q: string) => (q === 'meta[name="theme-color"]' ? meta : null) });
    try {
      const { applySkin } = await import('../ui/skin.ts');
      const root = { setAttribute: vi.fn() };
      for (const skin of ['felt', 'stack', 'classic'] as const) {
        applySkin(root, skin);
        expect(root.setAttribute).toHaveBeenLastCalledWith('data-skin', skin);
        expect(meta.content).toBe(THEME_COLOR[skin]);
      }
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
