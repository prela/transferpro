import process from 'node:process'
import { defineConfig } from 'drizzle-kit'

// Owner role only. Not part of the app environment (ADR-0011).
// `generate` does not connect; the placeholder is so the config still loads.
const url = process.env.DATABASE_MIGRATE_URL
if (!url && process.argv.includes('migrate'))
  throw new Error('DATABASE_MIGRATE_URL is required')

export default defineConfig({
  dialect: 'postgresql',
  schema: './db/schema.ts',
  out: './db/migrations',
  dbCredentials: { url: url ?? 'postgres://127.0.0.1:5432/transferpro' },
  strict: true,
})
