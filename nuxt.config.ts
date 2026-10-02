// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2026-10-02',
  typescript: {
    strict: true,
    // db/ is the Drizzle entry (charter layout). nuxi typecheck only sees the Nuxt project.
    tsConfig: {
      include: ['../db/**/*.ts'],
    },
  },
})
