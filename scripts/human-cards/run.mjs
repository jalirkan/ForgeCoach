// SPDX-License-Identifier: GPL-3.0-or-later
// `npm run human-cards` — loads the TypeScript CLI (cli.ts) through Vite's SSR
// module loader, so the generator uses the app's own cube parser and schema.
// `npm run human-blend` (first argument `blend-test`) runs blendCli.ts instead,
// docs/human-blend.md's split-half test.
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
  const args = process.argv.slice(2);
  const blend = args[0] === 'blend-test';
  const cli = await server.ssrLoadModule(blend ? '/scripts/human-cards/blendCli.ts' : '/scripts/human-cards/cli.ts');
  process.exitCode = await cli.main(blend ? args.slice(1) : args);
} catch (e) {
  console.error(e instanceof Error ? e.stack ?? e.message : e);
  process.exitCode = 1;
} finally {
  await server.close();
}
