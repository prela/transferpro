// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2026-10-02',
  nitro: {
    // Project root, not the Nuxt 4 `app/` srcDir. Replaces the dev and
    // prod handlers so neither writes a stack nor calls console.error.
    errorHandler: './server/error.ts',
  },
  typescript: {
    strict: true,
    // db/ is the Drizzle entry (charter layout). nuxi typecheck only sees the Nuxt project.
    tsConfig: {
      include: ['../db/**/*.ts'],
    },
  },
})
