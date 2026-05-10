import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

export default defineConfig({
  plugins: [svelte()],
  server: {
    port: 5173,
    strictPort: false,
  },
  // Worklets must be served as ES modules; Vite's `?worker&url` keeps the
  // worklet file outside the main bundle so it can be loaded by URL.
  build: {
    target: 'es2022',
  },
})
