import { z } from 'zod'

const emptyPayload = z.strictObject({})

const askedAtPayload = z.strictObject({
  askedAt: z.iso.datetime(),
})

/**
 * ADR-0035. Every job name the queue will accept, and the only shape of its
 * payload: uuids, an ISO instant, or an enum. Never free text. Strict, so an
 * extra key such as an email is refused. The check runs where a job is
 * written. Reading a job still hands the payload through.
 *
 * The foundation_* names are the queues in the job-queue RLS cases. They are
 * not product jobs. They keep those cases off the product queues.
 */
export const jobPayloads: Record<string, z.ZodType> = {
  'mail-outbox': z.strictObject({ entryId: z.uuid() }),
  'invoice-create': z.strictObject({ invoiceId: z.uuid() }),
  'mail-outbox-retention': emptyPayload,
  'mail-outbox-retention-tenant': askedAtPayload,
  'unavailability-retention': emptyPayload,
  'unavailability-retention-tenant': askedAtPayload,
  'flight-landing': emptyPayload,
  'flight-landing-ask': askedAtPayload,
  'place-refresh': emptyPayload,
  'place-refresh-check': askedAtPayload,
  'contact-person-retention': emptyPayload,
  'contact-person-retention-tenant': askedAtPayload,
  'foundation_rollback': z.strictObject({ token: z.enum(['kept', 'dropped']) }),
  'foundation_session': z.strictObject({ tenantId: z.uuid() }),
  'foundation_request': emptyPayload,
  'foundation_worker': emptyPayload,
  'foundation_publish': emptyPayload,
}

export class JobPayloadError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'JobPayloadError'
  }
}

/**
 * Refuse an unknown name, or a payload outside that name's schema, before
 * the adapter inserts anything. The message is fixed. Error.message is not
 * redacted, and the name or the payload may be a phone or an address.
 */
export function assertJobPayload(name: string, data: unknown): void {
  // Own keys only. `toString` and `constructor` live on Object.prototype,
  // so a plain lookup would treat that function as a schema.
  if (!Object.hasOwn(jobPayloads, name))
    throw new JobPayloadError('unknown job')
  const schema = jobPayloads[name]
  if (!schema?.safeParse(data).success)
    throw new JobPayloadError('invalid job payload')
}
