import process from 'node:process'
import * as Sentry from '@sentry/nuxt'
import { nodeEnv, parseAppEnv } from './server/core/index'
import { buildSentryOptions, markSentryEnabled } from './server/core/sentry'

const env = parseAppEnv(process.env)

if (env.SENTRY_DSN !== undefined) {
  Sentry.init(buildSentryOptions({
    dsn: env.SENTRY_DSN,
    release: env.SENTRY_RELEASE,
    environment: nodeEnv() ?? 'development',
  }))
  markSentryEnabled(error => Sentry.captureException(error))
}
