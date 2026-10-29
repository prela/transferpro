import { expect, it } from 'vitest'
import { redact, REDACTED } from './redact'
import { scrubSentryPayload } from './sentry'

const token = 'current-tool-token-9911'

it('drops an invoicing token from a log line, a job payload, and an error-tracker event', () => {
  const logged = redact({
    msg: 'invoicing settings saved',
    token,
    invoicingToken: token,
    job: { name: 'invoice-create', data: { token, invoiceId: '9e4b3f6d-5555-4555-8555-555555555555' } },
  })
  expect(logged).toMatchObject({
    token: REDACTED,
    invoicingToken: REDACTED,
    job: { data: { token: REDACTED } },
  })
  expect(JSON.stringify(logged)).not.toContain(token)

  const event = scrubSentryPayload({
    type: undefined,
    event_id: '00000000000000000000000000000000',
    platform: 'node',
    timestamp: 1,
    extra: { token, lineText: 'Transfer' },
  })
  expect(JSON.stringify(event)).not.toContain(token)
})
