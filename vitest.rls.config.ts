import { defineConfig } from 'vitest/config'

// Separate from the unit config so `pnpm test` does not need Postgres.
export default defineConfig({
  test: {
    include: ['server/**/*.rls.test.ts'],
    fileParallelism: false,
    // RLS tests spawn the provisioning script (tsx cold start ~3s on CI).
    testTimeout: 30_000,
  },
})
