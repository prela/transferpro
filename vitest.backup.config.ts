import { defineConfig } from 'vitest/config'

// Disposable Postgres 18. The fast job has no Docker.
export default defineConfig({
  test: {
    include: ['scripts/backup-restore.test.mjs'],
    testTimeout: 300_000,
    hookTimeout: 300_000,
  },
})
