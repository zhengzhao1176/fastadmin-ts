import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    setupFiles: ['tests/helpers/global-setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    fileParallelism: false,
    sequence: { concurrent: false },
    reporters: ['default'],
    include: ['tests/**/*.test.ts'],
    exclude: ['node_modules/**', 'fastAdmin/**', 'task/**', 'doc/**'],
  },
})
