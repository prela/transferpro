import type { ClientBilling, ClientBillingSave } from '../../../../shared'
import type { TenantTransaction } from '../../../core/index'
import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { billingDetailsAreComplete, billingDetailsChangedFields, clientBillingSchema, EMPTY_BILLING_DETAILS, isoCountrySchema, StaleSaveError } from '../../../../shared'
import { hideDatabaseError, postgresErrorCode } from '../../../core/index'
import { appendAuditEntry } from '../../audit'
import { TenantAccessError } from '../../tenancy'
import { ClientNotFoundError } from './clients'

function officeOnly(role: string): void {
  // Legal name, OIB, VAT id, and address are office facts. A driver is
  // refused here, not by whoever already holds the transaction (ADR-0051).
  if (role === 'admin' || role === 'dispatcher')
    return
  throw new TenantAccessError(403)
}

const billingRow = z.object({
  clientId: z.uuid(),
  legalName: z.string(),
  country: isoCountrySchema,
  oib: z.string().nullable(),
  vatId: z.string().nullable(),
  address: z.string(),
  guestNameOnInvoice: z.boolean(),
  version: z.number().int(),
  changedAt: z.coerce.date().nullable(),
  changedByName: z.string().min(1).nullable(),
})

const billingRows = z.object({
  rows: z.array(billingRow),
})

const claimedRows = z.object({
  rows: z.array(z.object({ id: z.uuid() })),
})

const clientRows = z.object({
  rows: z.array(z.object({ id: z.uuid() })),
})

/**
 * The Client has to be in this Tenant before billing details are read or
 * written. A missing id and another Tenant's id are the same 404. This read
 * does not lock the Client and does not change its version (ADR-0051).
 */
async function requireClient(transaction: TenantTransaction, clientId: string): Promise<void> {
  const selected = clientRows.parse(await transaction.execute(sql`
    select id from app.clients where id = ${clientId}
  `))
  if (!selected.rows[0])
    throw new ClientNotFoundError()
}

function toBilling(clientId: string, row: z.infer<typeof billingRow> | null): ClientBilling {
  if (!row) {
    return clientBillingSchema.parse({
      clientId,
      ...EMPTY_BILLING_DETAILS,
      complete: false,
      version: null,
      changedAt: null,
      changedByName: null,
    })
  }
  const values = {
    legalName: row.legalName,
    country: row.country,
    oib: row.oib,
    vatId: row.vatId,
    address: row.address,
    guestNameOnInvoice: row.guestNameOnInvoice,
  }
  return clientBillingSchema.parse({
    clientId,
    ...values,
    complete: billingDetailsAreComplete(values),
    version: row.version,
    changedAt: row.changedAt?.toISOString() ?? null,
    changedByName: row.changedByName,
  })
}

const billingSelect = sql`
  select n.client_id as "clientId", n.legal_name as "legalName", n.country,
         n.oib, n.vat_id as "vatId", n.address,
         n.guest_name_on_invoice as "guestNameOnInvoice", n.version,
         n.data_changed_at as "changedAt",
         changed_by.name as "changedByName"
  from app.client_billing_details as n
  -- The view is already this session's tenant. The tenant predicate keeps
  -- another tenant's name off the row if that filter is ever wider.
  left join app.tenant_member as changed_by
    on changed_by.user_id = n.data_changed_by
   and changed_by.tenant_id = n.tenant_id
`

/**
 * This Client's billing details, and whether they are complete.
 * No row is incomplete, not a missing Client. The role is checked here.
 * A driver is refused before any row is read. Invoicing calls this through
 * the clients module entry, inside a tenant session.
 */
export async function loadClientBillingDetails(transaction: TenantTransaction, clientId: string, role: string): Promise<ClientBilling> {
  officeOnly(role)
  return readBilling(transaction, clientId)
}

/**
 * Billing for the invoice job. The job has no member role: the office check
 * already ran when the invoice was requested. RLS still limits the row to
 * this Tenant. A missing Client throws, and the job treats that as a refusal.
 */
export async function loadClientBillingForInvoice(transaction: TenantTransaction, clientId: string): Promise<ClientBilling> {
  return readBilling(transaction, clientId)
}

async function readBilling(transaction: TenantTransaction, clientId: string): Promise<ClientBilling> {
  await requireClient(transaction, clientId)
  const selected = billingRows.parse(await transaction.execute(sql`
    ${billingSelect}
    where n.client_id = ${clientId}
  `))
  return toBilling(clientId, selected.rows[0] ?? null)
}

/** The row a concurrent save has already committed, locked for this transaction. */
async function lockBilling(transaction: TenantTransaction, clientId: string) {
  const selected = billingRows.parse(await transaction.execute(sql`
    ${billingSelect}
    where n.client_id = ${clientId}
    for update of n
  `))
  return selected.rows[0] ?? null
}

/** A second insert is already a stale save. Pass it through. A bound value must not reach a log. */
function isStaleSave(error: unknown): boolean {
  return error instanceof StaleSaveError
}

function recordSaved(
  transaction: TenantTransaction,
  actorUserId: string,
  clientId: string,
  fields: ReturnType<typeof billingDetailsChangedFields>,
) {
  return appendAuditEntry(transaction, {
    action: 'billing_details.saved',
    actorUserId,
    subjectUserId: null,
    data: { clientId, fields },
  })
}

/**
 * Insert the one billing row for this Client. Version starts at 1 with the
 * member and the time, so a later refusal can say who saved it and when.
 * A second insert of the same Client is 409 `stale_save` and writes nothing.
 * The Client's version is not touched.
 */
async function insertBilling(
  transaction: TenantTransaction,
  actorUserId: string,
  clientId: string,
  input: ClientBillingSave,
): Promise<ClientBilling> {
  const fields = billingDetailsChangedFields(EMPTY_BILLING_DETAILS, input)
  const claimed = claimedRows.parse(await hideDatabaseError(async () => {
    try {
      return await transaction.execute(sql`
        insert into app.client_billing_details (
          client_id, legal_name, country, oib, vat_id, address, guest_name_on_invoice,
          version, data_changed_at, data_changed_by
        )
        values (
          ${clientId}, ${input.legalName}, ${input.country}, ${input.oib}, ${input.vatId},
          ${input.address}, ${input.guestNameOnInvoice}, 1, now(), ${actorUserId}
        )
        returning id
      `)
    }
    catch (error) {
      if (postgresErrorCode(error) === '23505')
        throw new StaleSaveError()
      throw error
    }
  }, 'Client billing insert failed', { passthrough: isStaleSave }))
  if (!claimed.rows[0])
    throw new Error('Client billing insert returned no row.')
  await recordSaved(transaction, actorUserId, clientId, fields)
  return readBilling(transaction, clientId)
}

/**
 * Save this Client's billing details. The first save sends no version.
 * A second first save, including one that loses the race, is 409 `stale_save`.
 * A later save sends the version. A mismatch is 409 `stale_save` even when
 * the values would not change, and writes nothing. A fresh save of the same
 * values does not update and does not append. A billing save does not change
 * the Client's version.
 */
export async function saveClientBilling(
  transaction: TenantTransaction,
  actorUserId: string,
  clientId: string,
  input: ClientBillingSave,
): Promise<ClientBilling> {
  await requireClient(transaction, clientId)
  if (input.version === undefined)
    return insertBilling(transaction, actorUserId, clientId, input)

  const locked = await lockBilling(transaction, clientId)
  // A version for a row that is not there is the same refusal as a mismatch.
  if (!locked || locked.version !== input.version)
    throw new StaleSaveError()
  const current = toBilling(clientId, locked)
  const fields = billingDetailsChangedFields(current, input)
  if (fields.length === 0)
    return current

  const claimed = claimedRows.parse(await hideDatabaseError(() => transaction.execute(sql`
    update app.client_billing_details
    set legal_name = ${input.legalName},
        country = ${input.country},
        oib = ${input.oib},
        vat_id = ${input.vatId},
        address = ${input.address},
        guest_name_on_invoice = ${input.guestNameOnInvoice},
        version = version + 1,
        data_changed_at = now(),
        data_changed_by = ${actorUserId}
    where client_id = ${clientId}
      and version = ${input.version}
    returning id
  `), 'Client billing save failed'))
  if (!claimed.rows[0])
    throw new StaleSaveError()
  await recordSaved(transaction, actorUserId, clientId, fields)
  return readBilling(transaction, clientId)
}
