import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

export default defineConfig({
  // Sub-path deploys (e.g. a GitHub project Pages site) set VITE_BASE; all
  // asset and worklet URLs are resolved through import.meta.env.BASE_URL.
  base: process.env.VITE_BASE ?? '/',
  plugins: [svelte()],
  server: {
    // Distinct port so the synthex app (5173) can run standalone at the
    // same time as the studio.
    port: 5180,
    strictPort: false,
  },
  build: {
    target: 'es2022',
  },
})
