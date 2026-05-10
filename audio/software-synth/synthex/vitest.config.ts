import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['packages/**/tests/**/*.test.ts'],
    environment: 'node',
    setupFiles: ['./packages/engine/tests/setup.ts'],
  },
})
