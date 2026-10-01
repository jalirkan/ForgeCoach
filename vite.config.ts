import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Pages serves the site at https://jalirkan.github.io/ForgeCoach/.
export default defineConfig({
  base: process.env.GITHUB_PAGES ? '/ForgeCoach/' : '/',
  plugins: [react()],
  test: { environment: 'node' },
} as never);
