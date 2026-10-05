/*
 * ForgeCoach — pwa/vitePlugin.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The installable site's build step (used by vite.config.ts):
 *   - emits the icons (pwa/icons.ts: SVG text and PNGs drawn in code) under
 *     icons/, and serves the same bytes from the dev server;
 *   - builds pwa/sw.ts (with pwa/swRoutes.ts, the rules the tests check) into
 *     sw.js as a chunk of the same Rollup build, then fills in its precache
 *     list (the shell: index.html, the entry chunk and its static imports and
 *     stylesheets, the manifest, the icons) and a version hashed from that list.
 * sw.js must stand alone (a classic worker script): the build fails if Rollup
 * ever gives it an import.
 */
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import type { Plugin } from 'vite';
import { ICONS, renderIcon } from './icons.ts';

const SW_ENTRY = 'src/pwa/sw.ts';
export const SW_FILE = 'sw.js';

const deflate = (b: Uint8Array) => new Uint8Array(deflateSync(b, { level: 9 }));

/** The shell the worker precaches, as paths relative to the base. Pure, for the tests. */
export function precacheList(bundle: Record<string, { type: string; fileName: string; isEntry?: boolean; imports?: string[]; viteMetadata?: { importedCss?: Set<string> } }>): string[] {
  const out = new Set<string>(['./', 'manifest.webmanifest', ...ICONS.map((i) => i.path)]);
  const seen = new Set<string>();
  const visit = (name: string) => {
    if (seen.has(name)) return;
    seen.add(name);
    const c = bundle[name];
    if (!c || c.type !== 'chunk') return;
    out.add(c.fileName);
    for (const css of c.viteMetadata?.importedCss ?? []) out.add(css);
    for (const i of c.imports ?? []) visit(i);
  };
  for (const c of Object.values(bundle)) if (c.type === 'chunk' && c.isEntry && c.fileName !== SW_FILE) visit(c.fileName);
  return [...out];
}

/** Puts the version and the precache list into the built worker's placeholders. */
export function fillWorker(code: string, precache: string[]): string {
  const version = createHash('sha256').update(JSON.stringify(precache)).digest('hex').slice(0, 12);
  const filled = code
    .replace(/(["'`])__FORGECOACH_SW_VERSION__\1/g, JSON.stringify(version))
    .replace(/(["'`])__FORGECOACH_SW_PRECACHE__\1/g, JSON.stringify(JSON.stringify(precache)));
  if (filled.includes('__FORGECOACH_SW_')) throw new Error('sw.js: a placeholder was not filled');
  return filled;
}

export function forgecoachPwa(): Plugin {
  let isBuild = false;
  return {
    name: 'forgecoach-pwa',
    configResolved(c) {
      isBuild = c.command === 'build';
    },
    buildStart() {
      if (!isBuild) return;
      this.emitFile({ type: 'chunk', id: SW_ENTRY, fileName: SW_FILE });
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = (req.url ?? '').split('?')[0]!;
        const icon = ICONS.find((i) => path.endsWith(`/${i.path}`));
        if (!icon) return next();
        const { body, type } = renderIcon(icon, deflate);
        res.setHeader('Content-Type', type);
        res.end(Buffer.from(body));
      });
    },
    generateBundle(_opts, bundle) {
      if (!isBuild) return;
      for (const icon of ICONS) {
        const { body } = renderIcon(icon, deflate);
        this.emitFile({ type: 'asset', fileName: icon.path, source: body });
      }
      const sw = bundle[SW_FILE];
      if (!sw || sw.type !== 'chunk') this.error(`${SW_FILE} was not built`);
      if (sw.imports.length || sw.dynamicImports.length) this.error(`${SW_FILE} must not import other chunks (${[...sw.imports, ...sw.dynamicImports].join(', ')}): keep pwa/swRoutes.ts out of the app's imports`);
      if (/^\s*export\b/m.test(sw.code)) this.error(`${SW_FILE} must be a classic script, without exports`);
      sw.code = fillWorker(sw.code, precacheList(bundle as never));
    },
  };
}
