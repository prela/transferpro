import * as Sentry from '@sentry/nuxt'
import { buildBaseSentryOptions } from './shared/sentry'

const runtimeConfig = useRuntimeConfig()
const dsn = runtimeConfig.public.sentryDsn

if (typeof dsn === 'string' && dsn !== '') {
  Sentry.init(buildBaseSentryOptions({
    dsn,
    release: runtimeConfig.public.sentryRelease || undefined,
    environment: runtimeConfig.public.sentryEnvironment,
  }))
}
