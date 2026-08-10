import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

export default defineConfig({
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
