import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['server/**/*.test.ts', 'shared/**/*.test.ts'],
    // The cross-tenant proof needs Postgres. CI runs it; pre-commit does not.
    exclude: ['server/**/*.rls.test.ts', 'node_modules/**'],
    passWithNoTests: true,
  },
})
