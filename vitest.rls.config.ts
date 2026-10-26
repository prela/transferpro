import { defineConfig } from 'vitest/config'
import { assertLoadedRlsDatabaseEnv } from './scripts/rls-database.mjs'

// Same refusal as `scripts/assert-rls-database.mjs`, for a direct
// `vitest --config vitest.rls.config.ts` that skips the pnpm script.
// A wrong database name throws here, before any test file is loaded.
assertLoadedRlsDatabaseEnv()

// Separate from the unit config so `pnpm test` does not need Postgres.
export default defineConfig({
  test: {
    include: ['server/**/*.rls.test.ts'],
    setupFiles: ['server/modules/tenancy/infrastructure/office-claim-fixture.setup.ts'],
    fileParallelism: false,
    // RLS tests spawn the provisioning script (tsx cold start ~3s on CI).
    testTimeout: 30_000,
  },
})
