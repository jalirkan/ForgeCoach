// SPDX-License-Identifier: GPL-3.0-or-later
// `npm run human-picks` — loads cli.ts through Vite's SSR module loader, so the
// baselines use the app's own cube parser, card facts and pick advice
// (docs/human-picks.md; the fitting itself is fit.py).
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
  const cli = await server.ssrLoadModule('/scripts/human-picks/cli.ts');
  process.exitCode = await cli.main(process.argv.slice(2));
} catch (e) {
  console.error(e instanceof Error ? e.stack ?? e.message : e);
  process.exitCode = 1;
} finally {
  await server.close();
}
