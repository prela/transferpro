// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2026-10-02',
  modules: ['@nuxt/ui', '@nuxtjs/i18n'],
  css: ['~/assets/css/main.css'],
  // System until the user picks light or dark. The stored string is the same
  // `transferpro-theme` key as before, applied before paint (ADR-0016).
  colorMode: {
    preference: 'system',
    fallback: 'light',
    classSuffix: '',
    storageKey: 'transferpro-theme',
  },
  // Lucide is installed locally. A missing icon stays missing.
  icon: {
    serverBundle: 'local',
    fallbackToApi: false,
    clientBundle: {
      scan: true,
    },
  },
  ui: {
    // system-ui only. A webfont would be fetched for a face we do not use.
    fonts: false,
  },
  i18n: {
    defaultLocale: 'hr',
    strategy: 'no_prefix',
    detectBrowserLanguage: false,
    locales: [
      { code: 'hr', language: 'hr', name: 'Hrvatski', file: 'hr.json' },
      { code: 'en', language: 'en', name: 'English', file: 'en.json' },
    ],
  },
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
