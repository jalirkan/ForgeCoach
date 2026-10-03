// SPDX-License-Identifier: GPL-3.0-or-later
// `npm run bench:coach` — loads the TypeScript CLI (cli.ts) through Vite's SSR
// module loader, so the bench runs the app's own modules unchanged in Node.
// The server stays open while the CLI runs: the app loads the Anthropic SDK
// with a dynamic import, which needs a live loader.
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
  const cli = await server.ssrLoadModule('/bench/coach/cli.ts');
  process.exitCode = await cli.main(process.argv.slice(2));
} catch (e) {
  console.error(e instanceof Error ? e.stack ?? e.message : e);
  process.exitCode = 1;
} finally {
  await server.close();
}
