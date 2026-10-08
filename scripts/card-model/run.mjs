// SPDX-License-Identifier: GPL-3.0-or-later
// `npm run card-model -- export OUT.json [HALVES_DIR]` — loads the TypeScript
// exporter (export.ts) through Vite's SSR module loader, so it uses the app's
// own cube parser, card facts and score.ts. The fitting itself is Python
// (fit.py, synergy.py); see README.md in this folder.
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const server = await createServer({
  root,
  configFile: false,
  logLevel: 'error',
  appType: 'custom',
  server: { middlewareMode: true, hmr: false, watch: null },
  optimizeDeps: { noDiscovery: true, include: [] },
});
try {
  const cli = await server.ssrLoadModule('/scripts/card-model/export.ts');
  process.exitCode = await cli.main(process.argv.slice(2));
} catch (e) {
  console.error(e instanceof Error ? e.stack ?? e.message : e);
  process.exitCode = 1;
} finally {
  await server.close();
}
