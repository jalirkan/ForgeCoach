import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { forgecoachPwa } from './src/pwa/vitePlugin.ts';

// Pages serves the site at https://jalirkan.github.io/ForgeCoach/. Set
// FORGECOACH_BASE (e.g. './') to build for any path, such as the mtg-table
// bridge serving the site itself.
export default defineConfig({
  base: process.env.FORGECOACH_BASE ?? (process.env.GITHUB_PAGES ? '/ForgeCoach/' : '/'),
  // forgecoachPwa: the icons (drawn in code) and the service worker, sw.js (src/pwa/).
  plugins: [react(), forgecoachPwa()],
  test: { environment: 'node' },
} as never);
