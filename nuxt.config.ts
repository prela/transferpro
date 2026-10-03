// https://nuxt.com/docs/api/configuration/nuxt-config
const themeBoot = `(function(){try{var stored=localStorage.getItem('transferpro-theme');if(stored==='light'||stored==='dark')document.documentElement.dataset.theme=stored}catch(e){}})()`

export default defineNuxtConfig({
  compatibilityDate: '2026-10-02',
  modules: ['@nuxtjs/i18n'],
  css: ['~/assets/shell.css'],
  // Stored theme before paint. System preference stays in CSS until then.
  app: {
    head: {
      script: [{ innerHTML: themeBoot, tagPriority: 'critical' }],
    },
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
