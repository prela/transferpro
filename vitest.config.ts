import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['server/**/*.test.ts', 'shared/**/*.test.ts', 'scripts/**/*.test.mjs'],
    // The cross-tenant proof needs Postgres. CI runs it; pre-commit does not.
    // The disposable restore needs Docker and runs in the slow CI job.
    exclude: ['server/**/*.rls.test.ts', 'scripts/backup-restore.test.mjs', 'node_modules/**'],
    passWithNoTests: true,
  },
})
