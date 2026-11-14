import type { I18nOptions } from 'vue-i18n'
import { croatianPluralIndex } from '../shared/croatian-plural'

/**
 * The i18n module strips this call and loads the function. Croatian needs
 * one / few / other. English keeps vue-i18n's own rule, so a two-form
 * message stays one and other.
 */
declare function defineI18nConfig<Config extends I18nOptions>(loader: () => Config): () => Config

function croatianPluralConfig(): I18nOptions {
  return {
    pluralRules: {
      hr: croatianPluralIndex,
    },
  }
}

export default defineI18nConfig(croatianPluralConfig)
