import { execFileSync } from 'node:child_process';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { forgecoachPwa } from './src/pwa/vitePlugin.ts';

// The build a bug report names (mtg-table D410): the commit and the day it was built.
function buildId(): string {
  let sha = (process.env.GITHUB_SHA ?? '').slice(0, 7);
  if (!sha) {
    try {
      sha = execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch {
      sha = 'unknown';
    }
  }
  return `${sha} ${new Date().toISOString().slice(0, 10)}`;
}

export default defineConfig({
  define: { __FORGECOACH_BUILD__: JSON.stringify(buildId()) },
  // Pages serves the site at https://jalirkan.github.io/ForgeCoach/. Set
  // FORGECOACH_BASE (e.g. './') to build for any path, such as the mtg-table
  // bridge serving the site itself.
  base: process.env.FORGECOACH_BASE ?? (process.env.GITHUB_PAGES ? '/ForgeCoach/' : '/'),
  // forgecoachPwa: the icons (drawn in code) and the service worker, sw.js (src/pwa/).
  plugins: [react(), forgecoachPwa()],
  test: { environment: 'node' },
} as never);
